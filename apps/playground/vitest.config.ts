import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@sdk': fileURLToPath(new URL('../../packages/sdk/src', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
