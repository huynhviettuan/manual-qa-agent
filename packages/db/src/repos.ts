import type { AcceptanceCriterion, Actor, CaseStatus, Role, TenantScope } from '@qa/domain';
import { DomainError, newId, sha256 } from '@qa/domain';
import type { Db } from './db.ts';

// Every function that reads or writes tenant data takes a TenantScope and filters on
// both tenant_id and project_id. There is deliberately no unscoped variant.

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

// ---------------------------------------------------------------- identity

export async function createProject(db: Db, scope: TenantScope, name: string) {
  await db.query(
    'INSERT INTO projects (id, tenant_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    [scope.projectId, scope.tenantId, name],
  );
}

export async function createActor(
  db: Db,
  scope: TenantScope,
  a: { id: string; name: string; roles: Role[] },
) {
  await db.query(
    `INSERT INTO actors (id, tenant_id, project_id, display_name, roles) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET roles = EXCLUDED.roles`,
    [a.id, scope.tenantId, scope.projectId, a.name, a.roles],
  );
}

/** Stores only the SHA-256 of the key. */
export async function createApiKey(db: Db, actorId: string, rawKey: string) {
  await db.query('INSERT INTO api_keys (key_hash, actor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    sha256(rawKey),
    actorId,
  ]);
}

export async function findActorByApiKey(db: Db, rawKey: string): Promise<Actor | null> {
  const rows = await db.query<Actor>(
    `SELECT a.id, a.tenant_id AS "tenantId", a.project_id AS "projectId", a.roles
       FROM api_keys k JOIN actors a ON a.id = k.actor_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [sha256(rawKey)],
  );
  return rows[0] ?? null;
}

export async function getActor(db: Db, scope: TenantScope, id: string): Promise<Actor | null> {
  const rows = await db.query<Actor>(
    `SELECT id, tenant_id AS "tenantId", project_id AS "projectId", roles FROM actors
      WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export type EnvironmentRow = {
  id: string;
  kind: 'test' | 'staging' | 'production';
  allowedActions: string[];
  /** Execution target (Phase 2). Runs may only reach `allowedHosts`. */
  baseUrl?: string | null;
  allowedHosts?: string[];
};

export async function upsertEnvironment(db: Db, scope: TenantScope, e: EnvironmentRow) {
  await db.query(
    `INSERT INTO environments (id, tenant_id, project_id, kind, allowed_actions, base_url, allowed_hosts)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, project_id, id) DO UPDATE SET kind = EXCLUDED.kind,
       allowed_actions = EXCLUDED.allowed_actions, base_url = EXCLUDED.base_url, allowed_hosts = EXCLUDED.allowed_hosts`,
    [
      e.id,
      scope.tenantId,
      scope.projectId,
      e.kind,
      e.allowedActions,
      e.baseUrl ?? null,
      e.allowedHosts ?? [],
    ],
  );
}

export async function getEnvironment(db: Db, scope: TenantScope, id: string): Promise<EnvironmentRow | null> {
  const rows = await db.query<EnvironmentRow>(
    `SELECT id, kind, allowed_actions AS "allowedActions", base_url AS "baseUrl", allowed_hosts AS "allowedHosts"
       FROM environments WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- stories

export type StoryRow = {
  id: string;
  externalId: string;
  version: number;
  title: string;
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
  targetRelease: string | null;
  createdBy: string;
};

const STORY_COLS = `id, external_id AS "externalId", version, title, description,
  acceptance_criteria AS "acceptanceCriteria", target_release AS "targetRelease", created_by AS "createdBy"`;

/** Stories are immutable snapshots; each submission with changed content is a new version. */
export async function insertStoryVersion(
  db: Db,
  scope: TenantScope,
  s: Omit<StoryRow, 'id' | 'version'>,
): Promise<StoryRow> {
  return db.transaction(async (tx) => {
    const latest = (
      await tx.query<StoryRow>(
        `SELECT ${STORY_COLS} FROM stories WHERE tenant_id = $1 AND project_id = $2 AND external_id = $3
          ORDER BY version DESC LIMIT 1`,
        [scope.tenantId, scope.projectId, s.externalId],
      )
    )[0];
    if (
      latest &&
      latest.title === s.title &&
      latest.description === s.description &&
      latest.targetRelease === s.targetRelease &&
      JSON.stringify(latest.acceptanceCriteria) === JSON.stringify(s.acceptanceCriteria)
    ) {
      return latest;
    }
    const rows = await tx.query<StoryRow>(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, target_release, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9,$10) RETURNING ${STORY_COLS}`,
      [
        newId('story'),
        scope.tenantId,
        scope.projectId,
        s.externalId,
        (latest?.version ?? 0) + 1,
        s.title,
        s.description,
        json(s.acceptanceCriteria),
        s.targetRelease,
        s.createdBy,
      ],
    );
    return rows[0]!;
  });
}

export async function getStory(db: Db, scope: TenantScope, id: string): Promise<StoryRow | null> {
  const rows = await db.query<StoryRow>(
    `SELECT ${STORY_COLS} FROM stories WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- knowledge

export type SourceRow = {
  id: string;
  sourceId: string;
  version: string;
  sourceType: string;
  trustTier: 'T1' | 'T2' | 'T3' | 'T4';
  approvalStatus: 'APPROVED' | 'UNAPPROVED';
  approvedBy: string | null;
  owner: string;
  productArea: string | null;
  releaseVersion: string | null;
  ruleKeys: string[];
  /** `sourceId@version` refs this source refines; such pairs are not contradictions. */
  refines: string[];
  effectiveFrom: Date;
  contentHash: string;
  content: string;
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
  createdBy: string;
};

const SOURCE_COLS = `id, source_id AS "sourceId", version, source_type AS "sourceType", trust_tier AS "trustTier",
  approval_status AS "approvalStatus", approved_by AS "approvedBy", owner, product_area AS "productArea",
  release_version AS "releaseVersion", rule_keys AS "ruleKeys", refines, effective_from AS "effectiveFrom",
  content_hash AS "contentHash", content, status, created_by AS "createdBy"`;

export type ChunkInsert = {
  chunkIndex: number;
  heading: string | null;
  content: string;
  identifiers: string[];
  tokenEstimate: number;
};

export async function findSourceVersion(
  db: Db,
  scope: TenantScope,
  sourceId: string,
  version: string,
): Promise<SourceRow | null> {
  const rows = await db.query<SourceRow>(
    `SELECT ${SOURCE_COLS} FROM knowledge_sources
      WHERE tenant_id = $1 AND project_id = $2 AND source_id = $3 AND version = $4`,
    [scope.tenantId, scope.projectId, sourceId, version],
  );
  return rows[0] ?? null;
}

export async function insertSourceWithChunks(
  db: Db,
  scope: TenantScope,
  s: Omit<SourceRow, 'id' | 'status'>,
  chunks: ChunkInsert[],
): Promise<SourceRow> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<SourceRow>(
      `INSERT INTO knowledge_sources (id, tenant_id, project_id, source_id, version, source_type, trust_tier,
         approval_status, approved_by, owner, product_area, release_version, rule_keys, effective_from,
         content_hash, content, created_by, refines)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING ${SOURCE_COLS}`,
      [
        newId('src'),
        scope.tenantId,
        scope.projectId,
        s.sourceId,
        s.version,
        s.sourceType,
        s.trustTier,
        s.approvalStatus,
        s.approvedBy,
        s.owner,
        s.productArea,
        s.releaseVersion,
        s.ruleKeys,
        s.effectiveFrom,
        s.contentHash,
        s.content,
        s.createdBy,
        s.refines,
      ],
    );
    const source = rows[0]!;
    for (const c of chunks) {
      await tx.query(
        `INSERT INTO knowledge_chunks (id, tenant_id, project_id, source_row_id, source_id, source_version,
           chunk_index, heading, content, identifiers, token_estimate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          newId('chunk'),
          scope.tenantId,
          scope.projectId,
          source.id,
          s.sourceId,
          s.version,
          c.chunkIndex,
          c.heading,
          c.content,
          c.identifiers,
          c.tokenEstimate,
        ],
      );
    }
    // A new approved version supersedes older active approved versions of the same source.
    if (s.approvalStatus === 'APPROVED') {
      await tx.query(
        `UPDATE knowledge_sources SET status = 'SUPERSEDED'
          WHERE tenant_id = $1 AND project_id = $2 AND source_id = $3 AND id <> $4
            AND status = 'ACTIVE' AND approval_status = 'APPROVED' AND effective_from <= $5`,
        [scope.tenantId, scope.projectId, s.sourceId, source.id, s.effectiveFrom],
      );
    }
    return source;
  });
}

export async function revokeSourceVersion(
  db: Db,
  scope: TenantScope,
  sourceId: string,
  version: string,
): Promise<boolean> {
  const rows = await db.query(
    `UPDATE knowledge_sources SET status = 'REVOKED', revoked_at = now()
      WHERE tenant_id = $1 AND project_id = $2 AND source_id = $3 AND version = $4 AND status <> 'REVOKED'
      RETURNING id`,
    [scope.tenantId, scope.projectId, sourceId, version],
  );
  return rows.length > 0;
}

export type ChunkHit = {
  chunkId: string;
  sourceId: string;
  version: string;
  heading: string | null;
  content: string;
  identifiers: string[];
  tokenEstimate: number;
  trustTier: 'T1' | 'T2' | 'T3' | 'T4';
  ruleKeys: string[];
  effectiveFrom: Date;
  contentHash: string;
  exactMatch: boolean;
  textRank: number;
};

/**
 * Trusted retrieval: approved, active, already-effective versions only, within scope.
 * Exact identifier matches rank above full-text matches.
 */
export async function searchTrustedChunks(
  db: Db,
  scope: TenantScope,
  q: { identifiers: string[]; text: string; tiers: string[]; limit: number },
): Promise<ChunkHit[]> {
  return db.query<ChunkHit>(
    `WITH q AS (SELECT websearch_to_tsquery('english', $3) AS tsq)
     SELECT c.id AS "chunkId", c.source_id AS "sourceId", c.source_version AS "version", c.heading,
            c.content, c.identifiers, c.token_estimate AS "tokenEstimate", s.trust_tier AS "trustTier",
            s.rule_keys AS "ruleKeys", s.effective_from AS "effectiveFrom", s.content_hash AS "contentHash",
            (c.identifiers && $4::text[]) AS "exactMatch",
            ts_rank(c.tsv, q.tsq)::float8 AS "textRank"
       FROM knowledge_chunks c
       JOIN knowledge_sources s ON s.id = c.source_row_id
       CROSS JOIN q
      WHERE c.tenant_id = $1 AND c.project_id = $2
        AND s.tenant_id = $1 AND s.project_id = $2
        AND s.approval_status = 'APPROVED' AND s.status = 'ACTIVE' AND s.effective_from <= now()
        AND s.trust_tier = ANY($5::text[])
        AND ((c.identifiers && $4::text[]) OR c.tsv @@ q.tsq)
      ORDER BY "exactMatch" DESC, "textRank" DESC, s.effective_from DESC
      LIMIT $6`,
    [scope.tenantId, scope.projectId, q.text, q.identifiers, q.tiers, q.limit],
  );
}

/** Active approved sources sharing any of the given rule keys (for contradiction detection). */
export async function activeSourcesForRuleKeys(db: Db, scope: TenantScope, ruleKeys: string[]) {
  if (ruleKeys.length === 0) return [];
  return db.query<{
    sourceId: string;
    version: string;
    ruleKeys: string[];
    refines: string[];
    contentHash: string;
  }>(
    `SELECT source_id AS "sourceId", version, rule_keys AS "ruleKeys", refines, content_hash AS "contentHash"
       FROM knowledge_sources
      WHERE tenant_id = $1 AND project_id = $2 AND approval_status = 'APPROVED' AND status = 'ACTIVE'
        AND effective_from <= now() AND rule_keys && $3::text[]`,
    [scope.tenantId, scope.projectId, ruleKeys],
  );
}

// ---------------------------------------------------------------- workflows

export type WorkflowRow = {
  id: string;
  kind: string;
  storyId: string | null;
  correlationId: string;
  idempotencyKey: string;
  state: string;
  outcome: unknown;
  actorId: string;
};

const WORKFLOW_COLS = `id, kind, story_id AS "storyId", correlation_id AS "correlationId",
  idempotency_key AS "idempotencyKey", state, outcome, actor_id AS "actorId"`;

/** Idempotent: the same key in the same scope returns the existing workflow. */
export async function createOrGetWorkflow(
  db: Db,
  scope: TenantScope,
  w: { kind: string; storyId: string | null; correlationId: string; idempotencyKey: string; actorId: string },
): Promise<{ workflow: WorkflowRow; created: boolean }> {
  const inserted = await db.query<WorkflowRow>(
    `INSERT INTO workflows (id, tenant_id, project_id, kind, story_id, correlation_id, idempotency_key, state, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'RUNNING',$8)
     ON CONFLICT (tenant_id, project_id, idempotency_key) DO NOTHING RETURNING ${WORKFLOW_COLS}`,
    [
      newId('wf'),
      scope.tenantId,
      scope.projectId,
      w.kind,
      w.storyId,
      w.correlationId,
      w.idempotencyKey,
      w.actorId,
    ],
  );
  if (inserted[0]) return { workflow: inserted[0], created: true };
  const existing = await db.query<WorkflowRow>(
    `SELECT ${WORKFLOW_COLS} FROM workflows WHERE tenant_id = $1 AND project_id = $2 AND idempotency_key = $3`,
    [scope.tenantId, scope.projectId, w.idempotencyKey],
  );
  return { workflow: existing[0]!, created: false };
}

export async function getWorkflow(db: Db, scope: TenantScope, id: string): Promise<WorkflowRow | null> {
  const rows = await db.query<WorkflowRow>(
    `SELECT ${WORKFLOW_COLS} FROM workflows WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export async function finishWorkflow(
  db: Db,
  scope: TenantScope,
  id: string,
  state: string,
  outcome: unknown,
) {
  await db.query(
    `UPDATE workflows SET state = $4, outcome = $5::text::jsonb, updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId, state, json(outcome)],
  );
}

export type TaskRow = {
  id: string;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  result: unknown;
};

export async function getTask(db: Db, workflowId: string, taskType: string): Promise<TaskRow | null> {
  const rows = await db.query<TaskRow>(
    'SELECT id, state, attempts, result FROM workflow_tasks WHERE workflow_id = $1 AND task_type = $2',
    [workflowId, taskType],
  );
  return rows[0] ?? null;
}

export async function startTask(db: Db, workflowId: string, taskType: string): Promise<TaskRow> {
  const rows = await db.query<TaskRow>(
    `INSERT INTO workflow_tasks (id, workflow_id, task_type, state) VALUES ($1,$2,$3,'RUNNING')
     ON CONFLICT (workflow_id, task_type)
       DO UPDATE SET state = 'RUNNING', attempts = workflow_tasks.attempts + 1, updated_at = now()
     RETURNING id, state, attempts, result`,
    [newId('task'), workflowId, taskType],
  );
  return rows[0]!;
}

export async function completeTask(db: Db, taskId: string, state: 'SUCCEEDED' | 'FAILED', result: unknown) {
  await db.query(
    'UPDATE workflow_tasks SET state = $2, result = $3::text::jsonb, updated_at = now() WHERE id = $1',
    [taskId, state, json(result)],
  );
}

// ---------------------------------------------------------------- test cases

export type CaseRevisionRow = {
  caseId: string;
  storyId: string;
  revisionId: string;
  revision: number;
  status: CaseStatus;
  content: unknown;
  sourceRefs: string[];
  authorId: string;
  workflowId: string | null;
};

const REVISION_SELECT = `SELECT c.id AS "caseId", c.story_id AS "storyId", r.id AS "revisionId", r.revision,
  r.status, r.content, r.source_refs AS "sourceRefs", r.author_id AS "authorId", c.workflow_id AS "workflowId"
  FROM test_cases c JOIN test_case_revisions r ON r.case_id = c.id`;

export async function createTestCase(
  db: Db,
  scope: TenantScope,
  c: { storyId: string; workflowId: string | null; content: unknown; sourceRefs: string[]; authorId: string },
): Promise<CaseRevisionRow> {
  return db.transaction(async (tx) => {
    const caseId = newId('case');
    await tx.query(
      'INSERT INTO test_cases (id, tenant_id, project_id, story_id, workflow_id) VALUES ($1,$2,$3,$4,$5)',
      [caseId, scope.tenantId, scope.projectId, c.storyId, c.workflowId],
    );
    await tx.query(
      `INSERT INTO test_case_revisions (id, case_id, revision, status, content, source_refs, author_id)
       VALUES ($1,$2,1,'DRAFT',$3::text::jsonb,$4,$5)`,
      [newId('rev'), caseId, json(c.content), c.sourceRefs, c.authorId],
    );
    return (await latestRevision(tx, scope, caseId))!;
  });
}

export async function latestRevision(
  db: Db,
  scope: TenantScope,
  caseId: string,
): Promise<CaseRevisionRow | null> {
  const rows = await db.query<CaseRevisionRow>(
    `${REVISION_SELECT} WHERE c.id = $1 AND c.tenant_id = $2 AND c.project_id = $3
      ORDER BY r.revision DESC LIMIT 1`,
    [caseId, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export async function listRevisions(db: Db, scope: TenantScope, caseId: string): Promise<CaseRevisionRow[]> {
  return db.query<CaseRevisionRow>(
    `${REVISION_SELECT} WHERE c.id = $1 AND c.tenant_id = $2 AND c.project_id = $3 ORDER BY r.revision`,
    [caseId, scope.tenantId, scope.projectId],
  );
}

export async function addRevision(
  db: Db,
  scope: TenantScope,
  caseId: string,
  r: { content: unknown; sourceRefs: string[]; authorId: string; status: CaseStatus },
): Promise<CaseRevisionRow> {
  return db.transaction(async (tx) => {
    const latest = await latestRevision(tx, scope, caseId);
    if (!latest) throw new DomainError('NOT_FOUND', `test case ${caseId} not found`);
    await tx.query(
      `INSERT INTO test_case_revisions (id, case_id, revision, status, content, source_refs, author_id)
       VALUES ($1,$2,$3,$4,$5::text::jsonb,$6,$7)`,
      [newId('rev'), caseId, latest.revision + 1, r.status, json(r.content), r.sourceRefs, r.authorId],
    );
    return (await latestRevision(tx, scope, caseId))!;
  });
}

/** Status is the only mutable field of a revision; callers validate the transition first. */
export async function setRevisionStatus(db: Db, scope: TenantScope, revisionId: string, status: CaseStatus) {
  const rows = await db.query(
    `UPDATE test_case_revisions r SET status = $4 FROM test_cases c
      WHERE r.id = $1 AND r.case_id = c.id AND c.tenant_id = $2 AND c.project_id = $3 RETURNING r.id`,
    [revisionId, scope.tenantId, scope.projectId, status],
  );
  if (rows.length === 0) throw new DomainError('NOT_FOUND', `revision ${revisionId} not found`);
}

// ---------------------------------------------------------------- reviews & approvals

export type ReviewRow = {
  id: string;
  workflowId: string | null;
  kind: string;
  subjectType: string;
  subjectId: string;
  question: string;
  reason: string;
  sourceRefs: string[];
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  assignedRole: string;
  assigneeId: string | null;
  recommendedAction: string;
  modelSuggestion: unknown;
  targetEnvironment: string | null;
  proposedActionHash: string | null;
  policyVersion: string;
  resolution: unknown;
  resolvedBy: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  expiresAt: Date | null;
};

const REVIEW_COLS = `id, workflow_id AS "workflowId", kind, subject_type AS "subjectType", subject_id AS "subjectId",
  question, reason, source_refs AS "sourceRefs", risk, status, assigned_role AS "assignedRole",
  assignee_id AS "assigneeId", recommended_action AS "recommendedAction", model_suggestion AS "modelSuggestion",
  target_environment AS "targetEnvironment", proposed_action_hash AS "proposedActionHash",
  policy_version AS "policyVersion", resolution, resolved_by AS "resolvedBy", created_at AS "createdAt",
  resolved_at AS "resolvedAt", expires_at AS "expiresAt"`;

export type ReviewInsert = Omit<
  ReviewRow,
  'id' | 'status' | 'assigneeId' | 'resolution' | 'resolvedBy' | 'createdAt' | 'resolvedAt'
>;

export async function insertReview(db: Db, scope: TenantScope, r: ReviewInsert): Promise<ReviewRow> {
  const rows = await db.query<ReviewRow>(
    `INSERT INTO review_tasks (id, tenant_id, project_id, workflow_id, kind, subject_type, subject_id, question,
       reason, source_refs, risk, status, assigned_role, recommended_action, model_suggestion, target_environment,
       proposed_action_hash, policy_version, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OPEN',$12,$13,$14::text::jsonb,$15,$16,$17,$18)
     RETURNING ${REVIEW_COLS}`,
    [
      newId('review'),
      scope.tenantId,
      scope.projectId,
      r.workflowId,
      r.kind,
      r.subjectType,
      r.subjectId,
      r.question,
      r.reason,
      r.sourceRefs,
      r.risk,
      r.assignedRole,
      r.recommendedAction,
      json(r.modelSuggestion),
      r.targetEnvironment,
      r.proposedActionHash,
      r.policyVersion,
      r.expiresAt,
    ],
  );
  return rows[0]!;
}

export async function getReview(db: Db, scope: TenantScope, id: string): Promise<ReviewRow | null> {
  const rows = await db.query<ReviewRow>(
    `SELECT ${REVIEW_COLS} FROM review_tasks WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export async function listReviews(
  db: Db,
  scope: TenantScope,
  f: { status?: string; assignedRoles?: string[]; limit: number; offset: number },
): Promise<ReviewRow[]> {
  return db.query<ReviewRow>(
    `SELECT ${REVIEW_COLS} FROM review_tasks
      WHERE tenant_id = $1 AND project_id = $2
        AND ($3::text IS NULL OR status = $3)
        AND ($4::text[] IS NULL OR assigned_role = ANY($4::text[]))
      ORDER BY created_at ASC LIMIT $5 OFFSET $6`,
    [scope.tenantId, scope.projectId, f.status ?? null, f.assignedRoles ?? null, f.limit, f.offset],
  );
}

/** Optimistic update: only succeeds if the review is still in `expectedStatus`. */
export async function updateReviewStatus(
  db: Db,
  scope: TenantScope,
  id: string,
  expectedStatus: string,
  u: {
    status: string;
    assignedRole?: string;
    assigneeId?: string | null;
    resolution?: unknown;
    resolvedBy?: string;
  },
): Promise<ReviewRow> {
  const terminal = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(u.status);
  const rows = await db.query<ReviewRow>(
    `UPDATE review_tasks SET status = $5,
        assigned_role = coalesce($6, assigned_role),
        assignee_id = coalesce($7, assignee_id),
        resolution = coalesce($8::text::jsonb, resolution),
        resolved_by = coalesce($9, resolved_by),
        resolved_at = CASE WHEN $10 THEN now() ELSE resolved_at END
      WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND status = $4
      RETURNING ${REVIEW_COLS}`,
    [
      id,
      scope.tenantId,
      scope.projectId,
      expectedStatus,
      u.status,
      u.assignedRole ?? null,
      u.assigneeId ?? null,
      json(u.resolution),
      u.resolvedBy ?? null,
      terminal,
    ],
  );
  if (!rows[0]) throw new DomainError('CONFLICT', `review ${id} changed concurrently`);
  return rows[0];
}

export type ApprovalRow = {
  id: string;
  reviewId: string;
  actionHash: string;
  environmentId: string;
  approvedBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

const APPROVAL_COLS = `id, review_id AS "reviewId", action_hash AS "actionHash", environment_id AS "environmentId",
  approved_by AS "approvedBy", expires_at AS "expiresAt", revoked_at AS "revokedAt"`;

export async function insertApproval(
  db: Db,
  scope: TenantScope,
  a: Omit<ApprovalRow, 'id' | 'revokedAt'>,
): Promise<ApprovalRow> {
  const rows = await db.query<ApprovalRow>(
    `INSERT INTO approvals (id, tenant_id, project_id, review_id, action_hash, environment_id, approved_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${APPROVAL_COLS}`,
    [
      newId('appr'),
      scope.tenantId,
      scope.projectId,
      a.reviewId,
      a.actionHash,
      a.environmentId,
      a.approvedBy,
      a.expiresAt,
    ],
  );
  return rows[0]!;
}

export async function getApproval(db: Db, scope: TenantScope, id: string): Promise<ApprovalRow | null> {
  const rows = await db.query<ApprovalRow>(
    `SELECT ${APPROVAL_COLS} FROM approvals WHERE id = $1 AND tenant_id = $2 AND project_id = $3`,
    [id, scope.tenantId, scope.projectId],
  );
  return rows[0] ?? null;
}

export async function revokeApproval(db: Db, scope: TenantScope, id: string) {
  await db.query(
    'UPDATE approvals SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND revoked_at IS NULL',
    [id, scope.tenantId, scope.projectId],
  );
}

// ---------------------------------------------------------------- audit & telemetry records

export type DecisionRecordInsert = {
  workflowId: string | null;
  kind: string;
  provider: string;
  requestedModel: string;
  model: string | null;
  promptVersion: string;
  inputHash: string;
  snapshotId: string | null;
  sourceRefs: string[];
  outcome: string;
  result: unknown;
  usage: unknown;
  latencyMs: number;
  /** Served from the decision cache (no provider call). */
  cacheHit?: boolean;
};

export async function insertDecisionRecord(
  db: Db,
  scope: TenantScope,
  d: DecisionRecordInsert,
): Promise<string> {
  const id = newId('dec');
  await db.query(
    `INSERT INTO decision_records (id, tenant_id, project_id, workflow_id, kind, provider, requested_model, model,
       prompt_version, input_hash, snapshot_id, source_refs, outcome, result, usage, latency_ms, cache_hit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text::jsonb,$15::text::jsonb,$16,$17)`,
    [
      id,
      scope.tenantId,
      scope.projectId,
      d.workflowId,
      d.kind,
      d.provider,
      d.requestedModel,
      d.model,
      d.promptVersion,
      d.inputHash,
      d.snapshotId,
      d.sourceRefs,
      d.outcome,
      json(d.result),
      json(d.usage),
      Math.round(d.latencyMs),
      d.cacheHit ?? false,
    ],
  );
  return id;
}

export type PolicyEvaluationInsert = {
  workflowId: string | null;
  actorId: string;
  actionKind: string;
  actionHash: string;
  environmentId: string;
  policyVersion: string;
  gate: string;
  reasons: string[];
  decisionRecordId: string | null;
  approvalId: string | null;
};

export async function insertPolicyEvaluation(
  db: Db,
  scope: TenantScope,
  p: PolicyEvaluationInsert,
): Promise<string> {
  const id = newId('pol');
  await db.query(
    `INSERT INTO policy_evaluations (id, tenant_id, project_id, workflow_id, actor_id, action_kind, action_hash,
       environment_id, policy_version, gate, reasons, decision_record_id, approval_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      scope.tenantId,
      scope.projectId,
      p.workflowId,
      p.actorId,
      p.actionKind,
      p.actionHash,
      p.environmentId,
      p.policyVersion,
      p.gate,
      p.reasons,
      p.decisionRecordId,
      p.approvalId,
    ],
  );
  return id;
}

export type UsageEventInsert = {
  workflowId: string | null;
  component: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  retrievedTokensEstimate: number;
  latencyMs: number;
};

export async function insertUsageEvent(db: Db, scope: TenantScope, u: UsageEventInsert) {
  await db.query(
    `INSERT INTO usage_events (id, tenant_id, project_id, workflow_id, component, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, retrieved_tokens_estimate, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      newId('use'),
      scope.tenantId,
      scope.projectId,
      u.workflowId,
      u.component,
      u.model,
      u.inputTokens,
      u.outputTokens,
      u.cacheReadTokens,
      u.cacheWriteTokens,
      u.retrievedTokensEstimate,
      Math.round(u.latencyMs),
    ],
  );
}

export type AuditEventInsert = {
  actorId: string;
  workflowId: string | null;
  correlationId: string | null;
  actionKind: string;
  actionHash: string | null;
  target: string;
  policyVersion: string | null;
  decisionRecordId: string | null;
  approvalId: string | null;
  outcome: string;
};

export async function insertAuditEvent(db: Db, scope: TenantScope, a: AuditEventInsert) {
  await db.query(
    `INSERT INTO audit_events (id, tenant_id, project_id, actor_id, workflow_id, correlation_id, action_kind,
       action_hash, target, policy_version, decision_record_id, approval_id, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      newId('audit'),
      scope.tenantId,
      scope.projectId,
      a.actorId,
      a.workflowId,
      a.correlationId,
      a.actionKind,
      a.actionHash,
      a.target,
      a.policyVersion,
      a.decisionRecordId,
      a.approvalId,
      a.outcome,
    ],
  );
}

export async function workflowUsage(db: Db, scope: TenantScope, workflowId: string) {
  const [usage, decisions, policies] = await Promise.all([
    db.query(
      `SELECT component, model, input_tokens AS "inputTokens", output_tokens AS "outputTokens",
              cache_read_tokens AS "cacheReadTokens", cache_write_tokens AS "cacheWriteTokens",
              retrieved_tokens_estimate AS "retrievedTokensEstimate", latency_ms AS "latencyMs", created_at AS "createdAt"
         FROM usage_events WHERE workflow_id = $1 AND tenant_id = $2 AND project_id = $3 ORDER BY created_at`,
      [workflowId, scope.tenantId, scope.projectId],
    ),
    db.query(
      `SELECT id, kind, provider, requested_model AS "requestedModel", model, prompt_version AS "promptVersion",
              input_hash AS "inputHash", snapshot_id AS "snapshotId", source_refs AS "sourceRefs", outcome, usage,
              cache_hit AS "cacheHit",
              latency_ms AS "latencyMs", created_at AS "createdAt"
         FROM decision_records WHERE workflow_id = $1 AND tenant_id = $2 AND project_id = $3 ORDER BY created_at`,
      [workflowId, scope.tenantId, scope.projectId],
    ),
    db.query(
      `SELECT id, action_kind AS "actionKind", action_hash AS "actionHash", environment_id AS "environmentId",
              policy_version AS "policyVersion", gate, reasons, decision_record_id AS "decisionRecordId", created_at AS "createdAt"
         FROM policy_evaluations WHERE workflow_id = $1 AND tenant_id = $2 AND project_id = $3 ORDER BY created_at`,
      [workflowId, scope.tenantId, scope.projectId],
    ),
  ]);
  return { usage, decisions, policyEvaluations: policies };
}

/**
 * Changes whenever any source in scope is added, superseded or revoked. Used in default
 * idempotency keys so a story re-runs after its knowledge changes but not otherwise.
 */
export async function knowledgeStamp(db: Db, scope: TenantScope): Promise<string> {
  const rows = await db.query<{ n: string; added: Date | null; revoked: Date | null; superseded: string }>(
    `SELECT count(*)::text AS n, max(created_at) AS added, max(revoked_at) AS revoked,
            count(*) FILTER (WHERE status = 'SUPERSEDED')::text AS superseded
       FROM knowledge_sources WHERE tenant_id = $1 AND project_id = $2`,
    [scope.tenantId, scope.projectId],
  );
  const r = rows[0]!;
  return sha256(
    `${r.n}|${r.added?.toISOString() ?? ''}|${r.revoked?.toISOString() ?? ''}|${r.superseded}`,
  ).slice(0, 16);
}
