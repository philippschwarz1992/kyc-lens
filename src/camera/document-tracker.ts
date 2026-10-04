import type { DocumentDetection } from '../core/document.js';
import type { AssetOptions, DocumentType } from '../types.js';
import { documentPreviewGeometry } from './document-preview.js';
import type { DocumentFrameRequest, DocumentWorkerResponse } from './document-protocol.js';

/** Six preview frames per second, one transferable bitmap in flight, no model or network service. */
export async function createDocumentTracker(options: {
  video: HTMLVideoElement;
  guide: HTMLElement;
  type: DocumentType;
  assets?: AssetOptions;
  signal: AbortSignal;
  onDetection: (detection: DocumentDetection, timestamp: number) => void;
  onError: () => void;
}): Promise<{ stop(): void }> {
  if (options.signal.aborted) throw new DOMException('Document tracking cancelled.', 'AbortError');
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('Document guidance unavailable.');
  const base = (options.assets?.baseUrl ?? '/kyc-assets').replace(/\/$/, '');
  const worker = new Worker(new URL(options.assets?.documentWorkerUrl ?? `${base}/document-worker.js`, document.baseURI), { type: 'module', name: 'kyc-document-tracker' });
  let stopped = false;
  let ready = false;
  let busy = false;
  let rafId = 0;
  let previousVideoTime = -1;
  let previousFrameTime = -Infinity;
  let observationTime = -Infinity;
  let frameKey = '';
  let stale = false;
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveStartup: () => void = () => {};
  let rejectStartup: (error: Error) => void = () => {};
  const startup = new Promise<void>((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
    clearTimeout(startupTimer); clearTimeout(frameTimer);
    options.signal.removeEventListener('abort', aborted);
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
    worker.terminate();
  };
  const fail = () => {
    if (stopped) return;
    stop();
    if (ready) options.onError();
    else rejectStartup(new Error('Document guidance unavailable.'));
  };
  const aborted = () => {
    const pending = !ready;
    stop();
    if (pending) rejectStartup(new DOMException('Document tracking cancelled.', 'AbortError'));
  };
  const sample = (timestamp: number) => {
    if (stopped) return;
    rafId = requestAnimationFrame(sample);
    if (!stale && timestamp - observationTime > 1000) {
      stale = true;
      options.onDetection({ reason: 'searching' }, timestamp);
    }
    const video = options.video;
    if (busy || timestamp - previousFrameTime < 1000 / 6 || video.readyState < 2 || video.currentTime === previousVideoTime) return;
    const geometry = documentPreviewGeometry(video, options.guide);
    if (!geometry) return;
    busy = true;
    previousFrameTime = timestamp;
    previousVideoTime = video.currentTime;
    frameKey = geometry.key;
    const { crop } = geometry;
    frameTimer = setTimeout(fail, 3000);
    void createImageBitmap(video, crop.x, crop.y, crop.width, crop.height, {
      resizeWidth: crop.sampleWidth, resizeHeight: crop.sampleHeight, resizeQuality: 'high',
    }).then(bitmap => {
      if (stopped) { bitmap.close(); return; }
      try {
        const request: DocumentFrameRequest = { type: 'frame', bitmap, guide: geometry.guide, documentType: options.type, timestamp };
        worker.postMessage(request, [bitmap]);
      } catch { bitmap.close(); fail(); }
    }).catch(fail);
  };
  worker.onmessage = ({ data: response }: MessageEvent<DocumentWorkerResponse>) => {
    if (stopped) return;
    if (response.type === 'ready') {
      if (ready) return;
      ready = true; clearTimeout(startupTimer);
      rafId = requestAnimationFrame(sample);
      resolveStartup();
    } else if (response.type === 'error') fail();
    else if (response.type === 'detection') {
      clearTimeout(frameTimer); busy = false;
      const timestamp = performance.now();
      const geometry = documentPreviewGeometry(options.video, options.guide);
      if (timestamp - response.timestamp > 1000 || geometry?.key !== frameKey) {
        options.onDetection({ reason: 'searching' }, timestamp);
        return;
      }
      observationTime = timestamp; stale = false;
      options.onDetection(response.detection, response.timestamp);
    }
  };
  worker.onerror = event => { event.preventDefault(); fail(); };
  worker.onmessageerror = fail;
  startupTimer = setTimeout(fail, 5000);
  options.signal.addEventListener('abort', aborted, { once: true });
  if (options.signal.aborted) aborted();
  await startup;
  return { stop };
}
