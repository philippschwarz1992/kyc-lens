#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Budgets sit about 10% above the sizes measured for 0.1.0 (30,634 B, 205 B and 53,943,577 B).
// Raise them deliberately, with the reason in the commit message.
const budgets = {
  'dist/index.js (gzip)': 33_700,
  'dist/core/index.js (gzip)': 230,
  'npm pack tarball': 59_340_000,
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gzipSize = async path => gzipSync(await readFile(resolve(root, path)), { level: 9 }).length;

function packedSize() {
  // npm supplies its CLI path to npm scripts; the sibling path covers direct Node invocation.
  const cli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const result = spawnSync(process.execPath, [cli, 'pack', '--ignore-scripts', '--dry-run', '--json'], {
    cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm pack failed:\n${result.stderr}`);
  return JSON.parse(result.stdout)[0].size;
}

const format = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
const measured = {
  'dist/index.js (gzip)': await gzipSize('dist/index.js'),
  'dist/core/index.js (gzip)': await gzipSize('dist/core/index.js'),
  'npm pack tarball': packedSize(),
};
let failed = false;
for (const [name, bytes] of Object.entries(measured)) {
  const budget = budgets[name];
  const over = bytes > budget;
  failed ||= over;
  process.stdout.write(`${over ? 'FAIL' : 'ok  '} ${name}: ${format(bytes)} (${bytes} B) / budget ${format(budget)} (${budget} B)\n`);
}
if (failed) {
  process.stderr.write('Size budget exceeded. Reduce the output or raise the budget in scripts/check-size.mjs with a reason.\n');
  process.exitCode = 1;
}
