#!/usr/bin/env node
// Serves the SDK's runtime assets from public/kyc-assets.
// Default: models, WASM and licences only (the dev server loads workers from SDK source); existing files are kept.
// --full: the packaged layout including built workers, via the SDK's own copy command (needs `npm run build`).
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = resolve(app, '../../packages/sdk');
const target = resolve(app, 'public/kyc-assets');
if (!existsSync(resolve(sdk, 'assets/face_landmarker.task'))) {
  process.stderr.write('SDK assets are missing. Run `npm run setup` at the repository root first.\n');
  process.exit(1);
}
if (process.argv.includes('--full')) {
  await rm(target, { recursive: true, force: true });
  const result = spawnSync(process.execPath, [resolve(sdk, 'scripts/copy-assets.mjs'), target], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
await mkdir(target, { recursive: true });
await cp(resolve(sdk, 'assets'), target, { recursive: true });
