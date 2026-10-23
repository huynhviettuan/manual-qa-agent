# ADR-0015 — Run-scoped values: derived dates and captured values in executable steps

- **Status:** Accepted
- **Date:** 2026-10-23
- **Extends:** ADR-0008 (the step allowlist gains one step type and one value kind; every other constraint holds)

## Context

In the Gym CRM showcase, 131 of 261 designed cases stayed manual. The two most common reasons were that an
expected value depends on today's date ("expires on" today + 30 days), and that a step needs a record created
earlier in the same test (its new id in the URL, its generated code in a cell). ADR-0008's steps take only literal
values and secret references, so such cases could not be written without putting a model in the run-time loop,
which ADR-0008 forbids.

## Decision

- **A run has a value table.** It is filled from two sources and read by steps; nothing else writes to it.
  1. **Declared values**, `spec.values`: named definitions derived once, when the run starts, from a single clock
     reading, so every step sees the same date. Today the only kind is a date: `offsetDays` (whole days, ±10
     years), a `format` from a fixed list (`yyyy-MM-dd`, `dd/MM/yyyy`, `MM/dd/yyyy`, `d/M/yyyy`), and an optional
     IANA `timeZone` (default UTC). Days are added to the calendar date in that zone, so a DST change never moves
     the day.
  2. **Captured values**, the new `capture` step: reads the text of a strict locator or the current URL, applies
     an optional regular expression with exactly one capturing group, and stores the group under a name. A locator
     with several matches is an error, as everywhere else; a pattern that does not match is a step error, so the
     run is `INCONCLUSIVE`, never `FAILED`. The captured value is recorded in the step log.
- **Steps read values two ways:** `{ "var": "name" }` wherever an input value is accepted (`fill`, `apiRequest`
  bodies), and `{{name}}` placeholders in `navigate`, `expectUrl` and `apiRequest` paths and in `expectText` text.
- **Validated before approval, in code.** The spec is rejected when a step uses a value that is neither declared
  nor captured by an earlier step (setup, then steps, then teardown), when a capture would shadow a declared value,
  when a pattern has no or more than one group, or when a placeholder would break the relative-path rule. A path is
  checked again after filling at run time: a captured value can never redirect the run off the target host.
- Names are lowercase (`[a-z][a-z0-9_]*`), distinct from secret names (uppercase), and values are not secrets: they
  appear in logs and evidence like any page text, and secret redaction still applies to them.

## Consequences

- Date-dependent and chained cases become automatable with no change to governance: the same approvals, the same
  spec hash, the same deterministic verdicts.
- Approval binds to the spec, not to the values it produces at run time; two runs on different days fill in
  different dates by design, and the step log shows the value used.
- The step allowlist is now: `navigate`, `click`, `fill`, `select`, `apiRequest`, `capture`, `expectText`,
  `expectVisible`, `expectHidden`, `expectUrl`.
- Not covered, by choice: arithmetic on values, times of day, and values read from API responses. Each would be a
  further extension of this ADR with its own validation and tests.
