# ADR-0005 — Full-text and exact-ID retrieval first; vector ranking later

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Docs/04 proposes hybrid lexical + vector retrieval. The chosen AI provider (Anthropic) has no embeddings API. Adding an embeddings vendor or a local model now would mean a second data processor or a heavy dependency, before any retrieval eval exists. Business rules are best matched by exact identifiers (AC IDs, rule numbers, endpoint paths), which vectors handle poorly.

## Decision

- MVP retrieval = metadata filters (tenant, project, approved, not revoked, effective version), then exact-identifier matching, then PostgreSQL full-text ranking (`tsvector` / `ts_rank`).
- Create the `pgvector` extension, a nullable `embedding` column on `knowledge_chunks`, and an `EmbeddingProvider` interface now, but leave vector ranking switched off.
- Turn on vector ranking in a later issue, only after retrieval evals show a recall@k gap that full text does not close.

## Consequences

- No extra vendor; requirements text is sent only to the generation provider.
- Paraphrased queries may have lower recall. The eval harness measures this.
- The schema is ready for embeddings, so enabling them needs no migration of existing rows beyond backfill.

## Revisit when

Retrieval recall@k on the pilot eval set is below the threshold agreed by the QA lead.
