import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', DB_PATH: ':memory:' },
    include: ['tests/**/*.test.js'],
    testTimeout: 20000,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/db/seed.js', 'src/server.js'] },
  },
});
