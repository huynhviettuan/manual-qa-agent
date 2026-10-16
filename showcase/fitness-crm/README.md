# Gym CRM showcase

The agent tested the Gym CRM sample (`D:\fitness-crm`, fictional *Demo Gym* data). Plan and decisions: [PLAN.md](PLAN.md). Report: [results/report.html](results/report.html), published privately at https://claude.ai/artifact/5NU9478WKjcSdzTi3wzmKN.

| Path | Contents |
| --- | --- |
| `build-sources.ts` | Turns the Gym CRM docs into agent sources (one block per BR rule, AC and permission row) and one story per acceptance criterion |
| `sources/`, `stories/` | Generated from the Gym CRM docs, word for word |
| `stories-followup/` | Stories a QA engineer split after the agent asked for it (AC-01 part 1) |
| `suite-definition.ts` | The 30-case regression suite: requirement, steps and, for 20 cases, executable steps written against the real UI (manual cases record why) |
| `baseline.json` | Your team's manual numbers used by the agent-versus-manual analysis |
| `findings.json` | What the showcase found, in the agent and in Gym CRM |
| `run-showcase.ts` | Requirements review, case drafting and approval, the suite (created, run twice), safety gates and triage; writes `results/` |
| `build-report.ts` | Renders `results/report.html`; screenshots in `results/evidence/` are published with the report, not committed |

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
