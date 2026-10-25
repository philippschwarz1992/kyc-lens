#!/usr/bin/env node
import { cp, mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = `Usage: kyc-lens-copy-assets [destination] [--no-matching] [--source-maps]

Copies the KYC Lens workers, models, WASM and license files into a directory
your application serves. The destination defaults to public/kyc-assets.

Options:
  --no-matching  Skip local face comparison: match-worker.js, the ONNX Runtime
                 WASM and the YuNet/SFace models (about 53 MB). Pass
                 faceMatch={false} to KycFlow when you use this option.
  --source-maps  Also copy the .js.map files. They contain the original
                 library source, so anyone who opens your site can read it.
  -h, --help     Show this help.
`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(usage);
  process.exit(0);
}
const unknown = args.filter(arg => arg.startsWith('-') && !['--no-matching', '--source-maps'].includes(arg));
const positional = args.filter(arg => !arg.startsWith('-'));
if (unknown.length || positional.length > 1) {
  process.stderr.write(`${unknown.length ? `Unknown option: ${unknown.join(', ')}` : 'Expected at most one destination.'}\n\n${usage}`);
  process.exit(2);
}
const matching = !args.includes('--no-matching');
const sourceMaps = args.includes('--source-maps');

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
// Without maps, served scripts also drop their map reference, so browsers request no missing file.
async function copyScript(from, to) {
  if (sourceMaps) return copyFile(from, to);
  const text = await readFile(from, 'utf8');
  await writeFile(to, text.replace(/\n*\/\/# sourceMappingURL=[^\n]*\n*$/, '\n'));
}
async function copyRuntime(from, to, top) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!top || entry.name === 'chunks') await copyRuntime(resolve(from, entry.name), resolve(to, entry.name), false);
    } else if (entry.isFile() && /\.js(\.map)?$/.test(entry.name)) {
      if (top && !matching && matchingWorker.test(entry.name)) { skipped.push(entry.name); continue; }
      if (entry.name.endsWith('.map') && !sourceMaps) continue;
      await (entry.name.endsWith('.js') ? copyScript : copyFile)(resolve(from, entry.name), resolve(to, entry.name));
    }
  }
}
// Include relative chunks and all standalone processing workers.
await copyRuntime(resolve(root, 'dist'), destination, true);
process.stdout.write(`KYC assets copied to ${destination}\nUse assets={{ baseUrl: '/kyc-assets' }} to load the local processing workers.\n`);
if (!matching) {
  process.stdout.write(`Skipped local face comparison assets (--no-matching):\n${skipped.map(item => `  - ${item}`).join('\n')}\nPass faceMatch={false} to KycFlow; comparison cannot run without these files.\n`);
}
