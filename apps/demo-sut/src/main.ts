import { createDemoApp } from './index.ts';

// Local demo system under test (never deploy). The demo password comes from QA_SECRET_DEMO_PASSWORD,
// the same secret executable specs reference as { "secret": "DEMO_PASSWORD" }.
const password = process.env.QA_SECRET_DEMO_PASSWORD;
if (!password) {
  console.error('Set QA_SECRET_DEMO_PASSWORD to start the demo app.');
  process.exit(1);
}
const port = Number(process.env.DEMO_PORT ?? 4000);
const app = createDemoApp({
  user: { email: 'qa@example.test', password, name: 'QA Tester' },
  bugUserNotFoundMessage: process.env.DEMO_BUG_1042 === '1',
});
await app.listen({ port, host: '127.0.0.1' });
console.error(`demo app on http://127.0.0.1:${port}`);
