# ADR-0018 — Manual test management: the full case schema, coverage, exports and the question register

- **Status:** Accepted
- **Date:** 2026-10-23
- **Builds on:** ADR-0014 (techniques), ADR-0016 (sets), ADR-0017 (manual execution)

## Context

The team's manual practice (the `manual-test-design` skill) records more about a case than the agent did: the
module, whether it can be automated and why not, whether its expected results rest on an assumption, the open
questions it depends on, and references. It also produces documents from the cases: a tester workbook, a
traceability matrix and a coverage view, with execution columns filled only from real runs. The Gym CRM showcase
kept all of that outside the agent, in scripts.

## Decision

- **The case schema is complete.** The model emits, per case, `module`, `level` (`api`, `ui`, `manual`),
  `manualReason` (empty unless manual) and per-step `testData` naming the partition or boundary each value
  represents (prompt `draft-v5`). Stored content also carries `basis`, `openQuestions`, `refs` and `smoke`; these
  default to safe values for older revisions and are set by people through the review EDIT flow, never by the
  model (`smoke` and `openQuestions` are QA decisions).
- **Basis is derived, not claimed:** a case with any entry in `assumptions` is `assumption`-based. A manual case
  with no reason, or a reason on an automatable case, is flagged for the reviewer.
- **Coverage is computed from citations** (`GET /api/coverage`): per approved active source, per story criterion
  and per identifier found in the sources' chunks, listing the cases that cite them and the gaps. The granularity
  is the source and the criterion; an identifier inside a source counts as covered when a case cites that source.
  Nothing is estimated.
- **Exports come from the stored cases** (`GET /api/export/test-cases.csv`, optionally `?suiteId=`, and
  `GET /api/export/traceability.csv`): the twenty columns of the team's case schema, CRLF, UTF-8 with BOM. The
  execution columns (actual result, status, defect, environment) come from the latest recorded run, manual or
  automated; a case never executed reads `Not Run`. Notes carry the revision status when not approved, the review
  flags and the build of the last run.
- **The question register is the clarification reviews** (`GET /api/questions`: `REQUIREMENT_CLARIFICATION` and
  `MISSING_KNOWLEDGE`). A QA engineer may record the product's **current behaviour** for a question
  (`POST /api/reviews/{id}/observation`), stored on the review as observed, never as a requirement, audited and
  replaceable. Cases list the review ids they depend on in `openQuestions`, and the register shows them.

## Consequences

- The tester workbook, the traceability matrix and the coverage view no longer need a script per product.
- A reviewer sees the basis and the automation decision next to the techniques, and can change them.
- Coverage at source granularity can overstate identifier coverage when one source holds several rules; splitting
  sources per rule (as the showcase did) gives exact figures.
- Migration `0007_question_register` adds one nullable column to `review_tasks`; it passed on PGlite and must be
  run against a disposable PostgreSQL before deployment.
