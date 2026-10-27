# ADR-0026 — Two ways to a real model: an API key, or the session exchange

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The agent could reach a real model two ways, but only one was a configuration: `QA_LIVE_LLM=1` with a provider key.
The session exchange (ADR-0020) worked only through the showcase scripts, so a team with a Claude Code subscription
and no key had to write a script to use it, and nothing told them which requests were waiting.

## Decision

`QA_LLM_PROVIDER` chooses the way, for the API, the worker, the CLI and the eval alike:

| Mode | Setting | What answers | Cost |
| --- | --- | --- | --- |
| **API key** | `QA_LLM_PROVIDER=anthropic` (default) or `openai`, `QA_LIVE_LLM=1`, the provider's key | The provider's model, unattended | Billed per call |
| **Session exchange** | `QA_LLM_PROVIDER=session`, `QA_SESSION_EXCHANGE_DIR` (default `./.session-exchange`) | Claude in an interactive Claude Code session, through request and answer files; a person runs the workflow again when answers exist | The session's quota and a person's attention |
| **Mock** | the default without `QA_LIVE_LLM` | A deterministic stand-in behind the real SDK, no network | None |

In session mode readiness, drafts and executable proposals all go through the exchange and every answer passes the
same checks as any provider (ADR-0020); failure triage falls back to the keyless stand-in, labelled as such, because
triage runs inside the worker where nobody is waiting. `createProvidersFromEnv` reports `mode` (`api-key`,
`session`, `mock`) and `executables`, so the API logs which way it is on and the orchestrator gets the generator
without each app choosing. `pnpm qa session` lists the requests still waiting for an answer, with their kind and
subject, and where to write the answer.

## Consequences

- A project chooses by one variable; the audit trail says which way each decision came (`provider: anthropic`,
  `openai`, `claude-code-session`, or a `-mock` label).
- Session mode is a best case and a manual loop: a story submitted while nobody answers routes to review with
  `GENERATOR_UNAVAILABLE` / `CLASSIFIER_UNAVAILABLE`, and resubmitting it with the same idempotency key resumes once
  the answer file exists. It suits a pilot slice or a showcase, never regression, and reports must say "drafted in
  an interactive session".
- Nothing runs on a subscription unattended, and nothing is distributed: the person in the session writes every
  answer.
