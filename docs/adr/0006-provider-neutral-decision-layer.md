# ADR-0006 — Provider-neutral decision layer (Anthropic or OpenAI)

- **Status:** Accepted (amends ADR-0004). Extended by [ADR-0007](0007-typesafe-jev-readiness.md): readiness can be routed separately with `QA_READINESS_PROVIDER=openai|jev`.
- **Date:** 2026-10-09

## Context

ADR-0004 made Claude the only provider. The team wants to be able to run the agent with another vendor's models, starting with OpenAI, before Phase 2. For readiness the team chose the OpenAI **Decisions API** (beta). It returns typed `choice` / `predicate` / `score` answers with confidence, but no free text.

## Decision

- `ReadinessClassifier` and `DraftGenerator` stay the only ports the orchestrator sees. Each provider maps its own API onto those types; nothing outside `packages/llm-adapter` knows which vendor is configured.
- Provider-neutral rules have **one owner**, `llm-adapter/src/grounding.ts`:
  - cited sources must be among the retrieved ones;
  - a `ready` answer must cite at least one source;
  - `ready` together with listed missing expectations is `INCONSISTENT`;
  - every draft step must cite a supplied source.

  These rules apply to every provider's answers.
- One provider configures both steps: `QA_LLM_PROVIDER=anthropic|openai`.
  - **anthropic** (default): Claude structured outputs for readiness and drafts (ADR-0004).
  - **openai**:
    - Readiness uses the Decisions API (`QA_DECISIONS_MODEL`, default `gpt-6-luna` per the 2026-10-09 docs snapshot). It sends one `choice` question for readiness plus one `predicate` per acceptance criterion ("measurable?") and per retrieved source ("supports?"). Questions reference items by index only, so untrusted text stays in the evidence channel. The clarification question is built in code from the AC predicates. Refused or missing predicates count as "no". The predicate threshold of 0.5 is an uncalibrated placeholder.
    - Drafts use Responses API structured outputs (`QA_LLM_MODEL`, **required** when live; no model is assumed) with `store: false`.
- Confidence: the Decisions `choice` confidence is persisted in the DecisionRecord. An optional `QA_MIN_READY_CONFIDENCE` floor can route a low-confidence `ready` to review. Confidence can only downgrade a decision, never authorize one (ADR-0003). Providers without confidence (Claude) are unaffected.
- Tests: each provider has contract tests against a fake of its HTTP API (the real SDK runs). A conformance suite asserts that both providers route the same evidence identically. CI runs the eval for both providers.

## Consequences

- Switching vendor is configuration plus a provider-specific data-processing review (docs/09). Every DecisionRecord records provider, requested model, answering model and prompt version, so eval comparisons across providers stay traceable.
- The OpenAI readiness path costs more questions per call (1 + #AC + #sources) and cannot explain *why* in free text. Reviewers see predicate-derived reasons instead.
- The Decisions API is beta: re-verify model, SDK and response shape at every upgrade (docs/12 QA-010).

## Revisit when

A third provider is needed (add another implementation of the two ports plus conformance tests), or eval data shows that predicate thresholds or the confidence floor need calibration.
