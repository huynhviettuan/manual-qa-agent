import { createDbFromEnv, migrate } from '@qa/db';
import { createEvidenceStoreFromEnv } from '@qa/evidence';
import { createProvidersFromEnv } from '@qa/llm-adapter';
import { createLogger } from '@qa/observability';
import { envSecretResolver, PlaywrightExecutor } from '@qa/execution';
import { createBugTrackerFromEnv } from '@qa/integrations';
import { decisionCacheTtlFromEnv, minReadyConfidenceFromEnv, runWorkerLoop } from '@qa/orchestrator';
import { buildApp } from './app.ts';

const logger = createLogger({ name: 'qa-api' });
const db = await createDbFromEnv();
await migrate(db);
const providers = createProvidersFromEnv();
logger.info(
  { providers: providers.providers, live: providers.live, models: providers.models },
  providers.live ? 'AI provider: LIVE (billed)' : 'AI provider: mock heuristic (no network)',
);

const evidenceStore = createEvidenceStoreFromEnv();
const tracker = createBugTrackerFromEnv();
const decisionCacheTtlMs = decisionCacheTtlFromEnv();
logger.info({ jira: tracker ? tracker.target : 'disabled', decisionCacheTtlMs }, 'integrations');
const app = await buildApp({
  deps: {
    db,
    classifier: providers.classifier,
    generator: providers.generator,
    minReadyConfidence: minReadyConfidenceFromEnv(),
    decisionCacheTtlMs,
  },
  evidenceStore,
  triager: providers.triager,
  tracker,
  logger,
});
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '127.0.0.1' });

// Single-process development mode (needed with embedded PGlite, which is single-process).
// Production runs the standalone worker against PostgreSQL.
const workerAbort = new AbortController();
if (process.env.QA_EMBEDDED_WORKER === '1' && process.env.QA_EXECUTION_ENABLED !== '0') {
  logger.warn('embedded worker enabled (development only)');
  void runWorkerLoop(
    {
      db,
      executor: new PlaywrightExecutor({ channel: process.env.QA_BROWSER_CHANNEL || undefined }),
      store: evidenceStore,
      secrets: envSecretResolver(),
      triager: providers.triager,
      decisionCacheTtlMs,
      logger,
    },
    { workerId: `api-embedded-${process.pid}`, idleMs: 1000, signal: workerAbort.signal },
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    workerAbort.abort();
    void app
      .close()
      .then(() => db.close())
      .then(() => process.exit(0));
  });
}
