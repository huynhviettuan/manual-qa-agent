# Gym CRM showcase

The agent tested the Gym CRM sample (`D:\fitness-crm`, fictional *Demo Gym* data). Plan and decisions: [PLAN.md](PLAN.md). Report: [results/report.html](results/report.html), published privately at https://claude.ai/artifact/5NU9478WKjcSdzTi3wzmKN.

| Path | Contents |
| --- | --- |
| `build-sources.ts` | Turns the Gym CRM docs (05 business rules, 06 functional requirements, 09 roles, 14 acceptance criteria) into agent sources, one block per rule, requirement, criterion and permission row, plus one story per acceptance criterion |
| `sources/`, `stories/` | Generated from the Gym CRM docs, word for word |
| `stories-followup/` | Stories a QA engineer split after the agent asked for it (AC-01 part 1) |
| `suite/` | The full regression suite: one file per module (access, leads, contracts, schedule, operations), each with its test-design artifacts and the cases derived from them; 130 cases have executable steps written against the real UI, the rest record why they are manual |
| `baseline.json` | Your team's manual numbers used by the agent-versus-manual analysis |
| `findings.json` | What the showcase found, in the agent and in Gym CRM |
| `run-showcase.ts` | Requirements review, case drafting and approval, the suite (created, run twice), safety gates and triage; writes `results/` |
| `build-report.ts` | Renders `results/report.html` and `results/suite.json`; screenshots in `results/evidence/` are published with the report, not committed |
| `export_xlsx.py` | Writes `results/gym-crm-test-suite.xlsx` for testers: one sheet per module, traceability, test design, live summary formulas (`python showcase/fitness-crm/export_xlsx.py`) |

## Reproduce

1. Run a separate Gym CRM instance with demo data, so your own dev database is not touched. One way, used for this showcase:
   ```bash
   git clone D:/fitness-crm <temp>/gymcrm && cd <temp>/gymcrm
   docker run -d --name qa-gymcrm-pg -e POSTGRES_USER=fitness -e POSTGRES_PASSWORD=fitness -e POSTGRES_DB=fitness_crm -p 127.0.0.1:55433:5432 postgres:17
   # apps/api/.env and .env: DATABASE_URL on port 55433, PORT=4410, BETTER_AUTH_URL=http://localhost:3410,
   # fresh BETTER_AUTH_SECRET and FIELD_ENCRYPTION_KEY, SEED_ADMIN_PASSWORD; apps/web/.env: API_URL=http://localhost:4410
   pnpm install && pnpm build && pnpm db:deploy && pnpm db:seed && pnpm db:seed:demo
   node apps/api/dist/main.js            # API on :4410
   cd apps/web && npx next start -p 3410 # web on :3410
   ```
2. From this repository:
   ```bash
   npx tsx showcase/fitness-crm/build-sources.ts D:/fitness-crm   # only if the Gym CRM docs changed
   QA_SECRET_GYM_PASSWORD=<SEED_ADMIN_PASSWORD> pnpm showcase:gym
   pnpm showcase:gym:report
   ```
   Add `QA_LIVE_LLM=1` and `ANTHROPIC_API_KEY` for a live Claude run (billed). Without them the AI is the keyless stand-in, and the report says so.

Each run creates a few leads in the instance. Sign-in is rate limited, so avoid running the showcase in a tight loop.

Third run (2026-10-23, draft sets per story and run-scoped values): SEC-01 asserts the "Không tìm thấy" heading and passes; CON-08 is automated with derived dates (`values` in its spec). 131 automated: 130 passed, 1 failed (CON-07), identically in two suite runs.

## Drafted by Claude in an interactive session (ADR-0020)

No API key was available, so the 30 acceptance-criteria stories were answered by Claude in an interactive Claude
Code session through the file-exchange provider: the agent wrote each exact prompt to
`results/session-exchange/`, Claude answered there, and the agent applied its usual schema, grounding, coverage
and observability checks. Run it with `npx tsx showcase/fitness-crm/session-drafts.ts` (it replays the stored
answers). Results are in `results/session-drafts.json`. This is a best case, not the unattended agent: the session
had the whole project in context.

| | Keyless stand-in | Claude (session) |
| --- | ---: | ---: |
| Stories judged ready | 30 of 30 | 20 of 30 |
| Clarification questions | 0 | 10 |
| Draft cases | 30 (one restatement per story) | 53 (one per test condition) |
| Techniques used | specification-based only | 11 (state transition 15, equivalence partitioning 9, decision table 8, …) |
| Cases the observability check flagged | — | 20 of 53 |

**The clarifications are real gaps in the Gym CRM documents.** For example: AC-13 says the trash is "viewable only
by management", but the seeded roles keep it from the Fitness Manager (Admin only); AC-27 locks an overdue step
"past its grace period" without saying how long that is; AC-08, AC-18 and AC-22 compare with Excel or GymMaster
files that are not among the sources. The team's designed suite has cases on 9 of these 10 criteria, written
against today's behaviour rather than a stated rule.

**Against the team's cases on the 20 drafted criteria** (110 cases, 74 of them the AC-01 permission matrix):
outside AC-01 the session drafted 49 cases where the team designed 36, often splitting one requirement by
condition. The team's suite is broader on permissions; the drafts are broader on state transitions and money
relations. 23 drafts are marked manual with a reason (time passing, email, shared data), 29 UI, 1 API.

**The observability check over-flags.** About half of its 20 flags are fair (an expected value the sources do not
give, such as a tier price or the exact required-field message). The other half are false positives on absence and
relations: "No edit action is offered", "No reminder task exists", "Closing balance = opening + receipts −
expenses". The check is lexical; teaching it absence and arithmetic relations is a follow-up, not done here so the
drafts are not tuned to the checker.
