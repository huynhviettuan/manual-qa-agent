# ADR-0001 — Start with a modular monolith

- **Status:** Proposed
- **Date:** 2026-10-09

## Context

RAG, Decisions API, agent orchestration, execution and reviews are logically distinct. Deploying each one separately too early increases integration, deployment and observability cost. The existing agent implementation is not yet inventoried.

## Decision

Start with modular boundaries in one TypeScript repository and a small number of deployables (API + optional worker). Define stable interfaces for AI providers, retrieval, policy, execution and review. Use PostgreSQL with pgvector initially unless discovery shows constraints.

## Consequences

- Easier to develop/evaluate a vertical slice; fewer distributed failure modes.
- Clear packages allow later independent scaling if metrics justify it.
- Requires discipline to enforce architecture boundaries and avoid a monolithic orchestration class.

## Revisit when

Distinct scaling, isolation, language/runtime or regulatory requirements are demonstrated.
