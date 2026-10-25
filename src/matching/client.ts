import {
  comparisonResult, DEFAULT_INCONCLUSIVE_MARGIN, DEFAULT_MATCH_THRESHOLD, validDecisionOptions, validImageBlob,
} from './protocol.js';
import type {
  FaceMatchAssets, FaceMatchOptions, FaceMatchResult, FaceMatchWorkerRequest, FaceMatchWorkerResponse, ResolvedFaceMatchAssets,
} from './protocol.js';
import { scoreDecision } from './math.js';

/** Resolve every location before starting work; external asset hosts are rejected. */
export function resolveMatchAssets(assets: FaceMatchAssets | undefined, baseURI: string, origin: string): ResolvedFaceMatchAssets | null {
  try {
    const base = (assets?.baseUrl ?? '/kyc-assets').replace(/\/$/, '');
    const local = (path: string) => {
      const url = new URL(path, baseURI);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) throw new Error('Invalid assets.');
      return url.href;
    };
    return {
      workerUrl: local(assets?.matchWorkerUrl ?? `${base}/match-worker.js`),
      wasmBaseUrl: local(`${(assets?.matchWasmBaseUrl ?? `${base}/matching/ort`).replace(/\/$/, '')}/`),
      detectorUrl: local(assets?.faceDetectorModelUrl ?? `${base}/matching/face_detection_yunet_2023mar.onnx`),
      recognizerUrl: local(assets?.faceRecognizerModelUrl ?? `${base}/matching/face_recognition_sface_2021dec.onnx`),
    };
  } catch { return null; }
}

/**
 * Warms the HTTP cache with the runtime and models at low priority, in the order the worker needs them.
 * Failures are silent: compareFaces still fetches and verifies pinned sizes and hashes. Returns a cancel function.
 */
export function prefetchMatchingAssets(assets?: FaceMatchAssets): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof fetch !== 'function' || typeof AbortController === 'undefined') return () => {};
  const resolved = resolveMatchAssets(assets, document.baseURI, window.location.origin);
  if (!resolved) return () => {};
  const controller = new AbortController();
  const { signal } = controller;
  // Same request mode and credentials as the worker's loader, so its default-mode fetch can reuse these entries.
  const urls = [`${resolved.wasmBaseUrl}ort-wasm-simd-threaded.mjs`, `${resolved.wasmBaseUrl}ort-wasm-simd-threaded.wasm`, resolved.detectorUrl, resolved.recognizerUrl];
  const run = async () => {
    for (const url of urls) {
      if (signal.aborted) return;
      try {
        const response = await fetch(url, { cache: 'force-cache', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', priority: 'low', signal } as RequestInit & { priority?: 'low' });
        // Drain without retaining bytes; an unread body would not be completely written to the cache.
        const reader = response.ok ? response.body?.getReader() : undefined;
        if (!reader) { await response.body?.cancel(); continue; }
        while (!(await reader.read()).done) if (signal.aborted) { await reader.cancel(); return; }
      } catch { /* Offline, blocked or cancelled: the real comparison loads and verifies the files. */ }
    }
  };
  const idle = window.requestIdleCallback as typeof window.requestIdleCallback | undefined;
  const handle = idle ? idle.call(window, () => void run(), { timeout: 2_000 }) : setTimeout(() => void run(), 0);
  return () => {
    if (signal.aborted) return;
    controller.abort();
    if (idle) window.cancelIdleCallback?.(handle as number); else clearTimeout(handle as ReturnType<typeof setTimeout>);
  };
}

/** Runs one isolated worker and destroys it on result, timeout, error or cancellation. No uploads or persistence. */
export async function compareFaces(options: FaceMatchOptions): Promise<FaceMatchResult> {
  if (options.signal?.aborted) throw new DOMException('Face comparison cancelled.', 'AbortError');
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const margin = options.inconclusiveMargin ?? DEFAULT_INCONCLUSIVE_MARGIN;
  const timeout = options.timeoutMs ?? 45_000;
  const result = (status: FaceMatchResult['status'], reason: FaceMatchResult['reason']) => comparisonResult(status, reason, threshold, margin);
  if (!validDecisionOptions(threshold, margin) || !Number.isFinite(timeout) || timeout < 1_000 || timeout > 120_000) {
    return comparisonResult('inconclusive', 'invalid_options');
  }
  if (!validImageBlob(options.document) || !validImageBlob(options.selfie)) return result('inconclusive', 'invalid_image');
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined'
    || typeof OffscreenCanvas === 'undefined' || typeof WebAssembly === 'undefined') return result('unavailable', 'unsupported_browser');
  const assets = resolveMatchAssets(options.assets, document.baseURI, window.location.origin);
  if (!assets) return result('unavailable', 'invalid_assets');
  let worker: Worker;
  try { worker = new Worker(assets.workerUrl, { type: 'module', name: 'kyc-face-match' }); }
  catch { return result('unavailable', 'worker_error'); }

  return await new Promise<FaceMatchResult>((resolve, reject) => {
    let done = false;
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value?: FaceMatchResult, abort = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', aborted);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      if (abort) reject(new DOMException('Face comparison cancelled.', 'AbortError'));
      else resolve({ ...value!, durationMs: Math.max(0, performance.now() - started) });
    };
    const aborted = () => finish(undefined, true);
    worker.onmessage = ({ data }: MessageEvent<FaceMatchWorkerResponse>) => {
      if (data?.type !== 'result') { finish(result('unavailable', 'worker_error')); return; }
      const response = data.result;
      if (!response || !['match', 'no_match', 'inconclusive', 'unavailable'].includes(response.status)
        || response.threshold !== threshold || response.inconclusiveMargin !== margin
        || response.models?.detector !== 'yunet-2023mar' || response.models?.recognizer !== 'sface-2021dec'
        || ((response.status === 'match' || response.status === 'no_match')
          && (response.reason !== 'compared' || !Number.isFinite(response.score) || response.score! < -1 || response.score! > 1))) {
        finish(result('unavailable', 'worker_error')); return;
      }
      if (response.score !== undefined) {
        const expected = scoreDecision(response.score, threshold, margin);
        if (expected.status !== response.status || expected.reason !== response.reason) {
          finish(result('unavailable', 'worker_error')); return;
        }
      }
      // Copy only documented fields. Raw crops, embeddings or worker diagnostics are never forwarded.
      finish({ ...result(response.status, response.reason), ...(response.score === undefined ? {} : { score: response.score }) });
    };
    worker.onerror = event => { event.preventDefault(); finish(result('unavailable', 'worker_error')); };
    worker.onmessageerror = () => finish(result('unavailable', 'worker_error'));
    timer = setTimeout(() => finish(result('unavailable', 'timeout')), timeout);
    options.signal?.addEventListener('abort', aborted, { once: true });
    if (options.signal?.aborted) { aborted(); return; }
    try {
      const request: FaceMatchWorkerRequest = { type: 'compare', document: options.document, selfie: options.selfie, assets, threshold, inconclusiveMargin: margin };
      worker.postMessage(request);
    } catch { finish(result('unavailable', 'worker_error')); }
  });
}
