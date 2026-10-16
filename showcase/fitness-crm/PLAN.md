# Showcase plan: the agent on Gym CRM

**Status:** keyless run done 2026-10-16 (live Claude run pending) · approved 2026-10-16 · Target: `D:\fitness-crm` (Gym CRM sample, fictional *Demo Gym* data)

Goal: an honest, reproducible demo of the agent on a real product. It covers requirement readiness, cited test drafts, browser runs with evidence, triage and the safety gates. Every result is what the agent actually produced; nothing is staged unless the report labels it as staged.

## Decisions

| Question | Decision |
| --- | --- |
| Target | A **separate Gym CRM instance**: its own Postgres container and ports, seeded with `pnpm db:seed:demo`, thrown away afterwards. The dev app on ports 3000/4000, its database and the fitness-crm repo are not touched. |
| AI provider | **Live Claude** (`QA_LIVE_LLM=1`, billed). The keyless stand-in is used only while building and debugging. |
| Report | A **private claude.ai page**, plus the reproducible files in this folder and a link from the README. |

## Steps

1. **Instance:** start a separate copy of Gym CRM, seed the demo data, and register it as the `staging` environment, allowlisting only its hosts.
2. **Sources and stories:** wrap the relevant parts of the Gym CRM `docs/05_BUSINESS_RULES.md`, `14_ACCEPTANCE_CRITERIA.md` and `09_RBAC.md` as approved sources in `sources/`, keeping the BR/AC IDs. Write one story per acceptance criterion in `stories/`.
3. **Readiness report:** run all 30 acceptance criteria through readiness. Each gets a cited draft or a concrete clarification question.
4. **Browser runs:** run 4–6 ready, deterministic criteria. Candidates: AC-01 (permissions), AC-04 ("Khác" needs a note), AC-25 (minimal lead), AC-11 (locked contract), AC-15 (booking refused). Tests sign in through the UI with `{ "secret": "GYM_PASSWORD" }`, and a QA lead approves each executable (second-person rule).
5. **Triage and safety gates:**
   - Triage a genuine failure if one occurs. No bugs are planted in the product. Otherwise, triage one clearly labeled staged failure: a wrong expectation (test issue) or the API stopped mid-run (environment issue).
   - Show a destructive spec that is `BLOCKED` until approved, a production environment that is denied, and an unregistered host that is blocked.
6. **Deliverables:** this folder with sources, stories, specs and a one-command runner script; the showcase report (readiness table, drafts with citations, verdicts and screenshots, triage, safety gates, audit trail and costs); and a Showcase section in the README.

## Risks

- **Unsupported controls:** Gym CRM may use controls (custom dropdowns, date pickers) that the existing step types don't cover. ADR-0008 forbids adding a step type without validation and tests. Either pick criteria that fit, or propose the new step type before adding it.
- **Model quality:** readiness verdicts and drafts are only as good as the model. The report shows them as they came out, without correcting them by hand.
