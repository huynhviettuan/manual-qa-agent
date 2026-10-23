# ADR-0016 — A story is drafted as a set of test cases, one per test condition

- **Status:** Accepted
- **Date:** 2026-10-23
- **Amends:** ADR-0014 (which left "one case per story" as a known limit)

## Context

ADR-0014 made each draft name its techniques and derived conditions, but the agent still produced exactly one test
case per story. A boundary analysis yields several conditions (below, at, above a limit); a decision table yields a
column per rule; a state model yields a transition per case. Folding them into one case hides which condition
failed, and a reviewer cannot approve the sound cases while sending one back. The team's own practice (the
`manual-test-design` skill) is one case per condition.

## Decision

- Prompt `draft-v4` asks for **the set of cases the acceptance criteria need**: one per distinct test condition,
  between 1 and 12, never two checking the same condition, each independently executable. The design they come
  from (partitions, boundaries, rule columns, states) goes in `designNotes`.
- The model's schema is `DraftSetOutput = { designNotes, cases: DraftOutput[1..12] }`. Each case keeps the ADR-0014
  fields. Twelve is a reviewability and response-size bound, not a coverage target.
- `checkDraftSet` (code, shared by every provider) rejects a set as `MALFORMED` when it is empty, when a case has no
  steps or names no technique, or when two cases share a title (case-insensitive, trimmed); as `UNGROUNDED` when any
  step cites, or any case traces to, a source or criterion that was not supplied. **Coverage is judged across the
  set:** an acceptance criterion no case traces and no case reports as missing becomes a `coverageGaps` entry.
- The orchestrator persists **one test case per drafted case**, each at revision 1 in `DRAFT`, all tied to the
  workflow. The outcome carries `caseIds` and `cases: [{ caseId, title }]`; `caseId` remains the first case for
  callers that handle one. `missingRequirements` is the union of the cases' own and the set's coverage gaps;
  `designNotes` is returned for the reviewer.
- Review is unchanged: each case is approved, edited or rejected on its own, so a sound case is not held back by a
  weak sibling. Suites take case ids as before.
- The keyless stand-in drafts one case per acceptance criterion (one case when there is a single criterion), still
  claiming only `specification_based`.

## Consequences

- A story's drafts now mirror its design, and the reviewer sees the design next to them.
- More rows per story in the review queue; that is the point, and it is what the team does by hand today.
- Draft calls need more output room (`max_tokens` raised to 32,000 for the set); a truncated answer is still
  `MALFORMED`, never a partial set.
- The decision cache key changes with the prompt version, so the first draft of each story after upgrading is a
  fresh model call.
- Showcase and eval figures that counted "one draft per story" now count cases; the eval gates are unchanged
  because they judge routes, not case counts.
