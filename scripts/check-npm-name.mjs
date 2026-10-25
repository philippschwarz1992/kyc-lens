#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only registry query. It does not reserve the name; availability can change before publication.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).name;
const registry = 'https://registry.npmjs.org/';
const cli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const result = spawnSync(process.execPath, [cli, 'view', name, 'name', 'version', '--json', '--registry', registry], {
  cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true,
});
if (result.error) throw result.error;
const output = `${result.stdout}\n${result.stderr}`;

if (result.status === 0 && result.stdout.trim()) {
  const info = JSON.parse(result.stdout);
  process.stdout.write(`Taken: ${name} exists on ${registry} (latest ${info.version ?? 'unknown'}). Publish only if you own it, or choose another name.\n`);
  process.exitCode = 1;
} else if (/\bE404\b/.test(output)) {
  process.stdout.write(`Free: ${name} is not on ${registry} right now. This does not reserve it, and npm may still reject similar names.\n`);
} else {
  process.stderr.write(`Unknown: could not query ${registry} for ${name}. A network or authentication error is not evidence of availability.\n${result.stderr}`);
  process.exitCode = 2;
}
