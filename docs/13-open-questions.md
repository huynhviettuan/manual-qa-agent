# 13 — Open questions, assumptions and decisions to confirm

**Status:** Unresolved questions; the blueprint uses conservative defaults.

## Essential unknowns

| ID | Question | Current working assumption | Impact |
| --- | --- | --- | --- |
| OQ-01 | Does the existing agent generate cases, execute browser tests, or both? | **Resolved 2026-10-09:** there is no existing agent; the MVP is built from scratch in this repo | Adapter scope and MVP |
| OQ-02 | Where are approved requirements stored? | Files or tickets exportable by project | Ingestion connector |
| OQ-03 | Who can approve official business rules? | Product owner/BA assigned by project | RAG trust model |
| OQ-04 | Single team or multi-tenant product? | One team initially; design for tenant isolation | Auth/storage complexity |
| OQ-05 | UI framework / backend already in place? | **Resolved 2026-10-09:** Node.js + TypeScript, PostgreSQL + pgvector, Claude as AI provider (ADR-0004), full-text retrieval first (ADR-0005); review UI is API-only for MVP | Avoid needless rewrite |
| OQ-06 | Which environment can agent interact with? | Non-production staging only | Executor access and policy |
| OQ-07 | Is browser execution needed in MVP? | No; add in Phase 2 | Milestone timing |
| OQ-08 | Which test-management system is authoritative? | TBD | Sync and traceability |
| OQ-09 | Privacy classification of project documents? | Restrict sensitive data pending review | Provider use and logging |
| OQ-10 | Is GitHub repo private/public? | Private until permission review | Documentation/secrets/security |
| OQ-11 | Hosting model and budget? | Small single-service deployment | Infrastructure and operational choices |
| OQ-12 | Expected reviewer roles / SLA? | QA + Product Owner + Admin | Review workflow |
| OQ-13 | May an AI client submit stories (and so trigger drafts) on a person's behalf? | No: `AI_AGENT` is not a submitter; people submit stories (ADR-0011). Needs a delegated-access design first | Agent tool server scope, security matrix |

## Decisions to validate before implementation

- [ ] Confirm one pilot application and feature.
- [ ] Confirm official source hierarchy and version convention.
- [ ] Confirm provider legal/privacy suitability and spending limit.
- [ ] Confirm whether `pgvector` fits project scale/constraints.
- [ ] Confirm domain/environment allowlists and test accounts.
- [ ] Agree how many ambiguous cases may be auto-routed and who resolves them.
- [ ] Define labeled evaluation set size and acceptable false-ready rate.
- [ ] Choose initial UI for human review, not necessarily a full admin portal.

## Known limitations of this blueprint

- Documents propose behavior but do not implement a functioning system.
- API request examples use capabilities documented as of 2026-10-09; validate SDK before copying into production.
- Confidence thresholds and chunk/token budgets are **starting heuristics**, not evidence-backed defaults.
- No benchmark numbers, pricing, execution permissions, customer dataset, existing-agent code or live connector access has been provided.
- Final tech choices should be adjusted around the existing agent rather than blindly adopted.
