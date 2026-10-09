/**
 * Port for vector embeddings (ADR-0005). The MVP ranks with full text + exact identifiers
 * and has no implementation; `knowledge_chunks.embedding vector(1024)` is reserved for it.
 */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
