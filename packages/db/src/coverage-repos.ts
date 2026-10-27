import type { CaseStatus, TenantScope } from '@qa/domain';
import type { Db } from './db.ts';

// Read models for coverage, exports and the question register (ADR-0018): whole-project views
// that the per-id repositories do not offer. Every query is tenant- and project-scoped.

export type ActiveSourceRow = {
  sourceId: string;
  version: string;
  sourceType: string;
  productArea: string | null;
  identifiers: string[];
};

/** Approved, active sources with the identifiers their chunks carry (AC ids, rule numbers, paths). */
export async function listActiveSources(db: Db, scope: TenantScope): Promise<ActiveSourceRow[]> {
  return db.query<ActiveSourceRow>(
    `SELECT s.source_id AS "sourceId", s.version, s.source_type AS "sourceType", s.product_area AS "productArea",
       COALESCE((SELECT array_agg(DISTINCT i) FROM knowledge_chunks c, unnest(c.identifiers) AS i
                  WHERE c.source_row_id = s.id), '{}') AS identifiers
     FROM knowledge_sources s
     WHERE s.tenant_id = $1 AND s.project_id = $2 AND s.approval_status = 'APPROVED' AND s.status = 'ACTIVE'
     ORDER BY s.source_id, s.version`,
    [scope.tenantId, scope.projectId],
  );
}

export type LatestCaseRow = {
  caseId: string;
  code: string | null;
  storyId: string;
  storyExternalId: string;
  revision: number;
  status: CaseStatus;
  content: unknown;
  sourceRefs: string[];
  knownBug: string | null;
};

/** The latest revision of every case in the project, oldest case first. */
export async function listLatestCases(db: Db, scope: TenantScope): Promise<LatestCaseRow[]> {
  return db
    .query<LatestCaseRow>(
      `SELECT DISTINCT ON (c.id) c.id AS "caseId", c.code, c.story_id AS "storyId", st.external_id AS "storyExternalId",
       r.revision, r.status, r.content, r.source_refs AS "sourceRefs", c.known_bug AS "knownBug", c.created_at
     FROM test_cases c
     JOIN test_case_revisions r ON r.case_id = c.id
     JOIN stories st ON st.id = c.story_id
     WHERE c.tenant_id = $1 AND c.project_id = $2
     ORDER BY c.id, r.revision DESC`,
      [scope.tenantId, scope.projectId],
    )
    .then((rows) => rows.sort((a, b) => (a.caseId < b.caseId ? -1 : 1)));
}

export type LatestStoryRow = {
  id: string;
  externalId: string;
  version: number;
  title: string;
  acceptanceCriteria: Array<{ id: string; text: string }>;
};

/** The latest version of every story in the project. */
export async function listLatestStories(db: Db, scope: TenantScope): Promise<LatestStoryRow[]> {
  return db.query<LatestStoryRow>(
    `SELECT DISTINCT ON (external_id) id, external_id AS "externalId", version, title,
       acceptance_criteria AS "acceptanceCriteria"
     FROM stories WHERE tenant_id = $1 AND project_id = $2
     ORDER BY external_id, version DESC`,
    [scope.tenantId, scope.projectId],
  );
}

export type LatestExecutionRow = {
  caseId: string;
  kind: 'manual' | 'automated';
  status: string;
  reason: string | null;
  actual: string | null;
  environmentId: string;
  build: string | null;
  defectRef: string | null;
  testerId: string | null;
  at: Date;
};

/** The most recent execution per case, manual or automated, for the execution columns of an export. */
export async function listLatestExecutions(db: Db, scope: TenantScope): Promise<LatestExecutionRow[]> {
  return db.query<LatestExecutionRow>(
    `SELECT DISTINCT ON ("caseId") * FROM (
       SELECT case_id AS "caseId", 'manual' AS kind, status, NULLIF(reason, '') AS reason,
              (SELECT s->>'actual' FROM jsonb_array_elements(steps) s WHERE (s->>'index')::int = failed_step) AS actual,
              environment_id AS "environmentId", build, defect_ref AS "defectRef", tester_id AS "testerId",
              finished_at AS at
       FROM manual_runs WHERE tenant_id = $1 AND project_id = $2
       UNION ALL
       SELECT t.case_id, 'automated', t.state, t.reason, NULL, t.environment_id,
              (SELECT NULLIF(sr.build, '') FROM suite_run_items i JOIN suite_runs sr ON sr.id = i.suite_run_id
                WHERE i.run_id = t.id), NULL, NULL, t.created_at
       FROM test_runs t WHERE t.tenant_id = $1 AND t.project_id = $2
         AND state IN ('PASSED','FAILED','INCONCLUSIVE','BLOCKED')
     ) x ORDER BY "caseId", at DESC`,
    [scope.tenantId, scope.projectId],
  );
}
