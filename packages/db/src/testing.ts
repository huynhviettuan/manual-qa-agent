import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Actor, Role, TenantScope } from '@qa/domain';
import { createPgDb, createPgliteDb, type Db } from './db.ts';
import { migrate } from './migrations.ts';
import { createActor, createApiKey, createProject, upsertEnvironment } from './repos.ts';

/**
 * Fresh, migrated database for a test file: in-memory PGlite by default, or a throwaway database
 * on the PostgreSQL server at `QA_TEST_DATABASE_URL` (created here, dropped on close).
 */
export async function createTestDb(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  const db = env.QA_TEST_DATABASE_URL
    ? await createThrowawayPgDb(env.QA_TEST_DATABASE_URL)
    : await createPgliteDb();
  await migrate(db);
  return db;
}

async function onServer(serverUrl: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function createThrowawayPgDb(serverUrl: string): Promise<Db> {
  // Generated identifier (hex only), so interpolating it into DDL is safe.
  const name = `qa_test_${randomUUID().replaceAll('-', '')}`;
  await onServer(serverUrl, `CREATE DATABASE ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const db = createPgDb(url.toString());
  return {
    ...db,
    async close() {
      await db.close();
      await onServer(serverUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
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
