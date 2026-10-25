// Development-only, real WASM models vs the pinned OpenCV golden. No network requests.
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as ort from 'onnxruntime-web/wasm';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
await mkdir(resolve(root, '.cache'), { recursive: true });
const modulePath = resolve(root, '.cache/matching-reference-math.mjs');
await build({ entryPoints: [resolve(root, 'src/matching/math.ts')], outfile: modulePath, bundle: true, platform: 'node', format: 'esm' });
const { alignedFace, cosineSimilarity, decodeYuNet, imageTensor } = await import(pathToFileURL(modulePath).href);
const reference = JSON.parse(await readFile(resolve(root, 'tests/fixtures/astronaut-reference.json'), 'utf8'));
const rgba = new Uint8ClampedArray(await readFile(resolve(root, 'tests/fixtures/astronaut.rgba')));
const image = { data: rgba, width: reference.width, height: reference.height };
const padded = new Uint8ClampedArray(640 * 640 * 4);
for (let y = 0; y < image.height; y++) padded.set(rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * 640 * 4);

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { mjs: pathToFileURL(resolve(root, 'assets/matching/ort/ort-wasm-simd-threaded.mjs')).href,
  wasm: pathToFileURL(resolve(root, 'assets/matching/ort/ort-wasm-simd-threaded.wasm')).href };
ort.env.wasm.wasmBinary = new Uint8Array(await readFile(resolve(root, 'assets/matching/ort/ort-wasm-simd-threaded.wasm')));
const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
let detector, recognizer;
try {
  detector = await ort.InferenceSession.create(new Uint8Array(await readFile(resolve(root, 'assets/matching/face_detection_yunet_2023mar.onnx'))), options);
  const input = new ort.Tensor('float32', imageTensor({ data: padded, width: 640, height: 640 }, 'BGR'), [1, 3, 640, 640]);
  let outputs;
  try { outputs = await detector.run({ [detector.inputNames[0]]: input }); }
  finally { input.dispose(); }
  const faces = decodeYuNet(outputs);
  Object.values(outputs).forEach(value => value.dispose());
  if (!faces || faces.length !== 1) throw new Error('Expected one real-model face.');
  const face = faces[0];
  const actualCoordinates = [face.x, face.y, face.width, face.height, ...face.landmarks.flat(), face.score];
  const maxDetectionDelta = Math.max(...actualCoordinates.map((value, index) => Math.abs(value - reference.face[index])));
  const crop = alignedFace(image, face.landmarks);
  if (!crop) throw new Error('No crop.');
  recognizer = await ort.InferenceSession.create(new Uint8Array(await readFile(resolve(root, 'assets/matching/face_recognition_sface_2021dec.onnx'))), options);
  const cropTensor = new ort.Tensor('float32', imageTensor(crop, 'RGB'), [1, 3, 112, 112]);
  let feature;
  try { feature = await recognizer.run({ [recognizer.inputNames[0]]: cropTensor }); }
  finally { cropTensor.dispose(); }
  const embedding = new Float32Array(feature[recognizer.outputNames[0]].data);
  Object.values(feature).forEach(value => value.dispose());
  const embeddingCosine = cosineSimilarity(embedding, reference.embedding);
  const norm = Math.hypot(...embedding), referenceNorm = Math.hypot(...reference.embedding);
  const maxNormalizedEmbeddingDelta = Math.max(...embedding.map((value, index) => Math.abs(value / norm - reference.embedding[index] / referenceNorm)));
  const evidence = { runtime: 'ONNX Runtime Web 1.30.0 WASM numThreads=1', reference: reference.reference,
    maxDetectionDelta, embeddingCosine, maxNormalizedEmbeddingDelta };
  console.log(JSON.stringify(evidence, null, 2));
  if (maxDetectionDelta > 0.001 || embeddingCosine === null || embeddingCosine < 0.9999 || maxNormalizedEmbeddingDelta > 0.003) throw new Error('Reference parity exceeded tolerance.');
} finally { await Promise.allSettled([detector?.release(), recognizer?.release()]); }
