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
