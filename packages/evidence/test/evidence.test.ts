import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evidenceKey, LocalEvidenceStore, sha256Bytes } from '../src/index.ts';

let dir: string;
let store: LocalEvidenceStore;
const scope = { tenantId: 't', projectId: 'p' };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qa-evidence-'));
  store = new LocalEvidenceStore(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('LocalEvidenceStore', () => {
  it('stores objects with a digest and reads them back', async () => {
    const key = evidenceKey(scope, 'run_1', 'steps.json');
    const stored = await store.put(key, '{"ok":true}');
    expect(stored).toEqual({
      objectKey: 't/p/run_1/steps.json',
      digest: sha256Bytes('{"ok":true}'),
      sizeBytes: 11,
    });
    expect((await store.get(key))?.toString()).toBe('{"ok":true}');
    expect(await store.get(evidenceKey(scope, 'run_1', 'missing.png'))).toBeNull();
  });

  it('never overwrites existing evidence', async () => {
    const key = evidenceKey(scope, 'run_2', 'shot.png');
    await store.put(key, new Uint8Array([1, 2, 3]));
    await expect(store.put(key, new Uint8Array([9]))).rejects.toThrow();
    expect([...(await store.get(key))!]).toEqual([1, 2, 3]);
  });

  it.each([['..'], ['a/b'], ['..\\x'], ['']])('rejects unsafe key segment %j', (seg) => {
    expect(() => evidenceKey(scope, seg, 'x.json')).toThrow(/unsafe/);
  });

  it('rejects raw keys that escape the root', async () => {
    await expect(store.put('../outside.txt', 'x')).rejects.toThrow(/escapes/);
  });
});
