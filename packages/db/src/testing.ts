import type { Actor, Role, TenantScope } from '@qa/domain';
import { createPgliteDb, type Db } from './db.ts';
import { migrate } from './migrations.ts';
import { createActor, createApiKey, createProject, upsertEnvironment } from './repos.ts';

/** Fresh in-memory, migrated database for a test file. */
export async function createTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db);
  return db;
}

export const DEFAULT_ROLES = {
  qa: ['QA_ENGINEER'],
  lead: ['QA_LEAD'],
  po: ['PRODUCT_OWNER'],
  admin: ['ADMIN'],
  agent: ['AI_AGENT'],
} satisfies Record<string, Role[]>;

export type SeededActors = Record<keyof typeof DEFAULT_ROLES, Actor>;

/**
 * Seeds a project with one actor per default role and a staging + production environment.
 * Actor ids are `<projectId>-<role key>`; API keys are `key-<actor id>` (test/dev only).
 */
export async function seedProject(db: Db, scope: TenantScope): Promise<SeededActors> {
  await createProject(db, scope, scope.projectId);
  await upsertEnvironment(db, scope, {
    id: 'staging',
    kind: 'staging',
    allowedActions: ['draft', 'execute'],
  });
  await upsertEnvironment(db, scope, { id: 'production', kind: 'production', allowedActions: ['draft'] });
  const actors = {} as SeededActors;
  for (const [key, roles] of Object.entries(DEFAULT_ROLES) as Array<[keyof SeededActors, Role[]]>) {
    const id = `${scope.projectId}-${key}`;
    await createActor(db, scope, { id, name: id, roles });
    await createApiKey(db, id, `key-${id}`);
    actors[key] = { id, tenantId: scope.tenantId, projectId: scope.projectId, roles };
  }
  return actors;
}
