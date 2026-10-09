# 01 — Product requirements and acceptance criteria

**Status:** Proposed PRD · **Priorities:** P0 MVP / P1 next / P2 later

## Actors

- **QA engineer:** creates and reviews test cases, initiates authorized runs, resolves routine reviews.
- **QA lead:** configures thresholds, environments and review policies.
- **Product owner / BA:** resolves business-rule questions and approves new knowledge.
- **System admin:** manages access, providers, secrets, retention and usage budgets.
- **AI orchestrator (service actor):** operates only through audited capabilities and permissions.

## Functional requirements

| ID | Priority | Requirement | Acceptance criterion |
| --- | --- | --- | --- |
| FR-01 | P0 | Story and AC intake | Story ID, project, target version and AC are captured; empty AC is flagged |
| FR-02 | P0 | Knowledge ingestion | Approved document gets immutable source/version IDs, timestamps and project ACL |
| FR-03 | P0 | RAG retrieval | Queries apply tenant/project/version filters; answer includes source IDs and relevance metadata |
| FR-04 | P0 | Test draft generation | Draft contains steps, preconditions, expected outcomes and AC references; never silently invents missing rules |
| FR-05 | P0 | Readiness decision | Typed result maps to `READY`, `NEEDS_CLARIFICATION` or `BLOCKED`; refusal/error routes safely |
| FR-06 | P0 | Review queue | A review links story, evidence, reason, owner and status; human outcome is audited |
| FR-07 | P0 | Reviewer feedback | Approved clarifications become new versioned sources only after source-owner authorization |
| FR-08 | P0 | Telemetry | Task records source IDs, model/policy versions, usage, latency and token budget outcomes |
| FR-09 | P1 | Browser execution adapter | Executes low-risk approved tests in allowlisted non-production environments |
| FR-10 | P1 | Evidence collection | Screenshots, network traces and logs stored outside prompts with expiring controlled links |
| FR-11 | P1 | Failure triage | Agent proposes `PRODUCT_DEFECT`, `TEST_ISSUE`, `ENVIRONMENT`, `UNKNOWN` without overriding assertions |
| FR-12 | P1 | Jira/test-management integration | Optional adapters use scoped credentials; no unsolicited external writes |
| FR-13 | P2 | Self-service policy UI | Versioned policy edits require QA-lead/admin permission |
| FR-14 | P2 | Expansion adapters | API/DB/mobile adapters share the same policy and evidence interfaces |

## Non-functional requirements

| Category | Requirement |
| --- | --- |
| Security | Role + project/tenant authorization on every read and write; no raw secrets in AI context |
| Safety | Production is read-only by default; destructive actions require explicit approvals |
| Auditability | Store policy evaluation + approval decision + proposed and executed action |
| Reliability | Idempotent run/review creation; bounded retries; safe degraded mode |
| Maintainability | Provider abstractions for retrieval, model, decisions, execution, integrations |
| Explainability | Give evidence and source references; do not claim model-generated explanations are proofs |
| Performance | Establish p50/p95 baselines; target only after representative sampling |
| Cost | Per-task input/output/retrieval/decision metrics, caps and explicit budget exceptions |
| Data lifecycle | Configurable retention, deletion, reindexing and source revocation |

## Core user stories

### US-01 — Determine test readiness

As a Manual QA engineer, I want the agent to determine whether a story has sufficient observable expected behavior so I can avoid automating or reporting invented assumptions.

**Acceptance scenarios**

- Given an AC with an explicit outcome and versioned supporting rule, when evaluated, a `READY` recommendation includes source IDs and a test proposal.
- Given missing thresholds (e.g., "respond quickly"), the system produces `NEEDS_CLARIFICATION`, a concrete question, and does not execute that test.
- Given retrieval failure or API refusal, the outcome is `BLOCKED`/`NEEDS_REVIEW`; it is never silently considered ready.

### US-02 — Approve test drafts

As a Manual QA engineer, I want to approve/edit/reject generated cases and preserve feedback to avoid repeating mistakes.

**Acceptance scenarios**

- Reviewer edits create a new draft version, preserving prior versions and author IDs.
- Approved cases retain links to exact AC/source versions.
- An unapproved case cannot be promoted to a trusted reference test case.

### US-03 — Run authorized tests (P1)

As a QA engineer, I want the agent to execute low-risk tests in approved environments and capture reproducible evidence.

**Acceptance scenarios**

- Domain/environment allowlist is checked before every tool session.
- Assertions produce `PASSED`, `FAILED`, `BLOCKED` or `INCONCLUSIVE`, independent of model classification.
- Destructive/test-data-affecting actions without valid approvals are denied and logged.

### US-04 — Investigate unclear failures (P1)

As a QA engineer, I want suspected failures grouped by evidence and impact so I can triage faster.

**Acceptance scenarios**

- The triage label is explicitly **suspected** and never changes deterministic assertion results.
- If UI evidence and backend evidence disagree, the system marks `INCONCLUSIVE`/`NEEDS_REVIEW`.
- Security-sensitive suspected defects are escalated under policy regardless of confidence.

## Acceptance dependencies

Readiness and draft approval ship before automated execution. A browser runner without policies or evidence retention is not acceptable for production use.
