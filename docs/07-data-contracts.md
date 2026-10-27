# 07 — Data model and conceptual API contracts

**Status:** Entities and endpoints below are implemented (`packages/db` migrations, `apps/api`), except test runs and evidence (Phase 2). Additional MVP endpoints: `POST /api/knowledge/revocations`, `GET /api/test-cases/{id}`, `POST /api/test-cases/{id}/promote`, `GET /api/reviews/{id}`, `GET /api/workflows/{id}`. Phase 2 endpoints: `POST /api/test-cases/{id}/executables`, `POST /api/executables/{id}/review`, `POST /api/test-runs` (`Idempotency-Key`; 202 when queued, 200 with `BLOCKED` otherwise), `GET /api/test-runs/{id}`, `GET /api/evidence/{id}` (authenticated, project-scoped, `no-store`, digest header, never served to the AI agent). Entities: `test_case_executables`, `test_runs`, `evidence_artifacts` (migration `0003_execution`). Phase 3 endpoints: `POST|GET /api/test-runs/{id}/triage`, `GET /api/test-runs/{id}/reproduction` (markdown), `POST /api/test-runs/{id}/bugs`, `GET /api/bugs/{id}`, `POST /api/bugs/{id}/publish` (`approvalId`), `POST /api/bugs/{id}/revert`, `GET /api/metrics?days=`, `GET /api/metrics/alerts` (lead/admin). `POST /api/reviews/{id}/resolve` accepts `confirmedCause` for triage reviews. Entities: `run_triage`, `bug_reports`, `decision_cache` (migration `0004_triage_bugs_cache`). Test suites: `POST /api/suites` (`name`, `description`; QA roles), `GET /api/suites`, `GET /api/suites/{id}` (cases with section, latest revision status, requirement refs, `automated`), `POST /api/suites/{id}/cases` (`cases: [{caseId, section}]`; cases must belong to the project), `POST /api/suites/{id}/runs` (`environmentId`; 202; one `requestRun` per approved automated case, so policy applies per case; other cases are recorded as `NOT_AUTOMATED` or `NOT_APPROVED`, never as passed), `GET /api/suite-runs/{id}` (per-case status, reason, duration, evidence count, suggested cause; totals; `complete`). Entities: `test_suites`, `test_suite_cases`, `suite_runs`, `suite_run_items` (migration `0005_test_suites`). Manual execution (ADR-0017): `POST /api/manual-runs` (`caseId`, `environmentId`, `build`, `steps[{status, actual}]`, `reason`, `notes`, `defectRef`, optional `suiteRunId`; QA roles, never the AI agent; 201 with the derived status), `GET /api/manual-runs/{id}` (with evidence ids), `GET /api/test-cases/{id}/manual-runs` (history), `POST /api/manual-runs/{id}/evidence` (`name`, `contentType`, `dataBase64`, 5 MB; tester or lead/admin). Entity: `manual_runs` (migration `0006_manual_runs`, which also lets `evidence_artifacts` belong to a manual run). Manual test management (ADR-0018): `GET /api/coverage` (per source, criterion and identifier, with gaps), `GET /api/export/test-cases.csv` (optional `?suiteId=`; the 20-column tester workbook, execution columns from recorded runs only), `GET /api/export/traceability.csv`, `GET /api/questions` (clarification reviews with observed behaviour and dependent cases; not for the AI agent), `POST /api/reviews/{id}/observation` (`currentBehaviour`; QA roles). Migration `0007_question_register`. Tester screen (ADR-0019): `GET /tester` and `GET /tester/app.js` are served without a key (static, strict CSP); `GET /api/suites/{id}/runs` lists a suite's runs with `manualPending` and `manualRecorded`; `GET /api/test-cases?status=` lists the project's cases (latest revision) for the review view. `GET /api/me` returns the caller's own `actorId`, `tenantId`, `projectId` and `roles` (used by the agent tool server, ADR-0011). Case lifecycle (ADR-0021, migration `0008_case_lifecycle`): `test_cases.code` (`MODULE-NNN`, assigned on creation, unique per project) and `test_cases.known_bug`; `POST /api/test-cases/{id}/known-bug` (`bugRef` or `null`; QA roles, never the AI agent, audited); `GET /api/suite-runs/{id}` items carry `code`, `knownBug`, `expectedFailure` (FAILED with a known bug) and `retestNeeded` (PASSED with a known bug), totals carry `expectedFailures` and `retestNeeded`; `POST /api/suites/{id}/runs` takes `build` and runs a preflight (environment exists; for a suite with automated cases: not production, `execute` allowed, target on an allowed host, target answers HTTP), answering 200 with `status: BLOCKED` and `reason: PREFLIGHT:<checks>` and no queued run when it fails, 202 otherwise; `GET /api/coverage` adds `stale` (approved cases citing a superseded, revoked or unknown source version) and `totals.staleCases`; `GET /api/regression?ref=` (cases citing a requirement, all approved P0, cases guarding a published or known bug); `GET /api/export/test-design.md` (the eight-section design document from the records). `ExecutableSpec.exclusive` marks a run that has its environment to itself; `test_runs.exclusive` carries it to the worker. Adoption and evidence (ADR-0022, migration `0009_preflight_case`): `POST /api/test-cases/import` (`csv` in the 20 export columns, `label`, `approve`; 4 MB; QA roles, never the AI agent; 201 with a report of imported, skipped and rejected rows, unresolved requirement ids, unmapped techniques and test types, expected results moved to the last step, execution results not imported); `GET /api/coverage` adds `totals.identifiersNamed` and `gaps.identifiersNotNamed`; `GET /api/metrics` adds `manual` (runs, cases, minutes, `medianMinutesPerRun`, `byTester`); review kind `KNOWN_BUG_RETEST`, opened by a PASSED result of a case with a known bug and answered by changing or clearing the mark; `environments.preflight_case_id`, `test_runs.after_run_id` and `suite_runs.preflight_run_id`, with `GET /api/suite-runs/{id}` reporting `preflight` (`runId`, `caseId`, `status`, `reason`) and a held run blocked as `PREFLIGHT_FAILED:<state>`; locator roles `grid`, `gridcell`, `columnheader`, `rowheader`, `table`, `menu`, `menubar`, `menuitemcheckbox`, `menuitemradio`, `tabpanel`, `switch`. Auth is an `x-api-key` header resolved server-side to an actor with database roles. There are no cookies, so CSRF does not apply.

## Core entities

| Entity | Key fields | Invariants |
| --- | --- | --- |
| `Project` | id, tenantId, name, defaultEnvironment, policies | Tenant boundary enforced |
| `Story` | id, externalId, projectId, version, acceptanceCriteria | Immutable snapshots |
| `KnowledgeSource` | id, projectId, kind, version, approvedBy, approvalStatus, effectiveFrom, hash | Source owner approval required |
| `KnowledgeChunk` | id, sourceId, sourceVersion, chunkIndex, embedding, metadata | ACL and source version inherited |
| `TestCase` | id, storyId, workflowId, revision, steps (with testData), expected, status, sourceRefs, requirementRefs, techniques, testTypes, testConditions, module, level, manualReason, basis, openQuestions, refs, smoke, reviewFlags | Approval tied to revision; a story's workflow creates one per test condition (ADR-0016) |
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
