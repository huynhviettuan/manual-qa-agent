import { DomainError, newId, type TenantScope } from '@qa/domain';
import type { Db } from './db.ts';

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

// ---------------------------------------------------------------- decision cache

export async function getCachedDecision(
  db: Db,
  scope: TenantScope,
  kind: string,
  cacheKey: string,
): Promise<{ result: unknown; provider: string; model: string | null; promptVersion: string } | null> {
  const rows = await db.query<{
    result: unknown;
    provider: string;
    model: string | null;
    promptVersion: string;
  }>(
    `SELECT result, provider, model, prompt_version AS "promptVersion" FROM decision_cache
      WHERE tenant_id = $1 AND project_id = $2 AND kind = $3 AND cache_key = $4 AND expires_at > now()`,
    [scope.tenantId, scope.projectId, kind, cacheKey],
  );
  return rows[0] ?? null;
}

export async function putCachedDecision(
  db: Db,
  scope: TenantScope,
  e: {
    kind: string;
    cacheKey: string;
    result: unknown;
    provider: string;
    model: string | null;
    promptVersion: string;
    ttlMs: number;
  },
) {
  await db.query(
    `INSERT INTO decision_cache (tenant_id, project_id, kind, cache_key, result, provider, model, prompt_version, expires_at)
     VALUES ($1,$2,$3,$4,$5::text::jsonb,$6,$7,$8, now() + ($9 || ' milliseconds')::interval)
     ON CONFLICT (tenant_id, project_id, kind, cache_key) DO UPDATE SET result = EXCLUDED.result,
       provider = EXCLUDED.provider, model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version,
       created_at = now(), expires_at = EXCLUDED.expires_at`,
    [
      scope.tenantId,
      scope.projectId,
      e.kind,
      e.cacheKey,
      json(e.result),
      e.provider,
      e.model,
      e.promptVersion,
      String(e.ttlMs),
    ],
  );
}

// ---------------------------------------------------------------- triage

export type SuspectedCause = 'PRODUCT_DEFECT' | 'TEST_ISSUE' | 'ENVIRONMENT' | 'UNKNOWN';

export type TriageRow = {
  id: string;
  runId: string;
  suspectedCause: SuspectedCause;
  securitySensitive: boolean;
  securityProbability: number | null;
  confidence: number | null;
  rationale: string | null;
  outcome: string;
  decisionRecordId: string | null;
  reviewId: string | null;
  verifiedCause: SuspectedCause | null;
  verifiedBy: string | null;
  createdAt: Date;
};

const TRIAGE_COLS = `id, run_id AS "runId", suspected_cause AS "suspectedCause", security_sensitive AS "securitySensitive",
  security_probability AS "securityProbability", confidence, rationale, outcome, decision_record_id AS "decisionRecordId",
  review_id AS "reviewId", verified_cause AS "verifiedCause", verified_by AS "verifiedBy", created_at AS "createdAt"`;

export async function insertTriage(
  db: Db,
  scope: TenantScope,
  t: Omit<TriageRow, 'id' | 'verifiedCause' | 'verifiedBy' | 'createdAt'>,
): Promise<TriageRow> {
  const rows = await db.query<TriageRow>(
    `INSERT INTO run_triage (id, tenant_id, project_id, run_id, suspected_cause, security_sensitive, security_probability,
       confidence, rationale, outcome, decision_record_id, review_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${TRIAGE_COLS}`,
    [
      newId('tri'),
      scope.tenantId,
      scope.projectId,
      t.runId,
      t.suspectedCause,
      t.securitySensitive,
      t.securityProbability,
      t.confidence,
      t.rationale,
      t.outcome,
      t.decisionRecordId,
      t.reviewId,
    ],
  );
  return rows[0]!;
}

export async function latestTriage(db: Db, scope: TenantScope, runId: string): Promise<TriageRow | null> {
  const rows = await db.query<TriageRow>(
    `SELECT ${TRIAGE_COLS} FROM run_triage WHERE run_id = $1 AND tenant_id = $2 AND project_id = $3
      ORDER BY created_at DESC LIMIT 1`,
    [runId, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export async function triageByReview(
  db: Db,
  scope: TenantScope,
  reviewId: string,
): Promise<TriageRow | null> {
  const rows = await db.query<TriageRow>(
    `SELECT ${TRIAGE_COLS} FROM run_triage WHERE review_id = $1 AND tenant_id = $2 AND project_id = $3`,
    [reviewId, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export async function verifyTriage(
  db: Db,
  scope: TenantScope,
  id: string,
  cause: SuspectedCause,
  by: string,
) {
  const rows = await db.query(
    `UPDATE run_triage SET verified_cause = $4, verified_by = $5, verified_at = now()
      WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND verified_cause IS NULL RETURNING id`,
    [id, scope.tenantId, scope.projectId, cause, by],
  );
  if (!rows[0]) throw new DomainError('CONFLICT', `triage ${id} is already verified`);
}

/** Human-verified triage labels: ground truth for the triage evaluation set. */
export async function verifiedTriageLabels(db: Db, scope: TenantScope) {
  return db.query<{
    runId: string;
    suspectedCause: SuspectedCause;
    verifiedCause: SuspectedCause;
    securitySensitive: boolean;
  }>(
    `SELECT run_id AS "runId", suspected_cause AS "suspectedCause", verified_cause AS "verifiedCause",
            security_sensitive AS "securitySensitive"
       FROM run_triage WHERE tenant_id = $1 AND project_id = $2 AND verified_cause IS NOT NULL ORDER BY verified_at`,
    [scope.tenantId, scope.projectId],
  );
}

// ---------------------------------------------------------------- bug reports

export type BugStatus = 'DRAFT' | 'PUBLISHING' | 'PUBLISHED' | 'PUBLISH_FAILED' | 'REVERTED';

export type BugRow = {
  id: string;
  runId: string;
  triageId: string;
  tracker: string;
  target: string;
  summary: string;
  description: string;
  labels: string[];
  payloadHash: string;
  status: BugStatus;
  reviewId: string | null;
  approvalId: string | null;
  externalKey: string | null;
  externalUrl: string | null;
  error: string | null;
  createdBy: string;
  publishedBy: string | null;
  revertedBy: string | null;
  updatedAt: Date;
};

const BUG_COLS = `id, run_id AS "runId", triage_id AS "triageId", tracker, target, summary, description, labels,
  payload_hash AS "payloadHash", status, review_id AS "reviewId", approval_id AS "approvalId", external_key AS "externalKey",
  external_url AS "externalUrl", error, created_by AS "createdBy", published_by AS "publishedBy",
  reverted_by AS "revertedBy", updated_at AS "updatedAt"`;

export async function insertBug(
  db: Db,
  scope: TenantScope,
  b: Pick<
    BugRow,
    | 'runId'
    | 'triageId'
    | 'tracker'
    | 'target'
    | 'summary'
    | 'description'
    | 'labels'
    | 'payloadHash'
    | 'createdBy'
  >,
): Promise<BugRow> {
  const rows = await db.query<BugRow>(
    `INSERT INTO bug_reports (id, tenant_id, project_id, run_id, triage_id, tracker, target, summary, description, labels,
       payload_hash, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT',$12) RETURNING ${BUG_COLS}`,
    [
      newId('bug'),
      scope.tenantId,
      scope.projectId,
      b.runId,
      b.triageId,
      b.tracker,
      b.target,
      b.summary,
      b.description,
      b.labels,
      b.payloadHash,
      b.createdBy,
    ],
  );
  return rows[0]!;
}

export async function getBug(db: Db, scope: TenantScope, id: string): Promise<BugRow | null> {
  const rows = await db.query<BugRow>(
    `SELECT ${BUG_COLS} FROM bug_reports WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

/** Optimistic status change: succeeds only if the bug is currently in one of `from`. */
export async function updateBug(
  db: Db,
  scope: TenantScope,
  id: string,
  from: BugStatus[],
  u: Partial<
    Pick<
      BugRow,
      | 'status'
      | 'reviewId'
      | 'approvalId'
      | 'externalKey'
      | 'externalUrl'
      | 'error'
      | 'publishedBy'
      | 'revertedBy'
    >
  >,
): Promise<BugRow> {
  const rows = await db.query<BugRow>(
    `UPDATE bug_reports SET status = coalesce($5, status), review_id = coalesce($6, review_id),
        approval_id = coalesce($7, approval_id), external_key = coalesce($8, external_key),
        external_url = coalesce($9, external_url), error = $10, published_by = coalesce($11, published_by),
        reverted_by = coalesce($12, reverted_by), updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND status = ANY($4::text[]) RETURNING ${BUG_COLS}`,
    [
      id,
      scope.tenantId,
      scope.projectId,
      from,
      u.status ?? null,
      u.reviewId ?? null,
      u.approvalId ?? null,
      u.externalKey ?? null,
      u.externalUrl ?? null,
      u.error ?? null,
      u.publishedBy ?? null,
      u.revertedBy ?? null,
    ],
  );
  if (!rows[0]) throw new DomainError('CONFLICT', `bug ${id} is not in ${from.join('/')}`);
  return rows[0];
}
