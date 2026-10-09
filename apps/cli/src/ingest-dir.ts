import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@qa/db';
import type { Actor } from '@qa/domain';
import { ingestSource, parseSourceFile, type IngestResult } from '@qa/retrieval';

/** Ingests every .md/.json file in `dir` (sorted, non-recursive). */
export async function ingestDirectory(db: Db, actor: Actor, dir: string): Promise<IngestResult[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md') || f.endsWith('.json')).sort();
  const results: IngestResult[] = [];
  for (const file of files) {
    const doc = parseSourceFile(file, await readFile(join(dir, file), 'utf8'));
    results.push(await ingestSource(db, actor, doc));
  }
  return results;
}
