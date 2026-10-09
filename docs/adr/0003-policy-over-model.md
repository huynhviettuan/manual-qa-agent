# ADR-0003 — Deterministic policy overrides AI recommendations

- **Status:** Proposed
- **Date:** 2026-10-09

## Context

Model outputs can be confidently wrong; a Decisions API response is not an authorization grant or a deterministic assertion. Browser tools may affect real data or accounts.

## Decision

The agent and Decisions API produce proposals only. A deterministic, versioned policy engine gates execution by RBAC, target environment, action type, scoped approval, source quality, expiry and cost limits. Objective assertions govern test run PASS/FAIL; uncertain evidence routes to human review.

## Consequences

- Clear accountability and offline testability.
- Additional implementation work on policy/approval state.
- More workflows halt safely rather than continuing with guesses.

## Revisit when

Never remove the permission gate; review individual policy specifics as capabilities and risk change.
