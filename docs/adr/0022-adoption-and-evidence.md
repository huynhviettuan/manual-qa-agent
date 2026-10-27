# ADR-0022 — Adoption and evidence: catalogue import, a measured comparison, a calibrated observability check, a readiness preflight

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

After ADR-0021 the agent could manage a case over its life, but two things kept it from being adopted and judged:

- A team arrives with a catalogue. Without an import, adopting the agent meant starting from zero, and a comparison
  with the team's work had to be done by hand.
- There was no measurement of the drafts against what a team designs. The 53 session drafts (ADR-0020) were
  counted, not compared. The observability check flagged 20 of them, mostly wrongly, and every reviewer sees those
  flags.

Smaller gaps from the pilot: a pass on a known-bug case was only a label (ADR-0021); cases created before codes had
none; manual effort was recorded per run but never summed; booking calendars and row menus could not be located;
the suite preflight proved the target answers HTTP, not that it is ready (the pilot's `bootstrap` signed in as each
role first).

## Decision

1. **Catalogue import.** `POST /api/test-cases/import` (`csv`, `label`, `approve`; 4 MB) and `pnpm qa import` read the
   20-column workbook the agent exports. QA engineer, lead or admin only, never the AI agent; audited as
   `CASES_IMPORTED`. Each row becomes a case under one story `import:<label>`, as DRAFT, or as APPROVED when the
   importer says the team approved them. A well-formed Test Case ID is kept as the case code, and a code already in
   the project is skipped, so re-importing is a no-op. Requirement ids are resolved against the registry (a source
   version, a source id, or an identifier a source carries) and the resolved source versions become the steps'
   citations; an unresolved id is reported and flagged on the case. Techniques and test types outside the agent's
   lists are reported and flagged, never coerced. When expected results do not pair one per step they all go on
   the last step, never invented for the others. Execution columns are not imported: a result needs a run record
   (ADR-0017). Rows without a title or steps, or with a priority outside P0–P3, are rejected and reported.
2. **Bare identifiers are never stale.** Found by importing the Flow Fitness catalogue, where ADR-0021 called all 376
   cases stale: only a versioned citation (`sourceId@version`) can be superseded.
3. **A measured comparison.** `showcase/fitness-crm/compare.ts` counts a condition-level pairing of the agent's drafts
   with the team's cases on the same criteria. The pairing is a judgement and is kept as data
   (`comparison/condition-map.json`) with who made it; the script only checks that every case is placed exactly
   once. Results and their limits are in the showcase README.
4. **The observability check knows absences, relations and more named states** (`no … offered`, `nothing is saved`,
   `cannot be typed`; `equals`, `becomes`, `goes to`, `receives`, `=`; `granted`, `saved`, `required`, `inactive`, …).
   On the session drafts it went from 23 flags on 20 cases to 2 flags on 2 cases, the two whose expected value is
   unnamed. It was tuned on those drafts; that is stated wherever the number is.
5. **Retest reviews.** A PASSED result, manual or automated, of a case with a known bug opens one
   `KNOWN_BUG_RETEST` review (QA engineer, low risk) naming the environment, build and run. Changing or clearing the
   mark answers it. Verdicts are untouched; an automated pass opens it after the verdict is stored, and a failure to
   open it is logged, never fatal.
6. **Code backfill.** `pnpm qa codes` gives every case without a code one from its module, oldest first, once.
7. **Manual effort.** `GET /api/metrics` adds `manual`: runs, distinct cases, minutes, median minutes per run and
   minutes per tester, from the testers' recorded start and finish times only.
8. **Grid and menu roles.** Locators accept `grid`, `gridcell`, `columnheader`, `rowheader`, `table`, `menu`,
   `menubar`, `menuitemcheckbox`, `menuitemradio`, `tabpanel` and `switch`, scoped and strict like every other role
   (ADR-0008): a booking button looked up in the whole grid matches every slot and the run is INCONCLUSIVE.
9. **A readiness preflight.** An environment may name a preflight case (`pnpm qa env … --preflight-case`, admin): an
   approved case with an approved executable, such as signing in as each role. A suite run with automated cases
   requests it first; its other runs carry `after_run_id` and the worker claims them only after it PASSED. If it ends
   otherwise they are BLOCKED with `PREFLIGHT_FAILED:<state>` and audited, and never run. A named preflight case that
   cannot run blocks the suite run in the ADR-0021 preflight (`PREFLIGHT_CASE_NOT_EXECUTABLE`). Manual cases are not
   held back: people decide whether to execute them.

## Consequences

- A team's catalogue loads as it is. The Flow Fitness catalogue (376 cases) imported in about half a second with
  nothing rejected; the report named 5 ids the registry cannot hold (`NFR-SEC` and `API-ERR` have no number, so they
  are not identifiers in the ADR-0005 sense; `BR-402a` has a lower-case suffix) and 2 techniques outside the agent's
  list (CRUD, Random).
- The comparison is the first evidence of what the drafts are worth, and it found the agent's main weakness: a
  criterion with one unclear clause goes wholly to a question, leaving its clear clauses undrafted. Drafting the
  clear clauses and asking about the rest is the next change to the drafting workflow (it touches ADR-0016 and the
  readiness gate, so it needs its own ADR).
- The observability numbers are a calibration on known data, not a measured precision; a fresh set of drafts is
  what will measure it.
- Suite runs with a preflight case take one extra run, and their automated runs start after it.
