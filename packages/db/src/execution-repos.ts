import { DomainError, newId, type RunStatus, type TenantScope } from '@qa/domain';
import type { Db } from './db.ts';

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

// ---------------------------------------------------------------- executables

export type ExecutableRow = {
  id: string;
  caseId: string;
  caseRevision: number;
  version: number;
  spec: unknown;
  specHash: string;
  destructiveSteps: string[];
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  proposedBy: string;
  reviewedBy: string | null;
  reviewReason: string | null;
};

const EXEC_COLS = `id, case_id AS "caseId", case_revision AS "caseRevision", version, spec, spec_hash AS "specHash",
  destructive_steps AS "destructiveSteps", status, proposed_by AS "proposedBy", reviewed_by AS "reviewedBy",
  review_reason AS "reviewReason"`;

export async function insertExecutable(
  db: Db,
  scope: TenantScope,
  e: Pick<ExecutableRow, 'caseId' | 'caseRevision' | 'spec' | 'specHash' | 'destructiveSteps' | 'proposedBy'>,
): Promise<ExecutableRow> {
  return db.transaction(async (tx) => {
    const [{ next }] = (await tx.query<{ next: number }>(
      'SELECT coalesce(max(version), 0) + 1 AS next FROM test_case_executables WHERE case_id = $1',
      [e.caseId],
    )) as [{ next: number }];
    const rows = await tx.query<ExecutableRow>(
      `INSERT INTO test_case_executables (id, tenant_id, project_id, case_id, case_revision, version, spec, spec_hash,
         destructive_steps, status, proposed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8,$9,'PROPOSED',$10) RETURNING ${EXEC_COLS}`,
      [
        newId('exe'),
        scope.tenantId,
        scope.projectId,
        e.caseId,
        e.caseRevision,
        Number(next),
        json(e.spec),
        e.specHash,
        e.destructiveSteps,
        e.proposedBy,
      ],
    );
    return rows[0]!;
  });
}

export async function getExecutable(db: Db, scope: TenantScope, id: string): Promise<ExecutableRow | null> {
  const rows = await db.query<ExecutableRow>(
    `SELECT ${EXEC_COLS} FROM test_case_executables WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export async function approvedExecutableForCase(
  db: Db,
  scope: TenantScope,
  caseId: string,
): Promise<ExecutableRow | null> {
  const rows = await db.query<ExecutableRow>(
    `SELECT ${EXEC_COLS} FROM test_case_executables
      WHERE case_id = $1 AND tenant_id = $2 AND project_id = $3 AND status = 'APPROVED'
      ORDER BY version DESC LIMIT 1`,
    [caseId, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

/** Optimistic review; approving supersedes the previously approved version of the same case. */
export async function reviewExecutableRow(
  db: Db,
  scope: TenantScope,
  id: string,
  r: { status: 'APPROVED' | 'REJECTED'; reviewedBy: string; reason: string | null },
): Promise<ExecutableRow> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<ExecutableRow>(
      `UPDATE test_case_executables SET status = $4, reviewed_by = $5, review_reason = $6, reviewed_at = now()
        WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND status = 'PROPOSED' RETURNING ${EXEC_COLS}`,
      [id, scope.tenantId, scope.projectId, r.status, r.reviewedBy, r.reason],
    );
    const row = rows[0];
    if (!row) throw new DomainError('CONFLICT', `executable ${id} is not awaiting review`);
    if (r.status === 'APPROVED') {
      await tx.query(
        `UPDATE test_case_executables SET status = 'SUPERSEDED'
          WHERE case_id = $1 AND tenant_id = $2 AND project_id = $3 AND status = 'APPROVED' AND id <> $4`,
        [row.caseId, scope.tenantId, scope.projectId, id],
      );
    }
    return row;
  });
}

// ---------------------------------------------------------------- runs

export type RunRow = {
  id: string;
  tenantId: string;
  projectId: string;
  caseId: string;
  caseRevision: number;
  executableId: string;
  specHash: string;
  environmentId: string;
  state: RunStatus;
  reason: string | null;
  idempotencyKey: string;
  requestedBy: string;
  approvalId: string | null;
  reviewId: string | null;
  assertions: unknown[];
  cleanupFailed: boolean;
  blockedRequests: string[];
  leaseOwner: string | null;
  leaseUntil: Date | null;
  /** Has its environment to itself while it runs (ADR-0021). */
  exclusive: boolean;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const RUN_COLS = `id, tenant_id AS "tenantId", project_id AS "projectId", case_id AS "caseId", case_revision AS "caseRevision",
  executable_id AS "executableId", spec_hash AS "specHash", environment_id AS "environmentId", state, reason,
  idempotency_key AS "idempotencyKey", requested_by AS "requestedBy", approval_id AS "approvalId", review_id AS "reviewId",
  assertions, cleanup_failed AS "cleanupFailed", blocked_requests AS "blockedRequests", lease_owner AS "leaseOwner",
  lease_until AS "leaseUntil", exclusive, created_at AS "createdAt", started_at AS "startedAt", finished_at AS "finishedAt"`;

/** Idempotent: the same key in the same scope returns the existing run. */
export async function createOrGetRun(
  db: Db,
  scope: TenantScope,
  r: Pick<
    RunRow,
    | 'caseId'
    | 'caseRevision'
    | 'executableId'
    | 'specHash'
    | 'environmentId'
    | 'idempotencyKey'
    | 'requestedBy'
    | 'approvalId'
  > & { exclusive?: boolean },
): Promise<{ run: RunRow; created: boolean }> {
  const inserted = await db.query<RunRow>(
    `INSERT INTO test_runs (id, tenant_id, project_id, case_id, case_revision, executable_id, spec_hash, environment_id,
       state, idempotency_key, requested_by, approval_id, exclusive)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'QUEUED',$9,$10,$11,$12)
     ON CONFLICT (tenant_id, project_id, idempotency_key) DO NOTHING RETURNING ${RUN_COLS}`,
    [
      newId('run'),
      scope.tenantId,
      scope.projectId,
      r.caseId,
      r.caseRevision,
      r.executableId,
      r.specHash,
      r.environmentId,
      r.idempotencyKey,
      r.requestedBy,
      r.approvalId,
      r.exclusive ?? false,
    ],
  );
  if (inserted[0]) return { run: inserted[0], created: true };
  const existing = await db.query<RunRow>(
    `SELECT ${RUN_COLS} FROM test_runs WHERE tenant_id = $1 AND project_id = $2 AND idempotency_key = $3`,
    [scope.tenantId, scope.projectId, r.idempotencyKey],
  );
  return { run: existing[0]!, created: false };
}

export async function getRun(db: Db, scope: TenantScope, id: string): Promise<RunRow | null> {
  const rows = await db.query<RunRow>(
    `SELECT ${RUN_COLS} FROM test_runs WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

/** Serialises claims across workers, so the exclusivity check and the claim are one step. */
const CLAIM_LOCK = 7_340_022;

/**
 * Atomically claims the oldest QUEUED run that may run now (any tenant: workers are trusted
 * infrastructure; every later read/write is scoped by the claimed run's tenant/project).
 * ADR-0021: an exclusive run waits until nothing else of its environment is active, and while an
 * exclusive run is active nothing else of that environment is claimed. The claim happens under a
 * transaction-scoped advisory lock, so two workers never pass the check together.
 */
export async function claimNextRun(db: Db, workerId: string, leaseMs: number): Promise<RunRow | null> {
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [CLAIM_LOCK]);
    const rows = await tx.query<RunRow>(
      `UPDATE test_runs SET state = 'POLICY_CHECK', lease_owner = $1, lease_until = now() + ($2 || ' milliseconds')::interval
        WHERE id = (
          SELECT r.id FROM test_runs r WHERE r.state = 'QUEUED'
            AND NOT EXISTS (
              SELECT 1 FROM test_runs a
               WHERE a.state IN ('POLICY_CHECK','RUNNING') AND a.tenant_id = r.tenant_id
                 AND a.project_id = r.project_id AND a.environment_id = r.environment_id
                 AND (a.exclusive OR r.exclusive))
          ORDER BY r.created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
          AND state = 'QUEUED'
        RETURNING ${RUN_COLS}`,
      [workerId, String(leaseMs)],
    );
    return rows[0] ?? null;
  });
}

/** Runs whose worker lease expired mid-flight (crash). They are never re-executed blindly. */
export async function expiredLeases(db: Db): Promise<RunRow[]> {
  return db.query<RunRow>(
    `SELECT ${RUN_COLS} FROM test_runs WHERE state IN ('POLICY_CHECK','RUNNING') AND lease_until < now()`,
  );
}

/** Optimistic state change: succeeds only from `from`. Callers validate the transition first. */
export async function updateRunState(
  db: Db,
  scope: TenantScope,
  id: string,
  from: RunStatus,
  u: {
    state: RunStatus;
    reason?: string | null;
    reviewId?: string | null;
    assertions?: unknown[];
    cleanupFailed?: boolean;
    blockedRequests?: string[];
    started?: boolean;
    finished?: boolean;
  },
): Promise<RunRow> {
  const rows = await db.query<RunRow>(
    `UPDATE test_runs SET state = $5,
        reason = coalesce($6, reason),
        review_id = coalesce($7, review_id),
        assertions = coalesce($8::text::jsonb, assertions),
        cleanup_failed = coalesce($9, cleanup_failed),
        blocked_requests = coalesce($10, blocked_requests),
        started_at = CASE WHEN $11 THEN now() ELSE started_at END,
        finished_at = CASE WHEN $12 THEN now() ELSE finished_at END,
        lease_owner = CASE WHEN $12 THEN NULL ELSE lease_owner END,
        lease_until = CASE WHEN $12 THEN NULL ELSE lease_until END
      WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND state = $4
      RETURNING ${RUN_COLS}`,
    [
      id,
      scope.tenantId,
      scope.projectId,
      from,
      u.state,
      u.reason ?? null,
      u.reviewId ?? null,
      json(u.assertions),
      u.cleanupFailed ?? null,
      u.blockedRequests ?? null,
      u.started ?? false,
      u.finished ?? false,
    ],
  );
  if (!rows[0]) throw new DomainError('CONFLICT', `run ${id} is no longer ${from}`);
  return rows[0];
}

// ---------------------------------------------------------------- evidence

export type EvidenceRow = {
  id: string;
  /** Exactly one of runId (automated) and manualRunId (ADR-0017) is set. */
  runId: string | null;
  manualRunId: string | null;
  kind: string;
  name: string;
  contentType: string;
  objectKey: string;
  digest: string;
  sizeBytes: number;
  retentionUntil: Date;
};

const EVIDENCE_COLS = `id, run_id AS "runId", manual_run_id AS "manualRunId", kind, name, content_type AS "contentType",
  object_key AS "objectKey", digest, size_bytes AS "sizeBytes", retention_until AS "retentionUntil"`;

export async function insertEvidence(
  db: Db,
  scope: TenantScope,
  e: Omit<EvidenceRow, 'id' | 'runId' | 'manualRunId'> & {
    runId?: string | null;
    manualRunId?: string | null;
  },
): Promise<EvidenceRow> {
  const rows = await db.query<EvidenceRow>(
    `INSERT INTO evidence_artifacts (id, tenant_id, project_id, run_id, manual_run_id, kind, name, content_type,
       object_key, digest, size_bytes, retention_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${EVIDENCE_COLS}`,
    [
      newId('evd'),
      scope.tenantId,
      scope.projectId,
      e.runId ?? null,
      e.manualRunId ?? null,
      e.kind,
      e.name,
      e.contentType,
      e.objectKey,
      e.digest,
      e.sizeBytes,
      e.retentionUntil,
    ],
  );
  return rows[0]!;
}

export async function listEvidence(db: Db, scope: TenantScope, runId: string): Promise<EvidenceRow[]> {
  return db.query<EvidenceRow>(
    `SELECT ${EVIDENCE_COLS} FROM evidence_artifacts WHERE run_id = $1 AND tenant_id = $2 AND project_id = $3
      ORDER BY created_at, name`,
    [runId, scope.tenantId, scope.projectId],
  );
}

export async function listManualRunEvidence(
  db: Db,
  scope: TenantScope,
  manualRunId: string,
): Promise<EvidenceRow[]> {
  return db.query<EvidenceRow>(
    `SELECT ${EVIDENCE_COLS} FROM evidence_artifacts
      WHERE manual_run_id = $1 AND tenant_id = $2 AND project_id = $3 ORDER BY created_at, name`,
    [manualRunId, scope.tenantId, scope.projectId],
  );
}

export async function getEvidence(db: Db, scope: TenantScope, id: string): Promise<EvidenceRow | null> {
  const rows = await db.query<EvidenceRow>(
    `SELECT ${EVIDENCE_COLS} FROM evidence_artifacts WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

/** Evidence past retention, for purge jobs (any tenant). */
export async function expiredEvidence(
  db: Db,
  now: Date,
  limit = 500,
): Promise<Array<EvidenceRow & TenantScope>> {
  return db.query(
    `SELECT ${EVIDENCE_COLS}, tenant_id AS "tenantId", project_id AS "projectId" FROM evidence_artifacts
      WHERE retention_until < $1 ORDER BY retention_until LIMIT $2`,
    [now, limit],
  );
}

export async function deleteEvidenceRow(db: Db, id: string) {
  await db.query('DELETE FROM evidence_artifacts WHERE id = $1', [id]);
}
