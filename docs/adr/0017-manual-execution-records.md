# ADR-0017 — Manual execution records: testers record what they observed, status derived in code

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

The agent designs manual cases (ADR-0014, ADR-0016) and manages them in suites, but a tester had nowhere to record
executing one. A suite run listed manual cases as `NOT_AUTOMATED` and stopped there; in the Gym CRM showcase that
was 131 of 261 cases with no result at all. Drafts also passed through with expected results a tester cannot
verify ("an error is shown"), which only surfaced at execution time.

## Decision

- **A `manual_run` record** holds one execution of one approved case revision: tester, environment, build,
  started/finished, per-step results (`PASSED`, `FAILED`, `BLOCKED`, `SKIPPED`, with the actual result observed),
  a reason, notes, an optional defect reference and an optional suite run.
- **The overall status is derived in code** (`deriveManualStatus`), never taken from the request and never from a
  model: `FAILED` at the first failed step (which must carry an actual result), else `BLOCKED` when a step is
  blocked (with a reason), else `PASSED`. A step may be skipped only after a failed or blocked one.
- **Only people record results.** `QA_ENGINEER`, `QA_LEAD` and `ADMIN` may record; the `AI_AGENT` key is refused
  with a message saying why. Only an `APPROVED` revision can be executed, the environment must exist, and a run
  attached to a suite run must be for a case in that suite run.
- **Records are immutable.** Executing again adds a record; a case's history is listed newest first; every record
  is audited (`MANUAL_RUN_RECORDED`).
- **Evidence** (screenshots, text files, 5 MB each, allowlisted types) is attached by the tester who recorded the
  run or a lead/admin. It is stored through the same evidence store as automated runs, with digest and retention,
  and served by the same authenticated endpoint, never to the AI agent. `evidence_artifacts` now belongs to exactly
  one of an automated run or a manual run.
- **Suite reports** show the latest manual record per case beside automated results: the status, tester and
  reason fill the row, `notAutomated` counts only cases still awaiting a tester, and `manualRecorded` counts the
  rest. `complete` keeps its meaning (automated runs finished); the manual backlog is visible in the totals.
- **Expected results are checked for observability** when a set is drafted: a step whose expected result has no
  exact message, value or named state, or uses a word that leaves the judgement to the tester ("correctly",
  "quickly"), gets a `reviewFlags` entry on the case. It is a flag for the reviewer, not a rejection: the story may
  be fine and the wording weak. The same measurability rule is shared with the readiness stand-in.

## Consequences

- A regression run finally has one report for the whole suite, automated and manual, with the same vocabulary.
- Testers still need a client; the API is complete, and a tester screen is a separate change.
- Evidence retention and purge apply to manual evidence unchanged.
- The migration alters `evidence_artifacts` (`run_id` nullable, `manual_run_id`, a one-owner check); it passed on
  PGlite and must be run against a disposable PostgreSQL before deployment, as `docs/11` requires.
