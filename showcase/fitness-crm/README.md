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
| Cases the observability check flagged | — | 2 of 53 (20 before ADR-0022); every case also carries "no quoted evidence" flags since ADR-0023, as the draft-v5 prompt asks for no quotes |

**The clarifications are real gaps in the Gym CRM documents.** For example: AC-13 says the trash is "viewable only
by management", but the seeded roles keep it from the Fitness Manager (Admin only); AC-27 locks an overdue step
"past its grace period" without saying how long that is; AC-08, AC-18 and AC-22 compare with Excel or GymMaster
files that are not among the sources. The team's designed suite has cases on 9 of these 10 criteria, written
against today's behaviour rather than a stated rule.

**Against the team's cases, condition by condition** (ADR-0022). `npx tsx showcase/fitness-crm/compare.ts` checks
and counts the pairing in [`comparison/condition-map.json`](comparison/condition-map.json): the team's cases on each
criterion grouped by the condition they test (AC-01's 60 page-access cases are one condition with 30 data rows), and
each agent case placed against them. The pairing itself is a judgement, made by Claude in the session from the case
titles and the criterion text, and recorded with that label; the script only checks that every case is placed
exactly once. Results are in `results/comparison.json`.

| On the 20 drafted criteria | |
| --- | ---: |
| Team conditions (110 cases) | 36 |
| Covered by an agent case | 25 |
| Covered in part (AC-01: one refusal against the team's 30 pages × allowed and refused) | 1 |
| Missed | 10, of which 1 written in the criterion (AC-15's status colours) |
| Conditions the agent tested that the team did not file under the criterion | 23, of which 20 written in the criterion |

The ten misses are where people are strong: boundaries beyond the stated range (0 and non-numeric session counts,
1/150/151-character names), the other column of a decision table (a choice other than "Khác" needs no note), and
adjacent permission layers (signed-out access, actions inside a module, the API). The 20 extras written in the
criterion are clauses the team left without a case under that criterion id, for example AC-15's consumption rules
and booking refusals, AC-11 entirely, AC-05's "no effect until approved". The team may test some of them under
another requirement id; this comparison counts only cases filed under the same criterion.

**On the 10 criteria the agent asked about**, the team has 13 cases. 7 of them restate the gap the agent asked
about as their expected result ("Same counts and rates", "Locked after the grace period" with no length, "Usable
without sideways scrolling"), and 6 test a clear clause of the same criterion. That pointed at the agent's
weakness: it routed a whole criterion to a question, so 11 clear clauses in 7 criteria were not drafted. Since
ADR-0024 the readiness answer quotes the clauses that are clear and the workflow drafts them while the question is
open: on the replay those 7 criteria carry 11 cases (AC-06 1, AC-07 2, AC-13 2, AC-18 1, AC-21 1, AC-27 1, AC-29 3,
for example "A scan with no booking is an error"), and the 3 criteria that are wholly a data question (AC-08,
AC-22, AC-23) have none. The pairing in `comparison/condition-map.json` still lists those clauses under
`clearClausesNotDrafted`, as the record of the first run.

**The observability check** (after ADR-0022). The first run flagged 20 of 53 cases (23 flags). Going flag by flag,
2 leave the value unnamed ("The tier list shows the new unit price", "Both totals are shown"); 4 more name a state
the documents do not spell out ("marked required"); the rest were absences ("No edit action is offered"),
relations ("equals the new tier price", "closing = opening + receipts − expenses") and recipients ("goes to Admin").
The check now knows absences, relations and those states, and the replay flags 2 cases, exactly the 2 above. The
check was tuned on these same drafts, so this shows it handles these shapes, not its rate on drafts it has not
seen. Measured afterwards on a held-out set (the Flow Fitness team's 983 expected results, ADR-0023) it flags
16 %, nearly all falsely: see [showcase/flow-fitness](../flow-fitness/README.md).

**Spot-check.** `compare.ts` writes [`comparison/spot-check.json`](comparison/spot-check.json): 9 of the 36
conditions (every fourth) for a person to mark `agree` or not. It is empty until someone fills it in; the
comparison above should be read as unchecked until then.
