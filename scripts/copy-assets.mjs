#!/usr/bin/env node
import { cp, mkdir, readdir, copyFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = `Usage: kyc-lens-copy-assets [destination] [--no-matching]

Copies the KYC Lens workers, models, WASM and license files into a directory
your application serves. The destination defaults to public/kyc-assets.

Options:
  --no-matching  Skip local face comparison: match-worker.js, the ONNX Runtime
                 WASM and the YuNet/SFace models (about 53 MB). Pass
                 faceMatch={false} to KycFlow when you use this option.
  -h, --help     Show this help.
`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(usage);
  process.exit(0);
}
const unknown = args.filter(arg => arg.startsWith('-') && arg !== '--no-matching');
const positional = args.filter(arg => !arg.startsWith('-'));
if (unknown.length || positional.length > 1) {
  process.stderr.write(`${unknown.length ? `Unknown option: ${unknown.join(', ')}` : 'Expected at most one destination.'}\n\n${usage}`);
  process.exit(2);
}
const matching = !args.includes('--no-matching');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.cwd(), positional[0] || 'public/kyc-assets');
const matchingDirectory = resolve(root, 'assets', 'matching');
const matchingWorker = /^match-worker\.js(\.map)?$/;
const skipped = [];
await mkdir(destination, { recursive: true });
await cp(resolve(root, 'assets'), destination, {
  recursive: true,
  filter: source => {
    const path = resolve(source);
    if (matching || (path !== matchingDirectory && !path.startsWith(matchingDirectory + sep))) return true;
    if (path === matchingDirectory) skipped.push('matching/ (ONNX Runtime WASM, YuNet and SFace models, licenses)');
    return false;
  },
});
// Include relative chunks and all standalone processing workers.
for (const entry of await readdir(resolve(root, 'dist'), { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name === 'chunks') {
    await cp(resolve(root, 'dist/chunks'), resolve(destination, 'chunks'), { recursive: true });
  } else if (entry.isFile() && /\.js(\.map)?$/.test(entry.name)) {
    if (!matching && matchingWorker.test(entry.name)) { skipped.push(entry.name); continue; }
    await copyFile(resolve(root, 'dist', entry.name), resolve(destination, entry.name));
  }
}
process.stdout.write(`KYC assets copied to ${destination}\nUse assets={{ baseUrl: '/kyc-assets' }} to load the local processing workers.\n`);
if (!matching) {
  process.stdout.write(`Skipped local face comparison assets (--no-matching):\n${skipped.map(item => `  - ${item}`).join('\n')}\nPass faceMatch={false} to KycFlow; comparison cannot run without these files.\n`);
}
