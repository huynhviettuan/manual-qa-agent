import type { Db } from '@qa/db';
import type { TenantScope } from '@qa/domain';

// QA-022: project metrics and drift alerts over the audit/telemetry tables. Pure reads, scoped.

const n = (v: unknown) => Number(v ?? 0);

async function grouped(db: Db, sql: string, params: unknown[]) {
  const rows = await db.query<{ k: string | null; c: string }>(sql, params);
  return Object.fromEntries(rows.map((r) => [r.k ?? 'none', n(r.c)]));
}

/**
 * Manual execution effort (ADR-0022) from the testers' own start and finish times: what the team
 * spends by hand, per tester. Recorded durations only; nothing is estimated.
 */
async function manualEffort(db: Db, p: string[], since: string) {
  const minutes = `extract(epoch FROM (finished_at - started_at)) / 60`;
  const where = `WHERE tenant_id = $1 AND project_id = $2 AND created_at > ${since}`;
  const [total] = await db.query<{
    runs: string;
    cases: string;
    minutes: string | null;
    median: string | null;
  }>(
    `SELECT count(*) AS runs, count(DISTINCT case_id) AS cases, sum(${minutes}) AS minutes,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY ${minutes}) AS median
     FROM manual_runs ${where}`,
    p,
  );
  const byTester = await db.query<{ tester: string; runs: string; minutes: string | null }>(
    `SELECT tester_id AS tester, count(*) AS runs, sum(${minutes}) AS minutes FROM manual_runs ${where}
     GROUP BY 1 ORDER BY 1`,
    p,
  );
  const round = (v: unknown) => Math.round(n(v) * 10) / 10;
  return {
    runs: n(total?.runs),
    cases: n(total?.cases),
    minutes: round(total?.minutes),
    medianMinutesPerRun: total?.median == null ? null : round(total.median),
    byTester: byTester.map((t) => ({ testerId: t.tester, runs: n(t.runs), minutes: round(t.minutes) })),
  };
}

export async function projectMetrics(db: Db, scope: TenantScope, days = 7) {
  const p = [scope.tenantId, scope.projectId, String(days)];
  const since = `now() - ($3 || ' days')::interval`;
  const [workflows, decisions, tokens, reviewsOpen, oldest, runs, denied, triage, agreement] =
    await Promise.all([
      grouped(
        db,
        `SELECT outcome->>'route' AS k, count(*) AS c FROM workflows
        WHERE tenant_id = $1 AND project_id = $2 AND created_at > ${since} GROUP BY 1`,
        p,
      ),
      db.query<{ kind: string; outcome: string; cache_hit: boolean; c: string }>(
        `SELECT kind, outcome, cache_hit, count(*) AS c FROM decision_records
        WHERE tenant_id = $1 AND project_id = $2 AND created_at > ${since} GROUP BY 1, 2, 3`,
        p,
      ),
      db.query<{ model: string | null; i: string; o: string }>(
        `SELECT model, sum(input_tokens) AS i, sum(output_tokens) AS o FROM usage_events
        WHERE tenant_id = $1 AND project_id = $2 AND created_at > ${since} GROUP BY 1`,
        p,
      ),
      grouped(
        db,
        `SELECT kind AS k, count(*) AS c FROM review_tasks
        WHERE tenant_id = $1 AND project_id = $2 AND status IN ('OPEN','ASSIGNED','NEEDS_INFO') GROUP BY 1`,
        p.slice(0, 2),
      ),
      db.query<{ h: string | null }>(
        `SELECT extract(epoch FROM now() - min(created_at)) / 3600 AS h FROM review_tasks
        WHERE tenant_id = $1 AND project_id = $2 AND status IN ('OPEN','ASSIGNED','NEEDS_INFO')`,
        p.slice(0, 2),
      ),
      grouped(
        db,
        `SELECT state AS k, count(*) AS c FROM test_runs
        WHERE tenant_id = $1 AND project_id = $2 AND created_at > ${since} GROUP BY 1`,
        p,
      ),
      grouped(
        db,
        `SELECT reasons[1] AS k, count(*) AS c FROM policy_evaluations
        WHERE tenant_id = $1 AND project_id = $2 AND gate = 'DENY' AND created_at > ${since} GROUP BY 1`,
        p,
      ),
      grouped(
        db,
        `SELECT suspected_cause AS k, count(*) AS c FROM run_triage
        WHERE tenant_id = $1 AND project_id = $2 AND created_at > ${since} GROUP BY 1`,
        p,
      ),
      db.query<{ verified: string; agreed: string; security: string }>(
        `SELECT count(*) FILTER (WHERE verified_cause IS NOT NULL) AS verified,
              count(*) FILTER (WHERE verified_cause = suspected_cause) AS agreed,
              count(*) FILTER (WHERE security_sensitive) AS security
         FROM run_triage WHERE tenant_id = $1 AND project_id = $2 AND created_at > ${since}`,
        p,
      ),
    ]);

  const decisionTotal = decisions.reduce((s, d) => s + n(d.c), 0);
  const decisionFailures = decisions.filter((d) => d.outcome !== 'OK').reduce((s, d) => s + n(d.c), 0);
  const cacheHits = decisions.filter((d) => d.cache_hit).reduce((s, d) => s + n(d.c), 0);
  const workflowTotal = Object.values(workflows).reduce((a, b) => a + b, 0);
  const a = agreement[0]!;
  return {
    window: { days },
    workflows: { total: workflowTotal, byRoute: workflows },
    decisions: {
      total: decisionTotal,
      failureRate: decisionTotal ? decisionFailures / decisionTotal : 0,
      cacheHitRate: decisionTotal ? cacheHits / decisionTotal : 0,
      byKindOutcome: decisions.map((d) => ({
        kind: d.kind,
        outcome: d.outcome,
        cacheHit: d.cache_hit,
        count: n(d.c),
      })),
    },
    tokens: {
      input: tokens.reduce((s, t) => s + n(t.i), 0),
      output: tokens.reduce((s, t) => s + n(t.o), 0),
      byModel: tokens.map((t) => ({ model: t.model ?? 'none', input: n(t.i), output: n(t.o) })),
    },
    reviews: { openByKind: reviewsOpen, oldestOpenHours: oldest[0]?.h == null ? null : n(oldest[0].h) },
    runs: { byState: runs },
    manual: await manualEffort(db, p, since),
    policy: { deniedByReason: denied },
    triage: {
      bySuggestedCause: triage,
      verified: n(a.verified),
      agreementRate: n(a.verified) ? n(a.agreed) / n(a.verified) : null,
      securityEscalations: n(a.security),
    },
  };
}

export type AlertThresholds = {
  providerFailureRate: number;
  tokenSpikeFactor: number;
  reviewBacklogHours: number;
  deniedActionsPerDay: number;
  triageDisagreementRate: number;
  confidenceDrift: number;
  inconclusiveRate: number;
  /** Minimum sample size before a rate-based alert can fire. */
  minSample: number;
};

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  providerFailureRate: 0.2,
  tokenSpikeFactor: 2,
  reviewBacklogHours: 72,
  deniedActionsPerDay: 10,
  triageDisagreementRate: 0.3,
  confidenceDrift: 0.15,
  inconclusiveRate: 0.3,
  minSample: 5,
};

export type Alert = {
  rule: string;
  severity: 'warning' | 'critical';
  value: number;
  threshold: number;
  detail: string;
};

/** Drift/health alerts comparing the last 24h with the previous 7 days (docs/10 monitoring). */
export async function driftAlerts(
  db: Db,
  scope: TenantScope,
  t: AlertThresholds = DEFAULT_THRESHOLDS,
): Promise<Alert[]> {
  const p = [scope.tenantId, scope.projectId];
  const one = async (sql: string) => (await db.query<Record<string, string | null>>(sql, p))[0]!;
  const recent = `created_at > now() - interval '1 day'`;
  const baseline = `created_at <= now() - interval '1 day' AND created_at > now() - interval '8 days'`;
  const scoped = `tenant_id = $1 AND project_id = $2`;

  const [dec, tok, rev, den, tri, conf, run] = await Promise.all([
    one(
      `SELECT count(*) AS total, count(*) FILTER (WHERE outcome <> 'OK') AS failed FROM decision_records WHERE ${scoped} AND ${recent}`,
    ),
    one(`SELECT coalesce(sum(input_tokens + output_tokens) FILTER (WHERE ${recent}), 0) AS recent,
                coalesce(sum(input_tokens + output_tokens) FILTER (WHERE ${baseline}), 0) / 7.0 AS daily
           FROM usage_events WHERE ${scoped}`),
    one(`SELECT extract(epoch FROM now() - min(created_at)) / 3600 AS h FROM review_tasks
          WHERE ${scoped} AND status IN ('OPEN','ASSIGNED','NEEDS_INFO')`),
    one(`SELECT count(*) AS c FROM policy_evaluations WHERE ${scoped} AND gate = 'DENY' AND ${recent}`),
    one(`SELECT count(*) AS verified, count(*) FILTER (WHERE verified_cause <> suspected_cause) AS disagreed
           FROM run_triage WHERE ${scoped} AND verified_cause IS NOT NULL AND ${recent}`),
    one(`SELECT avg((result->>'confidence')::float8) FILTER (WHERE ${recent}) AS recent,
                count(*) FILTER (WHERE ${recent}) AS rn,
                avg((result->>'confidence')::float8) FILTER (WHERE ${baseline}) AS base,
                count(*) FILTER (WHERE ${baseline}) AS bn
           FROM decision_records WHERE ${scoped} AND kind = 'readiness' AND outcome = 'OK'
            AND result->>'confidence' IS NOT NULL`),
    one(`SELECT count(*) FILTER (WHERE state IN ('PASSED','FAILED','INCONCLUSIVE')) AS finished,
                count(*) FILTER (WHERE state = 'INCONCLUSIVE') AS inconclusive
           FROM test_runs WHERE ${scoped} AND ${recent}`),
  ]);

  const alerts: Alert[] = [];
  const push = (
    rule: string,
    severity: Alert['severity'],
    value: number,
    threshold: number,
    detail: string,
  ) => alerts.push({ rule, severity, value, threshold, detail });

  if (n(dec.total) >= t.minSample && n(dec.failed) / n(dec.total) > t.providerFailureRate) {
    push(
      'PROVIDER_FAILURE_RATE',
      'critical',
      n(dec.failed) / n(dec.total),
      t.providerFailureRate,
      'AI provider failures/refusals in the last 24h',
    );
  }
  if (n(tok.daily) > 0 && n(tok.recent) > t.tokenSpikeFactor * n(tok.daily)) {
    push(
      'TOKEN_SPIKE',
      'warning',
      n(tok.recent) / n(tok.daily),
      t.tokenSpikeFactor,
      'tokens in the last 24h vs the 7-day daily average',
    );
  }
  if (rev.h != null && n(rev.h) > t.reviewBacklogHours) {
    push(
      'REVIEW_BACKLOG_AGE',
      'warning',
      n(rev.h),
      t.reviewBacklogHours,
      'hours the oldest open review has waited',
    );
  }
  if (n(den.c) > t.deniedActionsPerDay) {
    push(
      'DENIED_ACTIONS_SPIKE',
      'critical',
      n(den.c),
      t.deniedActionsPerDay,
      'policy denials in the last 24h (attack or misconfiguration)',
    );
  }
  if (n(tri.verified) >= t.minSample && n(tri.disagreed) / n(tri.verified) > t.triageDisagreementRate) {
    push(
      'TRIAGE_DISAGREEMENT',
      'warning',
      n(tri.disagreed) / n(tri.verified),
      t.triageDisagreementRate,
      'suggested vs verified triage causes',
    );
  }
  if (
    n(conf.rn) >= t.minSample &&
    n(conf.bn) >= t.minSample &&
    Math.abs(n(conf.recent) - n(conf.base)) > t.confidenceDrift
  ) {
    push(
      'CONFIDENCE_DRIFT',
      'warning',
      Math.abs(n(conf.recent) - n(conf.base)),
      t.confidenceDrift,
      'mean readiness confidence, last 24h vs previous 7 days',
    );
  }
  if (n(run.finished) >= t.minSample && n(run.inconclusive) / n(run.finished) > t.inconclusiveRate) {
    push(
      'INCONCLUSIVE_RATE',
      'warning',
      n(run.inconclusive) / n(run.finished),
      t.inconclusiveRate,
      'inconclusive runs (flaky tests or environment)',
    );
  }
  return alerts;
}
