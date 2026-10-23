# ADR-0020 — A file-exchange provider: real-model answers from an interactive Claude Code session

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

Every prompt version up to `draft-v5` had only met the keyless stand-in, because no API key was available. The
team has a Claude Code subscription, but the Messages API and the SDK accept only API keys, and Anthropic's terms
do not allow a product to run on a subscription login: the Agent SDK documentation says third-party products may
not offer claude.ai login or rate limits, and `claude --bare` (headless mode) requires an API key. Wiring the
agent to a subscription token, or to `claude -p` in a batch, is therefore ruled out.

## Decision

- **`SessionExchangeProvider`** (`packages/llm-adapter/src/session.ts`) implements the readiness and draft
  interfaces through files. For each call it computes the same input hash as every other provider, and looks for
  `<kind>-<hash>.answer.json` in an exchange directory. If the answer is missing it writes
  `<kind>-<hash>.request.json` holding the exact system prompt and user message a model would receive, and fails
  as `UNAVAILABLE`, so the workflow routes to review and nothing is guessed. A rerun replays the answers.
- **Answers are written by Claude in an interactive Claude Code session**, as ordinary use of the subscription:
  a person runs the script, Claude reads the requests in the conversation and writes the answers. Nothing runs
  unattended on the subscription and nothing is distributed.
- **Every answer passes the same checks as any provider:** the provider's structured schema, then the shared
  grounding, coverage and observability checks (`checkReadiness`, `checkDraftSet`). The decision record stores
  `provider: claude-code-session`, the answering model as labelled, the prompt version and the input hash.
- `showcase/fitness-crm/session-drafts.ts` runs the 30 Gym CRM acceptance-criteria stories this way and writes
  `results/session-drafts.json` with the drafts and the team's designed cases on the same criteria.

## Consequences

- Real-model output through the agent's own prompts and checks is available without an API key, and the audit
  trail says exactly where it came from.
- It is a best case, not a measurement of the unattended agent: the answering session has the whole project in
  context and a person can steer it. Reports must say "drafted by Claude in an interactive session".
- The cost is the session's quota and attention, so it suits a showcase or a pilot slice, not regression.
- When an API key exists, `QA_LIVE_LLM=1` replaces this provider with no other change.
