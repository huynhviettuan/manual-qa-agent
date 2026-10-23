import { newId, type TenantScope } from '@qa/domain';
import type { Db } from './db.ts';

export type SuiteRow = {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: Date;
};

export type SuiteCaseRow = {
  caseId: string;
  section: string;
  position: number;
  revision: number;
  status: string;
  content: unknown;
  sourceRefs: string[];
};

export type SuiteRunRow = {
  id: string;
  suiteId: string;
  environmentId: string;
  requestedBy: string;
  createdAt: Date;
};

export type SuiteRunItemOutcome = 'REQUESTED' | 'NOT_AUTOMATED' | 'NOT_APPROVED';

export type SuiteRunItemRow = {
  caseId: string;
  position: number;
  outcome: SuiteRunItemOutcome;
  runId: string | null;
  runState: string | null;
  runReason: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const SUITE_COLS = `id, name, description, created_by AS "createdBy", created_at AS "createdAt"`;

export async function insertSuite(
  db: Db,
  scope: TenantScope,
  s: { name: string; description: string; createdBy: string },
): Promise<SuiteRow | null> {
  const rows = await db.query<SuiteRow>(
    `INSERT INTO test_suites (id, tenant_id, project_id, name, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, project_id, name) DO NOTHING RETURNING ${SUITE_COLS}`,
    [newId('suite'), scope.tenantId, scope.projectId, s.name, s.description, s.createdBy],
  );
  return rows[0] ?? null; // null: a suite with this name already exists
}

export async function getSuite(db: Db, scope: TenantScope, id: string): Promise<SuiteRow | null> {
  const rows = await db.query<SuiteRow>(
    `SELECT ${SUITE_COLS} FROM test_suites WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export async function listSuites(
  db: Db,
  scope: TenantScope,
): Promise<Array<SuiteRow & { caseCount: number }>> {
  return db.query(
    `SELECT s.id, s.name, s.description, s.created_by AS "createdBy", s.created_at AS "createdAt",
       (SELECT count(*)::int FROM test_suite_cases c WHERE c.suite_id = s.id) AS "caseCount"
     FROM test_suites s WHERE s.tenant_id = $1 AND s.project_id = $2 ORDER BY s.created_at`,
    [scope.tenantId, scope.projectId],
  );
}

/** Adds the case at the end of the suite, or moves it to another section if already present. */
export async function upsertSuiteCase(
  db: Db,
  suiteId: string,
  c: { caseId: string; section: string; addedBy: string },
): Promise<void> {
  await db.query(
    `INSERT INTO test_suite_cases (suite_id, case_id, section, position, added_by)
     VALUES ($1, $2, $3, (SELECT coalesce(max(position), 0) + 1 FROM test_suite_cases WHERE suite_id = $1), $4)
     ON CONFLICT (suite_id, case_id) DO UPDATE SET section = EXCLUDED.section`,
    [suiteId, c.caseId, c.section, c.addedBy],
  );
}

/** Suite cases with their latest revision (the suite always runs what the case is now). */
export async function listSuiteCases(db: Db, scope: TenantScope, suiteId: string): Promise<SuiteCaseRow[]> {
  return db.query<SuiteCaseRow>(
    `SELECT sc.case_id AS "caseId", sc.section, sc.position, r.revision, r.status, r.content,
       r.source_refs AS "sourceRefs"
     FROM test_suite_cases sc
     JOIN test_suites s ON s.id = sc.suite_id AND s.tenant_id = $2 AND s.project_id = $3
     JOIN LATERAL (SELECT * FROM test_case_revisions WHERE case_id = sc.case_id ORDER BY revision DESC LIMIT 1) r ON true
     WHERE sc.suite_id = $1 ORDER BY sc.position`,
    [suiteId, scope.tenantId, scope.projectId],
  );
}

export async function insertSuiteRun(
  db: Db,
  scope: TenantScope,
  r: { suiteId: string; environmentId: string; requestedBy: string },
): Promise<SuiteRunRow> {
  const rows = await db.query<SuiteRunRow>(
    `INSERT INTO suite_runs (id, tenant_id, project_id, suite_id, environment_id, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, suite_id AS "suiteId", environment_id AS "environmentId", requested_by AS "requestedBy",
       created_at AS "createdAt"`,
    [newId('suiterun'), scope.tenantId, scope.projectId, r.suiteId, r.environmentId, r.requestedBy],
  );
  return rows[0]!;
}

export async function insertSuiteRunItem(
  db: Db,
  item: {
    suiteRunId: string;
    caseId: string;
    runId: string | null;
    outcome: SuiteRunItemOutcome;
    position: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO suite_run_items (suite_run_id, case_id, run_id, outcome, position) VALUES ($1,$2,$3,$4,$5)`,
    [item.suiteRunId, item.caseId, item.runId, item.outcome, item.position],
  );
}

export type SuiteRunSummaryRow = SuiteRunRow & { manualPending: number; manualRecorded: number };

/** A suite's runs, newest first, with how many manual cases still await a tester (ADR-0019). */
export async function listSuiteRuns(
  db: Db,
  scope: TenantScope,
  suiteId: string,
): Promise<SuiteRunSummaryRow[]> {
  return db.query<SuiteRunSummaryRow>(
    `SELECT sr.id, sr.suite_id AS "suiteId", sr.environment_id AS "environmentId", sr.requested_by AS "requestedBy",
       sr.created_at AS "createdAt",
       (SELECT count(*)::int FROM suite_run_items i WHERE i.suite_run_id = sr.id AND i.outcome = 'NOT_AUTOMATED'
          AND NOT EXISTS (SELECT 1 FROM manual_runs m WHERE m.suite_run_id = sr.id AND m.case_id = i.case_id)) AS "manualPending",
       (SELECT count(DISTINCT m.case_id)::int FROM manual_runs m WHERE m.suite_run_id = sr.id) AS "manualRecorded"
     FROM suite_runs sr WHERE sr.suite_id = $1 AND sr.tenant_id = $2 AND sr.project_id = $3
     ORDER BY sr.created_at DESC, sr.id DESC`,
    [suiteId, scope.tenantId, scope.projectId],
  );
}

export async function getSuiteRun(db: Db, scope: TenantScope, id: string): Promise<SuiteRunRow | null> {
  const rows = await db.query<SuiteRunRow>(
    `SELECT id, suite_id AS "suiteId", environment_id AS "environmentId", requested_by AS "requestedBy",
       created_at AS "createdAt"
     FROM suite_runs WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

/** Items with the current state of each requested run (runs finish after the suite run is created). */
export async function listSuiteRunItems(
  db: Db,
  scope: TenantScope,
  suiteRunId: string,
): Promise<SuiteRunItemRow[]> {
  return db.query<SuiteRunItemRow>(
    `SELECT i.case_id AS "caseId", i.position, i.outcome, i.run_id AS "runId", t.state AS "runState",
       t.reason AS "runReason", t.started_at AS "startedAt", t.finished_at AS "finishedAt"
     FROM suite_run_items i
     JOIN suite_runs sr ON sr.id = i.suite_run_id AND sr.tenant_id = $2 AND sr.project_id = $3
     LEFT JOIN test_runs t ON t.id = i.run_id
     WHERE i.suite_run_id = $1 ORDER BY i.position`,
    [suiteRunId, scope.tenantId, scope.projectId],
  );
}
