import { hostname } from 'node:os';
import { createDbFromEnv, migrate } from '@qa/db';
import { createEvidenceStoreFromEnv } from '@qa/evidence';
import { envSecretResolver, PlaywrightExecutor } from '@qa/execution';
import { createLogger } from '@qa/observability';
import { runWorkerLoop } from '@qa/orchestrator';

/**
 * Executes QUEUED test runs one at a time (concurrency 1 keeps shared test data predictable).
 * Env: DATABASE_URL (PostgreSQL; embedded PGlite is single-process, see README), QA_EVIDENCE_DIR,
 * QA_SECRET_<NAME>, QA_BROWSER_CHANNEL, QA_WORKER_IDLE_MS, QA_WORKER_ONCE=1 (drain and exit).
 * Kill switch: QA_EXECUTION_ENABLED=0 (docs/09 incident response).
 */
const logger = createLogger({ name: 'qa-worker' });
if (process.env.QA_EXECUTION_ENABLED === '0') {
  logger.warn('execution disabled by QA_EXECUTION_ENABLED=0; exiting');
  process.exit(0);
}

const db = await createDbFromEnv();
await migrate(db);
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());

const workerId = `${hostname()}-${process.pid}`;
logger.info({ workerId }, 'worker started');
await runWorkerLoop(
  {
    db,
    executor: new PlaywrightExecutor({ channel: process.env.QA_BROWSER_CHANNEL || undefined }),
    store: createEvidenceStoreFromEnv(),
    secrets: envSecretResolver(),
    logger,
  },
  {
    workerId,
    idleMs: Number(process.env.QA_WORKER_IDLE_MS ?? 2000),
    once: process.env.QA_WORKER_ONCE === '1',
    signal: controller.signal,
  },
);
await db.close();
logger.info('worker stopped');
