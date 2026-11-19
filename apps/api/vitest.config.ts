import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Tests share one PostgreSQL test database, so files run sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/payments_test',
      EMAIL_PROVIDER: 'memory',
      WEBHOOK_ALLOW_PRIVATE_URLS: 'true',
      LOG_LEVEL: 'silent',
    },
  },
});
