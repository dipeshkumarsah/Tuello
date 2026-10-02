import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Worker jobs against PostgreSQL, Valkey and Mailpit in Testcontainers. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
