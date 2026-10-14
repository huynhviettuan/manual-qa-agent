# ADR-0008 — Approved test cases execute through a constrained step format

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Phase 2 executes approved test cases in non-production environments (docs/08, QA-015 to QA-018). A test case draft is natural language and cannot run. One option is an agent that drives the browser live from natural language. That is hard to audit and replay. It also exposes execution to prompt injection from the system under test, since page text would reach a model that holds browser control. ADR-0003 requires model output to stay advisory.

## Decision

- An APPROVED test case revision gets one or more **executable versions** (`test_case_executables`): an `ExecutableSpec` of allowlisted step types:
  - actions: `navigate`, `click`, `fill`, `select`, `apiRequest`;
  - assertions: `expectText`, `expectVisible`, `expectHidden`, `expectUrl`, and `apiRequest.expectStatus`.

  It is defined in `packages/domain/src/executable.ts` and validated with zod.
- Constraints:
  - **No arbitrary JavaScript**. Unknown step types are rejected.
  - **Relative paths only.** Navigation and API calls resolve against the administrator-configured environment base URL. Absolute URLs, `//host` and schemes are rejected.
  - **Semantic locators** (role/name, test ID, label, text), optionally scoped through a parent (`within`). Ambiguous locators fail in Playwright strict mode; the runner never guesses.
  - **Secrets by reference** (`{ "secret": "NAME" }`). They are resolved only by the executor at run time, masked in screenshots and redacted from every log.
  - **Destructive steps** (`click.destructive`, any `DELETE`, `apiRequest.destructive`) make the whole run require a scoped human approval (QA lead/admin). Production is denied regardless.
  - `teardown` always runs. The spec that creates test data owns its cleanup.
  - Steps may only cite sources the approved case cites (traceability).
- Governance:
  - Anyone in QA roles, **including the AI agent**, may propose an executable. A different human (QA engineer, lead or admin) must approve it. A database check enforces reviewer ≠ proposer.
  - Approval binds to the spec hash and to the case revision. A changed case invalidates the pending proposal.
  - Every run re-evaluates policy twice: at request time (fast feedback) and **again immediately before execution** in the worker. That second check uses the requester's current roles, the approval's expiry and revocation, the environment allowlist and the spec hash.
- Execution (`packages/execution`, Playwright):
  - A fresh browser context per run. Every request, including WebSockets, is checked against the environment's host allowlist; anything else is aborted and recorded.
  - No downloads, no service workers.
  - Waits are on real signals (locator state, URL), never fixed sleeps.
- Verdicts are deterministic:
  - `PASSED`: all assertions passed.
  - `FAILED`: an assertion observed a different value. The actual value is recorded.
  - `INCONCLUSIVE`: the behaviour was never observed, for example a setup failure, a missing element, a step error, mandatory evidence that could not be stored, an executor crash, or a worker lease lost mid-run.
  - `BLOCKED`: policy did not allow the run.
- Evidence (`packages/evidence`): per-step screenshots, a step log and a network summary (host and path only, no query strings, headers or bodies). Objects are immutable, stored by key outside prompts and the database, with digest, retention and purge. They are served only through authenticated, project-scoped requests and never to the AI agent.

## Consequences

- Runs are reproducible and auditable: the approved spec hash, policy evaluations, approvals, assertions and evidence digests are all recorded.
- Somebody has to author or approve the executable form of each case. LLM-assisted proposal, which fills the same `proposeExecutable` path as the AI agent actor, is a follow-up.
- The format covers common UI/API checks. New step types are added deliberately, each with its own validation and tests, never as an escape hatch.

## Revisit when

Pilot teams consistently need checks the format cannot express, or an evaluated, sandboxed agentic explorer is proposed for exploratory (non-verdict) testing only.
