# ADR-0012 — Story submission stays with people

- **Status:** Accepted
- **Date:** 2026-10-16
- **Resolves:** OQ-13 · **Related:** ADR-0011 (agent tool server), docs/09 permission matrix

## Context

ADR-0011 gave AI assistants a propose-only tool server. The `AI_AGENT` role is not in the submitter roles, so the
assistant can't submit stories: it prepares them and a person submits. OQ-13 asked whether to change that.

Submitting a story is more than data entry. It starts readiness and drafting (model calls, cost), decides which
acceptance criteria the project tests, and is the input every later approval builds on. The security matrix allows
the AI to draft test cases "only with delegated access", and no delegated-access design exists yet.

## Decision

- `AI_AGENT` stays out of the story submitter roles; the tool server has no `submit_story` tool.
- Assistants prepare story JSON (one acceptance criterion per testable behavior, in the requirement's words) and the
  submit command; a person with a submitter role reviews and submits it.
- Revisit only together with a delegated-access design: an assistant acting for a named person, under that person's
  roles, with the delegation recorded on every action.

## Consequences

- The human step stays at the start of the pipeline, where scope is decided; drafting cost stays tied to a person's
  decision.
- An assistant-driven pipeline (sdet-skills `manual-qa-agent` / `automation-pipeline`) waits for a person at story
  submission as well as at the approval gates.
