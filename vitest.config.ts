import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // PGlite instances are per test file; keep files isolated.
    pool: 'forks',
    testTimeout: 30_000,
  },
});
