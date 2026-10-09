# ADR-0004 — Claude structured outputs replace the OpenAI Decisions API

- **Status:** Accepted; amended by [ADR-0006](0006-provider-neutral-decision-layer.md). Claude is the default provider, and OpenAI is selectable.
- **Date:** 2026-10-09

## Context

The blueprint proposed a generic LLM adapter for drafts plus the OpenAI Decisions API (beta) for typed readiness classification. The team chose Claude as the single provider. Claude has no Decisions API equivalent with calibrated per-answer confidence. It does support schema-constrained structured outputs.

## Decision

- Use the Anthropic SDK (`@anthropic-ai/sdk`) for both readiness classification and draft generation. Use `client.messages.parse` with zod schemas (`zodOutputFormat`).
- Remove numeric confidence from routing. The policy gate uses the readiness label plus deterministic signals: trusted sources present, no contradictions, and a **grounding check**. The grounding check requires every source ID the model cites to be in the retrieved set.
- Default model `claude-opus-5-5`, configurable. The server-side refusal fallback is enabled, and the model that answered is recorded per decision.
- Map refusals, malformed output, provider errors and ungrounded citations to `NEEDS_REVIEW` (fail closed).
- Keep the provider behind `ReadinessClassifier` / `DraftGenerator` interfaces so it remains replaceable.

## Consequences

- One provider, one SDK and one set of credentials. Simpler key management and privacy review.
- No confidence threshold to calibrate. More cases route to review until the eval set shows which readiness labels are reliable.
- The model's self-reported reasoning is never stored as proof. Only typed fields, cited source IDs, usage and the model ID are persisted.

## Revisit when

A calibrated classification signal becomes available and is validated against the labeled evaluation set. Confidence must never become the sole criterion for sensitive actions (ADR-0003).
