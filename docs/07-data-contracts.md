# 07 — Data model and conceptual API contracts

**Status:** Entities and endpoints below are implemented (`packages/db` migrations, `apps/api`), except test runs and evidence (Phase 2). Additional MVP endpoints: `POST /api/knowledge/revocations`, `GET /api/test-cases/{id}`, `POST /api/test-cases/{id}/promote`, `GET /api/reviews/{id}`, `GET /api/workflows/{id}`. Phase 2 endpoints: `POST /api/test-cases/{id}/executables`, `POST /api/executables/{id}/review`, `POST /api/test-runs` (`Idempotency-Key`; 202 when queued, 200 with `BLOCKED` otherwise), `GET /api/test-runs/{id}`, `GET /api/evidence/{id}` (authenticated, project-scoped, `no-store`, digest header, never served to the AI agent). Entities: `test_case_executables`, `test_runs`, `evidence_artifacts` (migration `0003_execution`). Phase 3 endpoints: `POST|GET /api/test-runs/{id}/triage`, `GET /api/test-runs/{id}/reproduction` (markdown), `POST /api/test-runs/{id}/bugs`, `GET /api/bugs/{id}`, `POST /api/bugs/{id}/publish` (`approvalId`), `POST /api/bugs/{id}/revert`, `GET /api/metrics?days=`, `GET /api/metrics/alerts` (lead/admin). `POST /api/reviews/{id}/resolve` accepts `confirmedCause` for triage reviews. Entities: `run_triage`, `bug_reports`, `decision_cache` (migration `0004_triage_bugs_cache`). Test suites: `POST /api/suites` (`name`, `description`; QA roles), `GET /api/suites`, `GET /api/suites/{id}` (cases with section, latest revision status, requirement refs, `automated`), `POST /api/suites/{id}/cases` (`cases: [{caseId, section}]`; cases must belong to the project), `POST /api/suites/{id}/runs` (`environmentId`; 202; one `requestRun` per approved automated case, so policy applies per case; other cases are recorded as `NOT_AUTOMATED` or `NOT_APPROVED`, never as passed), `GET /api/suite-runs/{id}` (per-case status, reason, duration, evidence count, suggested cause; totals; `complete`). Entities: `test_suites`, `test_suite_cases`, `suite_runs`, `suite_run_items` (migration `0005_test_suites`). Manual execution (ADR-0017): `POST /api/manual-runs` (`caseId`, `environmentId`, `build`, `steps[{status, actual}]`, `reason`, `notes`, `defectRef`, optional `suiteRunId`; QA roles, never the AI agent; 201 with the derived status), `GET /api/manual-runs/{id}` (with evidence ids), `GET /api/test-cases/{id}/manual-runs` (history), `POST /api/manual-runs/{id}/evidence` (`name`, `contentType`, `dataBase64`, 5 MB; tester or lead/admin). Entity: `manual_runs` (migration `0006_manual_runs`, which also lets `evidence_artifacts` belong to a manual run). `GET /api/me` returns the caller's own `actorId`, `tenantId`, `projectId` and `roles` (used by the agent tool server, ADR-0011). Auth is an `x-api-key` header resolved server-side to an actor with database roles. There are no cookies, so CSRF does not apply.

## Core entities

| Entity | Key fields | Invariants |
| --- | --- | --- |
| `Project` | id, tenantId, name, defaultEnvironment, policies | Tenant boundary enforced |
| `Story` | id, externalId, projectId, version, acceptanceCriteria | Immutable snapshots |
| `KnowledgeSource` | id, projectId, kind, version, approvedBy, approvalStatus, effectiveFrom, hash | Source owner approval required |
| `KnowledgeChunk` | id, sourceId, sourceVersion, chunkIndex, embedding, metadata | ACL and source version inherited |
| `TestCase` | id, storyId, workflowId, revision, steps, expected, status, sourceRefs, requirementRefs, techniques, testTypes, testConditions | Approval tied to revision; a story's workflow creates one per test condition (ADR-0016) |
| `TestRun` | id, testCaseRevisionId, environmentId, state, assertions, evidenceIds | Run state independent of case approval |
| `EvidenceArtifact` | id, runId or manualRunId, kind, objectKey, digest, retentionUntil, classification | Store pointer, not raw bytes in prompt; exactly one owner |
| `ManualRun` | id, caseId, caseRevision, suiteRunId, environmentId, build, testerId, status, failedStep, steps[], reason, notes, defectRef | Status derived from steps in code; immutable; people only (ADR-0017) |
| `DecisionRecord` | id, taskId, kind, provider/model, result, confidence, usage, inputHash, sourceRefs | Recommendation separate from policy outcome |
| `PolicyEvaluation` | id, actionHash, policyVersion, result, actor, reason | Immutable audit |
| `ReviewTask` | id, type, subjectId, question, risk, status, reviewer, resolution | Expiry for action approvals |
| `Approval` | id, reviewId, actionHash, environmentId, approvedBy, expiresAt, revokedAt | Scope and time-bound |
| `WorkflowTask` | id, correlationId, state, taskType, attempts, idempotencyKey | Retry-safe state transitions |
| `UsageEvent` | id, workflowId, component, inputTokens, outputTokens, costEstimate, latencyMs | Correlates to decision and run |

For MVP, use normalized relational tables in PostgreSQL and a pgvector index. Use explicit migrations and protect every query by authenticated `tenantId`/`projectId` scope. `KnowledgeSource` revisions should be immutable: update via new version records.

## Example TypeScript domain types

```ts
export type CaseStatus =
  | 'DRAFT' | 'NEEDS_CLARIFICATION' | 'IN_REVIEW'
  | 'APPROVED' | 'REJECTED' | 'RETIRED';

export type RunStatus =
  | 'QUEUED' | 'POLICY_CHECK' | 'RUNNING'
  | 'PASSED' | 'FAILED' | 'BLOCKED' | 'INCONCLUSIVE' | 'CANCELLED';

export type ReviewStatus =
  | 'OPEN' | 'ASSIGNED' | 'NEEDS_INFO'
  | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type ActionProposal = {
  workflowId: string;
  caseId?: string;
  actorId: string;
  projectId: string;
  environmentId: string;
  kind: 'DRAFT_TEST' | 'EXECUTE_TEST' | 'DELETE_TEST_DATA' | 'FILE_BUG';
  parameters: Record<string, unknown>;
  knowledgeSnapshotId: string;
};
```

## Proposed REST endpoints

| Method & path | Purpose | Required authorization |
| --- | --- | --- |
| `POST /api/stories` | Create immutable story version | QA or Product role |
| `POST /api/knowledge/ingestions` | Ingest **approved** source | Source-owner-authorized |
| `POST /api/test-cases/draft` | Generate draft from story | QA |
| `POST /api/test-cases/{id}/review` | Approve/reject draft revision | QA with scoped role |
| `POST /api/test-runs` | Request run (P1) | QA + target environment policy |
| `GET /api/test-runs/{id}` | Retrieve statuses and evidence links | Project-member RBAC |
| `GET /api/reviews` | Read scoped review queue | Authorized reviewer |
| `POST /api/reviews/{id}/resolve` | Resolve a review with reason | Assigned/authorized reviewer |
| `GET /api/workflows/{id}/usage` | Read token/cost/audit data | QA lead/admin |

Use pagination, schema validation, idempotency keys, rate limits, CSRF protection where applicable, and server-side auth. `GET` returns only data within the caller's tenant/project scope.

## Example test-run response

```json
{
  "id": "run_01",
  "caseRevisionId": "case_001:v2",
  "status": "INCONCLUSIVE",
  "environmentId": "staging",
  "assertions": [
    { "name": "response-status", "expected": 200, "actual": 200, "passed": true },
    { "name": "record-exists", "expected": true, "actual": null, "passed": null }
  ],
  "evidenceIds": ["evidence_01"],
  "suspectedCause": "ENVIRONMENT",
  "suspectedCauseIsVerified": false,
  "reviewId": "review_01"
}
```

Null actual values are not the same as false assertions; preserve this distinction.

## Audit event minimum

`actorId`, `tenantId`, `projectId`, `workflowId`, `actionKind`, `actionHash`, `target`, `policyVersion`, `decisionRecordId`, `approvalId`, `outcome`, `timestamp`. Encrypt sensitive identifiers where appropriate and enforce retention policy.
