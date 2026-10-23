# ADR-0014 — Drafts name their test-design techniques; coverage is checked in code

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

draft-v1 asked the model for one test case with steps, sources, assumptions and missing requirements. It did not
say how the case was designed, which requirements it verifies, or whether it covers every acceptance criterion. A
reviewer had to work out by hand whether boundaries, invalid inputs, rule combinations and invalid state
transitions were tested. Manual test design (equivalence partitioning, boundary values, decision tables, state
transitions, use cases, permission matrices, error guessing and so on) was left implicit.

## Decision

- Prompt `draft-v2` tells the model to choose techniques by the structure of each requirement, and to test only
  boundaries, combinations and states the sources actually state. A technique never justifies an expected result on
  its own.
- The model's draft schema (`DraftOutput`) gains four required fields:

  | Field | Contents |
  | --- | --- |
  | `requirementRefs[]` | What the case verifies: `story:<AC id>` or `sourceId@version` |
  | `techniques[]` | From a fixed enum (`TestTechnique`) |
  | `testTypes[]` | positive, negative, boundary, security, regression |
  | `testConditions[]` | The derived partitions, boundaries, rule columns and transitions |

- `checkDraft` (code, shared by every provider) enforces:
  - **No technique:** a draft naming none is `MALFORMED`.
  - **Traceability:** a `requirementRefs` entry that is neither a retrieved source nor a story criterion is
    `UNGROUNDED`, like an unknown step citation.
  - **Coverage:** an acceptance criterion the draft neither traces nor lists as missing is appended to
    `missingRequirements` as `"<AC id>: not covered by this draft (coverage check)"`. The model's own claim of
    coverage is never trusted.
- Stored content (`DraftContent`) defaults the four fields to empty, so draft-v1 revisions and reviewer edits
  without them still read. A reference test case promoted from an approved revision lists its techniques and the
  requirements it verifies.
- The keyless stand-in derives no partitions, so it claims only `specification_based` and `positive`.

## Consequences

- Reviewers see how each case was designed and what it does not cover before approving it.
- A draft-v1-shaped answer from a provider is now `MALFORMED` and goes to review; nothing is drafted silently.
- Decision-cache entries keyed by `draft-v1` no longer match, so the first draft per story after upgrading is a
  fresh model call.
- Still one case per story; designing a full suite per story (several cases, one per condition) is a separate
  change.

## Amendment, 2026-10-23 (draft-v3)

`TestTechnique` and `TestType` were extended to the full lists of the team's `manual-test-design` skill, which is
the authoritative catalogue: techniques gain `domain`, `metamorphic`, `scenario`, `exploratory`, `checklist`,
`defect_based` and `attack_based`; test types gain `concurrency`, `end_to_end`, `ui` and `accessibility`. The prompt
names when each applies and says `exploratory` and `checklist` may be claimed only for a charter or checklist the
sources define. Stored drafts are unaffected; the cache key changes with the prompt version.
