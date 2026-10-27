# ADR-0023 — What a green report must earn: bound known bugs, quoted evidence, a sentinel, stability, weak assertions, text drift

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

A review of the path a verdict travels (source → draft → approval → executable → run → report) found places where the
system could say "tested" without that being earned:

- A known bug (ADR-0021) labelled *any* failure of its case as expected, so a new defect at another step hid behind
  it. The pilot bound the expectation to one labelled assertion.
- "Grounded" meant "cites a retrieved source", never "the expected result is in that source".
- 130 passes twice is also what a broken executor produces; nothing proved a suite run could detect a failure.
- A verdict that flipped between identical runs was two honest verdicts and nothing more.
- A `contains` on a short text, or an API step checking only its status, passed as readily as ten exact checks.
- The ADR-0022 comparison was judged by Claude and the observability check was tuned on the drafts it was scored
  on.
- A bare identifier (`A-342`) followed the active source version even when the text behind it changed.
- Importing a catalogue as APPROVED needed only a QA engineer; a 500 page counted as a reachable target; a P0
  failure recorded by hand with nothing attached read like any other.

## Decision

1. **Known bugs are bound to steps.** `POST /api/test-cases/:id/known-bug` takes `steps` (executable step ids or
   manual step numbers). A failure is `expectedFailure` only when the first failed assertion, or the manual failed
   step, is one of them; otherwise it is `failedOutsideKnownBug`, a real failure. A mark with no steps is
   `knownBugUnbound` and labels every failure, and the report says so. The audit records the binding.
2. **Quoted evidence.** A case step may carry `evidence`, a verbatim quote from a cited source. `quoteFlags` checks
   it in code (normalised substring of the cited chunk) and flags a wrong quote or a missing one. The model's draft
   schema and prompt (draft-v5) are unchanged in this ADR, so drafts get the "no quoted evidence" flag until a
   prompt version asks for quotes; reviewers and imports can add them now. Flags, never rejections.
3. **A sentinel proves detection.** An environment may name a sentinel case (`--sentinel-case`): an approved case
   known to fail there (a known-false expectation on this build). A suite run with automated cases requests it with
   the suite. The report carries `detection`: PROVEN when the sentinel FAILED, NOT_PROVEN when it ended any other
   terminal way, PENDING, or NONE without a sentinel; and `outcome: INCONCLUSIVE` when NOT_PROVEN, because the
   run's passes then prove nothing. Recorded verdicts never change.
4. **Stability is derived, never retried.** `unstableCases` finds cases whose verdict differed between runs of the
   same spec hash, environment and build. The suite report marks such items `unstable`; the design document lists
   them. No retry resolves it: the case is named so nobody trusts it until the cause is known.
5. **Weak assertions are flagged at proposal.** `weakAssertions` (a `contains` on fewer than 8 characters, an API
   step that checks only its status, actions after the last assertion) writes `review_flags` on the executable for
   its reviewer. The suite report shows `assertions` per automated item.
6. **Text drift under bare identifiers.** `listIdentifierTextChanges` compares each identifier's chunk text between a
   source's active version and the one before it; an approved case whose latest revision predates the change and
   cites the identifier bare is stale with `TEXT_CHANGED:<old>-><new>`.
7. **Evidence about the evidence.** The observability check is measured on a held-out set: the 983 expected results
   of the imported Flow Fitness catalogue, written by the team and never used for tuning. It flags 159 (16 %), and a
   sample shows nearly all are false ("Still on /login", "Payment status PARTIAL", "Paid"): the check is lexical and
   does not know the product's states. It stays an advisory flag, and this ADR does not tune it on that set.
   `compare.ts` also writes `comparison/spot-check.json`, every fourth condition of the pairing, for a person to
   fill in `agree` and `note`; it is written once and kept.
8. **Smaller.** Importing as APPROVED needs a QA lead or admin, and the audit names who. The target probe requires an
   HTTP status below 500. A P0 case whose manual result is FAILED or BLOCKED with no evidence attached is
   `unproven` in the report.

## Consequences

- A report now separates "failed on the known bug" from "failed elsewhere", says whether the run could have
  detected a failure, and names cases whose verdicts cannot be trusted. Those three change what green means.
- Quoted evidence is the mechanism; its value arrives when the prompt asks for quotes (a draft-v6, its own change
  with new fixtures and a re-run of the session exchange).
- The held-out measurement says the observability check should never block anything: 16 % false flags on
  human-written results would train reviewers to ignore it. Making it product-aware (the states a source names)
  is the next step, and it must be measured on a set it was not tuned on.
- A sentinel costs one run per suite run and needs a case that stays false on every build; a sentinel that starts
  passing is itself a finding.
