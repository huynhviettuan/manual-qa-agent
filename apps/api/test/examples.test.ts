import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, seedProject, upsertEnvironment, type Db, type SeededActors } from '@qa/db';
import {
  ClaudeProvider,
  createAnthropicClient,
  createFakeAnthropicFetch,
  heuristicResponder,
} from '@qa/llm-adapter';
import { ingestDirectory } from '@qa/retrieval';
import { buildApp } from '../src/app.ts';

// The README walkthrough sends the files in examples/ unchanged; this keeps them accepted by the API.
const root = new URL('../../../', import.meta.url);
const example = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`examples/${name}`, root), 'utf8'));

const S = { tenantId: 'local', projectId: 'pilot' };
let db: Db;
let app: FastifyInstance;
let a: SeededActors;

async function send(actor: keyof SeededActors, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-api-key': `key-${a[actor].id}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.json() };
}

/** Story -> draft -> approved case -> executable approved by a second person (README steps). */
async function approvedExecutable(story: string, executable: string) {
  const submitted = await send('qa', 'POST', '/api/stories', await example(story));
  expect(submitted.status).toBe(201);
  expect(submitted.body.outcome).toMatchObject({ route: 'DRAFT_CREATED', sourceRefs: ['AC-LOGIN@v1'] });
  const caseId: string = submitted.body.outcome.caseId;
  expect((await send('qa', 'POST', `/api/test-cases/${caseId}/review`, { decision: 'APPROVE' })).status).toBe(
    200,
  );
  const exe = await send('qa', 'POST', `/api/test-cases/${caseId}/executables`, await example(executable));
  expect(exe.status).toBe(201);
  expect(
    (await send('qa', 'POST', `/api/executables/${exe.body.id}/review`, { decision: 'APPROVE' })).status,
  ).toBe(403);
  expect(
    (await send('lead', 'POST', `/api/executables/${exe.body.id}/review`, { decision: 'APPROVE' })).status,
  ).toBe(200);
  return caseId;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  await ingestDirectory(db, a.po, fileURLToPath(new URL('eval/fixtures/sources', root)));
  await upsertEnvironment(db, S, {
    id: 'staging',
    kind: 'staging',
    allowedActions: ['draft', 'execute'],
    baseUrl: 'http://127.0.0.1:4000',
    allowedHosts: ['127.0.0.1:4000'],
  });
  const provider = new ClaudeProvider({
    client: createAnthropicClient({ apiKey: 'test', fetch: createFakeAnthropicFetch(heuristicResponder) }),
  });
  app = await buildApp({ deps: { db, classifier: provider, generator: provider }, rateLimitPerMinute: 1000 });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('README examples', () => {
  it('a vague story becomes a clarification; the product owner answer re-runs it into a draft', async () => {
    const submitted = await send('qa', 'POST', '/api/stories', await example('story-lockout-vague.json'));
    expect(submitted.body.outcome.route).toBe('REVIEW_REQUESTED');
    const queue = await send('po', 'GET', '/api/reviews');
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(submitted.body.outcome.reviewId);

    const answered = await send(
      'po',
      'POST',
      `/api/reviews/${submitted.body.outcome.reviewId}/resolve`,
      await example('answer-lockout-clarification.json'),
    );
    expect(answered.status).toBe(200);
    expect(answered.body.rerun.outcome).toMatchObject({ route: 'DRAFT_CREATED' });
    expect(answered.body.rerun.outcome.sourceRefs).toContain('CLAR-LOCKOUT@v1');
  });

  it('both login examples become approved executables and queue a run', async () => {
    const valid = await approvedExecutable('story-login-valid.json', 'executable-login-valid.json');
    await approvedExecutable('story-login-invalid.json', 'executable-login-invalid.json');
    const run = await send('qa', 'POST', '/api/test-runs', { caseId: valid, environmentId: 'staging' });
    expect(run.status).toBe(202);
    expect(run.body.status).toBe('QUEUED');
  });
});
