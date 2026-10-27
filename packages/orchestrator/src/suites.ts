import {
  approvedExecutableForCase,
  getEnvironment,
  getRun,
  getSuite,
  getSuiteRun,
  insertAuditEvent,
  insertSuite,
  insertSuiteRun,
  insertSuiteRunItem,
  latestManualRunsForSuiteRun,
  latestRevision,
  latestTriage,
  listEvidence,
  listSuiteCases,
  listSuiteRunItems,
  listSuiteRuns,
  setSuiteRunPreflight,
  setSuiteRunSentinel,
  unstableCases,
  upsertSuiteCase,
  type Db,
  type EnvironmentRow,
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
        code: c.code,
        section: c.section,
        title: DraftContent.safeParse(c.content).data?.title ?? c.caseId,
        status: c.status,
        revision: c.revision,
        sourceRefs: c.sourceRefs,
        knownBug: c.knownBug,
        automated: (await approvedExecutableForCase(db, scope, c.caseId)) !== null,
      })),
    ),
  };
}

// ------------------------------------------------------------------ preflight (ADR-0021)

/** Answers whether the target is up: an HTTP answer below 500. A 5xx or a network error is not. */
export type TargetProbe = (baseUrl: string) => Promise<boolean>;

export const httpProbe: TargetProbe = async (baseUrl) => {
  try {
    const res = await fetch(baseUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
};

export type SuiteRunDeps = Pick<RunDeps, 'db'> & {
  /** Reachability check of the environment's target before anything is queued; `null` skips it. */
  probe?: TargetProbe | null;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/**
 * Checks the environment once before a suite run queues anything, so a dead or misconfigured
 * target reads as one BLOCKED suite run with a reason, never as N failed cases. The checks that
 * concern execution apply only when the suite has something to execute.
 */
export async function preflight(
  deps: SuiteRunDeps,
  scope: TenantScope,
  environmentId: string,
  automatedCases: number,
): Promise<{ environment: EnvironmentRow | null; reasons: string[] }> {
  const environment = await getEnvironment(deps.db, scope, environmentId);
  if (!environment) return { environment, reasons: ['UNKNOWN_ENVIRONMENT'] };
  const reasons: string[] = [];
  if (automatedCases > 0) {
    if (environment.kind === 'production') reasons.push('PRODUCTION_ENVIRONMENT');
    if (!environment.allowedActions.includes('execute')) reasons.push('EXECUTE_NOT_ALLOWED');
    const host = environment.baseUrl ? hostOf(environment.baseUrl) : null;
    if (!environment.baseUrl || !host || !(environment.allowedHosts ?? []).includes(host)) {
      reasons.push('ENVIRONMENT_NOT_EXECUTABLE');
    } else if (deps.probe !== null) {
      const probe = deps.probe ?? httpProbe;
      if (!(await probe(environment.baseUrl))) reasons.push('TARGET_UNREACHABLE');
    }
    // ADR-0022/0023: a named preflight or sentinel case must be runnable.
    for (const [caseId, reason] of [
      [environment.preflightCaseId, 'PREFLIGHT_CASE_NOT_EXECUTABLE'],
      [environment.sentinelCaseId, 'SENTINEL_CASE_NOT_EXECUTABLE'],
    ] as const) {
      if (!caseId) continue;
      const c = await latestRevision(deps.db, scope, caseId);
      const exe = c ? await approvedExecutableForCase(deps.db, scope, c.caseId) : null;
      if (!c || c.status !== 'APPROVED' || !exe) reasons.push(reason);
    }
  }
  return { environment, reasons };
}

/**
 * Requests one run per approved, automated case (each through `requestRun`, so policy applies per
 * case). Cases without an approved revision or an approved executable are recorded as such: they
 * are for a person to execute, and the report never presents them as passed. A failed preflight
 * blocks the whole suite run before any case is queued.
 */
export async function runSuite(
  deps: SuiteRunDeps,
  actor: Actor,
  suiteId: string,
  input: { environmentId: string; build?: string },
) {
  const { db } = deps;
  const scope = scopeOf(actor);
  const suite = await getSuite(db, scope, suiteId);
  if (!suite) throw new DomainError('NOT_FOUND', `suite ${suiteId} not found`);
  const cases = await listSuiteCases(db, scope, suiteId);
  if (cases.length === 0) throw new DomainError('VALIDATION', `suite ${suiteId} has no cases`);
  const build = input.build?.trim() ?? '';

  const automated = new Set<string>();
  for (const c of cases) {
    if (c.status === 'APPROVED' && (await approvedExecutableForCase(db, scope, c.caseId)))
      automated.add(c.caseId);
  }
  const check = await preflight(deps, scope, input.environmentId, automated.size);
  const blocked = check.reasons.length > 0;
  const suiteRun = await insertSuiteRun(db, scope, {
    suiteId,
    environmentId: input.environmentId,
    build,
    status: blocked ? 'BLOCKED' : 'REQUESTED',
    reason: blocked ? `PREFLIGHT:${check.reasons.join(',')}` : null,
    requestedBy: actor.id,
  });
  // ADR-0022: the environment's preflight case runs first; the automated runs wait for it.
  let afterRunId: string | undefined;
  const preflightCaseId = check.environment?.preflightCaseId;
  if (!blocked && automated.size > 0 && preflightCaseId) {
    const pre = await requestRun(deps, actor, {
      caseId: preflightCaseId,
      environmentId: input.environmentId,
      idempotencyKey: `${suiteRun.id}:preflight`,
    });
    await setSuiteRunPreflight(db, suiteRun.id, pre.id);
    afterRunId = pre.id;
  }
  // ADR-0023: the sentinel runs with the suite; it is known to fail, and a pass means the run
  // cannot be trusted to detect a failure.
  const sentinelCaseId = check.environment?.sentinelCaseId;
  if (!blocked && automated.size > 0 && sentinelCaseId) {
    const sentinel = await requestRun(deps, actor, {
      caseId: sentinelCaseId,
      environmentId: input.environmentId,
      idempotencyKey: `${suiteRun.id}:sentinel`,
      afterRunId,
    });
    await setSuiteRunSentinel(db, suiteRun.id, sentinel.id);
  }
  for (const c of cases) {
    let outcome: SuiteRunItemOutcome = 'NOT_APPROVED';
    let runId: string | null = null;
    if (blocked) outcome = 'BLOCKED';
    else if (c.status === 'APPROVED') {
      if (automated.has(c.caseId)) {
        const run = await requestRun(deps, actor, {
          caseId: c.caseId,
          environmentId: input.environmentId,
          idempotencyKey: `${suiteRun.id}:${c.caseId}`,
          afterRunId,
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
  await audit(
    db,
    actor,
    blocked ? 'SUITE_RUN_BLOCKED' : 'SUITE_RUN_REQUESTED',
    suiteRun.id,
    blocked ? suiteRun.reason! : input.environmentId,
  );
  return getSuiteRunReport(db, scope, suiteRun.id);
}

export async function listSuiteRunSummaries(db: Db, scope: TenantScope, suiteId: string) {
  if (!(await getSuite(db, scope, suiteId))) throw new DomainError('NOT_FOUND', `suite ${suiteId} not found`);
  return listSuiteRuns(db, scope, suiteId);
}

const TERMINAL = new Set(['PASSED', 'FAILED', 'INCONCLUSIVE', 'BLOCKED']);

/** The first failed assertion's step id of an automated run, or the manual failed step number. */
const failedStepOf = (assertions: unknown[], manualFailedStep: number | null | undefined): string | null => {
  if (manualFailedStep != null) return String(manualFailedStep);
  const a = assertions.find((x) => (x as { passed?: boolean | null }).passed === false) as
    { stepId?: string } | undefined;
  return a?.stepId ?? null;
};

/**
 * Per-case results with traceability; verdicts come from each run's deterministic assertions.
 * A case with a known bug (ADR-0021) keeps its verdict: the report only labels a FAILED result
 * as `expectedFailure` and a PASSED one as `retestNeeded` (the bug may be fixed; clear the mark).
 */
export async function getSuiteRunReport(db: Db, scope: TenantScope, suiteRunId: string) {
  const suiteRun = await getSuiteRun(db, scope, suiteRunId);
  if (!suiteRun) throw new DomainError('NOT_FOUND', `suite run ${suiteRunId} not found`);
  const cases = new Map((await listSuiteCases(db, scope, suiteRun.suiteId)).map((c) => [c.caseId, c]));
  // Manual results recorded against this suite run (ADR-0017) fill in the cases automation left.
  const manual = new Map(
    (await latestManualRunsForSuiteRun(db, scope, suiteRunId)).map((m) => [m.caseId, m]),
  );
  const unstable = new Set(
    (await unstableCases(db, scope)).map((u) => `${u.caseId}|${u.environmentId}|${u.build}`),
  );
  const items = await Promise.all(
    (await listSuiteRunItems(db, scope, suiteRunId)).map(async (i) => {
      const c = cases.get(i.caseId);
      const triage = i.runId ? await latestTriage(db, scope, i.runId) : null;
      const run = i.runId ? await getRun(db, scope, i.runId) : null;
      const m = i.outcome === 'NOT_AUTOMATED' ? manual.get(i.caseId) : undefined;
      const status = m ? m.status : i.outcome === 'REQUESTED' ? i.runState! : i.outcome;
      const started = m ? m.startedAt : i.startedAt;
      const finished = m ? m.finishedAt : i.finishedAt;
      const knownBug = c?.knownBug ?? null;
      const bugSteps = c?.knownBugSteps ?? [];
      const failedStep = failedStepOf(run?.assertions ?? [], m?.failedStep);
      // ADR-0023: a known bug accounts for a failure only at the steps it is bound to.
      const expectedFailure =
        knownBug !== null &&
        status === 'FAILED' &&
        (bugSteps.length === 0 || (failedStep !== null && bugSteps.includes(failedStep)));
      const priority = DraftContent.safeParse(c?.content).data?.priority ?? null;
      return {
        caseId: i.caseId,
        code: c?.code ?? null,
        section: c?.section ?? '',
        title: DraftContent.safeParse(c?.content).data?.title ?? i.caseId,
        sourceRefs: c?.sourceRefs ?? [],
        status,
        reason: m ? m.reason || null : i.runReason,
        knownBug,
        knownBugSteps: bugSteps,
        failedStep,
        expectedFailure,
        /** The known bug is bound to other steps: this failure is a real one. */
        failedOutsideKnownBug: knownBug !== null && status === 'FAILED' && !expectedFailure,
        /** A known bug with no steps bound labels every failure as expected; say so. */
        knownBugUnbound: knownBug !== null && bugSteps.length === 0,
        retestNeeded: knownBug !== null && status === 'PASSED',
        /** Verdicts of this case differed on this environment and build without a spec change. */
        unstable: unstable.has(`${i.caseId}|${suiteRun.environmentId}|${suiteRun.build}`),
        /** Assertions the verdict rests on (automated runs). */
        assertions: run ? run.assertions.length : null,
        /** A P0 failure or block recorded by hand with nothing attached: the result is unproven. */
        unproven:
          !!m && priority === 'P0' && (m.status === 'FAILED' || m.status === 'BLOCKED') && m.evidence === 0,
        runId: i.runId,
        manualRunId: m?.id ?? null,
        testerId: m?.testerId ?? null,
        durationMs: started && finished ? new Date(finished).getTime() - new Date(started).getTime() : null,
        evidence: i.runId ? (await listEvidence(db, scope, i.runId)).length : 0,
        suspectedCause: triage?.suspectedCause ?? null,
        suspectedCauseIsVerified: triage?.verifiedCause != null,
      };
    }),
  );
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const requested = items.filter((i) => i.runId);
  const pre = suiteRun.preflightRunId ? await getRun(db, scope, suiteRun.preflightRunId) : null;
  const sentinel = suiteRun.sentinelRunId ? await getRun(db, scope, suiteRun.sentinelRunId) : null;
  // ADR-0023: detection is proven by a sentinel that FAILED; a sentinel that PASSED means the
  // run's passes prove nothing, so the run as a whole is inconclusive. Verdicts stay as recorded.
  const detection = !sentinel
    ? ('NONE' as const)
    : sentinel.state === 'FAILED'
      ? ('PROVEN' as const)
      : TERMINAL.has(sentinel.state)
        ? ('NOT_PROVEN' as const)
        : ('PENDING' as const);
  return {
    id: suiteRun.id,
    suiteId: suiteRun.suiteId,
    environmentId: suiteRun.environmentId,
    build: suiteRun.build,
    status: suiteRun.status,
    reason: suiteRun.reason,
    /** The environment's preflight case run (ADR-0022): the automated runs ran only if it PASSED. */
    preflight: pre ? { runId: pre.id, caseId: pre.caseId, status: pre.state, reason: pre.reason } : null,
    sentinel: sentinel
      ? { runId: sentinel.id, caseId: sentinel.caseId, status: sentinel.state, reason: sentinel.reason }
      : null,
    detection,
    /** INCONCLUSIVE when the sentinel passed: nothing here is shown to detect a failure. */
    outcome: detection === 'NOT_PROVEN' ? ('INCONCLUSIVE' as const) : ('AS_RECORDED' as const),
    requestedBy: suiteRun.requestedBy,
    createdAt: suiteRun.createdAt,
    complete:
      requested.every((i) => TERMINAL.has(i.status)) &&
      (!pre || TERMINAL.has(pre.state)) &&
      (!sentinel || TERMINAL.has(sentinel.state)),
    totals: {
      cases: items.length,
      passed: count('PASSED'),
      failed: count('FAILED'),
      inconclusive: count('INCONCLUSIVE'),
      blocked: count('BLOCKED'),
      pending: requested.filter((i) => !TERMINAL.has(i.status)).length,
      /** Manual cases still awaiting a tester's record. */
      notAutomated: count('NOT_AUTOMATED'),
      manualRecorded: items.filter((i) => i.manualRunId).length,
      notApproved: count('NOT_APPROVED'),
      /** Of `failed`: failures a known bug accounts for (verdicts unchanged). */
      expectedFailures: items.filter((i) => i.expectedFailure).length,
      /** Of `passed`: cases whose known bug may be fixed; retest and clear the mark. */
      retestNeeded: items.filter((i) => i.retestNeeded).length,
      failedOutsideKnownBug: items.filter((i) => i.failedOutsideKnownBug).length,
      unstable: items.filter((i) => i.unstable).length,
      unproven: items.filter((i) => i.unproven).length,
    },
    items,
  };
}
