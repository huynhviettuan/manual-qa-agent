# ADR-0010 — The context budget keeps exact matches and drops lower-ranked keyword matches with a recorded gap

- **Status:** Accepted
- **Date:** 2026-10-16
- **Amends:** the budget rule in docs/04 and `retrieve()` (ADR-0005)

## Context

Retrieval selects trusted chunks in rank order: exact-identifier matches first, then by trust tier, text rank and freshness. Until now, any T1 chunk that did not fit the 1,800-token budget made the story "too broad" (`CONTEXT_BUDGET_EXCEEDED`), and it went back to a person.

The Gym CRM showcase showed the cost of that rule. Permission statements share words such as role names and "permission" with dozens of permission rows. Full text matched 15 to 20 loosely related T1 chunks, and the agent refused 109 of 261 test cases, even after the statements were narrowed. The refused stories were not too broad. Chunks that merely shared two keywords counted as much as the requirement the story names.

## Decision

- A T1 chunk that matches one of the story's identifiers (exact match) is **required**. If it cannot fit, the budget is exceeded and the story goes to a person, as before.
- A T1 chunk matched **only by shared keywords** ranks below every exact match. If it does not fit, it is dropped whole and recorded as a gap: `Dropped <source>@<version> (T1, keyword match only) to fit the context budget`. T2 chunks were already handled this way.
- Content is still never truncated inside a chunk. Every dropped chunk is listed in the retrieval result's gaps, which are kept with the workflow step.

## Consequences

- On the Gym CRM suite, drafted cases rose from 152 to 216 of 261 with the same sources. The remaining refusals are content questions (unsupported or unclear requirements), not budget overflows.
- A relevant rule that matches only by keywords, not by identifier, can now be left out of the model's context. Mitigations: the gap names it, the reviewer approves every draft, and grounding checks still require every citation to be in the retrieved set.
- The evaluation gates (no false-ready, no cross-project leak, cache consistency, security escalation) pass unchanged.

## Revisit when

Vector or hybrid ranking arrives (ADR-0005). Relevance scores would then allow a threshold instead of a rank cut-off.
