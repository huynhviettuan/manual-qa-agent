import { newId, type TenantScope } from '@qa/domain';
import type { Db } from './db.ts';

// Manual execution records (ADR-0017): a tester's observed result for one approved case revision.
// Records are immutable; executing again adds a new one.

export type ManualStepStatus = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
export type ManualRunStatus = 'PASSED' | 'FAILED' | 'BLOCKED';

export type ManualStepResult = { index: number; status: ManualStepStatus; actual: string };

export type ManualRunRow = {
  id: string;
  caseId: string;
  caseRevision: number;
  suiteRunId: string | null;
  environmentId: string;
  build: string;
  testerId: string;
  status: ManualRunStatus;
  failedStep: number | null;
  reason: string;
  steps: ManualStepResult[];
  notes: string;
  defectRef: string | null;
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
};

const COLS = `id, case_id AS "caseId", case_revision AS "caseRevision", suite_run_id AS "suiteRunId",
  environment_id AS "environmentId", build, tester_id AS "testerId", status, failed_step AS "failedStep", reason,
  steps, notes, defect_ref AS "defectRef", started_at AS "startedAt", finished_at AS "finishedAt",
  created_at AS "createdAt"`;

export async function insertManualRun(
  db: Db,
  scope: TenantScope,
  r: Omit<ManualRunRow, 'id' | 'createdAt'>,
): Promise<ManualRunRow> {
  const rows = await db.query<ManualRunRow>(
    `INSERT INTO manual_runs (id, tenant_id, project_id, case_id, case_revision, suite_run_id, environment_id, build,
       tester_id, status, failed_step, reason, steps, notes, defect_ref, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text::jsonb,$14,$15,$16,$17) RETURNING ${COLS}`,
    [
      newId('mrun'),
      scope.tenantId,
      scope.projectId,
      r.caseId,
      r.caseRevision,
      r.suiteRunId,
      r.environmentId,
      r.build,
      r.testerId,
      r.status,
      r.failedStep,
      r.reason,
      JSON.stringify(r.steps),
      r.notes,
      r.defectRef,
      r.startedAt,
      r.finishedAt,
    ],
  );
  return rows[0]!;
}

export async function getManualRun(db: Db, scope: TenantScope, id: string): Promise<ManualRunRow | null> {
  const rows = await db.query<ManualRunRow>(
    `SELECT ${COLS} FROM manual_runs WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

/** A case's execution history, newest first. */
export async function listManualRunsForCase(
  db: Db,
  scope: TenantScope,
  caseId: string,
): Promise<ManualRunRow[]> {
  return db.query<ManualRunRow>(
    `SELECT ${COLS} FROM manual_runs WHERE case_id = $1 AND tenant_id = $2 AND project_id = $3
      ORDER BY created_at DESC, id DESC`,
    [caseId, scope.tenantId, scope.projectId],
  );
}

/** The latest record per case within one suite run (a case executed twice keeps its last result). */
export async function latestManualRunsForSuiteRun(
  db: Db,
  scope: TenantScope,
  suiteRunId: string,
): Promise<ManualRunRow[]> {
  return db.query<ManualRunRow>(
    `SELECT DISTINCT ON (case_id) ${COLS} FROM manual_runs
      WHERE suite_run_id = $1 AND tenant_id = $2 AND project_id = $3
      ORDER BY case_id, created_at DESC, id DESC`,
    [suiteRunId, scope.tenantId, scope.projectId],
  );
}
