import {
  approvedExecutableForCase,
  getSuite,
  getSuiteRun,
  insertAuditEvent,
  insertSuite,
  insertSuiteRun,
  insertSuiteRunItem,
  latestRevision,
  latestTriage,
  listEvidence,
  listSuiteCases,
  listSuiteRunItems,
  upsertSuiteCase,
  type Db,
  type SuiteRunItemOutcome,
} from '@qa/db';
import { DomainError, DraftContent, hasRole, type Actor, type TenantScope } from '@qa/domain';
import { requestRun, type RunDeps } from './runs.ts';

const MANAGER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN'] as const;
const scopeOf = (a: Actor): TenantScope => ({ tenantId: a.tenantId, projectId: a.projectId });

function requireManager(actor: Actor) {
  if (!hasRole(actor, ...MANAGER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot manage test suites`);
}

async function audit(db: Db, actor: Actor, actionKind: string, target: string, outcome: string) {
  await insertAuditEvent(db, scopeOf(actor), {
    actorId: actor.id,
    workflowId: null,
    correlationId: null,
    actionKind,
    actionHash: null,
    target,
    policyVersion: null,
    decisionRecordId: null,
    approvalId: null,
    outcome,
  });
}

export async function createSuite(db: Db, actor: Actor, input: { name: string; description?: string }) {
  requireManager(actor);
  const suite = await insertSuite(db, scopeOf(actor), {
    name: input.name,
    description: input.description ?? '',
    createdBy: actor.id,
  });
  if (!suite) throw new DomainError('CONFLICT', `a suite named "${input.name}" already exists`);
  await audit(db, actor, 'SUITE_CREATED', suite.id, 'CREATED');
  return suite;
}

/** Adds cases (or moves them to another section). Every case must belong to the actor's project. */
export async function addSuiteCases(
  db: Db,
  actor: Actor,
  suiteId: string,
  cases: Array<{ caseId: string; section?: string }>,
) {
  requireManager(actor);
  const scope = scopeOf(actor);
  if (!(await getSuite(db, scope, suiteId))) throw new DomainError('NOT_FOUND', `suite ${suiteId} not found`);
  for (const c of cases) {
    if (!(await latestRevision(db, scope, c.caseId)))
      throw new DomainError('NOT_FOUND', `test case ${c.caseId} not found`);
  }
  for (const c of cases)
    await upsertSuiteCase(db, suiteId, { ...c, section: c.section ?? '', addedBy: actor.id });
  await audit(db, actor, 'SUITE_CASES_ADDED', suiteId, String(cases.length));
  return getSuiteDetail(db, scope, suiteId);
}

export async function getSuiteDetail(db: Db, scope: TenantScope, suiteId: string) {
  const suite = await getSuite(db, scope, suiteId);
  if (!suite) throw new DomainError('NOT_FOUND', `suite ${suiteId} not found`);
  const cases = await listSuiteCases(db, scope, suiteId);
  return {
    ...suite,
    cases: await Promise.all(
      cases.map(async (c) => ({
        caseId: c.caseId,
        section: c.section,
        title: DraftContent.safeParse(c.content).data?.title ?? c.caseId,
        status: c.status,
        revision: c.revision,
        sourceRefs: c.sourceRefs,
        automated: (await approvedExecutableForCase(db, scope, c.caseId)) !== null,
      })),
    ),
  };
}

/**
 * Requests one run per approved, automated case (each through `requestRun`, so policy applies per
 * case). Cases without an approved revision or an approved executable are recorded as such: they
 * are for a person to execute, and the report never presents them as passed.
 */
export async function runSuite(
  deps: Pick<RunDeps, 'db'>,
  actor: Actor,
  suiteId: string,
  input: { environmentId: string },
) {
  const { db } = deps;
  const scope = scopeOf(actor);
  const suite = await getSuite(db, scope, suiteId);
  if (!suite) throw new DomainError('NOT_FOUND', `suite ${suiteId} not found`);
  const cases = await listSuiteCases(db, scope, suiteId);
  if (cases.length === 0) throw new DomainError('VALIDATION', `suite ${suiteId} has no cases`);
  const suiteRun = await insertSuiteRun(db, scope, {
    suiteId,
    environmentId: input.environmentId,
    requestedBy: actor.id,
  });
  for (const c of cases) {
    let outcome: SuiteRunItemOutcome = 'NOT_APPROVED';
    let runId: string | null = null;
    if (c.status === 'APPROVED') {
      if (await approvedExecutableForCase(db, scope, c.caseId)) {
        const run = await requestRun(deps, actor, {
          caseId: c.caseId,
          environmentId: input.environmentId,
          idempotencyKey: `${suiteRun.id}:${c.caseId}`,
        });
        outcome = 'REQUESTED';
        runId = run.id;
      } else outcome = 'NOT_AUTOMATED';
    }
    await insertSuiteRunItem(db, {
      suiteRunId: suiteRun.id,
      caseId: c.caseId,
      runId,
      outcome,
      position: c.position,
    });
  }
  await audit(db, actor, 'SUITE_RUN_REQUESTED', suiteRun.id, input.environmentId);
  return getSuiteRunReport(db, scope, suiteRun.id);
}

const TERMINAL = new Set(['PASSED', 'FAILED', 'INCONCLUSIVE', 'BLOCKED']);

/** Per-case results with traceability; verdicts come from each run's deterministic assertions. */
export async function getSuiteRunReport(db: Db, scope: TenantScope, suiteRunId: string) {
  const suiteRun = await getSuiteRun(db, scope, suiteRunId);
  if (!suiteRun) throw new DomainError('NOT_FOUND', `suite run ${suiteRunId} not found`);
  const cases = new Map((await listSuiteCases(db, scope, suiteRun.suiteId)).map((c) => [c.caseId, c]));
  const items = await Promise.all(
    (await listSuiteRunItems(db, scope, suiteRunId)).map(async (i) => {
      const c = cases.get(i.caseId);
      const triage = i.runId ? await latestTriage(db, scope, i.runId) : null;
      const status = i.outcome === 'REQUESTED' ? i.runState! : i.outcome;
      return {
        caseId: i.caseId,
        section: c?.section ?? '',
        title: DraftContent.safeParse(c?.content).data?.title ?? i.caseId,
        sourceRefs: c?.sourceRefs ?? [],
        status,
        reason: i.runReason,
        runId: i.runId,
        durationMs:
          i.startedAt && i.finishedAt
            ? new Date(i.finishedAt).getTime() - new Date(i.startedAt).getTime()
            : null,
        evidence: i.runId ? (await listEvidence(db, scope, i.runId)).length : 0,
        suspectedCause: triage?.suspectedCause ?? null,
        suspectedCauseIsVerified: triage?.verifiedCause != null,
      };
    }),
  );
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const requested = items.filter((i) => i.runId);
  return {
    id: suiteRun.id,
    suiteId: suiteRun.suiteId,
    environmentId: suiteRun.environmentId,
    requestedBy: suiteRun.requestedBy,
    createdAt: suiteRun.createdAt,
    complete: requested.every((i) => TERMINAL.has(i.status)),
    totals: {
      cases: items.length,
      passed: count('PASSED'),
      failed: count('FAILED'),
      inconclusive: count('INCONCLUSIVE'),
      blocked: count('BLOCKED'),
      pending: requested.filter((i) => !TERMINAL.has(i.status)).length,
      notAutomated: count('NOT_AUTOMATED'),
      notApproved: count('NOT_APPROVED'),
    },
    items,
  };
}
