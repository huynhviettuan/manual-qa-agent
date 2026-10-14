# ADR-0009 — Advisory failure triage, gated Jira filing, decision cache

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Phase 3 (docs/08, QA-019 to QA-022) adds failure triage, a reproduction aid, an external tracker integration (the team chose **Jira only**, creating issues after approval), cost-aware caching, and dashboards/alerts. The constraints from the docs:
- triage must never change a deterministic verdict;
- security-sensitive suspicions escalate regardless of confidence;
- external writes need explicit authorization and must be audited and reversible;
- caching must respect tenancy and invalidate when knowledge changes.

## Decision

**Triage (advisory).**
- The readiness provider also answers triage: Claude structured output, or OpenAI Decisions / Jev with a `choice` for the cause plus a yes/no "security relevant?" question (shared plan in `llm-adapter/src/decision-triage.ts`).
- Input is **deterministic, redacted facts** extracted from assertions and stored logs: the failing step with expected/actual, step errors, 5xx responses and console errors. No screenshots and no raw logs.
- The worker triages FAILED/INCONCLUSIVE runs automatically. Triage problems are logged and never affect the run.
- Routing: security-sensitive goes to a `SECURITY_TRIAGE` review (QA lead, HIGH); everything else goes to a `FAILURE_TRIAGE` review (QA engineer). Two cases escalate by design (fail safe): a provider failure, and a missing security answer. The decision-API escalation threshold is a deliberately low 0.3.
- A human confirms the actual cause (`confirmedCause`). Only a verified label is ever used downstream.
- **Mandatory eval gate:** zero missed security escalations on the labeled triage set. That gate caught a real gap in the keyless heuristic: an authorization check (expected 403) was not escalated.

**Reproduction.** Deterministic markdown built from the stored step log: environment, steps, expected vs actual, the triage label shown as suggested or verified, and evidence ids and digests. No model is involved, and secrets appear only as `[secret:NAME]`.

**Jira filing** (QA-020; `packages/integrations`, Jira Cloud REST v3 checked against Atlassian's OpenAPI spec):
- **Off by default** (`QA_JIRA_ENABLED`).
- A bug draft requires a FAILED run whose triage a human verified as `PRODUCT_DEFECT`. There is one active bug per run.
- Publishing is the `publish_bug` action. It needs the capability (never the AI agent) plus a QA-lead approval scoped to the action hash (bug id, payload hash, tracker target). That approval is re-checked when publishing.
- Idempotency: a `qa-agent-run-<runId>` label is searched (`/search/jql`) before creating, so a crash after the external write never duplicates. A `PUBLISHING` claim prevents concurrent double-publish.
- Revert is QA lead/admin only: label + comment + optional transition. Nothing is deleted. Every step is audited.
- Data minimization: the description is the redacted reproduction. Evidence stays behind the authenticated API.

**Decision cache** (QA-021):
- Readiness and triage decisions are cached per tenant/project. The key is the provider's identity (provider, model, prompt version, effort) plus the exact input; for readiness that includes the full content of every retrieved source.
- Only successful, already-checked answers are stored. Cache hits are recorded (`decision_records.cache_hit`, zero tokens).
- TTL comes from `QA_DECISION_CACHE_TTL_HOURS` (default 24h; 0 disables).
- Drafts are not cached.
- The eval re-runs the story set warm and fails if any outcome differs.

**Metrics and alerts** (QA-022):
- `GET /api/metrics` returns workflows, decisions (failure and cache-hit rates), tokens by model, review backlog, run verdicts, policy denials and triage agreement.
- `GET /api/metrics/alerts` raises alerts for provider failure rate, token spikes, review backlog age, denial spikes, triage disagreement, confidence drift and the inconclusive rate. It compares the last 24h with the previous 7 days, with minimum samples.
- Both endpoints are lead/admin only. No UI; the JSON is meant for an existing dashboard.

## Consequences

- QA gets a faster first look at failures without the model ever deciding pass/fail, filing anything by itself, or skipping a human on security-relevant cases.
- Jira writes are explicit, attributable and reversible. Teams with other trackers implement the `BugTracker` port.
- Cache savings depend on how often identical inputs recur. Any change to knowledge, model or prompt busts the cache by construction.

## Revisit when

Verified triage labels accumulate enough to calibrate thresholds, or a second tracker (e.g. a test-management system) is requested.
