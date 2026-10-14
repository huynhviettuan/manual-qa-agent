import {
  getEnvironment,
  getExecutable,
  getRun,
  insertAuditEvent,
  insertDecisionRecord,
  insertTriage,
  insertUsageEvent,
  latestRevision,
  latestTriage,
  listEvidence,
  type Db,
  type RunRow,
  type TriageRow,
} from '@qa/db';
import { type Actor, DomainError, DraftContent, hasRole, redactSecrets, type TenantScope } from '@qa/domain';
import type { EvidenceStore } from '@qa/evidence';
import type { TriageClassifier, TriageFacts } from '@qa/llm-adapter';
import { silentLogger, type Logger } from '@qa/observability';
import { POLICY_VERSION } from '@qa/policy-engine';
import { openReview } from '@qa/review';
import { cachedDecision } from './decision-cache.ts';

export type TriageDeps = {
  db: Db;
  store: EvidenceStore;
  triager: TriageClassifier;
  logger?: Logger;
  decisionCacheTtlMs?: number | null;
};

const TRIAGE_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN', 'AI_AGENT'] as const;
const MAX_ITEMS = 10;
const clip = (s: string) => redactSecrets(s).text.slice(0, 300);

type StepLogEntry = { id: string; description: string; status: string; error?: string };
type NetworkEntry = {
  method?: string;
  url?: string;
  status?: number;
  failure?: string;
  console?: string;
  text?: string;
};

async function readJson<T>(
  db: Db,
  store: EvidenceStore,
  scope: TenantScope,
  runId: string,
  name: string,
): Promise<T | null> {
  const item = (await listEvidence(db, scope, runId)).find((e) => e.name === name);
  if (!item) return null;
  const data = await store.get(item.objectKey);
  try {
    return data ? (JSON.parse(data.toString()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic facts for triage: the first failing assertion (expected vs actual), step errors,
 * server errors and console errors from the stored logs. Bounded and redacted; no screenshots,
 * no request bodies, no query strings.
 */
export async function buildTriageFacts(db: Db, store: EvidenceStore, run: RunRow): Promise<TriageFacts> {
  const scope = { tenantId: run.tenantId, projectId: run.projectId };
  const steps =
    (await readJson<{ steps: StepLogEntry[] }>(db, store, scope, run.id, 'steps.json'))?.steps ?? [];
  const network =
    (await readJson<{ requests: NetworkEntry[] }>(db, store, scope, run.id, 'network.json'))?.requests ?? [];
  const env = await getEnvironment(db, scope, run.environmentId);
  const assertions = run.assertions as Array<{
    stepId: string;
    expected: unknown;
    actual: unknown;
    passed: boolean | null;
  }>;

  const failed = assertions.find((a) => a.passed !== true);
  const errored = steps.find((s) => s.status === 'error');
  const describe = (id: string) => clip(steps.find((s) => s.id === id)?.description ?? id);
  const failingStep = failed
    ? {
        id: failed.stepId,
        description: describe(failed.stepId),
        expected: typeof failed.expected === 'string' ? clip(failed.expected) : failed.expected,
        actual: typeof failed.actual === 'string' ? clip(failed.actual) : failed.actual,
      }
    : errored
      ? { id: errored.id, description: clip(errored.description), expected: null, actual: null }
      : null;

  const path = (u?: string) => {
    try {
      return new URL(u ?? '').pathname;
    } catch {
      return '?';
    }
  };
  return {
    verdict: run.state as 'FAILED' | 'INCONCLUSIVE',
    reason: clip(run.reason ?? ''),
    environmentKind: env?.kind ?? 'unknown',
    failingStep,
    stepErrors: steps
      .filter((s) => s.error)
      .map((s) => clip(s.error!))
      .slice(0, MAX_ITEMS),
    httpErrors: network
      .filter((n) => typeof n.status === 'number' && n.status >= 500)
      .map((n) => ({ method: n.method ?? 'GET', path: path(n.url), status: n.status! }))
      .slice(0, MAX_ITEMS),
    failedRequests: network.filter((n) => n.failure && n.failure !== 'net::ERR_BLOCKED_BY_CLIENT').length,
    blockedRequests: run.blockedRequests.length,
    consoleErrors: network
      .filter((n) => n.console === 'error')
      .map((n) => clip(n.text ?? ''))
      .slice(0, MAX_ITEMS),
  };
}

/**
 * Suggests a cause for a FAILED/INCONCLUSIVE run and routes it to a human: security-sensitive
 * suspicions (or an unavailable triage) go to a QA lead; others to a QA engineer to confirm.
 * Never changes the run's verdict (ADR-0009).
 */
export async function triageRun(deps: TriageDeps, actor: Actor, runId: string): Promise<TriageRow> {
  if (!hasRole(actor, ...TRIAGE_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot triage runs`);
  const { db } = deps;
  const scope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const log = deps.logger ?? silentLogger;
  const run = await getRun(db, scope, runId);
  if (!run) throw new DomainError('NOT_FOUND', `run ${runId} not found`);
  if (run.state !== 'FAILED' && run.state !== 'INCONCLUSIVE') {
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      `only FAILED or INCONCLUSIVE runs are triaged (run is ${run.state})`,
    );
  }

  const facts = await buildTriageFacts(db, deps.store, run);
  const { out, cacheHit } = await cachedDecision(
    db,
    scope,
    'triage',
    deps.triager.triageCacheId,
    facts,
    deps.decisionCacheTtlMs,
    () => deps.triager.triage(facts),
  );
  const decisionRecordId = await insertDecisionRecord(db, scope, {
    workflowId: null,
    kind: 'triage',
    provider: out.meta.provider,
    requestedModel: out.meta.requestedModel,
    model: out.meta.model,
    promptVersion: out.meta.promptVersion,
    inputHash: out.meta.inputHash,
    snapshotId: null,
    sourceRefs: [],
    outcome: out.ok ? 'OK' : out.failure,
    result: out.ok ? out.value : { failure: out.failure, detail: out.detail },
    usage: out.meta.usage,
    latencyMs: out.meta.latencyMs,
    cacheHit,
  });
  await insertUsageEvent(db, scope, {
    workflowId: null,
    component: cacheHit ? 'triage:cache' : 'triage',
    model: out.meta.model,
    inputTokens: out.meta.usage?.inputTokens ?? 0,
    outputTokens: out.meta.usage?.outputTokens ?? 0,
    cacheReadTokens: out.meta.usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: out.meta.usage?.cacheWriteTokens ?? 0,
    retrievedTokensEstimate: 0,
    latencyMs: out.meta.latencyMs,
  });

  // Provider unavailable: unknown cause, and unknown security relevance escalates (fail safe).
  const suggestion = out.ok
    ? out.value
    : {
        suspectedCause: 'UNKNOWN' as const,
        securitySensitive: true,
        securityProbability: null,
        rationale: null,
        confidence: null,
      };
  const kind = suggestion.securitySensitive ? 'SECURITY_TRIAGE' : 'FAILURE_TRIAGE';
  const facts1 = facts.failingStep
    ? `Step "${facts.failingStep.description}": expected ${JSON.stringify(facts.failingStep.expected)}, observed ${JSON.stringify(facts.failingStep.actual)}.`
    : `Reason: ${facts.reason}.`;
  const review = await openReview(db, scope, actor.id, {
    workflowId: null,
    kind,
    subjectType: 'test_run',
    subjectId: run.id,
    question: `${out.ok ? `Suggested cause: ${suggestion.suspectedCause} (unverified)` : `Automatic triage unavailable (${out.failure})`}. ${facts1} Confirm the actual cause${suggestion.securitySensitive ? ' and handle under the security process' : ''}.`,
    reason: out.ok ? `SUSPECTED_${suggestion.suspectedCause}` : `TRIAGE_${out.failure}`,
    sourceRefs: [],
    recommendedAction: 'CONFIRM_CAUSE',
    modelSuggestion: out.ok ? { ...suggestion, label: 'suggested' } : null,
    targetEnvironment: run.environmentId,
    proposedActionHash: null,
    policyVersion: POLICY_VERSION,
    expiresAt: null,
  });

  const row = await insertTriage(db, scope, {
    runId: run.id,
    suspectedCause: suggestion.suspectedCause,
    securitySensitive: suggestion.securitySensitive,
    securityProbability: suggestion.securityProbability,
    confidence: suggestion.confidence,
    rationale: suggestion.rationale ? clip(suggestion.rationale) : null,
    outcome: out.ok ? 'OK' : out.failure,
    decisionRecordId,
    reviewId: review.id,
  });
  await insertAuditEvent(db, scope, {
    actorId: actor.id,
    workflowId: null,
    correlationId: null,
    actionKind: 'RUN_TRIAGE',
    actionHash: null,
    target: run.id,
    policyVersion: POLICY_VERSION,
    decisionRecordId,
    approvalId: null,
    outcome: `${suggestion.suspectedCause}${suggestion.securitySensitive ? ':SECURITY' : ''}`,
  });
  log.info(
    { runId: run.id, suspected: suggestion.suspectedCause, security: suggestion.securitySensitive, cacheHit },
    'run triaged',
  );
  return row;
}

/**
 * Deterministic reproduction write-up (no model): environment, setup, steps up to the failure with
 * expected vs actual, the triage label (suspected or verified) and evidence references.
 */
export async function buildReproduction(
  db: Db,
  store: EvidenceStore,
  scope: TenantScope,
  runId: string,
): Promise<string> {
  const run = await getRun(db, scope, runId);
  if (!run) throw new DomainError('NOT_FOUND', `run ${runId} not found`);
  const [exe, env, revision, triage, evidence] = await Promise.all([
    getExecutable(db, scope, run.executableId),
    getEnvironment(db, scope, run.environmentId),
    latestRevision(db, scope, run.caseId),
    latestTriage(db, scope, run.id),
    listEvidence(db, scope, run.id),
  ]);
  const steps =
    (await readJson<{ steps: StepLogEntry[] }>(db, store, scope, run.id, 'steps.json'))?.steps ?? [];
  const assertions = new Map(
    (
      run.assertions as Array<{ stepId: string; expected: unknown; actual: unknown; passed: boolean | null }>
    ).map((a) => [a.stepId, a]),
  );
  const title = DraftContent.safeParse(revision?.content).data?.title ?? run.caseId;

  const line = (s: StepLogEntry, i: number) => {
    const a = assertions.get(s.id);
    const mark =
      s.status === 'error'
        ? `  <- ERROR: ${clip(s.error ?? '')}`
        : a && a.passed === false
          ? `  <- FAILED: expected ${JSON.stringify(a.expected)} but was ${JSON.stringify(a.actual)}`
          : a && a.passed === null
            ? '  <- NOT EVALUATED (element not found)'
            : s.status === 'skipped'
              ? '  (skipped)'
              : '';
    return `${i + 1}. ${clip(s.description)}${mark}`;
  };
  const phase = (p: string) => steps.filter((s) => (s as StepLogEntry & { phase?: string }).phase === p);
  const triageLine = triage
    ? triage.verifiedCause
      ? `${triage.verifiedCause} (verified by ${triage.verifiedBy})`
      : `${triage.suspectedCause} (suggested, unverified)`
    : 'not triaged';

  return [
    `# Reproduction: ${title}`,
    '',
    `- Run: ${run.id} (${run.state}${run.reason ? `: ${run.reason}` : ''})`,
    `- Test case: ${run.caseId} revision ${run.caseRevision}; executable v${exe?.version ?? '?'} (spec ${run.specHash.slice(0, 12)})`,
    `- Environment: ${run.environmentId} (${env?.kind ?? '?'}) ${env?.baseUrl ?? ''}`.trimEnd(),
    `- Triage: ${triageLine}${triage?.securitySensitive ? ' [security-sensitive]' : ''}`,
    `- Executed: ${run.startedAt?.toISOString() ?? '?'}`,
    '',
    ...(phase('setup').length ? ['## Setup', '', ...phase('setup').map(line), ''] : []),
    '## Steps',
    '',
    ...(phase('steps').length
      ? phase('steps').map(line)
      : ['(step log unavailable: evidence may have expired)']),
    '',
    ...(phase('teardown').length ? ['## Cleanup', '', ...phase('teardown').map(line), ''] : []),
    '## Evidence (authenticated access via the QA API)',
    '',
    ...evidence.map((e) => `- ${e.kind} ${e.name}: id ${e.id}, sha256 ${e.digest.slice(0, 16)}...`),
    '',
    'Secrets are shown as [secret:NAME] and never included. Verdicts come from deterministic assertions;',
    'any cause above marked "suggested" is a model suggestion, not a finding.',
  ].join('\n');
}
