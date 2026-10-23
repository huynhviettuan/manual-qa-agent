import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import {
  findActorByApiKey,
  getBug,
  getEvidence,
  getReview,
  latestTriage,
  getWorkflow,
  listRevisions,
  listSuites,
  workflowUsage,
  type Db,
} from '@qa/db';
import {
  AcceptanceCriterion,
  type Actor,
  DomainError,
  hasRole,
  ManualRunInput,
  newId,
  REVIEW_STATUSES,
  Role,
} from '@qa/domain';
import type { EvidenceStore } from '@qa/evidence';
import type { BugTracker } from '@qa/integrations';
import type { TriageClassifier } from '@qa/llm-adapter';
import { silentLogger, type Logger } from '@qa/observability';
import {
  addSuiteCases,
  buildReproduction,
  createSuite,
  DEFAULT_THRESHOLDS,
  getSuiteDetail,
  getSuiteRunReport,
  getCoverage,
  listQuestions,
  recordObservation,
  testCasesCsv,
  traceabilityCsv,
  attachManualEvidence,
  getManualRunDetail,
  listManualRuns,
  MAX_ATTACHMENT_BYTES,
  recordManualRun,
  runSuite,
  driftAlerts,
  getRunReport,
  projectMetrics,
  proposeBug,
  proposeExecutable,
  publishBug,
  revertBug,
  triageRun,
  requestRun,
  resolveReviewAndContinue,
  reviewExecutable,
  runStoryWorkflow,
  submitStory,
  type OrchestratorDeps,
} from '@qa/orchestrator';
import { ingestSource, revokeSource, SourceMeta } from '@qa/retrieval';
import { CONFIRMABLE_CAUSES, listQueue, promoteToReference, reviewTestCase } from '@qa/review';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
    correlationId: string;
  }
}

export type AppOptions = {
  deps: OrchestratorDeps;
  /** Evidence is served only through authenticated, project-scoped requests. */
  evidenceStore?: EvidenceStore;
  /** Failure triage provider (ADR-0009); triage endpoints are unavailable without it. */
  triager?: TriageClassifier;
  /** External bug tracker; null/undefined = integration disabled. */
  tracker?: BugTracker | null;
  logger?: Logger;
  rateLimitPerMinute?: number;
  /** Retention for evidence attached to manual runs (days; default 30). */
  evidenceRetentionDays?: number;
};

const ExecutableBody = z.object({ spec: z.unknown() });
const ExecutableReviewBody = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(2000).optional(),
});
const RunBody = z.object({
  caseId: z.string().min(1).max(100),
  environmentId: z.string().min(1).max(100),
  approvalId: z.string().min(1).max(100).optional(),
});

const STATUS_BY_CODE: Record<DomainError['code'], number> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IMMUTABLE: 409,
  ILLEGAL_TRANSITION: 409,
};

const StoryBody = z.object({
  externalId: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).default(''),
  acceptanceCriteria: z.array(AcceptanceCriterion).max(100),
  targetRelease: z.string().max(100).nullish(),
  environmentId: z.string().max(100).optional(),
});

const IngestBody = z.object({ meta: SourceMeta, content: z.string().min(1).max(200_000) });
const RevokeBody = z.object({ sourceId: z.string(), version: z.string() });
const DraftBody = z.object({ storyId: z.string(), environmentId: z.string().optional() });
const CaseReviewBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE'), reason: z.string().optional() }),
  z.object({ decision: z.literal('REJECT'), reason: z.string().min(1) }),
  z.object({ decision: z.literal('EDIT'), content: z.unknown(), reason: z.string().optional() }),
]);
const ResolveBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ASSIGN') }),
  z.object({ action: z.literal('REQUEST_INFO'), reason: z.string().min(1) }),
  z.object({ action: z.literal('ESCALATE'), reason: z.string().min(1), toRole: Role }),
  z.object({ action: z.literal('REJECT'), reason: z.string().min(1) }),
  z.object({ action: z.literal('CANCEL'), reason: z.string().min(1) }),
  z.object({
    action: z.literal('APPROVE'),
    reason: z.string().min(1),
    publishSource: z
      .object({
        sourceId: z.string().regex(/^[A-Za-z0-9._-]+$/),
        version: z.string().regex(/^[A-Za-z0-9._-]+$/),
        content: z.string().min(1).max(200_000),
        ruleKeys: z.array(z.string()).optional(),
      })
      .optional(),
    approvalTtlMs: z.number().int().positive().optional(),
    confirmedCause: z.enum(CONFIRMABLE_CAUSES).optional(),
  }),
]);
const QueueQuery = z.object({
  status: z.enum(REVIEW_STATUSES).optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const IdParams = z.object({ id: z.string().min(1).max(100) });

function apiKeyFrom(req: FastifyRequest): string | null {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header) return header;
  const auth = req.headers.authorization;
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { deps } = opts;
  const db: Db = deps.db;
  const app = Fastify({
    loggerInstance: (opts.logger ?? silentLogger) as FastifyBaseLogger,
  }) as unknown as FastifyInstance;

  await app.register(rateLimit, {
    max: opts.rateLimitPerMinute ?? 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => apiKeyFrom(req) ?? req.ip,
  });

  app.decorateRequest('actor', null as unknown as Actor);
  app.decorateRequest('correlationId', '');

  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-correlation-id'];
    req.correlationId =
      typeof incoming === 'string' && /^[\w-]{1,100}$/.test(incoming) ? incoming : newId('corr');
    reply.header('x-correlation-id', req.correlationId);
    if (req.url === '/healthz') return;
    // Identity and roles come only from the server-side key lookup, never from the request body.
    const key = apiKeyFrom(req);
    const actor = key ? await findActorByApiKey(db, key) : null;
    if (!actor) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    req.actor = actor;
  });

  app.setErrorHandler((err: unknown, req, reply: FastifyReply) => {
    if (err instanceof DomainError)
      return reply.code(STATUS_BY_CODE[err.code]).send({ error: err.code, message: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'VALIDATION', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply.code(status).send({ error: 'REQUEST_ERROR', message: (err as Error).message });
    req.log.error({ err, correlationId: req.correlationId }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', correlationId: req.correlationId });
  });

  const scope = (req: FastifyRequest) => ({ tenantId: req.actor.tenantId, projectId: req.actor.projectId });
  const idempotencyKey = (req: FastifyRequest) => {
    const k = req.headers['idempotency-key'];
    return typeof k === 'string' && k.length > 0 && k.length <= 200 ? k : undefined;
  };
  const orchestratorDeps = (req: FastifyRequest): OrchestratorDeps => ({
    ...deps,
    logger: req.log as unknown as Logger,
  });

  app.get('/healthz', async () => ({ ok: true }));

  // Who the presented key belongs to. Lets clients such as the agent tool server (ADR-0011) refuse to run with
  // the wrong kind of key; it reveals nothing the key holder can't already do.
  app.get('/api/me', async (req) => ({
    actorId: req.actor.id,
    tenantId: req.actor.tenantId,
    projectId: req.actor.projectId,
    roles: req.actor.roles,
  }));

  app.post('/api/stories', async (req, reply) => {
    const body = StoryBody.parse(req.body);
    const result = await submitStory(orchestratorDeps(req), req.actor, body, {
      environmentId: body.environmentId,
      idempotencyKey: idempotencyKey(req),
      correlationId: req.correlationId,
    });
    return reply.code(result.deduplicated ? 200 : 201).send(result);
  });

  app.post('/api/knowledge/ingestions', async (req, reply) => {
    const body = IngestBody.parse(req.body);
    const result = await ingestSource(db, req.actor, { meta: body.meta, body: body.content });
    return reply.code(result.status === 'INGESTED' ? 201 : 200).send(result);
  });

  app.post('/api/knowledge/revocations', async (req) => {
    const body = RevokeBody.parse(req.body);
    return { revoked: await revokeSource(db, req.actor, body.sourceId, body.version) };
  });

  app.post('/api/test-cases/draft', async (req, reply) => {
    const body = DraftBody.parse(req.body);
    const result = await runStoryWorkflow(orchestratorDeps(req), req.actor, body.storyId, {
      environmentId: body.environmentId,
      idempotencyKey: idempotencyKey(req),
      correlationId: req.correlationId,
    });
    return reply.code(result.deduplicated ? 200 : 201).send(result);
  });

  app.get('/api/test-cases/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    const revisions = await listRevisions(db, scope(req), id);
    if (revisions.length === 0) throw new DomainError('NOT_FOUND', `test case ${id} not found`);
    return { caseId: id, storyId: revisions[0]!.storyId, revisions };
  });

  app.post('/api/test-cases/:id/review', async (req) => {
    const { id } = IdParams.parse(req.params);
    return reviewTestCase(db, req.actor, id, CaseReviewBody.parse(req.body));
  });

  app.post('/api/test-cases/:id/promote', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    return reply.code(201).send(await promoteToReference(db, req.actor, id));
  });

  app.get('/api/reviews', async (req) => {
    const q = QueueQuery.parse(req.query);
    return { items: await listQueue(db, req.actor, q), limit: q.limit, offset: q.offset };
  });

  app.get('/api/reviews/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    if (hasRole(req.actor, 'AI_AGENT'))
      throw new DomainError('FORBIDDEN', 'the AI agent cannot read reviews');
    const review = await getReview(db, scope(req), id);
    if (!review) throw new DomainError('NOT_FOUND', `review ${id} not found`);
    return review;
  });

  app.post('/api/reviews/:id/resolve', async (req) => {
    const { id } = IdParams.parse(req.params);
    return resolveReviewAndContinue(orchestratorDeps(req), req.actor, id, ResolveBody.parse(req.body));
  });

  app.get('/api/workflows/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    const wf = await getWorkflow(db, scope(req), id);
    if (!wf) throw new DomainError('NOT_FOUND', `workflow ${id} not found`);
    return wf;
  });

  app.get('/api/workflows/:id/usage', async (req) => {
    const { id } = IdParams.parse(req.params);
    if (!hasRole(req.actor, 'QA_LEAD', 'ADMIN'))
      throw new DomainError('FORBIDDEN', 'usage data requires QA lead/admin');
    if (!(await getWorkflow(db, scope(req), id)))
      throw new DomainError('NOT_FOUND', `workflow ${id} not found`);
    return workflowUsage(db, scope(req), id);
  });

  // ---------------------------------------------------------------- Phase 2: execution

  app.post('/api/test-cases/:id/executables', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = ExecutableBody.parse(req.body);
    return reply.code(201).send(await proposeExecutable(db, req.actor, id, body.spec));
  });

  app.post('/api/executables/:id/review', async (req) => {
    const { id } = IdParams.parse(req.params);
    return reviewExecutable(db, req.actor, id, ExecutableReviewBody.parse(req.body));
  });

  app.post('/api/test-runs', async (req, reply) => {
    const body = RunBody.parse(req.body);
    const run = await requestRun({ db }, req.actor, { ...body, idempotencyKey: idempotencyKey(req) });
    return reply.code(run.state === 'QUEUED' ? 202 : 200).send(await getRunReport(db, scope(req), run.id));
  });

  app.get('/api/test-runs/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    return getRunReport(db, scope(req), id);
  });

  app.get('/api/evidence/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (hasRole(req.actor, 'AI_AGENT'))
      throw new DomainError('FORBIDDEN', 'raw evidence is not served to the AI agent');
    const evidence = await getEvidence(db, scope(req), id);
    if (!evidence || !opts.evidenceStore) throw new DomainError('NOT_FOUND', `evidence ${id} not found`);
    const data = await opts.evidenceStore.get(evidence.objectKey);
    if (!data) throw new DomainError('NOT_FOUND', `evidence ${id} content is no longer retained`);
    return reply
      .header('content-type', evidence.contentType)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `inline; filename="${evidence.name}"`)
      .header('x-evidence-digest', evidence.digest)
      .send(data);
  });

  // ---------------------------------------------------------------- Phase 3: triage, bugs, metrics

  const requireStore = () => {
    if (!opts.evidenceStore) throw new DomainError('VALIDATION', 'evidence store is not configured');
    return opts.evidenceStore;
  };
  const bugDeps = () => ({ db, store: requireStore(), tracker: opts.tracker ?? null });
  const requireLead = (req: FastifyRequest) => {
    if (!hasRole(req.actor, 'QA_LEAD', 'ADMIN')) throw new DomainError('FORBIDDEN', 'requires QA lead/admin');
  };

  app.post('/api/test-runs/:id/triage', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!opts.triager) throw new DomainError('VALIDATION', 'triage provider is not configured');
    const triage = await triageRun(
      {
        db,
        store: requireStore(),
        triager: opts.triager,
        logger: req.log as unknown as Logger,
        decisionCacheTtlMs: deps.decisionCacheTtlMs,
      },
      req.actor,
      id,
    );
    return reply.code(201).send(triage);
  });

  app.get('/api/test-runs/:id/triage', async (req) => {
    const { id } = IdParams.parse(req.params);
    const triage = await latestTriage(db, scope(req), id);
    if (!triage) throw new DomainError('NOT_FOUND', `run ${id} has no triage`);
    return triage;
  });

  app.get('/api/test-runs/:id/reproduction', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const md = await buildReproduction(db, requireStore(), scope(req), id);
    return reply
      .header('content-type', 'text/markdown; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(md);
  });

  app.post('/api/test-runs/:id/bugs', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    return reply.code(201).send(await proposeBug(bugDeps(), req.actor, id));
  });

  app.get('/api/bugs/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    const bug = await getBug(db, scope(req), id);
    if (!bug) throw new DomainError('NOT_FOUND', `bug ${id} not found`);
    return bug;
  });

  app.post('/api/bugs/:id/publish', async (req) => {
    const { id } = IdParams.parse(req.params);
    const { approvalId } = z.object({ approvalId: z.string().min(1).max(100) }).parse(req.body);
    return publishBug(bugDeps(), req.actor, id, approvalId);
  });

  app.post('/api/bugs/:id/revert', async (req) => {
    const { id } = IdParams.parse(req.params);
    const { reason } = z.object({ reason: z.string().min(1).max(2000) }).parse(req.body);
    return revertBug(bugDeps(), req.actor, id, reason);
  });

  app.get('/api/metrics', async (req) => {
    requireLead(req);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
    return projectMetrics(db, scope(req), days);
  });

  app.get('/api/metrics/alerts', async (req) => {
    requireLead(req);
    return { alerts: await driftAlerts(db, scope(req), DEFAULT_THRESHOLDS) };
  });

  // Test suites: managed sets of cases, run together (docs/07).
  app.post('/api/suites', async (req, reply) => {
    const body = z
      .object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional() })
      .parse(req.body);
    return reply.code(201).send(await createSuite(db, req.actor, body));
  });

  app.get('/api/suites', async (req) => ({ items: await listSuites(db, scope(req)) }));

  app.get('/api/suites/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    return getSuiteDetail(db, scope(req), id);
  });

  app.post('/api/suites/:id/cases', async (req) => {
    const { id } = IdParams.parse(req.params);
    const { cases } = z
      .object({
        cases: z
          .array(z.object({ caseId: z.string().min(1).max(100), section: z.string().max(200).optional() }))
          .min(1)
          .max(500),
      })
      .parse(req.body);
    return addSuiteCases(db, req.actor, id, cases);
  });

  app.post('/api/suites/:id/runs', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { environmentId } = z.object({ environmentId: z.string().min(1).max(100) }).parse(req.body);
    return reply.code(202).send(await runSuite({ db }, req.actor, id, { environmentId }));
  });

  app.get('/api/suite-runs/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    return getSuiteRunReport(db, scope(req), id);
  });

  // ---------------------------------------------------------------- coverage, exports, questions (ADR-0018)

  app.get('/api/coverage', async (req) => getCoverage(db, scope(req)));

  const csv = (reply: FastifyReply, name: string, body: string) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`)
      .header('cache-control', 'no-store')
      .send(body);

  app.get('/api/export/test-cases.csv', async (req, reply) => {
    const { suiteId } = z.object({ suiteId: z.string().min(1).max(100).optional() }).parse(req.query);
    return csv(reply, 'test-cases.csv', await testCasesCsv(db, scope(req), { suiteId }));
  });

  app.get('/api/export/traceability.csv', async (req, reply) =>
    csv(reply, 'traceability.csv', await traceabilityCsv(db, scope(req))),
  );

  app.get('/api/questions', async (req) => {
    if (hasRole(req.actor, 'AI_AGENT'))
      throw new DomainError('FORBIDDEN', 'the AI agent cannot read reviews');
    return { items: await listQuestions(db, scope(req)) };
  });

  app.post('/api/reviews/:id/observation', async (req) => {
    const { id } = IdParams.parse(req.params);
    const { currentBehaviour } = z.object({ currentBehaviour: z.string().min(1).max(4000) }).parse(req.body);
    return recordObservation(db, req.actor, id, currentBehaviour);
  });

  // ---------------------------------------------------------------- manual execution (ADR-0017)

  app.post('/api/manual-runs', async (req, reply) => {
    return reply.code(201).send(await recordManualRun(db, req.actor, ManualRunInput.parse(req.body)));
  });

  app.get('/api/manual-runs/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    return getManualRunDetail(db, scope(req), id);
  });

  app.get('/api/test-cases/:id/manual-runs', async (req) => {
    const { id } = IdParams.parse(req.params);
    return { items: await listManualRuns(db, scope(req), id) };
  });

  // JSON with base64 content: no multipart dependency, and the size limit is explicit.
  app.post(
    '/api/manual-runs/:id/evidence',
    { bodyLimit: Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4096 },
    async (req, reply) => {
      const { id } = IdParams.parse(req.params);
      const body = z
        .object({
          name: z.string().min(1).max(128),
          contentType: z.string().min(1).max(100),
          dataBase64: z.string().min(1),
        })
        .parse(req.body);
      const data = Buffer.from(body.dataBase64, 'base64');
      const deps = { db, store: requireStore(), evidenceRetentionDays: opts.evidenceRetentionDays };
      return reply.code(201).send(
        await attachManualEvidence(deps, req.actor, id, {
          name: body.name,
          contentType: body.contentType,
          data,
        }),
      );
    },
  );

  return app;
}
