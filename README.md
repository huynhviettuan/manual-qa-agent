# Manual QA AI Agent

An assistant for manual QA teams. It turns user stories into test cases that cite their requirement sources, and asks a person when a requirement is unclear. It runs approved tests in a real browser and keeps the evidence, and it suggests why a test failed. Risky steps always need a deterministic policy check and a human approval.

> **Status:** Phases 1–3 are implemented and tested; Phase 4 is not started ([status](#project-status)). The reviewer workflow is API-only (no web UI yet). · **Version:** 0.3 · **Updated:** 2026-10-16

**Contents:** [How it works](#how-it-works) · [Quickstart](#quickstart) · [Walkthroughs](#walkthroughs) · [AI assistants](#connect-an-ai-assistant-mcp) · [Showcase](#showcase-gym-crm) · [Roles](#roles-and-api-keys) · [Real AI models](#use-a-real-ai-model) · [Configuration](#configuration) · [Production setup](#run-it-like-production) · [Development](#develop-and-test) · [Troubleshooting](#troubleshooting) · [Docs](#documentation)

## How it works

```mermaid
flowchart LR
  S["Story + acceptance criteria"] --> R["Find approved,<br/>versioned sources"]
  R --> D{"Ready to test?"}
  D -- unclear --> C["Question for the<br/>product owner"] -- answer becomes a source --> R
  D -- ready --> T["Draft test case<br/>(cites sources)"] --> A["QA approves"]
  A --> E["Executable steps,<br/>approved by a 2nd person"] --> W["Worker runs it<br/>in a browser"]
  W --> V["PASSED / FAILED / INCONCLUSIVE<br/>+ screenshots and logs"]
  V -- failed --> G["Suggested cause"] --> H["Human confirms"] --> J["Jira bug<br/>(QA lead approval)"]
```

What it guarantees:

- **The AI never decides pass/fail.** Verdicts come only from code assertions (URL, text, HTTP status). The AI reads requirements and suggests causes.
- **No invented requirements.** Expected results must come from approved, versioned sources. If something is missing or two sources contradict each other, a person is asked.
- **No unapproved risk.** Destructive steps, production writes and Jira filing need a human approval for that exact action and environment. The approval is re-checked right before the action runs.
- **Secrets stay out of the model.** Inputs are redacted, test passwords are passed by reference, and the model never sees screenshots or traces.
- **Everything is auditable.** Every step records the model, prompt and policy versions, the sources used, token cost and who approved what.

## Quickstart

You need about 5 minutes, Node.js 22.12+ and pnpm 9 (`corepack enable`, or use `npx pnpm@9`). You don't need Docker or API keys. Without keys, a deterministic stand-in replaces the AI model behind the real SDK code, so nothing leaves your machine.

> **Windows:** run the commands in **Git Bash** (installed with Git for Windows). For PowerShell, see [Troubleshooting](#troubleshooting).

**1. Install and set up.** Run these once, while the API is **not** running. The embedded database is used by one process at a time, so the API won't see changes a `pnpm qa` command makes while it runs.

```bash
pnpm install
pnpm --filter @qa/execution exec playwright install chromium   # browser for test runs
pnpm db:migrate                                                # creates ./.pglite (embedded database)
pnpm qa seed --project pilot                                   # prints 5 API keys, once: save them
pnpm qa ingest eval/fixtures/sources --project pilot --as pilot-po   # sample approved requirements
pnpm qa env staging --project pilot --kind staging --base-url http://127.0.0.1:4000
```

The last command registers the demo app as the `staging` test environment. Test runs can only reach the hosts you register.

**2. Start the demo app and the API** in two terminals:

```bash
QA_SECRET_DEMO_PASSWORD=demo-password pnpm demo:sut                         # terminal 2: demo app on :4000
QA_EMBEDDED_WORKER=1 QA_SECRET_DEMO_PASSWORD=demo-password pnpm api         # terminal 3: API on :3000
```

The demo app is a small login site, included so you have something safe to test. `QA_SECRET_DEMO_PASSWORD` is its test password. Test steps refer to it as `{ "secret": "DEMO_PASSWORD" }`, so the password never appears in a test case or reaches the model.

**3. Set the keys from step 1** in the terminal you'll use for the walkthroughs:

```bash
export API=http://127.0.0.1:3000
export QA_KEY=<pilot-qa key>       # QA engineer
export LEAD_KEY=<pilot-lead key>   # QA lead
export PO_KEY=<pilot-po key>       # product owner
curl -s $API/healthz               # {"ok":true}
```

## Walkthroughs

Each call is a plain `curl` against the API. The request bodies are in [`examples/`](examples/), and a test keeps them working. Responses are JSON: copy the IDs you need into variables, as shown.

### 1. Turn a story into a test case

```bash
curl -s -X POST $API/api/stories -H "x-api-key: $QA_KEY" -H "content-type: application/json" \
  -d @examples/story-login-valid.json
```

The response says `"route":"DRAFT_CREATED"` and gives `caseIds`: one test case per test condition the story needs (a boundary, a rule combination, a transition), with `designNotes` saying how they were derived ([ADR-0016](docs/adr/0016-draft-sets.md)); `caseId` is the first of them. Each case names its test-design techniques, the conditions it checks, the requirements it verifies and the `sourceRefs` it cites (`AC-LOGIN@v1`). Any acceptance criterion no case covers is listed in `missingRequirements` by a check in code ([ADR-0014](docs/adr/0014-drafts-name-test-design-techniques.md)). Read a draft, then approve it as a QA engineer:

```bash
export CASE=<caseId>
curl -s $API/api/test-cases/$CASE -H "x-api-key: $QA_KEY"
curl -s -X POST $API/api/test-cases/$CASE/review -H "x-api-key: $QA_KEY" -H "content-type: application/json" \
  -d '{"decision":"APPROVE"}'
```

### 2. When a requirement is unclear

"After multiple failed logins the system locks the user out" doesn't say how many attempts, so no test can be written for it yet:

```bash
curl -s -X POST $API/api/stories -H "x-api-key: $QA_KEY" -H "content-type: application/json" \
  -d @examples/story-lockout-vague.json
```

The route is `REVIEW_REQUESTED`, with a `question` and a `reviewId` for the product owner. The product owner sees it in their queue and answers it. The answer is published as a new approved source (`CLAR-LOCKOUT@v1`), and the story re-runs automatically:

```bash
curl -s $API/api/reviews -H "x-api-key: $PO_KEY"
curl -s -X POST $API/api/reviews/<reviewId>/resolve -H "x-api-key: $PO_KEY" -H "content-type: application/json" \
  -d @examples/answer-lockout-clarification.json
```

The `rerun` part of the response now has a draft whose `sourceRefs` include `CLAR-LOCKOUT@v1`.

### 3. Run the approved test in a browser

A test case is written for people. To run it, you attach **executable steps**: a fixed set of safe step types (navigate, fill, click, expect…) with locators scoped to their parent element. A different person has to approve them.

```bash
curl -s -X POST $API/api/test-cases/$CASE/executables -H "x-api-key: $QA_KEY" -H "content-type: application/json" \
  -d @examples/executable-login-valid.json
export EXE=<id>
curl -s -X POST $API/api/executables/$EXE/review -H "x-api-key: $LEAD_KEY" -H "content-type: application/json" \
  -d '{"decision":"APPROVE"}'                       # the proposer approving their own gets 403
curl -s -X POST $API/api/test-runs -H "x-api-key: $QA_KEY" -H "content-type: application/json" \
  -d "{\"caseId\":\"$CASE\",\"environmentId\":\"staging\"}"
```

The run starts as `QUEUED`. After a few seconds, `GET` it until `status` is `PASSED`. The response lists the evidence, which you can download:

```bash
export RUN=<id>
curl -s $API/api/test-runs/$RUN -H "x-api-key: $QA_KEY"
curl -s -o step.png $API/api/evidence/<evidence id> -H "x-api-key: $QA_KEY"
```

Destructive steps (for example, deleting an account) come back `BLOCKED` with an approval review for a QA lead. Once it is approved, request the run again with `"approvalId"`.

### 4. Record a manual execution

Not every approved case can run in a browser. A tester runs the rest by hand and records the result step by step; the status is worked out from the steps in code, never typed in ([ADR-0017](docs/adr/0017-manual-execution-records.md)):

```bash
curl -s -X POST $API/api/manual-runs -H "x-api-key: $QA_KEY" -H "content-type: application/json"   -d "{\"caseId\":\"$CASE\",\"environmentId\":\"staging\",\"build\":\"a981386\",\"steps\":[{\"status\":\"PASSED\",\"actual\":\"\"},{\"status\":\"FAILED\",\"actual\":\"Shows the raw message Too big: expected number to be <=1000\"}]}"
```

The answer is `"status":"FAILED","failedStep":2`. Attach a screenshot with `POST /api/manual-runs/<id>/evidence` (`name`, `contentType`, `dataBase64`), read the history with `GET /api/test-cases/$CASE/manual-runs`, and when the case was part of a suite run, pass `suiteRunId` so the suite report shows the manual result beside the automated ones. The AI agent key cannot record results.

Testers don't need `curl`: open `http://127.0.0.1:3000/tester`, enter your API key, pick a suite run and record each step; the page posts to the same endpoint and shows the status the server derived ([ADR-0019](docs/adr/0019-tester-screen.md)). The same stored cases feed `GET /api/coverage` (which requirements the cases cite, and the gaps), the tester workbook `GET /api/export/test-cases.csv` (the team's 20-column schema; execution columns only from recorded runs) and `GET /api/export/traceability.csv`. Open questions from clarification reviews are listed by `GET /api/questions`, where QA can record what the product does today ([ADR-0018](docs/adr/0018-manual-test-management.md)).

### 5. Triage a failing test

Restart the demo app with a planted bug: its error message now reveals whether an account exists (`DEMO_BUG_1042=1`). Then run the "wrong password" test:

```bash
DEMO_BUG_1042=1 QA_SECRET_DEMO_PASSWORD=demo-password pnpm demo:sut     # in terminal 2, after Ctrl+C
```

To run the test, repeat walkthroughs 1 and 3 using `examples/story-login-invalid.json` and `examples/executable-login-invalid.json`. The run ends `FAILED`, and the worker triages it automatically:

```bash
curl -s $API/api/test-runs/$RUN/triage -H "x-api-key: $QA_KEY"         # suggested cause + security flag
curl -s $API/api/test-runs/$RUN/reproduction -H "x-api-key: $QA_KEY"   # steps to reproduce (markdown)
```

The triage is only a suggestion and never changes the verdict. This failure leaks account existence, so it is flagged as security-sensitive and sent to a QA lead. The lead confirms the cause:

```bash
curl -s $API/api/reviews -H "x-api-key: $LEAD_KEY"                      # find the SECURITY_TRIAGE review
curl -s -X POST $API/api/reviews/<reviewId>/resolve -H "x-api-key: $LEAD_KEY" -H "content-type: application/json" \
  -d '{"action":"APPROVE","reason":"Message reveals unknown accounts","confirmedCause":"PRODUCT_DEFECT"}'
```

To file the confirmed defect in Jira, [configure Jira](#configuration) and restart the API. Until Jira is configured, step 1 below returns `bug tracker integration is disabled (QA_JIRA_ENABLED)`.
1. `POST /api/test-runs/$RUN/bugs` creates a bug draft and an approval review.
2. A QA lead approves the review.
3. `POST /api/bugs/<id>/publish` with that `approvalId` files the issue. It's idempotent, and `POST /api/bugs/<id>/revert` undoes it (audited; no deletes).

## Connect an AI assistant (MCP)

A coding assistant such as Claude Code can do the agent-side work for you: read an approved case, write and check
its executable steps, propose them, and run and read the result once a person has approved. It connects through
`pnpm mcp`, a tool server that only runs with the `pilot-agent` key, so the API refuses anything the AI role
may not do, whatever the assistant asks for ([ADR-0011](docs/adr/0011-agent-tool-server.md)).

```bash
claude mcp add qa-agent --env QA_API_URL=http://127.0.0.1:3000 --env QA_AGENT_KEY=<pilot-agent key> \
  -- pnpm -s --dir /path/to/manual-qa-agent mcp
```

`-s` matters: the tool server speaks MCP on stdout, and pnpm's script banner would corrupt it.

For assistants that can't spawn a local process, run it over HTTP instead: `QA_API_URL=… pnpm -s mcp --http` serves
`http://127.0.0.1:3100/mcp`, and every request must send its own `pilot-agent` key as `Authorization: Bearer <key>`
([ADR-0013](docs/adr/0013-tool-server-http-transport.md)).

Tools: `whoami`, `get_test_case`, `check_executable`, `propose_executable`, `request_run`, `get_run`, `get_triage`,
`get_reproduction`. Approving cases and executables, answering clarifications and filing bugs stay with people;
there is no tool for them. Stories are also submitted by people ([ADR-0012](docs/adr/0012-story-submission-stays-with-people.md)).
The `manual-qa-agent` and `test-script-writer` skills in [sdet-skills](https://github.com/huynhviettuan/sdet-skills)
teach an assistant this workflow and the executable-step format.

## Showcase: Gym CRM

The agent tested a real product end to end: the Gym CRM sample (a gym management web app) with its fictional *Demo Gym* data, running as a separate local copy. **Report:** https://claude.ai/artifact/5NU9478WKjcSdzTi3wzmKN (private; also [results/report.html](showcase/fitness-crm/results/report.html)) · **Tester workbook:** [gym-crm-test-suite.xlsx](showcase/fitness-crm/results/gym-crm-test-suite.xlsx) · **Code and how to reproduce:** [showcase/fitness-crm](showcase/fitness-crm/README.md)

What happened, in the order the agent works:

1. **Requirements in.** The Gym CRM docs (business rules, functional requirements, role permissions, acceptance criteria) became 10 approved sources. The agent reviewed 30 acceptance-criteria stories and asked for one to be split instead of guessing.
2. **Test design.** A 261-case regression suite covers every documented module, traced to 96 requirements. Each module carries its design artifacts (partition, boundary and decision tables, state models), and every case names the technique it comes from.
3. **Draft and approve.** The agent drafted 259 cases from the sources, with citations. A QA engineer revised each one and a QA lead approved it; the agent cannot approve its own work. Two cases were left undrafted: one needs clarification, and one requirement has no source.
4. **Execute.** 130 approved cases have executable steps and ran in a real browser, twice, with identical results. Verdicts come only from code assertions, never from the model.
5. **Triage and safety.** Failures got an advisory cause. Production runs, destructive steps, other hosts and self-approval were all refused.

| Module | Cases | Automated |
| --- | ---: | ---: |
| Sign-in, sessions, roles and permissions | 79 | 70 |
| Leads and consulting | 43 | 27 |
| Customers and contracts | 45 | 23 |
| PT booking, sessions, classes and check-in | 36 | 1 |
| Money, approvals, configuration, tasks, workouts, reports, security | 58 | 9 |
| **Total** | **261** | **130** |

Techniques used: permission matrix (77 cases), use case (46), boundary value analysis (35), equivalence partitioning (34), decision table (28), error guessing (21), state transition (20).

**Results.** 128 passed, 1 failed and 1 was inconclusive.
- **CON-07 failed:** a real defect. Entering 1001 sessions on a new contract shows the raw English message "Too big: expected number to be <=1000" in the Vietnamese price preview.
- **SEC-01 was inconclusive:** the not-found page nests two `main` landmarks, so the check refused to guess which one was meant.

The 131 manual cases each record why they are not automated: date-relative values, two users in sequence, a controllable clock, email, and so on. Together these reasons form the executor's backlog.

**Compared with manual testing**, on the team's numbers (3 min to run a case by hand, weekly regression):

| | Manual | With the agent |
| --- | ---: | ---: |
| One regression run | 13 h 03 min (261 × 3 min) | 6 h 36 min (131 cases by hand + 3 min 15 s of browser time) |
| Per year | 678 h | 343 h (about 335 h saved) |

The 130 automated cases took about 3 min 15 s of browser time in total. Gym CRM limits sign-ins to 20 per minute, so the run waited about 7 minutes on top of that; reusing one session per role would remove the wait. Writing the executable specs was a one-time cost that was not timed. The report shows the payback.

The showcase also found and fixed four agent issues: the locale-dependent login labels, a screenshot race on client redirects, secret placeholders being redacted, and the context budget dropping exact requirement matches ([ADR-0010](docs/adr/0010-budget-keeps-exact-matches.md)). This run used the keyless stand-in model. To repeat it with live Claude (billed), use `QA_LIVE_LLM=1 pnpm showcase:gym`.

## Roles and API keys

`pnpm qa seed` creates one user per role and prints their API keys once (only hashes are stored). Send a key as `x-api-key: <key>` or `Authorization: Bearer <key>`. Roles come only from the server, never from the request.

| User | Role | Can |
| --- | --- | --- |
| `pilot-qa` | QA engineer | Submit stories; approve, edit or reject test cases; propose and approve executables (but not their own); request runs; resolve triage and missing-knowledge reviews |
| `pilot-lead` | QA lead | Everything a QA engineer can, plus: approve destructive actions and bug filing, handle security triage, read metrics and usage |
| `pilot-po` | Product owner | Submit stories; answer clarifications and source conflicts; publish approved requirement sources |
| `pilot-admin` | Admin | Everything above |
| `pilot-agent` | AI agent | Read cases; propose executables; request runs; read runs, triage and reproductions. Never approves, resolves reviews, files bugs, reads the review queue or downloads evidence |

The AI agent has its own role. It can propose but never approve, and it can't read the review queue. Use its key only with the [agent tool server](#connect-an-ai-assistant-mcp).

## Use a real AI model

Set `QA_LIVE_LLM=1` plus one provider's key. Live calls are **billed**.

| Provider | Settings |
| --- | --- |
| Claude (default) | `ANTHROPIC_API_KEY`; model `claude-opus-5-5` unless `QA_LLM_MODEL` is set |
| OpenAI | `QA_LLM_PROVIDER=openai`, `OPENAI_API_KEY`, and `QA_LLM_MODEL` (the Responses API model for drafts) |
| TypeSafe Jev (readiness only) | `QA_READINESS_PROVIDER=jev`, `TYPESAFE_API_KEY`; drafts still come from `QA_LLM_PROVIDER` |

The provider is recorded with every decision. See [ADR-0004](docs/adr/0004-claude-structured-decisions.md), [0006](docs/adr/0006-provider-neutral-decision-layer.md) and [0007](docs/adr/0007-typesafe-jev-readiness.md).

## Configuration

All settings are environment variables. [`env.example`](env.example) lists every one with an explanation. The most common:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | unset → embedded PGlite in `./.pglite` | PostgreSQL connection string |
| `PORT` / `DEMO_PORT` | `3000` / `4000` | API and demo app ports |
| `QA_EMBEDDED_WORKER` | off | Run the worker inside the API (development with PGlite) |
| `QA_SECRET_<NAME>` | — | Secrets used by test steps as `{ "secret": "<NAME>" }` |
| `QA_BROWSER_CHANNEL` | bundled Chromium | `chrome` or `msedge` to use an installed browser |
| `QA_EVIDENCE_DIR` | `./.evidence` | Where screenshots and logs are stored |
| `QA_EXECUTION_ENABLED` | on | `0` stops all test execution (kill switch) |
| `QA_LIVE_LLM` | off | `1` calls the real AI provider (billed) |
| `QA_DECISION_CACHE_TTL_HOURS` | `24` | Reuse identical AI decisions; `0` disables |
| `QA_JIRA_ENABLED` + `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` | off | Jira Cloud bug filing |

Keep real values in a secret manager or an untracked `.env`. Never commit them.

## Run it like production

The embedded database (PGlite) is for **one process on one machine**. For anything shared, use PostgreSQL and run the worker as its own process. You can run several workers; each test run is claimed by exactly one.

```bash
docker compose up -d                                                  # PostgreSQL 17 + pgvector on :5432
export DATABASE_URL=postgres://qa:qa_local_only@127.0.0.1:5432/qa     # local compose only
pnpm db:migrate && pnpm qa seed --project pilot
pnpm api                                                              # no QA_EMBEDDED_WORKER
pnpm worker                                                           # one or more, in other terminals
```

Deployment and operations guidance is in [docs/11](docs/11-deployment.md).

## Develop and test

```bash
pnpm lint && pnpm format:check && pnpm typecheck   # static checks
pnpm test                                          # unit, contract (mocked AI), policy, tenancy, browser tests
pnpm eval                                          # labeled pilot set; fails on any false "ready" or missed security escalation
```

- Tests run on in-memory PGlite. To run them against real PostgreSQL, set `QA_TEST_DATABASE_URL` to a disposable server; each test file creates and drops its own database. CI runs both, because only a real server tests concurrent workers.
- CI never calls a live model. Live smoke tests run only with `QA_LIVE_LLM=1` and a key.
- Before changing code, read [AGENTS.md](AGENTS.md). It has the non-negotiable safety rules and the merge checklist.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| A `pnpm qa …` command reported success, but the API doesn't see the change (for example, a run is `BLOCKED` with `DENIED:UNKNOWN_ENVIRONMENT`) | The embedded database works for one process at a time. A command run while the API is up writes changes the API can't see, and the two processes can corrupt `./.pglite`. Stop the API, run the command again, then restart the API. For several processes, use PostgreSQL. |
| Errors reading `./.pglite` after a crash or forced kill | Development data only: delete `.pglite` and repeat Quickstart step 1. |
| `401 UNAUTHENTICATED` | Send the key as `x-api-key`. Keys are printed only by `pnpm qa seed`. |
| `403 FORBIDDEN` | That role can't do that action (see [Roles](#roles-and-api-keys)). Approving your own executable is always refused. |
| `429` rate limit | 120 requests per minute per key. Wait for the `retry-after` time. |
| Port 3000 or 4000 in use | Set `PORT` / `DEMO_PORT`. If you move the demo app, re-run `pnpm qa env staging … --base-url` with the new port. |
| Run is `BLOCKED` | Read its `reason`. Common causes: a destructive step without an approval, a production environment, an environment with no registered target, or the requester losing permission before the run started. |
| Browser not found | Run the `playwright install chromium` step, or set `QA_BROWSER_CHANNEL=chrome`. |
| PowerShell | Set variables with `$env:QA_SECRET_DEMO_PASSWORD="demo-password"; pnpm demo:sut`, and use `curl.exe` (in Windows PowerShell 5.1, plain `curl` is a different command). Git Bash avoids both. |

## Project status

| Phase | What works | Not yet |
| --- | --- | --- |
| 1. Requirements and review | Approved-source registry, full-text + exact-ID retrieval, readiness check, cited drafts as one case per test condition with named techniques and a coverage check, review queue, knowledge feedback, evaluation set | Vector search (ADR-0005), reviewer web UI |
| 2. Execution and evidence | Constrained steps (ADR-0008) with date-relative values and values captured between steps (ADR-0015), Playwright executor with host allowlist and pinned locale, deterministic verdicts, leased workers, immutable evidence with retention, test suites (sections, suite runs, per-case report) | S3 evidence storage, AI-proposed steps, arithmetic on values, values read from API responses |
| 3. Triage and integration | Advisory triage with security escalation (ADR-0009), reproduction write-up, Jira Cloud filing (off by default), decision cache, metrics and drift alerts, propose-only MCP tool server for AI assistants (ADR-0011) | Live Jira verification, test-management sync |
| 3b. Manual testing | Manual execution records with derived status and evidence (ADR-0017), full case schema, coverage, tester workbook and traceability exports, question register (ADR-0018), tester screen with draft review (ADR-0019) | Bulk review actions, revision diffs |
| 4. Scale | — | Per-project budgets, scheduled runs, more frameworks; only with measured benefit ([docs/08](docs/08-implementation-plan.md)) |

The backlog with per-issue status is in [docs/12](docs/12-github-backlog.md).

The team's Claude Code skills for test design, automation architecture and QA reporting live in [skills/](skills/README.md); the agent's draft vocabulary follows them.

## Documentation

| File | Purpose |
| --- | --- |
| [docs/00-product-vision.md](docs/00-product-vision.md) | Purpose, business value and boundaries |
| [docs/01-requirements.md](docs/01-requirements.md) | Personas, use cases and acceptance criteria |
| [docs/02-architecture.md](docs/02-architecture.md) | Components, integration, trust boundaries |
| [docs/03-workflows.md](docs/03-workflows.md) | End-to-end examples and lifecycle transitions |
| [docs/04-rag-design.md](docs/04-rag-design.md) | Ingestion, retrieval, context budgets, feedback |
| [docs/05-decisions-api.md](docs/05-decisions-api.md) | Decision types, typed integration and policy engine |
| [docs/06-human-review.md](docs/06-human-review.md) | Review triggers, UX, governance and SLAs |
| [docs/07-data-contracts.md](docs/07-data-contracts.md) | Data entities, schemas and endpoints |
| [docs/08-implementation-plan.md](docs/08-implementation-plan.md) | Phased roadmap and definition of done |
| [docs/09-security.md](docs/09-security.md) | Tenant isolation, safety, secrets and privacy |
| [docs/10-evaluation.md](docs/10-evaluation.md) | Reliability, quality, cost and token benchmarks |
| [docs/11-deployment.md](docs/11-deployment.md) | Local, CI and operational guidance |
| [docs/12-github-backlog.md](docs/12-github-backlog.md) | Backlog and status |
| [docs/13-open-questions.md](docs/13-open-questions.md) | Assumptions to validate |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [AGENTS.md](AGENTS.md) | Rules for coding agents working on this repo |

### Design principles

1. **Rules before models.** Code checks observable facts; AI helps interpret, never redefines pass/fail.
2. **Evidence with provenance.** Every decision references versioned sources and a run or evidence ID.
3. **No silent high-risk changes.** Destructive, production and security-sensitive actions need policy approval and usually a person.
4. **Fail safe.** If a model, retrieval or provider fails, the result is `INCONCLUSIVE` or `NEEDS_REVIEW`, never a guess.
5. **Measure cost.** Every AI call records tokens and latency; identical decisions are cached.

### Stack

Node.js + TypeScript (pnpm workspaces), Fastify, zod at every boundary · PostgreSQL + pgvector, or embedded PGlite for development · Claude (`@anthropic-ai/sdk`), OpenAI (`openai`) or TypeSafe Jev (`@typesafe-ai/sdk`) behind provider-neutral ports · Playwright 1.64 · Jira Cloud REST v3.

### SDK references (verified 2026-10-09)

- Anthropic `@anthropic-ai/sdk` 0.132.x: `client.beta.messages.parse` with `betaZodOutputFormat`, `stop_reason: "refusal"`, server-side refusal fallback (`server-side-fallback-2026-07-01`).
- OpenAI `openai` 7.31.x: `client.decisions.create` (beta; `choice` / `predicate` / `score` / `refusal` answers) and `client.responses.parse` with `zodTextFormat`.
- TypeSafe `@typesafe-ai/sdk` 0.6.x: `client.systemOne({ state, questions, model })` with `choice()` / `noul()`, `TYPESAFE_API_KEY`.

Recheck model IDs, SDK versions and response shapes when upgrading (docs/12 QA-010).
