import { defineConfig } from 'vitest/config';
// Route and delivery logic is tested against in-memory stores; Workers bindings are exercised with `wrangler dev`.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
