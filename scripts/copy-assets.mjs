#!/usr/bin/env node
import { cp, mkdir, readdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.cwd(), process.argv[2] || 'public/kyc-assets');
await mkdir(destination, { recursive: true });
await cp(resolve(root, 'assets'), destination, { recursive: true });
// Include relative chunks and all three standalone processing workers.
for (const entry of await readdir(resolve(root, 'dist'), { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name === 'chunks') {
    await cp(resolve(root, 'dist/chunks'), resolve(destination, 'chunks'), { recursive: true });
  } else if (entry.isFile() && /\.js(\.map)?$/.test(entry.name)) {
    await copyFile(resolve(root, 'dist', entry.name), resolve(destination, entry.name));
  }
}
process.stdout.write(`KYC assets copied to ${destination}\nUse assets={{ baseUrl: '/kyc-assets' }} to load the local processing workers.\n`);
