#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchingModels } from './matching-assets.mjs';

// Development QA only. Install an actual tarball into a fresh application directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, '.cache'), { recursive: true });
const consumer = await mkdtemp(resolve(root, '.cache/consumer-'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const react = JSON.parse(await readFile(resolve(root, 'node_modules/react/package.json'), 'utf8')).version;
const reactDom = JSON.parse(await readFile(resolve(root, 'node_modules/react-dom/package.json'), 'utf8')).version;
const cli = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
function run(args, cwd = root) {
  const output = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  if (output.error) throw output.error;
  assert.equal(output.status, 0, `${output.stderr}\n${output.stdout}`);
  return output.stdout;
}
const packed = JSON.parse(run([cli, 'pack', '--ignore-scripts', '--pack-destination', resolve(root, '.cache'), '--json']))[0];
await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ name: 'kyc-consumer-check', private: true, type: 'module',
  dependencies: { [pkg.name]: `file:${resolve(root, '.cache', packed.filename).replaceAll('\\', '/')}`, react, 'react-dom': reactDom } }, null, 2));
run([cli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline=false', '--cache', resolve(root, '.cache/npm')], consumer);
const installed = resolve(consumer, `node_modules/${pkg.name}`);
const api = await import(pathToFileURL(resolve(installed, 'dist/index.js')).href);
assert.equal(typeof api.KycFlow, 'function'); assert.equal(typeof api.compareFaces, 'function');
const blank = new Blob(['not an image'], { type: 'image/png' });
assert.equal((await api.compareFaces({ document: blank, selfie: blank })).reason, 'unsupported_browser');
const assets = resolve(consumer, 'public/kyc-assets');
run([resolve(installed, 'scripts/copy-assets.mjs'), assets], consumer);
for (const model of matchingModels) {
  const bytes = await readFile(resolve(assets, 'matching', model.name));
  assert.equal(bytes.length, model.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), model.sha256);
}
for (const file of ['face-worker.js', 'document-worker.js', 'match-worker.js', 'matching/ort/ort-wasm-simd-threaded.mjs', 'matching/ort/ort-wasm-simd-threaded.wasm']) assert((await readFile(resolve(assets, file))).length > 0);
await writeFile(resolve(root, '.cache/consumer-check.json'), JSON.stringify({ package: `${pkg.name}@${pkg.version}`, react, reactDom,
  consumer, assets, tarball: resolve(root, '.cache', packed.filename), packedBytes: packed.size,
  checks: ['fresh tarball installation', 'public ESM imports', 'SSR-safe comparison API', 'installed asset-copy CLI', 'bundled worker/runtime files', 'pinned model integrity'],
  pending: ['complete capture in clean consumer browser', 'React 18 and Next.js matrix', 'physical device and held-out biometric evaluation'] }, null, 2));
process.stdout.write(`Fresh consumer passed: ${pkg.name}@${pkg.version}, React ${react}, bundled assets intact.\nEvidence: .cache/consumer-check.json\n`);
