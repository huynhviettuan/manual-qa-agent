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
  {
    id: '0003_execution',
    sql: /* sql */ `
-- Administrator-managed execution target. Runs may only reach allowed_hosts.
ALTER TABLE environments ADD COLUMN base_url text;
ALTER TABLE environments ADD COLUMN allowed_hosts text[] NOT NULL DEFAULT '{}';

-- Executable versions of an APPROVED test case revision (ADR-0008). Content is immutable;
-- approval binds to spec_hash and requires a reviewer other than the proposer.
CREATE TABLE test_case_executables (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  case_id text NOT NULL REFERENCES test_cases(id),
  case_revision integer NOT NULL,
  version integer NOT NULL,
  spec jsonb NOT NULL,
  spec_hash text NOT NULL,
  destructive_steps text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('PROPOSED','APPROVED','REJECTED','SUPERSEDED')),
  proposed_by text NOT NULL,
  reviewed_by text,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (case_id, version),
  CHECK (reviewed_by IS NULL OR reviewed_by <> proposed_by)
);

CREATE TABLE test_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  case_id text NOT NULL REFERENCES test_cases(id),
  case_revision integer NOT NULL,
  executable_id text NOT NULL REFERENCES test_case_executables(id),
  spec_hash text NOT NULL,
  environment_id text NOT NULL,
  state text NOT NULL,
  reason text,
  idempotency_key text NOT NULL,
  requested_by text NOT NULL,
  approval_id text REFERENCES approvals(id),
  review_id text REFERENCES review_tasks(id),
  assertions jsonb NOT NULL DEFAULT '[]',
  cleanup_failed boolean NOT NULL DEFAULT false,
  blocked_requests text[] NOT NULL DEFAULT '{}',
  lease_owner text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (tenant_id, project_id, idempotency_key)
);
CREATE INDEX test_runs_queue_idx ON test_runs (state, created_at);

CREATE TABLE evidence_artifacts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  run_id text NOT NULL REFERENCES test_runs(id),
  kind text NOT NULL,
  name text NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL UNIQUE,
  digest text NOT NULL,
  size_bytes integer NOT NULL,
  classification text NOT NULL DEFAULT 'INTERNAL',
  retention_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: '0004_triage_bugs_cache',
    sql: /* sql */ `
ALTER TABLE decision_records ADD COLUMN cache_hit boolean NOT NULL DEFAULT false;

-- Successful decisions only, keyed by provider identity + exact input; tenant/project scoped.
CREATE TABLE decision_cache (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL,
  cache_key text NOT NULL,
  result jsonb NOT NULL,
  provider text NOT NULL,
  model text,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, kind, cache_key)
);

-- Suspected failure cause (never changes the run verdict) and its human verification.
CREATE TABLE run_triage (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  run_id text NOT NULL REFERENCES test_runs(id),
  suspected_cause text NOT NULL CHECK (suspected_cause IN ('PRODUCT_DEFECT','TEST_ISSUE','ENVIRONMENT','UNKNOWN')),
  security_sensitive boolean NOT NULL,
  security_probability double precision,
  confidence double precision,
  rationale text,
  outcome text NOT NULL,
  decision_record_id text REFERENCES decision_records(id),
  review_id text REFERENCES review_tasks(id),
  verified_cause text CHECK (verified_cause IN ('PRODUCT_DEFECT','TEST_ISSUE','ENVIRONMENT','UNKNOWN')),
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_triage_run_idx ON run_triage (run_id, created_at);

-- Bugs filed to an external tracker only after human confirmation + scoped approval.
CREATE TABLE bug_reports (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  run_id text NOT NULL REFERENCES test_runs(id),
  triage_id text NOT NULL REFERENCES run_triage(id),
  tracker text NOT NULL,
  target text NOT NULL,
  summary text NOT NULL,
  description text NOT NULL,
  labels text[] NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHING','PUBLISHED','PUBLISH_FAILED','REVERTED')),
  review_id text REFERENCES review_tasks(id),
  approval_id text REFERENCES approvals(id),
  external_key text,
  external_url text,
  error text,
  created_by text NOT NULL,
  published_by text,
  reverted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: '0005_test_suites',
    sql: /* sql */ `
-- Test suites group approved cases (by section) so they are managed and run together.
CREATE TABLE test_suites (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, name)
);

CREATE TABLE test_suite_cases (
  suite_id text NOT NULL REFERENCES test_suites(id),
  case_id text NOT NULL REFERENCES test_cases(id),
  section text NOT NULL DEFAULT '',
  position integer NOT NULL,
  added_by text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (suite_id, case_id)
);

-- One suite run = one requested run per automated case; manual cases are listed, never guessed.
CREATE TABLE suite_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  suite_id text NOT NULL REFERENCES test_suites(id),
  environment_id text NOT NULL,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suite_run_items (
  suite_run_id text NOT NULL REFERENCES suite_runs(id),
  case_id text NOT NULL REFERENCES test_cases(id),
  run_id text REFERENCES test_runs(id),
  outcome text NOT NULL CHECK (outcome IN ('REQUESTED','NOT_AUTOMATED','NOT_APPROVED')),
  position integer NOT NULL,
  PRIMARY KEY (suite_run_id, case_id),
  CHECK ((outcome = 'REQUESTED') = (run_id IS NOT NULL))
);
`,
  },
  {
    id: '0006_manual_runs',
    sql: /* sql */ `
-- A tester's observed result for one approved case revision (ADR-0017). Immutable: executing
-- again adds a record. The status is derived in code from the step results.
CREATE TABLE manual_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  case_id text NOT NULL REFERENCES test_cases(id),
  case_revision integer NOT NULL,
  suite_run_id text REFERENCES suite_runs(id),
  environment_id text NOT NULL,
  build text NOT NULL DEFAULT '',
  tester_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASSED','FAILED','BLOCKED')),
  failed_step integer,
  reason text NOT NULL DEFAULT '',
  steps jsonb NOT NULL,
  notes text NOT NULL DEFAULT '',
  defect_ref text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'FAILED') = (failed_step IS NOT NULL)),
  CHECK (finished_at >= started_at)
);
CREATE INDEX manual_runs_case ON manual_runs (case_id, created_at DESC);
CREATE INDEX manual_runs_suite_run ON manual_runs (suite_run_id, case_id, created_at DESC);

-- Evidence belongs to exactly one run, automated or manual.
ALTER TABLE evidence_artifacts ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE evidence_artifacts ADD COLUMN manual_run_id text REFERENCES manual_runs(id);
ALTER TABLE evidence_artifacts ADD CONSTRAINT evidence_one_owner CHECK ((run_id IS NULL) <> (manual_run_id IS NULL));
`,
  },
  {
    id: '0007_question_register',
    sql: /* sql */ `
-- What the product does today for an open question (ADR-0018): observed by a person, never a requirement.
ALTER TABLE review_tasks ADD COLUMN observed_behaviour text;
`,
  },
  {
    id: '0008_case_lifecycle',
    sql: /* sql */ `
-- ADR-0021: what the Flow Fitness pilot needed from a case over its life.
-- A stable code people quote (MODULE-NNN), assigned when the case is created; older cases keep null.
ALTER TABLE test_cases ADD COLUMN code text;
CREATE UNIQUE INDEX test_cases_code_idx ON test_cases (tenant_id, project_id, code);
-- An open defect that blocks the expected result, set by a reviewer. Reports label a FAILED result
-- as expected and a PASSED one as "retest and clear"; verdicts themselves never change (ADR-0009).
ALTER TABLE test_cases ADD COLUMN known_bug text;
-- A suite run names the build under test, and is BLOCKED as a whole when its preflight fails.
ALTER TABLE suite_runs ADD COLUMN build text NOT NULL DEFAULT '';
ALTER TABLE suite_runs ADD COLUMN status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','BLOCKED'));
ALTER TABLE suite_runs ADD COLUMN reason text;
ALTER TABLE suite_run_items DROP CONSTRAINT suite_run_items_outcome_check;
ALTER TABLE suite_run_items ADD CONSTRAINT suite_run_items_outcome_check
  CHECK (outcome IN ('REQUESTED','NOT_AUTOMATED','NOT_APPROVED','BLOCKED'));
-- An exclusive run has its environment to itself (global settings, lockout): nothing else of the
-- same environment runs beside it.
ALTER TABLE test_runs ADD COLUMN exclusive boolean NOT NULL DEFAULT false;
`,
  },
  {
    id: '0009_preflight_case',
    sql: /* sql */ `
-- ADR-0022: an environment may name an approved case that proves it is ready (accounts sign in,
-- the suite's data exists). A suite run executes it first; its other runs wait for it and are
-- BLOCKED unless it PASSED.
ALTER TABLE environments ADD COLUMN preflight_case_id text;
ALTER TABLE test_runs ADD COLUMN after_run_id text REFERENCES test_runs(id);
ALTER TABLE suite_runs ADD COLUMN preflight_run_id text REFERENCES test_runs(id);
`,
  },
  {
    id: '0010_trust',
    sql: /* sql */ `
-- ADR-0023: what a green report must earn.
-- A known bug is bound to the steps it breaks; a failure elsewhere is a plain failure.
ALTER TABLE test_cases ADD COLUMN known_bug_steps text[] NOT NULL DEFAULT '{}';
-- A sentinel case known to fail on the environment proves a suite run can detect a failure.
ALTER TABLE environments ADD COLUMN sentinel_case_id text;
ALTER TABLE suite_runs ADD COLUMN sentinel_run_id text REFERENCES test_runs(id);
-- Weak assertions found in code when an executable is proposed, for its reviewer.
ALTER TABLE test_case_executables ADD COLUMN review_flags text[] NOT NULL DEFAULT '{}';
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
