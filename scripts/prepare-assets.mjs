import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { prepareMatchingAssets } from './matching-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'assets');
const require = createRequire(import.meta.url);
const visionRoot = dirname(require.resolve('@mediapipe/tasks-vision'));
await mkdir(resolve(assets, 'wasm'), { recursive: true });
const licensePath = resolve(assets, 'MEDIAPIPE-LICENSE.txt');
try { await stat(licensePath); } catch {
  const response = await fetch('https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE', { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Unable to download the MediaPipe redistribution license.');
  await writeFile(licensePath, await response.text());
}
const wasmFiles = (await readdir(resolve(visionRoot, 'wasm'))).filter(name => /\.(wasm|m?js)$/.test(name));
for (const name of wasmFiles) await copyFile(resolve(visionRoot, 'wasm', name), resolve(assets, 'wasm', name));
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const expectedModelSha256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const model = resolve(assets, 'face_landmarker.task');
let exists = false;
try { exists = (await stat(model)).size > 1_000_000; } catch { /* First-time setup. */ }
if (!exists) {
  process.stdout.write('Downloading the pinned, free MediaPipe face model (one-time setup)…\n');
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000 || bytes.length > 25_000_000) throw new Error('Unexpected model size; refusing to save it.');
  await writeFile(model, bytes);
}
const modelBytes = await readFile(model);
const modelSha256 = createHash('sha256').update(modelBytes).digest('hex');
if (modelSha256 !== expectedModelSha256) throw new Error('The Face Landmarker model checksum does not match the pinned version.');
const version = JSON.parse(await readFile(resolve(visionRoot, 'package.json'), 'utf8')).version;
await writeFile(resolve(assets, 'manifest.json'), JSON.stringify({
  runtime: '@mediapipe/tasks-vision', version, modelUrl,
  modelSha256,
}, null, 2) + '\n');
const localPublic = resolve(root, 'demo/public/kyc-assets');
await mkdir(resolve(localPublic, 'wasm'), { recursive: true });
await copyFile(model, resolve(localPublic, 'face_landmarker.task'));
await copyFile(resolve(assets, 'manifest.json'), resolve(localPublic, 'manifest.json'));
await copyFile(licensePath, resolve(localPublic, 'MEDIAPIPE-LICENSE.txt'));
for (const name of wasmFiles) await copyFile(resolve(assets, 'wasm', name), resolve(localPublic, 'wasm', name));
process.stdout.write(`Ready: ${modelBytes.length.toLocaleString()} model bytes + matching WASM ${version}. Runtime assets are served locally.\n`);
await prepareMatchingAssets(root);
