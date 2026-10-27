import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProvidersFromEnv, SESSION_PROVIDER } from '../src/index.ts';

// ADR-0026: the two ways to a real model are chosen by one variable. `session` needs no key and
// no network: every call becomes a request file for a person in a Claude Code session to answer.

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qa-session-mode-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const story = {
  externalId: 'S-1',
  title: 'Lockout',
  description: '',
  acceptanceCriteria: [{ id: 'AC-1', text: 'The account locks after 5 failed attempts' }],
};

describe('QA_LLM_PROVIDER=session', () => {
  it('routes readiness, drafts and executables to the exchange directory and needs no key', async () => {
    const p = createProvidersFromEnv({ QA_LLM_PROVIDER: 'session', QA_SESSION_EXCHANGE_DIR: dir });
    expect(p).toMatchObject({
      mode: 'session',
      live: false,
      providers: { readiness: 'session', draft: 'session' },
    });
    expect(p.executables).not.toBeNull();
    const out = await p.classifier.classify({ story, sources: [] });
    expect(out).toMatchObject({ ok: false, failure: 'UNAVAILABLE', meta: { provider: SESSION_PROVIDER } });
    expect((await readdir(dir)).some((f) => f.startsWith('readiness-') && f.endsWith('.request.json'))).toBe(
      true,
    );
  });

  it('the key mode is the default, and its mock stands in without QA_LIVE_LLM', () => {
    expect(createProvidersFromEnv({})).toMatchObject({ mode: 'mock', live: false });
    expect(createProvidersFromEnv({ QA_LIVE_LLM: '1', ANTHROPIC_API_KEY: 'sk-test' })).toMatchObject({
      mode: 'api-key',
      live: true,
    });
    expect(() => createProvidersFromEnv({ QA_LLM_PROVIDER: 'nope' })).toThrow(/QA_LLM_PROVIDER/);
  });
});
