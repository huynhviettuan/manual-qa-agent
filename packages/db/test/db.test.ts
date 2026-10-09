import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrGetWorkflow,
  createTestDb,
  findActorByApiKey,
  getStory,
  insertStoryVersion,
  migrate,
  seedProject,
  type Db,
} from '../src/index.ts';

const A = { tenantId: 'tenant-a', projectId: 'proj-a' };
const B = { tenantId: 'tenant-b', projectId: 'proj-b' };

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  await seedProject(db, A);
  await seedProject(db, B);
});
afterAll(() => db.close());

describe('migrations', () => {
  it('are idempotent', async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('a story created in one tenant is invisible to another', async () => {
    const story = await insertStoryVersion(db, A, {
      externalId: 'LOGIN-1',
      title: 't',
      description: 'd',
      acceptanceCriteria: [{ id: 'AC-1', text: 'x' }],
      targetRelease: null,
      createdBy: 'proj-a-qa',
    });
    expect(await getStory(db, A, story.id)).not.toBeNull();
    expect(await getStory(db, B, story.id)).toBeNull();
    expect(await getStory(db, { tenantId: A.tenantId, projectId: B.projectId }, story.id)).toBeNull();
  });
});

describe('stories', () => {
  it('are versioned immutably; resubmitting identical content returns the same version', async () => {
    const base = {
      externalId: 'LOGIN-2',
      title: 't',
      description: 'd',
      acceptanceCriteria: [{ id: 'AC-1', text: 'x' }],
      targetRelease: null,
      createdBy: 'proj-a-qa',
    };
    const v1 = await insertStoryVersion(db, A, base);
    const again = await insertStoryVersion(db, A, base);
    const v2 = await insertStoryVersion(db, A, { ...base, description: 'changed' });
    expect(v1.version).toBe(1);
    expect(again.id).toBe(v1.id);
    expect(v2.version).toBe(2);
    expect((await getStory(db, A, v1.id))?.description).toBe('d');
  });
});

describe('workflows', () => {
  it('duplicate idempotency key returns the existing workflow', async () => {
    const w = {
      kind: 'STORY_READINESS',
      storyId: null,
      correlationId: 'c1',
      idempotencyKey: 'k1',
      actorId: 'proj-a-qa',
    };
    const first = await createOrGetWorkflow(db, A, w);
    const second = await createOrGetWorkflow(db, A, { ...w, correlationId: 'c2' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.workflow.id).toBe(first.workflow.id);
    // Same key in another tenant is a different workflow.
    expect((await createOrGetWorkflow(db, B, w)).created).toBe(true);
  });
});

describe('api keys', () => {
  it('resolve to the actor with database roles; unknown keys resolve to nothing', async () => {
    const actor = await findActorByApiKey(db, 'key-proj-a-lead');
    expect(actor).toMatchObject({ id: 'proj-a-lead', tenantId: 'tenant-a', roles: ['QA_LEAD'] });
    expect(await findActorByApiKey(db, 'nope')).toBeNull();
  });
});
