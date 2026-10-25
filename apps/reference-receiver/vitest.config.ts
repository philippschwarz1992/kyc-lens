import { defineConfig } from 'vitest/config';
// Receiver logic is tested against in-memory stores; D1 and R2 are exercised with `wrangler dev`.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
