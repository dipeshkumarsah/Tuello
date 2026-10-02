import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Unit tests (src/**\/*.test.ts). Integration tests use vitest.integration.config.ts. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['src/**/*.test.ts'] },
});
