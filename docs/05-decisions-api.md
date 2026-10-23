# 05 — AI decision layer (Claude) and deterministic policy engine

**Status:** Implemented in `packages/llm-adapter` and `packages/policy-engine` (MVP) · **Provider snapshot:** 2026-10-09 · See [ADR-0004](adr/0004-claude-structured-decisions.md)

## Why a separate decision layer?

Some routing questions benefit from AI interpretation. Examples: is this acceptance criterion measurable, and which test steps does a source support? The decision layer asks Claude for **typed, schema-validated** answers to these bounded questions. It does **not** run tests, retrieve documents, prove causal truth, or approve actions. Every action passes through the deterministic policy engine.

The original blueprint proposed the OpenAI Decisions API. ADR-0004 replaces it with Claude structured outputs. The main differences:

- Claude returns a schema-validated JSON object (`client.messages.parse` + `zodOutputFormat`). It does not return a calibrated per-answer confidence.
- **Routing therefore uses no numeric confidence.** The policy relies on deterministic signals: readiness label, trusted sources present, no contradictions, and a code-level **grounding check** that every cited source ID was actually retrieved.

Provider details (re-verify at coding time; see `docs/12` QA-010):

- SDK `@anthropic-ai/sdk`. Default model `claude-opus-5-5`, overridable via `QA_LLM_MODEL`.
- Refusals arrive as HTTP 200 with `stop_reason: "refusal"`. Always check `stop_reason` before reading output.
- The server-side refusal fallback is enabled. The model that actually answered is recorded from the response, not from config.

## Providers ([ADR-0006](adr/0006-provider-neutral-decision-layer.md))

| `QA_LLM_PROVIDER` | Readiness | Drafts | Confidence |
| --- | --- | --- | --- |
| `anthropic` (default) | Claude structured output (`ReadinessSchema`) | Claude structured output (`DraftContent`) | none (`null`) |
| `openai` | Decisions API: `choice` readiness + `predicate` per AC ("measurable?") and per source ("supports?") | Responses API structured output, `store: false` | `choice` confidence, persisted |
| `QA_READINESS_PROVIDER=jev` ([ADR-0007](adr/0007-typesafe-jev-readiness.md)) | TypeSafe Jev `systemOne`: `choice` readiness + `noul` per AC and per source | from `QA_LLM_PROVIDER` | `choice` confidence (different scale), persisted |

Decision-API providers (OpenAI, Jev) share one question plan and answer mapping (`llm-adapter/src/decision-readiness.ts`). All providers share the grounding rules (`llm-adapter/src/grounding.ts`) and failure mapping. `QA_MIN_READY_CONFIDENCE` (optional) can only downgrade a `ready` answer to review, and must be calibrated per provider and model.

## Questions asked of the model

| Question | Output field | Purpose |
| --- | --- | --- |
| Are requirements sufficiently unambiguous? | `readiness`: `ready` / `clarification` / `blocked` / `other` | Routing to draft vs review |
| Which expectations are missing? | `missingExpectations[]`, `clarificationQuestion` | Content of the review task |
| Which sources support the classification? | `citedSourceIds[]` | Grounding check (code) |
| Draft test cases | `designNotes[]`, `cases[]` (1–12), each with `steps[].sourceRefs[]`, `requirementRefs[]`, `techniques[]`, `testTypes[]`, `testConditions[]`, `assumptions[]`, `missingRequirements[]` | One case per test condition (ADR-0016); every step cites a retrieved source, techniques are named (ADR-0014), and code reports any acceptance criterion no case covers as a coverage gap |

**Do not** ask the model to declare an HTTP assertion successful or approve deleting customer data. Code and policy answer those questions.

## Failure mapping (fail closed)

| Condition | Adapter outcome | Workflow route |
| --- | --- | --- |
| `stop_reason: "refusal"` | `REFUSED` | `NEEDS_REVIEW` |
| Output missing / fails schema / `max_tokens` | `MALFORMED` | `NEEDS_REVIEW` |
| 429 / 5xx / timeout after bounded SDK retries | `UNAVAILABLE` | `NEEDS_REVIEW` |
| Cited source ID not in retrieved set | `UNGROUNDED` | `NEEDS_REVIEW` |
| `readiness` ≠ `ready` | classification | `NEEDS_REVIEW` (clarification task) |

No failure is ever treated as `ready`.

## Deterministic action policy (applied after classification)

```ts
type Gate = 'AUTO_PROCEED' | 'RETRIEVE_MORE' | 'NEEDS_HUMAN_REVIEW' | 'DENY';

type Evaluation = {
  action: 'draft' | 'execute' | 'delete' | 'publish_bug';
  targetEnvironment: 'test' | 'staging' | 'production';
  sourcesTrusted: boolean;
  hasContradiction: boolean;
  classifiedReadiness?: 'ready' | 'clarification' | 'blocked' | 'other';
  grounded: boolean;          // every cited source ID was retrieved (checked in code)
  criteriaCovered: boolean;   // every AC ID is referenced by a retrieved trusted source (US-01)
  authorized: boolean;        // RBAC for the actor, resolved server-side
  hasScopedApproval: boolean; // re-validated (hash, env, expiry, revocation) at use time
};

export function decideGate(e: Evaluation): Gate {
  // Non-negotiable controls: no approval or model output overrides these.
  if (!e.authorized) return 'DENY';
  // Production writes are disabled by default. Any exception is a separately
  // versioned operational policy, not this gate.
  if (e.targetEnvironment === 'production' && e.action !== 'draft') return 'DENY';
  // Evidence checks apply to every action, approved or not.
  if (e.hasContradiction) return 'NEEDS_HUMAN_REVIEW';
  if (!e.sourcesTrusted) return 'RETRIEVE_MORE';
  // Sensitive actions require a scoped human approval regardless of classification.
  if (e.action === 'delete' || e.action === 'publish_bug') {
    return e.hasScopedApproval ? 'AUTO_PROCEED' : 'NEEDS_HUMAN_REVIEW';
  }
  if (e.classifiedReadiness !== 'ready') return 'NEEDS_HUMAN_REVIEW';
  if (!e.grounded) return 'NEEDS_HUMAN_REVIEW';
  // US-01: READY needs a versioned supporting rule for every acceptance criterion.
  if (e.action === 'draft' && !e.criteriaCovered) return 'NEEDS_HUMAN_REVIEW';
  return 'AUTO_PROCEED';
}
```

The implementation combines this gate with environment action allowlists, approval expiry/revocation checks and budget checks. Some actions stay denied even with approval.

## Invocation rules

1. Apply trivial deterministic checks first (required fields, policy, validation).
2. Use RAG only if the rule requires external project knowledge. With no trusted sources or with a contradiction, open a review **without** calling the model.
3. Call the model only for bounded judgments whose answer affects routing or drafting.
4. Persist a `DecisionRecord`: model actually used, prompt version, input hash, retrieval snapshot, cited sources, usage (input/output/cache tokens), latency and outcome.
5. The policy engine owns the final action. Model output never upgrades a denied action.
6. Untrusted content (story, AC, retrieved chunks) is redacted and placed inside delimited data blocks. Instructions inside it are ignored.

## Tests (mocked provider)

- `readiness=ready` with trusted, grounded sources → draft generated (recommendation only).
- Refusal / malformed output / missing answer → `NEEDS_REVIEW`.
- `readiness=ready` citing a source that was not retrieved → `NEEDS_REVIEW` (ungrounded).
- `readiness=ready` but an acceptance criterion has no supporting trusted source → `NEEDS_REVIEW` (found by the eval set: a self-contained measurable AC with only an unapproved note behind it).
- `ready` + destructive action without approval → `NEEDS_HUMAN_REVIEW`; production write with approval → `DENY`.
- Approved `delete` with a source contradiction → `NEEDS_HUMAN_REVIEW`.
- `publish_bug` without approval → `NEEDS_HUMAN_REVIEW`.
- 429 / timeout → bounded retry, then degraded safe status.
- Changing model, prompt or policy version → traceable in the decision record and eval runs.
