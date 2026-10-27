# ADR-0024 — Test as much as possible: API sessions and JSON checks, proposed executables, data rows, bounded waits, clause-level drafting

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

Measured against the Flow Fitness pilot (353 of 376 cases automated, 323 of them through the product's API), the
agent's ceiling was the executor and the drafting gate, not review: the showcase automated 130 of 261 cases and 1
of 36 booking cases, every executable was written by hand, `apiRequest` could check only a status, a permission
matrix of 60 cases needed 60 executables, 23 pilot cases stayed manual for "time passing" or "a job", and the
comparison of ADR-0022 showed 11 clear clauses in 7 criteria undrafted because one clause of each was unclear.

## Decision

1. **Testing through the API.** New steps and fields in the ADR-0008 format, each validated and executed with the
   same host rules: `session` (a named cookie jar signed in by one request, credentials as secrets, an optional
   bearer token read from the response), `apiRequest.session`, `apiRequest.expectJson` (`path` with `equals`,
   `matches` or `exists`; each check is an assertion, and a check against a secret shows only the secret's name in
   evidence), `capture.from.kind: 'response'`. A failed sign-in is a step error, never a pass.
2. **Data rows.** `spec.rows`: the whole spec runs once per row with the row's columns as run-scoped values; one run,
   one verdict per row in the assertions (`row`), the first problem deciding the run's verdict; rows must share
   their columns and may not shadow declared values. The suite report shows `rows: { total, failed }`.
3. **Bounded waits.** `waitFor` on a text or on a request's status and JSON, with a bound and an interval; never a
   fixed sleep. Running out makes the run **BLOCKED** (`WAIT_TIMEOUT:<step>`): the signal never came and nothing was
   proved either way. `press`, `upload` (the file travels with the spec, 1 MB) and `expectDownload` (the file is kept
   as evidence) complete the format.
4. **Proposed executables.** `ExecutableGenerator` (prompt `exec-v1`) proposes a spec for an approved `api`/`ui` case
   from the case and its own sources; `checkExecutable` validates it as a spec and checks traceability; the
   orchestrator records a decision record and a usage event and then calls `proposeExecutable`, so the proposal
   carries the weak-assertion flags and needs a different person's approval like any other (ADR-0008). A model may
   answer `{ cannot }` with a reason, recorded as REFUSED. Implemented for the session exchange (ADR-0020) and a
   keyless stand-in; `POST /api/test-cases/:id/executables/propose`. Requests are keyed by case code, so a run is
   replayable.
5. **Clause-level drafting.** Readiness (`readiness-v2`) adds `draftableClauses`: when a story needs clarification,
   the clauses of its criteria that are specified enough to test, quoted verbatim. Code keeps only clauses that are
   the criteria's own words and rejects a "ready" answer that names any. The workflow opens the clarification and,
   when clauses remain, drafts them under the criterion's own id against the same sources; the outcome carries
   `drafted` (or `draftPending` with the generator's failure, which opens no second review).

## Consequences

- Flow Fitness executables, first 20 API-level cases through the session exchange: 8 answered in this session; 2
  proposed with no flags (AUTH-001, AUTH-002), 6 refused with reasons that are gaps in the step format, not in
  the cases: a raw or non-JSON body, a content type, a request header (Origin), a second factor (TOTP) and a
  per-run account for the lockout case. Those are the next steps of the format.
- Gym CRM session drafts: the 7 clarified criteria with clear clauses now have 11 cases drafted while their
  questions stay open (AC-06 1, AC-07 2, AC-13 2, AC-18 1, AC-21 1, AC-27 1, AC-29 3); the 3 criteria that are
  wholly a data question (AC-08, AC-22, AC-23) have none, as they should.
- A BLOCKED verdict can now come from the executor; the run state machine already allowed RUNNING → BLOCKED.
- The readiness prompt version changed, so the 30 stored readiness answers were re-written under v2 with the same
  judgements plus the clauses; the exchange directory keeps both.
