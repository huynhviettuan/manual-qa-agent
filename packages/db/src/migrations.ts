import type { Db } from './db.ts';

type Migration = { id: string; sql: string };

// Append-only. Never edit a migration that has shipped; add a new one.
export const MIGRATIONS: Migration[] = [
  {
    id: '0001_init',
    sql: /* sql */ `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE projects (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Administrator-managed environments and action allowlists (never resolved from URLs).
CREATE TABLE environments (
  id text NOT NULL,
  tenant_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('test','staging','production')),
  allowed_actions text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, project_id, id)
);

CREATE TABLE actors (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  display_name text NOT NULL,
  roles text[] NOT NULL
);

CREATE TABLE api_keys (
  key_hash text PRIMARY KEY,
  actor_id text NOT NULL REFERENCES actors(id),
  revoked_at timestamptz
);

CREATE TABLE stories (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  external_id text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  acceptance_criteria jsonb NOT NULL,
  target_release text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, external_id, version)
);

-- Immutable source versions. Only status/revoked_at may change.
CREATE TABLE knowledge_sources (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  source_id text NOT NULL,
  version text NOT NULL,
  source_type text NOT NULL,
  trust_tier text NOT NULL CHECK (trust_tier IN ('T1','T2','T3','T4')),
  approval_status text NOT NULL CHECK (approval_status IN ('APPROVED','UNAPPROVED')),
  approved_by text,
  owner text NOT NULL,
  product_area text,
  release_version text,
  rule_keys text[] NOT NULL DEFAULT '{}',
  effective_from timestamptz NOT NULL,
  content_hash text NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','REVOKED')),
  revoked_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, source_id, version),
  CHECK (approval_status = 'UNAPPROVED' OR approved_by IS NOT NULL),
  CHECK (approval_status = 'APPROVED' OR trust_tier = 'T4')
);

CREATE TABLE knowledge_chunks (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  source_row_id text NOT NULL REFERENCES knowledge_sources(id),
  source_id text NOT NULL,
  source_version text NOT NULL,
  chunk_index integer NOT NULL,
  heading text,
  content text NOT NULL,
  identifiers text[] NOT NULL DEFAULT '{}',
  token_estimate integer NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading,'') || ' ' || content)) STORED,
  -- Reserved for vector ranking (ADR-0005); unused in the MVP.
  embedding vector(1024),
  UNIQUE (source_row_id, chunk_index)
);
CREATE INDEX knowledge_chunks_scope_idx ON knowledge_chunks (tenant_id, project_id);
CREATE INDEX knowledge_chunks_tsv_idx ON knowledge_chunks USING gin (tsv);
CREATE INDEX knowledge_chunks_identifiers_idx ON knowledge_chunks USING gin (identifiers);

CREATE TABLE workflows (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL,
  story_id text REFERENCES stories(id),
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL,
  outcome jsonb,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, idempotency_key)
);

CREATE TABLE workflow_tasks (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES workflows(id),
  task_type text NOT NULL,
  state text NOT NULL CHECK (state IN ('RUNNING','SUCCEEDED','FAILED')),
  attempts integer NOT NULL DEFAULT 1,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, task_type)
);

CREATE TABLE test_cases (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  story_id text NOT NULL REFERENCES stories(id),
  workflow_id text REFERENCES workflows(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Content is immutable per revision; edits create a new revision.
CREATE TABLE test_case_revisions (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES test_cases(id),
  revision integer NOT NULL,
  status text NOT NULL,
  content jsonb NOT NULL,
  source_refs text[] NOT NULL,
  author_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, revision)
);

CREATE TABLE review_tasks (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  workflow_id text REFERENCES workflows(id),
  kind text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  question text NOT NULL,
  reason text NOT NULL,
  source_refs text[] NOT NULL DEFAULT '{}',
  risk text NOT NULL CHECK (risk IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status text NOT NULL,
  assigned_role text NOT NULL,
  assignee_id text,
  recommended_action text NOT NULL,
  model_suggestion jsonb,
  target_environment text,
  proposed_action_hash text,
  policy_version text NOT NULL,
  resolution jsonb,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX review_tasks_queue_idx ON review_tasks (tenant_id, project_id, status, created_at);

CREATE TABLE approvals (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  review_id text NOT NULL REFERENCES review_tasks(id),
  action_hash text NOT NULL,
  environment_id text NOT NULL,
  approved_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decision_records (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  workflow_id text REFERENCES workflows(id),
  kind text NOT NULL,
  provider text NOT NULL,
  requested_model text NOT NULL,
  model text,
  prompt_version text NOT NULL,
  input_hash text NOT NULL,
  snapshot_id text,
  source_refs text[] NOT NULL DEFAULT '{}',
  outcome text NOT NULL,
  result jsonb,
  usage jsonb,
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_evaluations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  workflow_id text REFERENCES workflows(id),
  actor_id text NOT NULL,
  action_kind text NOT NULL,
  action_hash text NOT NULL,
  environment_id text NOT NULL,
  policy_version text NOT NULL,
  gate text NOT NULL,
  reasons text[] NOT NULL,
  decision_record_id text REFERENCES decision_records(id),
  approval_id text REFERENCES approvals(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  workflow_id text REFERENCES workflows(id),
  component text NOT NULL,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  retrieved_tokens_estimate integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  actor_id text NOT NULL,
  workflow_id text,
  correlation_id text,
  action_kind text NOT NULL,
  action_hash text,
  target text NOT NULL,
  policy_version text,
  decision_record_id text,
  approval_id text,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: '0002_source_refines',
    sql: /* sql */ `
-- Source versions this source explicitly refines (e.g. a clarification resolving an ambiguous AC).
-- Refinement pairs are not contradictions.
ALTER TABLE knowledge_sources ADD COLUMN refines text[] NOT NULL DEFAULT '{}';
`,
  },
];

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const done = new Set((await db.query<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
    });
    applied.push(m.id);
  }
  return applied;
}
