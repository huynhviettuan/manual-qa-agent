# ADR-0021 — What a case needs over its life: codes, known bugs, stale citations, suite preflight, exclusive runs, build, design document

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The Flow Fitness pilot (376 cases, 353 automated, run against a live product for three weeks) showed what a case
needs *after* it is designed, which ADR-0014 to ADR-0019 did not cover:

- Five cases had an open defect blocking their expected result. Without a mark, their failures read as regressions
  on every run, and the day a bug was fixed nothing said "retest".
- The requirement catalogue was a dated snapshot; when a document changed, the cases citing the old text had to be
  found by hand, and "which cases do I run for BR-404" had no answer but a tag grep.
- One dead environment read as 130 failures until someone noticed the first screenshot was a connection error.
- Two cases that change global settings once ran side by side and undid each other's restores.
- Reports were compared build to build; the agent recorded the build only for manual runs.
- People quoted cases as `BKG-010`, never as a generated id; the team read a design document, not a CSV.

## Decision

1. **Case codes.** `test_cases.code` (`<MODULE>-<NNN>`) is assigned when a case is created, from the draft's module,
   with a per-project sequence under an advisory lock, and never reused. It is shown in the tester screen, reports,
   exports and the regression scope. Cases created before this ADR have no code and are shown by id.
2. **Known bugs.** `test_cases.known_bug` is set or cleared by a QA engineer, lead or admin
   (`POST /api/test-cases/:id/known-bug`), audited, and refused to the AI agent. It is lifecycle state, not revision
   content, so marking a bug does not create a revision or reopen review. A suite report labels a FAILED result of
   such a case `expectedFailure` and a PASSED one `retestNeeded`; the totals count both. **Verdicts never change**
   (ADR-0009): the label is beside the status, never instead of it. The CSV's "Defect ID" shows the known bug when no
   execution recorded one.
3. **Stale cases and regression scope.** Computed from citations, never stored: an approved case citing a source
   version that is superseded, revoked or unknown is *stale* (`GET /api/coverage` → `stale`, also in the tester
   screen and the design document). `GET /api/regression?ref=` returns the cases citing a requirement (an identifier
   inside a source, a source id, `sourceId@version` or `story:AC`), every approved P0 case and the cases guarding a
   defect (a published bug, or a known bug).
4. **Suite preflight.** Before a suite run queues anything it checks the environment: it must exist; when the suite
   has an automated case it must not be production, must allow `execute`, must have a target on an allowed host, and
   the target must answer HTTP (`TargetProbe`, injectable; any status counts, a network error does not). A failed
   check produces one suite run with `status: BLOCKED`, `reason: PREFLIGHT:<checks>`, every item BLOCKED and no test
   run created. The API answers 200 for it, not 202.
5. **Exclusive runs.** `ExecutableSpec.exclusive` (default false) marks a case that must have its environment to
   itself. The worker's claim runs under a transaction-scoped advisory lock and never claims an exclusive run while
   any run of the same environment is active, nor any run while an exclusive one is active. It is validated like
   every other field of the spec (ADR-0008) and copied onto the run when it is requested.
6. **Build under test.** `POST /api/suites/:id/runs` takes `build`; it is stored on the suite run, shown in the report
   and reaches the CSV's execution notes for automated runs as it already did for manual ones.
7. **Test-design document.** `GET /api/export/test-design.md` assembles the eight sections of the manual-test-design
   skill (requirement analysis and open questions, techniques, coverage model, cases by module, traceability, gaps and
   assumptions with stale cases, risk-based order with the smoke set, regression scope by module and the cases
   guarding defects) from the stored records. Every figure is a count; no model writes any of it.

## Consequences

- A suite report now says three things a Flow Fitness report had to say by hand: which failures a known bug
  accounts for, which passes mean a bug may be fixed, and whether the environment was fit to run at all.
- A source change points at the cases to re-review and the cases to re-run, without a grep.
- Codes make cases quotable; existing projects keep their ids until cases are recreated.
- The preflight probe adds one HTTP request per suite run; `targetProbe: null` turns it off for tests without a
  target. It checks reachability, not readiness of data or accounts: a bootstrap of test accounts per environment
  (what the pilot's `npm run bootstrap` did) stays outside the agent, as it is product-specific.
- Exclusive runs lower throughput for the cases that need it and nothing else; a worker finds other environments'
  runs meanwhile.
