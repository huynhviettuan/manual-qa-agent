import {
  approvedExecutableForCase,
  claimNextRun,
  createOrGetRun,
  deleteEvidenceRow,
  expiredEvidence,
  expiredLeases,
  getActor,
  getApproval,
  getEnvironment,
  getExecutable,
  getRun,
  insertAuditEvent,
  insertEvidence,
  insertExecutable,
  insertPolicyEvaluation,
  latestRevision,
  listEvidence,
  reviewExecutableRow,
  updateRunState,
  type Db,
  type ExecutableRow,
  type RunRow,
} from '@qa/db';
import {
  type Actor,
  destructiveSteps,
  DomainError,
  ExecutableSpec,
  hasRole,
  newId,
  type RunStatus,
  specHash,
  type TenantScope,
  transitionRun,
} from '@qa/domain';
import type { EvidenceStore } from '@qa/evidence';
import type { ExecutionOutcome, Executor, SecretResolver } from '@qa/execution';
import { silentLogger, type Logger } from '@qa/observability';
import { evaluate, type PolicyResult } from '@qa/policy-engine';
import { openReview } from '@qa/review';

export type RunDeps = {
  db: Db;
  executor: Executor;
  store: EvidenceStore;
  secrets: SecretResolver;
  logger?: Logger;
  /** Evidence retention in days (default 30). */
  evidenceRetentionDays?: number;
};

const AUTHOR_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN', 'AI_AGENT'] as const;
const REVIEWER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN'] as const;
const RUNNER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN', 'AI_AGENT'] as const;

const scopeOf = (a: { tenantId: string; projectId: string }): TenantScope => ({
  tenantId: a.tenantId,
  projectId: a.projectId,
});

// ------------------------------------------------------------------ executables (ADR-0008)

/**
 * Proposes an executable version of the case's latest APPROVED revision. Authors include the AI
 * agent (an LLM may propose steps); a different human must approve before anything runs.
 */
export async function proposeExecutable(
  db: Db,
  actor: Actor,
  caseId: string,
  input: unknown,
): Promise<ExecutableRow> {
  if (!hasRole(actor, ...AUTHOR_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot propose executables`);
  const parsed = ExecutableSpec.safeParse(input);
  if (!parsed.success)
    throw new DomainError('VALIDATION', `invalid executable spec: ${parsed.error.message}`);
  const spec = parsed.data;
  const scope = scopeOf(actor);

  const revision = await latestRevision(db, scope, caseId);
  if (!revision) throw new DomainError('NOT_FOUND', `test case ${caseId} not found`);
  if (revision.status !== 'APPROVED') {
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      `case revision ${revision.revision} is ${revision.status}, not APPROVED`,
    );
  }
  // Traceability: steps may only cite sources the approved case cites, or story ACs.
  const allowed = new Set(revision.sourceRefs);
  const untraced = [...spec.setup, ...spec.steps, ...spec.teardown]
    .flatMap((s) => s.sourceRefs)
    .filter((r) => !allowed.has(r) && !r.startsWith('story:'));
  if (untraced.length) {
    throw new DomainError(
      'VALIDATION',
      `steps cite sources outside the approved case: ${[...new Set(untraced)].join(', ')}`,
    );
  }

  const row = await insertExecutable(db, scope, {
    caseId,
    caseRevision: revision.revision,
    spec,
    specHash: specHash(spec),
    destructiveSteps: destructiveSteps(spec),
    proposedBy: actor.id,
  });
  await audit(
    db,
    scope,
    actor.id,
    'EXECUTABLE_PROPOSE',
    row.specHash,
    `${caseId}:x${row.version}`,
    'PROPOSED',
  );
  return row;
}

export async function reviewExecutable(
  db: Db,
  actor: Actor,
  executableId: string,
  input: { decision: 'APPROVE' | 'REJECT'; reason?: string },
): Promise<ExecutableRow> {
  if (!hasRole(actor, ...REVIEWER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot review executables`);
  const scope = scopeOf(actor);
  const exe = await getExecutable(db, scope, executableId);
  if (!exe) throw new DomainError('NOT_FOUND', `executable ${executableId} not found`);
  if (exe.proposedBy === actor.id)
    throw new DomainError('FORBIDDEN', 'the proposer cannot review their own executable');
  if (input.decision === 'APPROVE') {
    const revision = await latestRevision(db, scope, exe.caseId);
    if (revision?.revision !== exe.caseRevision || revision.status !== 'APPROVED') {
      throw new DomainError('CONFLICT', 'the case has changed since this executable was proposed');
    }
  }
  const row = await reviewExecutableRow(db, scope, executableId, {
    status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    reviewedBy: actor.id,
    reason: input.reason ?? null,
  });
  await audit(db, scope, actor.id, `EXECUTABLE_${input.decision}`, row.specHash, row.id, row.status);
  return row;
}

// ------------------------------------------------------------------ policy

async function evaluateRunPolicy(
  db: Db,
  actor: Actor,
  run: RunRow,
  exe: ExecutableRow,
): Promise<PolicyResult> {
  const scope = scopeOf(run);
  const environment = await getEnvironment(db, scope, run.environmentId);
  const revision = await latestRevision(db, scope, run.caseId);
  const approval = run.approvalId ? await getApproval(db, scope, run.approvalId) : null;
  const executable =
    !!environment?.baseUrl && (environment.allowedHosts ?? []).includes(new URL(environment.baseUrl).host);

  const result = evaluate({
    actor,
    proposal: {
      kind: 'execute',
      projectId: run.projectId,
      environmentId: run.environmentId,
      caseId: run.caseId,
      parameters: { executableId: exe.id, specHash: exe.specHash },
    },
    environment,
    sourcesTrusted: true,
    hasContradiction: false,
    // An approved executable of the case's current approved revision is the execution
    // equivalent of "ready"; anything else is blocked.
    classifiedReadiness:
      executable &&
      exe.status === 'APPROVED' &&
      revision?.status === 'APPROVED' &&
      revision.revision === exe.caseRevision
        ? 'ready'
        : 'blocked',
    grounded: true,
    criteriaCovered: true,
    destructive: exe.destructiveSteps.length > 0,
    approval,
  });
  if (!executable && result.gate !== 'DENY') {
    result.gate = 'DENY';
    result.reasons = ['ENVIRONMENT_NOT_EXECUTABLE'];
  }
  await insertPolicyEvaluation(db, scope, {
    workflowId: null,
    actorId: actor.id,
    actionKind: 'execute',
    actionHash: result.actionHash,
    environmentId: run.environmentId,
    policyVersion: result.policyVersion,
    gate: result.gate,
    reasons: result.reasons,
    decisionRecordId: null,
    approvalId: result.approvalId,
  });
  return result;
}

/** POLICY_CHECK -> BLOCKED, opening a scoped approval review when that is what's missing. */
async function block(
  db: Db,
  actor: Actor,
  run: RunRow,
  exe: ExecutableRow,
  policy: PolicyResult,
): Promise<RunRow> {
  const scope = scopeOf(run);
  let reviewId: string | null = null;
  if (policy.gate === 'NEEDS_HUMAN_REVIEW' && policy.reasons.includes('SCOPED_APPROVAL_REQUIRED')) {
    const review = await openReview(db, scope, actor.id, {
      workflowId: null,
      kind: 'ACTION_APPROVAL',
      subjectType: 'test_run',
      subjectId: run.id,
      question: `Approve executing destructive steps [${exe.destructiveSteps.join(', ')}] of ${exe.caseId} (executable v${exe.version}) in "${run.environmentId}"?`,
      reason: 'DESTRUCTIVE_STEPS',
      sourceRefs: [],
      recommendedAction: 'APPROVE_SCOPED_ACTION',
      modelSuggestion: null,
      targetEnvironment: run.environmentId,
      proposedActionHash: policy.actionHash,
      policyVersion: policy.policyVersion,
      expiresAt: null,
    });
    reviewId = review.id;
  }
  const reason =
    policy.gate === 'DENY'
      ? `DENIED:${policy.reasons.join(',')}`
      : `REVIEW_REQUIRED:${policy.reasons.join(',')}`;
  transitionRun(run.state, 'BLOCKED');
  const blocked = await updateRunState(db, scope, run.id, run.state, {
    state: 'BLOCKED',
    reason,
    reviewId,
    finished: true,
  });
  await audit(
    db,
    scope,
    actor.id,
    'RUN_BLOCKED',
    policy.actionHash,
    run.id,
    reason,
    policy.policyVersion,
    policy.approvalId,
  );
  return blocked;
}

// ------------------------------------------------------------------ runs (Workflow B)

export type RunRequest = {
  caseId: string;
  environmentId: string;
  approvalId?: string;
  idempotencyKey?: string;
};

/**
 * Creates a QUEUED run for the case's approved executable. Policy is checked now (fast feedback)
 * and again by the worker immediately before execution (approvals may expire or be revoked).
 */
export async function requestRun(deps: Pick<RunDeps, 'db'>, actor: Actor, req: RunRequest): Promise<RunRow> {
  if (!hasRole(actor, ...RUNNER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot request runs`);
  const { db } = deps;
  const scope = scopeOf(actor);
  const exe = await approvedExecutableForCase(db, scope, req.caseId);
  if (!exe) throw new DomainError('ILLEGAL_TRANSITION', `test case ${req.caseId} has no approved executable`);

  const { run, created } = await createOrGetRun(db, scope, {
    caseId: req.caseId,
    caseRevision: exe.caseRevision,
    executableId: exe.id,
    specHash: exe.specHash,
    environmentId: req.environmentId,
    idempotencyKey: req.idempotencyKey ?? newId('runkey'),
    requestedBy: actor.id,
    approvalId: req.approvalId ?? null,
  });
  if (!created) return run;

  const policy = await evaluateRunPolicy(db, actor, run, exe);
  if (policy.gate === 'AUTO_PROCEED') {
    await audit(
      db,
      scope,
      actor.id,
      'RUN_QUEUED',
      policy.actionHash,
      run.id,
      'QUEUED',
      policy.policyVersion,
      policy.approvalId,
    );
    return run;
  }
  const checking = await updateRunState(db, scope, run.id, 'QUEUED', {
    state: transitionRun('QUEUED', 'POLICY_CHECK'),
  });
  return block(db, actor, checking, exe, policy);
}

/** Executes one claimed run end to end; never throws for run-level problems. */
async function executeClaimed(deps: RunDeps, claimed: RunRow, log: Logger): Promise<RunRow> {
  const { db } = deps;
  const scope = scopeOf(claimed);
  const exe = (await getExecutable(db, scope, claimed.executableId))!;
  const finish = async (
    from: RunStatus,
    state: RunStatus,
    reason: string,
    extra: Partial<Parameters<typeof updateRunState>[4]> = {},
  ) => {
    transitionRun(from, state);
    return updateRunState(db, scope, claimed.id, from, { state, reason, finished: true, ...extra });
  };

  // Re-check authority at execution time: the requester's current roles and any approval.
  const actor = await getActor(db, scope, claimed.requestedBy);
  if (!actor) return finish('POLICY_CHECK', 'BLOCKED', 'DENIED:REQUESTER_NOT_FOUND');
  const policy = await evaluateRunPolicy(db, actor, claimed, exe);
  if (policy.gate !== 'AUTO_PROCEED') return block(db, actor, claimed, exe, policy);
  if (exe.specHash !== claimed.specHash) return finish('POLICY_CHECK', 'BLOCKED', 'DENIED:SPEC_CHANGED');

  const environment = (await getEnvironment(db, scope, claimed.environmentId))!;
  await updateRunState(db, scope, claimed.id, 'POLICY_CHECK', {
    state: transitionRun('POLICY_CHECK', 'RUNNING'),
    started: true,
  });
  await audit(
    db,
    scope,
    actor.id,
    'RUN_START',
    policy.actionHash,
    claimed.id,
    'RUNNING',
    policy.policyVersion,
    policy.approvalId,
  );

  let outcome: ExecutionOutcome;
  try {
    outcome = await deps.executor.execute({
      runId: claimed.id,
      scope,
      spec: ExecutableSpec.parse(exe.spec),
      target: { baseUrl: environment.baseUrl!, allowedHosts: environment.allowedHosts ?? [] },
      secrets: deps.secrets,
      store: deps.store,
    });
  } catch (err) {
    log.error({ err, runId: claimed.id }, 'executor crashed');
    outcome = {
      verdict: 'INCONCLUSIVE',
      reason: 'EXECUTOR_CRASHED',
      assertions: [],
      steps: [],
      cleanupFailed: false,
      blockedRequests: [],
      evidence: [],
    };
  }

  const retentionUntil = new Date(Date.now() + (deps.evidenceRetentionDays ?? 30) * 86_400_000);
  for (const e of outcome.evidence) {
    await insertEvidence(db, scope, {
      runId: claimed.id,
      kind: e.kind,
      name: e.name,
      contentType: e.contentType,
      objectKey: e.objectKey,
      digest: e.digest,
      sizeBytes: e.sizeBytes,
      retentionUntil,
    });
  }
  const done = await finish('RUNNING', outcome.verdict, outcome.reason, {
    assertions: outcome.assertions,
    cleanupFailed: outcome.cleanupFailed,
    blockedRequests: outcome.blockedRequests,
  });
  await audit(
    db,
    scope,
    actor.id,
    'RUN_FINISH',
    policy.actionHash,
    claimed.id,
    outcome.verdict,
    policy.policyVersion,
    policy.approvalId,
  );
  log.info({ runId: claimed.id, verdict: outcome.verdict, reason: outcome.reason }, 'run finished');
  return done;
}

/**
 * Worker tick: first closes runs whose lease expired mid-flight as INCONCLUSIVE (side effects may
 * have happened, so they are never re-executed blindly), then claims and executes one QUEUED run.
 */
export async function workOnce(
  deps: RunDeps,
  workerId: string,
  leaseMs = 10 * 60_000,
): Promise<RunRow | null> {
  const log = deps.logger ?? silentLogger;
  for (const stale of await expiredLeases(deps.db)) {
    const scope = scopeOf(stale);
    // Lost before execution: nothing ran, so the run is simply blocked and may be re-requested.
    // Lost while RUNNING: steps may have had side effects, so the outcome is unknown.
    const [state, reason] =
      stale.state === 'RUNNING'
        ? (['INCONCLUSIVE', 'LEASE_LOST'] as const)
        : (['BLOCKED', 'LEASE_LOST_BEFORE_EXECUTION'] as const);
    transitionRun(stale.state, state);
    try {
      await updateRunState(deps.db, scope, stale.id, stale.state, { state, reason, finished: true });
      await audit(deps.db, scope, stale.leaseOwner ?? workerId, 'RUN_LEASE_LOST', null, stale.id, state);
    } catch (err) {
      // Only a concurrent update by another worker is expected here.
      if (!(err instanceof DomainError && err.code === 'CONFLICT')) throw err;
    }
  }
  const claimed = await claimNextRun(deps.db, workerId, leaseMs);
  return claimed ? executeClaimed(deps, claimed, log.child({ runId: claimed.id, workerId })) : null;
}

/** Report shape from docs/07: verdicts come only from deterministic assertions. */
export async function getRunReport(db: Db, scope: TenantScope, runId: string) {
  const run = await getRun(db, scope, runId);
  if (!run) throw new DomainError('NOT_FOUND', `run ${runId} not found`);
  const evidence = await listEvidence(db, scope, runId);
  return {
    id: run.id,
    caseRevisionId: `${run.caseId}:v${run.caseRevision}`,
    executableId: run.executableId,
    status: run.state,
    reason: run.reason,
    environmentId: run.environmentId,
    assertions: run.assertions,
    cleanupFailed: run.cleanupFailed,
    blockedRequests: run.blockedRequests,
    evidence: evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      digest: e.digest,
      sizeBytes: e.sizeBytes,
    })),
    reviewId: run.reviewId,
    approvalId: run.approvalId,
    // Phase 3 (triage) may add a *suspected* cause; it never changes `status`.
    suspectedCause: null,
    suspectedCauseIsVerified: false,
    requestedBy: run.requestedBy,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

async function audit(
  db: Db,
  scope: TenantScope,
  actorId: string,
  actionKind: string,
  actionHash: string | null,
  target: string,
  outcome: string,
  policyVersion: string | null = null,
  approvalId: string | null = null,
) {
  await insertAuditEvent(db, scope, {
    actorId,
    workflowId: null,
    correlationId: null,
    actionKind,
    actionHash,
    target,
    policyVersion,
    decisionRecordId: null,
    approvalId,
    outcome,
  });
}

/** Deletes evidence past its retention (objects first, then pointers). Returns the count purged. */
export async function purgeExpiredEvidence(db: Db, store: EvidenceStore, now = new Date()): Promise<number> {
  let purged = 0;
  for (const e of await expiredEvidence(db, now)) {
    await store.delete(e.objectKey);
    await deleteEvidenceRow(db, e.id);
    await audit(
      db,
      { tenantId: e.tenantId, projectId: e.projectId },
      'retention-job',
      'EVIDENCE_PURGE',
      e.digest,
      e.id,
      'PURGED',
    );
    purged++;
  }
  return purged;
}

export type WorkerLoopOptions = {
  workerId: string;
  /** Queue polling interval when idle. */
  idleMs?: number;
  /** Drain the queue, then return (cron/CI). */
  once?: boolean;
  signal?: AbortSignal;
};

/** Worker loop shared by the standalone worker and the API's optional embedded worker. */
export async function runWorkerLoop(deps: RunDeps, opts: WorkerLoopOptions): Promise<void> {
  const log = deps.logger ?? silentLogger;
  const idleMs = opts.idleMs ?? 2000;
  const sleep = () => new Promise((r) => setTimeout(r, idleMs));
  let lastPurge = 0;
  while (!opts.signal?.aborted) {
    try {
      if (Date.now() - lastPurge > 3_600_000) {
        const purged = await purgeExpiredEvidence(deps.db, deps.store);
        if (purged) log.info({ purged }, 'expired evidence purged');
        lastPurge = Date.now();
      }
      const run = await workOnce(deps, opts.workerId);
      if (!run) {
        if (opts.once) return;
        await sleep();
      }
    } catch (err) {
      log.error({ err }, 'worker tick failed');
      if (opts.once) throw err;
      await sleep();
    }
  }
}
