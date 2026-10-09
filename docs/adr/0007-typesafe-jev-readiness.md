# ADR-0007 — TypeSafe Jev as an optional readiness provider

- **Status:** Accepted (extends ADR-0006)
- **Date:** 2026-10-09

## Context

TypeSafe AI's Jev ("System One" model) answers typed questions about a state: `choice` with probabilities and confidence, `score`, and `noul`, a yes/no probability. Pricing and latency are positioned well below general LLMs. That fits readiness classification, a bounded typed judgment. Jev cannot generate free-text test-case drafts.

Sources (checked 2026-10-09): docs.typesafe.ai (`/api`, `/models`, `/confidence`, `/sdk/javascript`) and the official SDK `@typesafe-ai/sdk` 0.6.0. The SDK is published by typesafe.ai maintainers, MIT-licensed, and has no runtime dependencies.

## Decision

- Add `JevClassifier` (readiness only). It is selected with `QA_READINESS_PROVIDER=jev`; drafts stay with `QA_LLM_PROVIDER` (Claude or OpenAI). The override also accepts `openai` (the Decisions API), so readiness and drafts can use different vendors.
- Jev reuses the provider-neutral decision plan in `llm-adapter/src/decision-readiness.ts`, shared with the OpenAI Decisions path:
  - questions: one `choice` for readiness, one `noul` per acceptance criterion ("measurable?") and one per retrieved source ("supports?");
  - the same redacted, delimited evidence string as `state`;
  - questions reference items by index only;
  - the same answer mapping and shared grounding checks.
- Model: `jev-1.13.0`, pinned rather than `jev-latest`, because TypeSafe advises explicit versions once thresholds are calibrated. Overridable with `QA_DECISIONS_MODEL`.
- Security and robustness:
  - The SDK client's `logLevel` is pinned to `warn`. The SDK logs request bodies (requirement text) at `debug`, and `TYPESAFE_LOG_LEVEL` would otherwise enable that.
  - Answers are validated at runtime with zod. A missing or invalid readiness answer is `MALFORMED`. A missing or out-of-range `noul` counts as "no".
  - The SDK retries 408/429/5xx (including 529 "overloaded") twice and honors `retry-after`. 422 is not retried and maps to `UNAVAILABLE`.
- Confidence: Jev's `choice` confidence is 1 when all probability is on one label and 0 when spread evenly. That scale differs from OpenAI's, so `QA_MIN_READY_CONFIDENCE` must be calibrated **per provider and model**. As with OpenAI, it can only downgrade a decision to review.

## Consequences

- Readiness can run on a cheaper and faster decision model while drafts use an LLM. DecisionRecords show each step's provider and model separately.
- TypeSafe becomes another data processor for requirement text (docs/09). It needs a data-processing review before live use.
- Like the Decisions API, Jev gives no free-text rationale. Reviewers see AC-level reasons built from the yes/no answers.

## Revisit when

Eval data on the pilot set supports calibrated thresholds for Jev (the yes/no cut-off and the confidence floor), or TypeSafe releases a new model version to pin.
