import type { AssetOptions, FaceObservation } from '../types.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';
import { coverViewport, mapFaceToViewport } from './viewport.js';

export interface FaceTrackerOptions {
  video: HTMLVideoElement;
  assets?: AssetOptions;
  trackingFps?: number;
  /** Evaluate geometry in a centered object-fit:cover preview; otherwise return native coordinates. */
  previewFit?: 'cover';
  /** Cancels pending initialization as well as an active tracker. */
  signal?: AbortSignal;
  onObservation: (observation: FaceObservation) => void;
  onError: (error: Error) => void;
}

/** Resolves after the dedicated CPU worker and local model are ready. Camera ownership stays with the host. */
export async function createFaceTracker(options: FaceTrackerOptions): Promise<{ stop(): void }> {
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('This browser does not support worker-based face tracking.');
  if (options.signal?.aborted) throw new DOMException('Face tracking was cancelled.', 'AbortError');
  const fps = options.trackingFps ?? 12;
  if (!Number.isFinite(fps) || fps < 3 || fps > 30) throw new Error('trackingFps must be between 3 and 30.');
  const base = (options.assets?.baseUrl ?? '/kyc-assets').replace(/\/$/, '');
  const resolveAsset = (path: string): string => new URL(path, document.baseURI).href;
  const worker = new Worker(resolveAsset(options.assets?.workerUrl ?? `${base}/face-worker.js`), { type: 'module', name: 'kyc-face-tracker' });
  let stopped = false;
  let ready = false;
  let rafId = 0;
  let busy = false;
  let lastVideoTime = -1;
  let lastFrameTimestamp = -Infinity;
  let frameViewport: ReturnType<typeof coverViewport> = null;
  let inferenceTimer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectStartup: (error: Error) => void = () => {};
  let resolveStartup: () => void = () => {};
  let handleAbort: () => void = () => {};
  const startup = new Promise<void>((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
    clearTimeout(startupTimer);
    clearTimeout(inferenceTimer);
    options.signal?.removeEventListener('abort', handleAbort);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    // Terminating also releases transferred ImageBitmaps and the worker's WASM heap.
    worker.terminate();
  };
  const fail = (error: Error): void => {
    if (stopped) return;
    stop();
    if (ready) options.onError(error);
    else rejectStartup(error);
  };
  handleAbort = (): void => {
    if (stopped) return;
    const wasPending = !ready;
    stop();
    if (wasPending) rejectStartup(new DOMException('Face tracking was cancelled.', 'AbortError'));
  };

  const sample = (timestamp: number): void => {
    if (stopped) return;
    rafId = requestAnimationFrame(sample);
    const { video } = options;
    if (busy || timestamp - lastFrameTimestamp < 1000 / fps || video.readyState < 2 || video.videoWidth === 0 || video.currentTime === lastVideoTime) return;
    busy = true;
    lastVideoTime = video.currentTime;
    lastFrameTimestamp = timestamp;
    const width = Math.min(video.videoWidth, 640);
    const height = Math.max(1, Math.round(video.videoHeight * width / video.videoWidth));
    // Keep inference on the full frame to detect additional faces. Map its result
    // to the centered object-fit:cover preview so the visible guide stays accurate.
    const viewport = coverViewport(video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight);
    void createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' }).then((bitmap) => {
      if (stopped) { bitmap.close(); return; }
      try {
        const request: WorkerRequest = { type: 'frame', bitmap, timestamp };
        frameViewport = viewport;
        worker.postMessage(request, [bitmap]);
        inferenceTimer = setTimeout(() => fail(new Error('Face tracking stopped responding. Please retry.')), 10_000);
      } catch (error) {
        bitmap.close();
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    }).catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
  };

  worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
    if (stopped) return;
    const response = event.data;
    if (response.type === 'ready') {
      if (ready) return;
      ready = true;
      clearTimeout(startupTimer);
      rafId = requestAnimationFrame(sample);
      resolveStartup();
    } else if (response.type === 'error') {
      fail(new Error(response.message));
    } else if (response.type === 'observation') {
      clearTimeout(inferenceTimer);
      busy = false;
      try { options.onObservation(options.previewFit === 'cover' ? mapFaceToViewport(response.observation, frameViewport) : response.observation); }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    }
  };
  worker.onerror = (event): void => { event.preventDefault(); fail(new Error(event.message || 'Unable to load the face tracking worker.')); };
  worker.onmessageerror = (): void => fail(new Error('Unable to communicate with the face tracking worker.'));
  startupTimer = setTimeout(() => fail(new Error('Face tracking could not start. Check your self-hosted model and WASM assets.')), 30_000);
  options.signal?.addEventListener('abort', handleAbort, { once: true });
  if (options.signal?.aborted) handleAbort();
  try {
    const request: WorkerRequest = {
      type: 'init', modelUrl: resolveAsset(options.assets?.modelUrl ?? `${base}/face_landmarker.task`),
      wasmBaseUrl: resolveAsset(options.assets?.wasmBaseUrl ?? `${base}/wasm`),
    };
    if (!stopped) worker.postMessage(request);
  } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  await startup;
  return { stop };
}
