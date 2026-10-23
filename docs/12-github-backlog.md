# 12 — GitHub milestones and issue backlog

**Status:** Ready to copy into GitHub Issues/Projects; nothing has been created remotely.

## Suggested GitHub Project setup

Create a project board with fields `Status` (Backlog, Ready, In Progress, In Review, Done), `Phase` (0–4), `Priority` (P0–P2), `Area` (Agent, RAG, Decisions, Review, Execution, Security, Evaluation), `Estimate`, `Owner` and `Dependencies`. Use issues as deliverables; use milestones for phases. Define repository protection requiring tests/review before merging.

## Milestone 0 — Discovery and guardrails

| Issue | Title | Priority | Definition of done |
| --- | --- | --- | --- |
| QA-001 | Document existing manual-agent capabilities | P0 | Inputs, outputs, tools, modes, and gaps mapped |
| QA-002 | Define pilot stories and golden labels | P0 | Reviewed stories/AC and expected readiness labels versioned |
| QA-003 | Set tenant/environment/access policies | P0 | Roles, allowlists, secrets policy and blocked operations documented |
| QA-004 | Baseline cost and quality | P0 | Repeatable eval command/method and report |

## Milestone 1 — MVP RAG + readiness + HITL

| Issue | Title | Priority | Depends on | Definition of done |
| --- | --- | --- | --- | --- |
| QA-005 | Create typed domain schema and DB migrations | P0 | 001,003 | State types + migrations + ownership constraints tested |
| QA-006 | Approved-source registry and versioning | P0 | 005 | Approval status immutable; source revocation works |
| QA-007 | Build ingestion and hybrid RAG retrieval | P0 | 006 | Cross-project version-filtering and source-citation tests |
| QA-008 | Add context budget and retrieval diagnostics | P0 | 007 | Budget event + source snapshots; no silent truncation |
| QA-009 | Adapt existing agent for test drafts | P0 | 001,008 | Given AC + sources returns validated draft schema |
| QA-010 | Claude decision adapter + mocked contracts (ADR-0004) | P0 | 005,002 | `ready/clarification/blocked/other`, refusal, malformed, ungrounded, timeout tested; model ID, SDK version and response shape re-verified against provider docs and recorded with date |
| QA-011 | Implement deterministic routing policy | P0 | 003,010 | Unsafe actions denied despite high model confidence |
| QA-012 | Human review queue + approval audit | P0 | 005,011 | Reviewer resolves tasks; no unauthorized approval |
| QA-013 | Approved knowledge feedback ingestion | P0 | 006,012 | Approved new source indexed; unapproved feedback excluded |
| QA-014 | End-to-end MVP acceptance + telemetry | P0 | 009–013 | Pilot story gets draft or review; usage trace complete |

## Milestone 2 — Controlled execution

| Issue | Title | Priority | Definition of done |
| --- | --- | --- | --- |
| QA-015 | Browser executor adapter and allowlists | P1 | Non-prod test runs; forbidden environment rejected. **Done (ADR-0008)** |
| QA-016 | Evidence capture and private storage | P1 | Screenshots/traces linked; expiry/redaction tested. **Done** (local store; S3 adapter follow-up; Playwright traces deliberately off because they record filled secret values) |
| QA-017 | Deterministic assertions and run lifecycle | P1 | Pass/fail/block/inconclusive independent of model output. **Done** |
| QA-018 | Scoped approval for high-impact test actions | P1 | Action hash/environment/expiry/revocation tested. **Done** |

## Milestone 3 — Triage and integrations

| Issue | Title | Priority | Definition of done |
| --- | --- | --- | --- |
| QA-019 | Failure triage suggestion and review gates | P1 | Verified label metrics; cannot rewrite assertion verdict. **Done (ADR-0009)** |
| QA-020 | Optional test-management/Jira draft adapter | P1 | Minimal scopes; no external writes without authorization. **Done for Jira** (test-management sync not started) |
| QA-021 | RAG caching and cost optimization | P1 | Same benchmark compares cost and quality. **Done** (decision cache + warm-run eval) |
| QA-022 | Operational dashboards and drift alerts | P1 | Token/cost, review, safety metrics and errors visible. **Done** (JSON endpoints; no UI) |
| QA-023 | Propose-only tool server for AI clients | P1 | MCP tools to read cases, check and propose executables, request and read runs; starts only with an `AI_AGENT` key; no approve/resolve/file tools. **Done (ADR-0011)** |
| QA-024 | Tool server over Streamable HTTP | P2 | Per-request AI_AGENT key checked via /api/me; 401/403 for missing, unknown or human keys; stateless. **Done (ADR-0013)** |
| QA-025 | Test-design techniques in drafts | P1 | Drafts name techniques, test types, derived conditions and traced requirements; unknown traces rejected; uncovered ACs reported by code. **Done (ADR-0014)** |
| QA-026 | One case per test condition | P1 | A story drafts a bounded set of cases with design notes; duplicate titles and empty sets rejected; coverage judged across the set; one DRAFT revision per case. **Done (ADR-0016)** |
| QA-027 | Run-scoped values in executable steps | P1 | Declared date values derived once per run; `capture` step from text or URL; `{ var }` and `{{name}}` references validated before approval; filled paths re-checked at run time. **Done (ADR-0015)** |
| QA-028 | Manual execution records | P1 | Testers record per-step results; status derived in code; immutable history; evidence through the evidence store; suite reports show manual beside automated; AI agent refused. **Done (ADR-0017)** |
| QA-029 | Observability check on expected results | P2 | Steps whose expected result cannot be verified as written are flagged for the reviewer (`reviewFlags`). **Done (ADR-0017)** |
| QA-030 | Full manual case schema | P1 | module, level and manual reason, per-step test data from the model (draft-v5); basis derived; openQuestions, refs and smoke set by people. **Done (ADR-0018)** |
| QA-031 | Coverage, tester workbook and traceability from the agent | P1 | `GET /api/coverage`, CSV exports with execution columns from recorded runs only. **Done (ADR-0018)** |
| QA-032 | Open-question register | P2 | Clarification reviews with observed current behaviour recorded by QA; cases link to them. **Done (ADR-0018)** |

## Example issue template

```md
## Context
Which user story or architecture document motivates this work?

## Scope
Explicit included and excluded behavior.

## Acceptance criteria
- [ ] Observable behavior 1
- [ ] Observable behavior 2
- [ ] Failure, policy and review behavior

## Dependencies
Issues, data, provider access, human approvals.

## Test plan
Unit, contract, negative security, integration, benchmark.

## Observability & documentation
Metrics/audit changes and docs/ADRs to update.
```

## Suggested first sprint

Start with QA-001 through QA-004. Next complete QA-005 and QA-006 before adding live model calls. Run readiness decisions on **mocked/labeled inputs first** to calibrate when a human should review.
