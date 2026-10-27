import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionExchangeProvider } from '../src/index.ts';

const story = {
  externalId: 'S-1',
  title: 'Lockout',
  description: 'd',
  acceptanceCriteria: [{ id: 'AC-1', text: 'After 5 failed logins the account locks for 15 minutes.' }],
};
const source = {
  sourceId: 'AC-LOGIN',
  version: 'v2',
  chunkId: 'c1',
  content: 'AC-1\nAfter 5 failed logins the account is locked for 15 minutes.',
  trustTier: 'T1' as const,
  relevance: 1,
};
const step = {
  action: 'Fail 5 times',
  expected: 'HTTP 423 ACCOUNT_LOCKED',
  sourceRefs: ['AC-LOGIN@v2'],
  testData: 'wrong x5',
  evidence: '',
};
const kase = {
  title: 'Locks at 5',
  priority: 'P1',
  preconditions: [],
  testData: [],
  steps: [step],
  assumptions: [],
  missingRequirements: [],
  requirementRefs: ['story:AC-1'],
  techniques: ['boundary_value_analysis'],
  testTypes: ['boundary'],
  testConditions: ['5 failures'],
  module: 'Sign-in',
  level: 'api',
  manualReason: '',
};

let dir: string;
let p: SessionExchangeProvider;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qa-session-'));
  p = new SessionExchangeProvider({ dir, modelLabel: 'claude-opus-5-5 (interactive session)' });
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const answer = async (kind: string, body: unknown) => {
  const req = (await readdir(dir)).find((f) => f.startsWith(kind) && f.endsWith('.request.json'))!;
  await writeFile(join(dir, req.replace('.request.json', '.answer.json')), JSON.stringify(body));
  return req;
};

describe('SessionExchangeProvider (ADR-0020)', () => {
  it('writes the exact prompt as a request and fails UNAVAILABLE until an answer exists', async () => {
    const out = await p.classify({ story, sources: [source] });
    expect(out).toMatchObject({
      ok: false,
      failure: 'UNAVAILABLE',
      meta: { provider: 'claude-code-session', model: null },
    });
    const req = JSON.parse(await readFile(join(dir, (await readdir(dir))[0]!), 'utf8'));
    expect(req).toMatchObject({ kind: 'readiness', promptVersion: 'readiness-v2' });
    expect(req.system).toContain('You assess whether a user story is ready');
    expect(req.user).toContain('<untrusted_data>');
  });

  it('replays an answer through the same schema and grounding checks as any provider', async () => {
    await answer('readiness', {
      readiness: 'ready',
      missingExpectations: [],
      clarificationQuestion: null,
      citedSourceIds: ['AC-LOGIN@v2'],
      draftableClauses: [],
    });
    const ready = await p.classify({ story, sources: [source] });
    expect(ready).toMatchObject({
      ok: true,
      value: { readiness: 'ready', confidence: null },
      meta: { model: 'claude-opus-5-5 (interactive session)' },
    });

    expect((await p.generate({ story, sources: [source] })).ok).toBe(false);
    await answer('draft', { designNotes: ['boundary at 5'], cases: [kase] });
    const drafted = await p.generate({ story, sources: [source] });
    expect(drafted.ok && drafted.value.cases[0]).toMatchObject({ title: 'Locks at 5' });
    // The only flags are the ADR-0023 "no quoted evidence" ones: the answer carries no quotes.
    expect(
      drafted.ok && drafted.value.cases[0]!.reviewFlags.every((f) => f.includes('no quoted evidence')),
    ).toBe(true);
  });

  it('rejects an answer that breaks the schema or cites a source that was not supplied', async () => {
    const other = { ...story, externalId: 'S-2', acceptanceCriteria: [{ id: 'AC-2', text: 'x 5' }] };
    await p.generate({ story: other, sources: [source] });
    const files = (await readdir(dir)).filter((f) => f.endsWith('.request.json'));
    const reqs = await Promise.all(
      files.map(async (f) => ({ f, r: JSON.parse(await readFile(join(dir, f), 'utf8')) })),
    );
    const mine = reqs.find((x) => x.r.kind === 'draft' && x.r.user.includes('AC-2'))!;
    await writeFile(
      join(dir, mine.f.replace('.request.json', '.answer.json')),
      JSON.stringify({ designNotes: [], cases: [] }),
    );
    expect(await p.generate({ story: other, sources: [source] })).toMatchObject({ failure: 'MALFORMED' });
    await writeFile(
      join(dir, mine.f.replace('.request.json', '.answer.json')),
      JSON.stringify({
        designNotes: [],
        cases: [
          { ...kase, requirementRefs: ['story:AC-2'], steps: [{ ...step, sourceRefs: ['MADE-UP@v1'] }] },
        ],
      }),
    );
    expect(await p.generate({ story: other, sources: [source] })).toMatchObject({ failure: 'UNGROUNDED' });
  });
});
