import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { DomainError, type TenantScope } from '@qa/domain';

export type StoredObject = { objectKey: string; digest: string; sizeBytes: number };

/**
 * Evidence lives outside prompts and outside the database (docs/09): screenshots, step logs and
 * network summaries are stored by key; the database keeps pointers, digests and retention.
 */
export interface EvidenceStore {
  put(objectKey: string, data: Uint8Array | string): Promise<StoredObject>;
  get(objectKey: string): Promise<Buffer | null>;
  delete(objectKey: string): Promise<void>;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

/** `tenant/project/run/name`; every segment is validated so keys cannot traverse directories. */
export function evidenceKey(scope: TenantScope, runId: string, name: string): string {
  const segments = [scope.tenantId, scope.projectId, runId, name];
  for (const s of segments) {
    if (!SAFE_SEGMENT.test(s) || s === '.' || s === '..') {
      throw new DomainError('VALIDATION', `unsafe evidence key segment "${s}"`);
    }
  }
  return segments.join('/');
}

export function sha256Bytes(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Local-disk store for development and single-node pilots. Use an S3-compatible store in production. */
export class LocalEvidenceStore implements EvidenceStore {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathFor(objectKey: string): string {
    const full = resolve(join(this.root, objectKey));
    if (!full.startsWith(this.root + sep))
      throw new DomainError('VALIDATION', 'evidence key escapes the store root');
    return full;
  }

  async put(objectKey: string, data: Uint8Array | string): Promise<StoredObject> {
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true });
    // Evidence is immutable: never overwrite an existing object.
    await writeFile(path, data, { flag: 'wx' });
    const sizeBytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    return { objectKey, digest: sha256Bytes(data), sizeBytes };
  }

  async get(objectKey: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(objectKey));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.pathFor(objectKey), { force: true });
  }
}

/** `QA_EVIDENCE_DIR` (default `.evidence`, git-ignored). */
export function createEvidenceStoreFromEnv(env: NodeJS.ProcessEnv = process.env): EvidenceStore {
  return new LocalEvidenceStore(env.QA_EVIDENCE_DIR || '.evidence');
}
