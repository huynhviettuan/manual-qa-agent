# 08 — Implementation roadmap and definition of done

**Status:** Proposed incremental delivery for an **existing** Manual QA AI Agent.

## Phase 0 — Discovery and baseline

**Deliverables:** inventory current agent interfaces, environment/tool permissions, test-management source, story ingestion, data classification and failure taxonomy; label an evaluation set.

- [ ] Document what the existing agent can actually do (generate/execute/both).
- [ ] List source systems and establish authoritative rule ownership.
- [ ] Choose a pilot feature (e.g., login/password reset), non-production environment and a small suite of reviewed AC/test pairs.
- [ ] Capture baseline generation time, token/cost consumption, review load, error rates and retrieval-free quality.
- [ ] Review security threat model and resolve blocker questions in `13-open-questions.md`.

**Exit gate:** accepted scope, data policy and ≥1 reproducible representative workflow; no blind live execution.

## Phase 1 — RAG + readiness + review (recommended MVP)

1. Implement source registry, approval and immutable version tracking.
2. Add ingestion, content extraction, project/tenant filters and hybrid retrieval.
3. Create context budgets and record source IDs in generation calls.
4. Wrap existing agent with a story-to-test-draft adapter.
5. Add Decisions API readiness adapter + policy engine (mocked tests first).
6. Implement review queue and draft approval/rejection.
7. Emit correlation IDs, token/latency metrics and error outcomes.
8. Create golden evaluation dataset and regression tests for hallucination/source drift.

**Exit gate:** Pilot users can submit an AC, retrieve approved sources, receive an editable draft or a clarification task, and audit provenance; refusal/missing-source tests fail closed.

## Phase 2 — Controlled execution and evidence

1. Add Playwright or an adapter to the agent's existing browser executor.
2. Implement allowlisted environments, test accounts, isolated test data, retry policy.
3. Save screenshots/traces/network logs securely with retention.
4. Add deterministic UI/API assertions and separate run lifecycle.
5. Route contradictions and sensitive operations to review.

**Exit gate:** Non-production pilot tests reproduce run statuses and evidence; unauthorized or unapproved actions cannot execute, even with highly confident AI recommendation.

## Phase 3 — Triage, integration and feedback

1. Failure-category Decisions call over redacted/evidence-selected context.
2. Reproduction assistant that never overwrites test verdict.
3. Approved Jira/test-management adapters for creating links/drafts (external write requires permission).
4. Feedback ingestion from confirmed corrections with source-owner approval.
5. Cost-aware caching, batch decisions and token-budget tuning.

**Exit gate:** Triage quality measured against labeled outcomes; integrations are audited and reversible.

## Phase 4 — Scale and optional autonomy

Per-project budgets and policies, additional app frameworks, deeper coverage analytics, scheduled tasks, multi-tenant support, release-specific regression risk. Only pursue with measured benefit.

## Cross-phase engineering deliverables

- Infrastructure: repeatable local database/object store; migrations; environment configuration.
- Test coverage: schema/contract tests, policy invariants, tenancy negative tests and smoke tests.
- CI: lint, typecheck, unit, integration tests and no live model calls by default.
- Observability: source IDs, trace IDs, decision/policy audits, retries, token/cost estimates.
- Documentation: update PRD/ADR for every substantive behavior or architecture change.

## Implementation checklist per issue

- [ ] Input/output contract written and validated
- [ ] Happy path, rejection path and external failure path tested
- [ ] Tenant/project/role restrictions covered by tests
- [ ] Idempotency/retries specified for any side effect
- [ ] Usage and audit event emitted
- [ ] Human-review route documented if ambiguous/high-risk
- [ ] Security impact reviewed and docs updated

## Delivery risks and mitigations

| Risk | Mitigation |
| --- | --- |
| RAG retrieves obsolete document | Effective version filters, source conflict detection and provenance |
| Model hallucinates expected behavior | Enforce approved AC link; clarification route; QA review |
| AI runs destructive operation | Policy engine, allowlists, scoped approval, dry-run checks |
| Misleading confidence | Project-specific calibration and evaluation sets |
| LLM cost exceeds expectations | Per-task budgets, telemetry, avoid unnecessary calls |
| Sensitive data leaks to provider | Redaction, minimization, permissions and provider review |
| Existing agent is tightly coupled | Adapter/anti-corruption layer and small vertical slices |
| Tests appear flaky | Deterministic waits/assertions, trace collection, triage review |
