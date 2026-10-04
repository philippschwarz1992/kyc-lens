import * as ort from 'onnxruntime-web/wasm';
import {
  alignedFace, cosineSimilarity, decodeYuNet, faceAcquisitionReason, imageTensor, scoreDecision, selectFace,
} from './math.js';
import type { DetectedFace, NumericTensor, Pixels } from './math.js';
import { comparisonResult, validDecisionOptions, validImageBlob } from './protocol.js';
import type { FaceMatchResult, FaceMatchWorkerRequest, FaceMatchWorkerResponse } from './protocol.js';

interface MatchWorkerScope {
  onmessage: ((event: MessageEvent<FaceMatchWorkerRequest>) => void) | null;
  postMessage(message: FaceMatchWorkerResponse): void;
}
const scope = globalThis as unknown as MatchWorkerScope;
let busy = false;

// Exact redistributed float32 models. A changed/corrupt model cannot inherit these identifiers.
const MODELS = {
  detector: { size: 232589, sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4' },
  recognizer: { size: 38696353, sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79' },
} as const;
const RUNTIME = {
  module: { size: 24381, sha256: 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b' },
  wasm: { size: 14239897, sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2' },
} as const;

function localUrl(path: string): string {
  const url = new URL(path, location.href);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid asset.');
  return url.href;
}

async function loadAsset(url: string, model: { readonly size: number; readonly sha256: string }): Promise<ArrayBuffer> {
  // Reject redirects so a same-origin asset cannot silently redirect to a third-party model host.
  const response = await fetch(localUrl(url), { credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error('Model unavailable.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== model.size) throw new Error('Invalid model.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== model.sha256) throw new Error('Invalid model.');
  return bytes;
}

async function decodeImage(blob: Blob): Promise<Pixels | null> {
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    if (Math.min(bitmap.width, bitmap.height) < 112 || bitmap.width * bitmap.height > 32_000_000) return null;
    const factor = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * factor)), height = Math.max(1, Math.round(bitmap.height * factor));
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } catch { return null; }
  finally {
    bitmap?.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

async function run(session: ort.InferenceSession, pixels: Pixels, order: 'BGR' | 'RGB'): Promise<Record<string, ort.Tensor>> {
  const data = imageTensor(pixels, order);
  if (!data || session.inputNames.length !== 1) throw new Error('Invalid input.');
  const tensor = new ort.Tensor('float32', data, [1, 3, pixels.height, pixels.width]);
  try { return await session.run({ [session.inputNames[0]!]: tensor }); }
  finally { tensor.dispose(); }
}

function disposeOutputs(outputs: Record<string, ort.Tensor>): void {
  for (const tensor of Object.values(outputs)) tensor.dispose();
}

async function detect(session: ort.InferenceSession, pixels: Pixels): Promise<DetectedFace[] | null> {
  // Pad only on the right and bottom, as the pinned OpenCV detector does. Scale down to fit its fixed ONNX input.
  const scale = Math.min(1, 640 / pixels.width, 640 / pixels.height);
  const width = Math.max(1, Math.round(pixels.width * scale)), height = Math.max(1, Math.round(pixels.height * scale));
  const source = new OffscreenCanvas(pixels.width, pixels.height), canvas = new OffscreenCanvas(640, 640);
  const sourceContext = source.getContext('2d'), context = canvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext || !context) throw new Error('Canvas unavailable.');
  let outputs: Record<string, ort.Tensor> | undefined;
  try {
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    context.fillStyle = '#000'; context.fillRect(0, 0, 640, 640);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'low';
    context.drawImage(source, 0, 0, width, height);
    outputs = await run(session, { data: context.getImageData(0, 0, 640, 640).data, width: 640, height: 640 }, 'BGR');
    if (Object.values(outputs).some(tensor => tensor.type !== 'float32')) return null;
    const decoded = decodeYuNet(outputs as unknown as Record<string, NumericTensor>);
    if (!decoded) return null;
    const scaleX = width / pixels.width, scaleY = height / pixels.height;
    // Detections wholly in black padding are not portraits from this image.
    return decoded.filter(face => face.x < width && face.y < height && face.x + face.width > 0 && face.y + face.height > 0).map(face => ({
      ...face, x: face.x / scaleX, y: face.y / scaleY, width: face.width / scaleX, height: face.height / scaleY,
      landmarks: face.landmarks.map(([x, y]) => [x / scaleX, y / scaleY]) as unknown as DetectedFace['landmarks'],
    }));
  } finally {
    if (outputs) disposeOutputs(outputs);
    source.width = 1; source.height = 1; canvas.width = 1; canvas.height = 1;
  }
}

async function embedding(session: ort.InferenceSession, crop: Pixels): Promise<Float32Array | null> {
  // OpenCV's swapRB=true converts its BGR image to RGB. Browser ImageData is already RGB.
  const outputs = await run(session, crop, 'RGB');
  try {
    if (session.outputNames.length !== 1) return null;
    const output = outputs[session.outputNames[0]!];
    if (!output || output.type !== 'float32' || output.dims.length !== 2 || output.dims[0] !== 1 || output.dims[1] !== 128) return null;
    const values = new Float32Array(output.data as Float32Array);
    return values.length === 128 && values.every(Number.isFinite) ? values : null;
  } finally { disposeOutputs(outputs); }
}

async function compare(request: FaceMatchWorkerRequest): Promise<FaceMatchResult> {
  const result = (status: FaceMatchResult['status'], reason: FaceMatchResult['reason']) => comparisonResult(status, reason, request.threshold, request.inconclusiveMargin);
  if (!validDecisionOptions(request.threshold, request.inconclusiveMargin)) return comparisonResult('inconclusive', 'invalid_options');
  if (!validImageBlob(request.document) || !validImageBlob(request.selfie)) return result('inconclusive', 'invalid_image');
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined' || !crypto.subtle) return result('unavailable', 'unsupported_browser');
  try {
    localUrl(request.assets.workerUrl); localUrl(request.assets.wasmBaseUrl);
    localUrl(request.assets.detectorUrl); localUrl(request.assets.recognizerUrl);
  } catch { return result('unavailable', 'invalid_assets'); }
  const document = await decodeImage(request.document), selfie = await decodeImage(request.selfie);
  if (!document || !selfie) return result('inconclusive', 'invalid_image');

  let detector: ort.InferenceSession | undefined, recognizer: ort.InferenceSession | undefined;
  let runtimeModuleUrl: string | undefined;
  let documentEmbedding: Float32Array | null = null, selfieEmbedding: Float32Array | null = null;
  try {
    // One thread works without SharedArrayBuffer/cross-origin isolation. The existing outer worker handles cancellation.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.initTimeout = 15_000;
    const runtime = request.assets.wasmBaseUrl.replace(/\/$/, '');
    // Fetch/hash both local runtime files ourselves: an import or WASM fetch must not follow an external redirect.
    const [moduleBytes, wasmBytes] = await Promise.all([
      loadAsset(`${runtime}/ort-wasm-simd-threaded.mjs`, RUNTIME.module),
      loadAsset(`${runtime}/ort-wasm-simd-threaded.wasm`, RUNTIME.wasm),
    ]);
    runtimeModuleUrl = URL.createObjectURL(new Blob([moduleBytes], { type: 'text/javascript' }));
    ort.env.wasm.wasmBinary = new Uint8Array(wasmBytes);
    ort.env.wasm.wasmPaths = {
      mjs: runtimeModuleUrl,
      wasm: localUrl(`${runtime}/ort-wasm-simd-threaded.wasm`),
    };
    const sessionOptions: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
    detector = await ort.InferenceSession.create(await loadAsset(request.assets.detectorUrl, MODELS.detector), sessionOptions);
    URL.revokeObjectURL(runtimeModuleUrl); runtimeModuleUrl = undefined;
    const documentFaces = await detect(detector, document), selfieFaces = await detect(detector, selfie);
    if (!documentFaces || !selfieFaces) return result('unavailable', 'model_error');
    const selectedDocument = selectFace(documentFaces, 'document'), selectedSelfie = selectFace(selfieFaces, 'selfie');
    if (!selectedDocument.face) return result('inconclusive', selectedDocument.reason!);
    if (!selectedSelfie.face) return result('inconclusive', selectedSelfie.reason!);
    const documentCrop = alignedFace(document, selectedDocument.face.landmarks), selfieCrop = alignedFace(selfie, selectedSelfie.face.landmarks);
    if (!documentCrop || !selfieCrop) return result('inconclusive', 'invalid_image');
    const documentReason = faceAcquisitionReason(selectedDocument.face, document, documentCrop, 'document');
    if (documentReason) return result('inconclusive', documentReason);
    const selfieReason = faceAcquisitionReason(selectedSelfie.face, selfie, selfieCrop, 'selfie');
    if (selfieReason) return result('inconclusive', selfieReason);
    // Lazy-load the larger recognizer only once both inputs have usable, unambiguous faces.
    await detector.release(); detector = undefined;
    recognizer = await ort.InferenceSession.create(await loadAsset(request.assets.recognizerUrl, MODELS.recognizer), sessionOptions);
    documentEmbedding = await embedding(recognizer, documentCrop);
    selfieEmbedding = await embedding(recognizer, selfieCrop);
    const score = documentEmbedding && selfieEmbedding ? cosineSimilarity(documentEmbedding, selfieEmbedding) : null;
    return scoreDecision(score, request.threshold, request.inconclusiveMargin);
  } catch { return result('unavailable', 'model_error'); }
  finally {
    // Embeddings never leave this worker, and neither media nor derived data is persisted.
    documentEmbedding?.fill(0); selfieEmbedding?.fill(0);
    document.data.fill(0); selfie.data.fill(0);
    await Promise.allSettled([detector?.release(), recognizer?.release()]);
    if (runtimeModuleUrl) URL.revokeObjectURL(runtimeModuleUrl);
    ort.env.wasm.wasmBinary = undefined;
  }
}

scope.onmessage = ({ data: request }): void => {
  if (busy || request?.type !== 'compare') return;
  busy = true;
  void compare(request).then(result => scope.postMessage({ type: 'result', result })).catch(() => {
    scope.postMessage({ type: 'result', result: comparisonResult('unavailable', 'worker_error', request.threshold, request.inconclusiveMargin) });
  });
};
