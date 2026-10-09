# ADR-0002 — Only approved sources become trusted RAG knowledge

- **Status:** Proposed
- **Date:** 2026-10-09

## Context

Agent output and bug histories can be wrong. A feedback loop that automatically writes unreviewed answers into the retrieval index can amplify hallucinations and stale rules.

## Decision

Trust tier T1 includes approved, versioned requirements, test cases and authoritative clarifications. Every indexed chunk maintains exact source/provenance, project ACL and effective version. Unreviewed LLM outputs never become authoritative knowledge automatically. Contradictory or superseded sources require explicit handling.

## Consequences

- More reviewer/source-owner work when adding knowledge.
- Stronger auditability and lower risk of self-reinforcing incorrect answers.
- Requires reindex/revocation procedures and retrieval authorization tests.

## Revisit when

There is a formally evaluated auto-approval mechanism accepted by source owners and governance team; never solely based on confidence.
