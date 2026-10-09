import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import pg from 'pg';

/** Minimal database port shared by the PostgreSQL pool and embedded PGlite. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run multi-statement SQL without parameters (migrations). */
  exec(sql: string): Promise<void>;
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

type PgliteLike = Pick<PGlite, 'query' | 'exec'>;

function pgliteDb(pglite: PgliteLike, root: PGlite | null): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pglite.query<T>(sql, params);
      return res.rows;
    },
    async exec(sql) {
      await pglite.exec(sql);
    },
    async transaction(fn) {
      // Nested transactions run inside the outer one.
      if (!root) return fn(this);
      return root.transaction((tx) => fn(pgliteDb(tx, null)));
    },
    async close() {
      await root?.close();
    },
  };
}

/** Embedded PostgreSQL (WASM) with pgvector. `dataDir` undefined = in-memory (tests). */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const pglite = await PGlite.create(dataDir, { extensions: { vector } });
  return pgliteDb(pglite, pglite);
}

function clientDb(client: pg.PoolClient): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await client.query(sql);
    },
    async transaction(fn) {
      return fn(this);
    },
    async close() {},
  };
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(clientDb(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/** `DATABASE_URL` -> PostgreSQL; otherwise an on-disk PGlite database for local development. */
export async function createDbFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  return env.DATABASE_URL ? createPgDb(env.DATABASE_URL) : createPgliteDb(env.QA_PGLITE_DIR ?? '.pglite');
}
