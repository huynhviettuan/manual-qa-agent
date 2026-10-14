# Manual QA AI Agent — Architecture & Delivery Blueprint

> **Status:** Phases 1–3 implemented: readiness, RAG and review; controlled execution and evidence; advisory triage, gated Jira filing, decision cache and metrics. Phase 4, test-management sync and the reviewer UI are specification only (see the table below). · **Version:** 0.3 · **Updated:** 2026-10-14

A specification and a working implementation of a Manual QA AI agent with retrieval-augmented generation (RAG), an AI decision layer (Claude, [ADR-0004](docs/adr/0004-claude-structured-decisions.md)), deterministic policy, human review, and a controlled knowledge feedback loop. There was no pre-existing agent to wrap (OQ-01), so the MVP was built from scratch.

## Getting started

Requires Node.js 22.12+ and pnpm 9 (`corepack enable`, or `npx pnpm@9`). No Docker or API key is needed for local development:

- Without `DATABASE_URL`, an embedded PostgreSQL (PGlite with pgvector) is stored in `./.pglite`. Use `docker compose up -d` and set `DATABASE_URL` for a real PostgreSQL.
- Tests use in-memory PGlite. Set `QA_TEST_DATABASE_URL` to run them against a disposable PostgreSQL server instead. CI does both, because only a real server exercises concurrent run claims ([docs/11](docs/11-deployment.md)).
- `QA_LLM_PROVIDER` selects `anthropic` (default) or `openai` for drafts, and by default also for readiness (ADR-0006). `QA_READINESS_PROVIDER=jev|openai` routes readiness to a typed-decision API: TypeSafe Jev or the OpenAI Decisions API (ADR-0007).
- Without `QA_LIVE_LLM=1`, a deterministic heuristic stands in for the model behind the selected provider's real SDK code path. Set `QA_LIVE_LLM=1` plus that provider's credentials to call it; those calls are billed. Live OpenAI also requires `QA_LLM_MODEL`, the Responses API model used for drafts. See `env.example`.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test          # unit, mocked-provider contract, policy/tenancy, PGlite integration
pnpm db:migrate
pnpm qa seed --project pilot                      # prints one API key per role, once
pnpm qa ingest eval/fixtures/sources --project pilot --as pilot-po
pnpm api                                          # http://127.0.0.1:3000, send keys as x-api-key
pnpm eval                                         # labeled pilot set; fails on any false-ready draft
```

### Phase 2: run an approved test case (local demo)

```bash
pnpm --filter @qa/execution exec playwright install chromium   # or set QA_BROWSER_CHANNEL=chrome|msedge
QA_SECRET_DEMO_PASSWORD=<any> pnpm demo:sut                      # demo system under test on :4000
pnpm qa env staging --project pilot --kind staging --base-url http://127.0.0.1:4000
QA_EMBEDDED_WORKER=1 QA_SECRET_DEMO_PASSWORD=<same> pnpm api    # API + in-process worker (dev)
```

Then, through the API:
1. Approve a case (`POST /api/test-cases/{id}/review`).
2. Propose an executable spec (`POST /api/test-cases/{id}/executables`). Examples are in `apps/demo-sut/src/specs.ts`.
3. Have a **different** person approve it (`POST /api/executables/{id}/review`).
4. Request a run (`POST /api/test-runs`), then read `GET /api/test-runs/{id}` and download evidence from `GET /api/evidence/{id}`.

Destructive specs come back `BLOCKED` with an approval review. After a QA lead approves it, request the run again with `approvalId`.

> Embedded PGlite is **single-process and development-only**. A hard-killed process can corrupt its data directory. Run the API and `pnpm worker` against PostgreSQL (`DATABASE_URL`, e.g. `docker compose up -d`) for anything shared.

### Implementation status

| Area | Package | Backlog | Status |
| --- | --- | --- | --- |
| Domain types and state machines | `packages/domain` | QA-005 | Implemented |
| Schema, migrations, tenant-scoped repositories | `packages/db` | QA-005 | Implemented |
| Approved-source registry, ingestion, revocation | `packages/retrieval` | QA-006 | Implemented |
| Full-text + exact-ID retrieval, contradictions, context budget | `packages/retrieval` | QA-007/008 | Implemented (vectors deferred, ADR-0005) |
| Readiness + draft providers (Claude; OpenAI Decisions + Responses; TypeSafe Jev for readiness), shared decision plan and grounding checks | `packages/llm-adapter` | QA-009/010 | Implemented (ADR-0004, 0006, 0007) |
| Deterministic policy gate | `packages/policy-engine` | QA-011 | Implemented |
| Review queue, approvals, draft lifecycle | `packages/review` | QA-012 | Implemented (API only, no UI) |
| Approved knowledge feedback | `packages/review`, `packages/orchestrator` | QA-013 | Implemented |
| Workflow orchestration, telemetry, HTTP API | `packages/orchestrator`, `apps/api` | QA-014 | Implemented |
| Evaluation harness | `apps/cli`, `eval/fixtures` | QA-002/004 | Sample pilot set; real labels must come from the team |
| Constrained executable steps, second-person approval (ADR-0008) | `packages/domain`, `packages/orchestrator` | — | Implemented (LLM-proposed steps: follow-up) |
| Playwright executor: host allowlist, secrets by reference, strict locators | `packages/execution` | QA-015 | Implemented |
| Evidence capture, immutable store, retention purge, authenticated download | `packages/evidence`, `apps/api` | QA-016 | Implemented (local disk; S3 adapter: follow-up) |
| Deterministic assertions + run lifecycle, worker with leases | `packages/orchestrator`, `apps/worker` | QA-017 | Implemented |
| Scoped approval for destructive steps, re-checked at execution | `packages/policy-engine`, `packages/orchestrator` | QA-018 | Implemented |
| Demo system under test + executable specs | `apps/demo-sut` | — | Implemented (pilot/CI only) |
| Advisory failure triage (all providers), security escalation, human-verified causes | `packages/llm-adapter`, `packages/orchestrator` | QA-019 | Implemented (ADR-0009) |
| Deterministic reproduction write-up | `packages/orchestrator` | — | Implemented |
| Jira Cloud bug filing: verified defect + scoped approval, idempotent, revertible | `packages/integrations`, `packages/orchestrator` | QA-020 | Implemented (off by default; no live Jira test yet) |
| Decision cache (tenant-scoped, content-addressed) + warm-run benchmark | `packages/orchestrator`, `apps/cli` | QA-021 | Implemented |
| Metrics + drift alerts (JSON for dashboards) | `packages/orchestrator`, `apps/api` | QA-022 | Implemented (no UI) |
| Test-management (Kiwi TCMS) sync, reviewer UI | — | — | Not started |

## North star

Make the agent useful for daily Manual QA work: understand requirements; design traceable tests; execute approved low-risk flows; record reproducible evidence; triage unclear results; request human approval when necessary; and learn only from reviewed outcomes.

**The platform assists QA; it does not autonomously define business requirements, infer product correctness, or authorize dangerous operations.**

## Key engineering principles

1. **Rules before models.** Use code assertions for observable facts (HTTP statuses, SQL values, URLs, UI text). AI helps with interpretation, not redefining pass/fail.
2. **Retrieve only when needed.** RAG reduces repeated prompt context; it does not automatically reduce total cost. Measure embeddings, retrieval, LLM and decision costs.
3. **Evidence with provenance.** Any requirement-driven decision references versioned source IDs and a run/evidence ID.
4. **No silent high-risk changes.** Destructive actions, writes to production, permissions and security-sensitive operations require explicit policy authorization and often human approval.
5. **Separate lifecycle state.** Test-case definition, test execution and human review are different records.
6. **Graceful fallback.** When a model, retrieval service or Decisions API is unavailable, enter a safe `INCONCLUSIVE`/`NEEDS_REVIEW` state rather than guessing.
7. **Start small.** First integrate requirement readiness + human review into the existing agent, then extend to execution and failure triage.

## Documentation map

| File | Purpose |
| --- | --- |
| [docs/00-product-vision.md](docs/00-product-vision.md) | Purpose, business value and boundaries |
| [docs/01-requirements.md](docs/01-requirements.md) | Personas, use cases and acceptance criteria |
| [docs/02-architecture.md](docs/02-architecture.md) | Components, integration, trust boundaries |
| [docs/03-workflows.md](docs/03-workflows.md) | End-to-end examples and lifecycle transitions |
| [docs/04-rag-design.md](docs/04-rag-design.md) | Ingestion, retrieval, context budgets, feedback |
| [docs/05-decisions-api.md](docs/05-decisions-api.md) | Decision types, typed integration and policy engine |
| [docs/06-human-review.md](docs/06-human-review.md) | Review triggers, UX, governance and SLAs |
| [docs/07-data-contracts.md](docs/07-data-contracts.md) | Data entities, schemas and conceptual endpoints |
| [docs/08-implementation-plan.md](docs/08-implementation-plan.md) | Phased tasks, dependencies, definition of done |
| [docs/09-security.md](docs/09-security.md) | Tenant isolation, safety, secrets and privacy |
| [docs/10-evaluation.md](docs/10-evaluation.md) | Reliability, quality, cost and token benchmarks |
| [docs/11-deployment.md](docs/11-deployment.md) | Local/CI and operational recommendations |
| [docs/12-github-backlog.md](docs/12-github-backlog.md) | GitHub milestones, labels and actionable issues |
| [docs/13-open-questions.md](docs/13-open-questions.md) | Design assumptions to validate |
| [docs/adr/](docs/adr/) | Architecture decision records (proposed) |
| [AGENTS.md](AGENTS.md) | Instructions to coding agents implementing the plan |

## Stack

- API/orchestrator: Node.js + TypeScript (pnpm workspaces), Fastify, zod at every boundary; workflow steps persisted and resumable.
- Structured data: PostgreSQL (`DATABASE_URL`) or embedded PGlite for dev/tests; `pgvector` column reserved, full-text retrieval first (ADR-0005).
- AI, behind provider-neutral ports (ADR-0006):
  - Claude via `@anthropic-ai/sdk` structured outputs (default, `claude-opus-5-5`; ADR-0004);
  - or OpenAI via `openai`: Decisions API for readiness (`gpt-6-luna`), Responses API for drafts.
  - Readiness only, optional: TypeSafe Jev via `@typesafe-ai/sdk` (`jev-1.13.0`, pinned).
- Execution: Playwright 1.64 via a constrained step format (ADR-0008), a worker with leases, and a local-disk evidence store.
- Integrations: Jira Cloud REST v3 via plain `fetch` with zod-validated responses (ADR-0009).
- Planned, not built: S3-compatible evidence adapter, LLM-proposed executable steps, test-management sync, reviewer web UI.

## Suggested repository workflow

1. Create a GitHub repository, for example `manual-qa-ai-agent`.
2. Copy this entire documentation pack to the repository root.
3. Open [docs/13-open-questions.md](docs/13-open-questions.md) and resolve essential choices with your team.
4. Convert [docs/12-github-backlog.md](docs/12-github-backlog.md) into issues and milestones.
5. Tell the coding agent to read `AGENTS.md` and the relevant feature specification **before** modifying code.
6. Start with Phase 0 and Phase 1 from the implementation plan; validate outcomes on a labeled QA dataset.

## Reference documentation (verified 2026-10-09)

- Anthropic TypeScript SDK `@anthropic-ai/sdk` 0.132.x: `client.beta.messages.parse` with `betaZodOutputFormat`, `stop_reason: "refusal"`, server-side refusal fallback (`server-side-fallback-2026-07-01`). Checked against the installed SDK types on 2026-10-09.
- OpenAI TypeScript SDK `openai` 7.31.x: `client.decisions.create` (beta; `choice` / `predicate` / `score` / `refusal` answers, see `resources/decisions.d.ts`) and `client.responses.parse` with `zodTextFormat`. Checked against the installed SDK types on 2026-10-09.
- TypeSafe SDK `@typesafe-ai/sdk` 0.6.x: `client.systemOne({ state, questions, model })` with `choice()` / `noul()`, `POST https://api.typesafe.ai/v1/systemone`, `TYPESAFE_API_KEY`. Checked against docs.typesafe.ai and the installed SDK types on 2026-10-09.
- The original blueprint referenced the OpenAI Decisions API (beta). ADR-0004 replaces it.

Recheck model IDs, SDK versions and response shapes when upgrading (docs/12 QA-010).
