# ADR-0011 — AI clients reach the agent through a propose-only tool server

- **Status:** Accepted
- **Date:** 2026-10-16
- **Builds on:** ADR-0003 (policy over model), ADR-0008 (constrained executable steps)

## Context

ADR-0008 left LLM-assisted proposal of executable specs as a follow-up: someone has to write the executable form of
each approved case, and the Gym CRM showcase wrote 130 by hand. Coding assistants (Claude Code with the
`sdet-skills` collection) can explore the live app and write those specs, but they need a way to reach the API.

Handing an assistant a person's API key would work technically, but then only the assistant's own instructions keep
it from approving its own proposal, resolving clarifications, or filing bugs. The `AI_AGENT` role already exists and
the API refuses it those actions, but nothing issued a key for it and no client used it.

## Decision

- `apps/mcp` is an **MCP server over stdio** (`pnpm -s mcp`; `-s` keeps pnpm's banner off the protocol stream), using `@modelcontextprotocol/sdk`. It talks to the
  normal HTTP API, so authentication, roles, policy and audit stay in one place and work against remote deployments.
- It starts **only with a pure `AI_AGENT` key** (`QA_AGENT_KEY`): at startup it calls the new `GET /api/me` and exits
  if the key has any other role. The API then refuses approvals, review resolution, the review queue, evidence
  downloads, bug filing and source ingestion for every call it makes, whatever the client asks for.
- `pnpm qa seed` creates a `<project>-agent` actor with `AI_AGENT` and prints its key with the others.
- The tool surface is the propose / run / read part of the workflow, and nothing else:

  | Tool | API |
  | --- | --- |
  | `whoami` | `GET /api/me` |
  | `get_test_case` | `GET /api/test-cases/:id` (latest revision, whether an executable is allowed) |
  | `check_executable` | local: ADR-0008 schema, latest revision `APPROVED`, `sourceRefs` traced to that revision; lists destructive steps and secrets |
  | `propose_executable` | runs the check, then `POST /api/test-cases/:id/executables` |
  | `request_run` | `POST /api/test-runs` (with `idempotency-key`) |
  | `get_run` | `GET /api/test-runs/:id`, optionally polled until terminal (≤ 120 s) |
  | `get_triage` | `GET /api/test-runs/:id/triage` |
  | `get_reproduction` | `GET /api/test-runs/:id/reproduction` |

- There is deliberately **no tool** for reviewing cases or executables, resolving reviews, filing or publishing bugs,
  ingesting or revoking sources, managing suites, or downloading evidence. Adding one needs a new ADR.
- Tool descriptions mark run reports, triage and reproductions as untrusted data (they contain text from the system
  under test and from the model).
- API errors become tool errors; a `403` is reported as a permission boundary that must not be retried with another
  key.

## Consequences

- An assistant can take an approved case to a verdict — propose, wait for a person, run, read the result — while the
  second-person rule and every policy gate are enforced by the server, not by the assistant's prompt.
- Story submission stays with people for now: `AI_AGENT` is not in the submitter roles, matching the security
  matrix ("draft test cases: only with delegated access"). See OQ-13.
- One more dependency (`@modelcontextprotocol/sdk`, pinned) and one more process to run beside the API.
- `GET /api/me` is available to every key; it returns only the caller's own actor id, scope and roles.

## Revisit when

Delegated access is designed (OQ-13), teams want suites run by the agent, or an HTTP (non-stdio) transport is needed
for hosted assistants.
