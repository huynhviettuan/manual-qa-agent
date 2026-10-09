import { createDbFromEnv, migrate } from '@qa/db';
import { createProvidersFromEnv } from '@qa/llm-adapter';
import { createLogger } from '@qa/observability';
import { minReadyConfidenceFromEnv } from '@qa/orchestrator';
import { buildApp } from './app.ts';

const logger = createLogger({ name: 'qa-api' });
const db = await createDbFromEnv();
await migrate(db);
const providers = createProvidersFromEnv();
logger.info(
  { providers: providers.providers, live: providers.live, models: providers.models },
  providers.live ? 'AI provider: LIVE (billed)' : 'AI provider: mock heuristic (no network)',
);

const app = await buildApp({
  deps: {
    db,
    classifier: providers.classifier,
    generator: providers.generator,
    minReadyConfidence: minReadyConfidenceFromEnv(),
  },
  logger,
});
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => db.close())
      .then(() => process.exit(0));
  });
}
