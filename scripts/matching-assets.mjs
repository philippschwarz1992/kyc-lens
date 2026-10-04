import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export const matchingModels = [
  { name: 'face_detection_yunet_2023mar.onnx', directory: 'face_detection_yunet', size: 232589,
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4', license: 'MIT' },
  { name: 'face_recognition_sface_2021dec.onnx', directory: 'face_recognition_sface', size: 38696353,
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79', license: 'Apache-2.0' },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function pinnedDownload(destination, url, model) {
  let bytes;
  try { bytes = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes) {
    process.stdout.write(`Preparing bundled local model: ${model.name}\n`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Unable to prepare ${model.name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== model.size || hash(bytes) !== model.sha256) throw new Error(`Model checksum/size mismatch: ${model.name}`);
    await writeFile(destination, bytes);
  }
  if (bytes.length !== model.size || hash(bytes) !== model.sha256) throw new Error(`Bundled model checksum/size mismatch: ${model.name}`);
}

export async function prepareMatchingAssets(root) {
  const target = resolve(root, 'assets/matching');
  await mkdir(resolve(target, 'ort'), { recursive: true });
  const runtimeRoot = resolve(dirname(createRequire(import.meta.url).resolve('onnxruntime-web/wasm')), '..');
  const runtime = JSON.parse(await readFile(resolve(runtimeRoot, 'package.json'), 'utf8'));
  const runtimeFiles = [];
  for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    const bytes = await readFile(resolve(runtimeRoot, 'dist', name));
    await writeFile(resolve(target, 'ort', name), bytes);
    runtimeFiles.push({ name, size: bytes.length, sha256: hash(bytes) });
  }
  for (const model of matchingModels) {
    const url = `https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/${model.directory}/${model.name}`;
    await pinnedDownload(resolve(target, model.name), url, model);
    const licenseName = `${model.directory}-LICENSE.txt`;
    let license;
    try { license = await readFile(resolve(target, licenseName), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!license) {
      const response = await fetch(`https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/${model.directory}/LICENSE`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Unable to obtain ${model.license} notice for ${model.name}`);
      license = await response.text();
      await writeFile(resolve(target, licenseName), license);
    }
    if (!license.includes(model.license === 'MIT' ? 'MIT License' : 'Apache License')) throw new Error(`Unexpected model license: ${model.name}`);
  }
  const runtimeLicensePath = resolve(target, 'ONNXRUNTIME-LICENSE.txt');
  try { await readFile(runtimeLicensePath); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://raw.githubusercontent.com/microsoft/onnxruntime/v${runtime.version}/LICENSE`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Unable to obtain ONNX Runtime redistribution notice.');
    await writeFile(runtimeLicensePath, await response.text());
  }
  await writeFile(resolve(target, 'manifest.json'), JSON.stringify({
    runtime: 'onnxruntime-web', version: runtime.version, backend: 'wasm', runtimeFiles,
    models: matchingModels.map(model => ({ ...model, source: `https://github.com/opencv/opencv_zoo/tree/main/models/${model.directory}` })),
    limitations: 'Published licenses retained. SFace training-data provenance clarification remains unresolved: https://github.com/opencv/opencv_zoo/issues/313. Threshold requires calibration; comparison does not establish liveness or document authenticity.',
  }, null, 2) + '\n');
  await cp(target, resolve(root, 'demo/public/kyc-assets/matching'), { recursive: true });
  process.stdout.write(`Bundled YuNet + SFace and ONNX Runtime ${runtime.version}. Consumer installs do not download models.\n`);
}
