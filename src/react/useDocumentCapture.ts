import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetOptions, DocumentOptions, DocumentType } from '../types.js';
import { analyzeDocument, type DocumentDetectionReason } from '../core/document.js';
import { createDocumentHold } from '../core/document-auto.js';
import { createDocumentTracker } from '../camera/document-tracker.js';
import { documentPreviewGeometry } from '../camera/document-preview.js';

export type DocumentCameraStatus = 'idle' | 'requesting' | 'ready' | 'capturing';
export type DocumentSide = 'front' | 'back';
export type DocumentGuideFeedback = DocumentDetectionReason | 'hold-still' | 'unavailable' | 'off';

function captureError(message: string): Error {
  const error = new Error(message);
  error.name = 'DocumentCaptureError';
  return error;
}

function encodePhoto(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(captureError('documentCaptureFailed')), 5000);
    try {
      canvas.toBlob(blob => {
        clearTimeout(timer);
        if (blob) resolve(blob);
        else reject(captureError('documentCaptureFailed'));
      }, 'image/jpeg', 0.95);
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}

async function snapshot(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return Promise.reject(captureError('documentCameraUnavailable'));
  const canvas = document.createElement('canvas');
  // Preserve the entire camera image at its native resolution; the guide is only visual.
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(captureError('documentCaptureFailed'));
  context.drawImage(video, 0, 0);
  return encodePhoto(canvas);
}

type PreviewGeometry = NonNullable<ReturnType<typeof documentPreviewGeometry>>;

/** Decode and assess the delivered JPEG, using the same visible crop and document interior as the guide. */
async function checkPhoto(photo: Blob, geometry: PreviewGeometry, type: DocumentType) {
  const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(captureError('documentCaptureFailed')); }, 5000);
    try {
      void createImageBitmap(photo).then(decoded => {
        clearTimeout(timer);
        if (expired) decoded.close();
        else resolve(decoded);
      }, error => { clearTimeout(timer); reject(error); });
    } catch (error) { clearTimeout(timer); reject(error); }
  });
  try {
    const canvas = document.createElement('canvas');
    const { crop } = geometry;
    canvas.width = crop.sampleWidth;
    canvas.height = crop.sampleHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw captureError('documentCaptureFailed');
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    return analyzeDocument({ data: context.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width, height: canvas.height, guide: geometry.guide, type });
  } finally { bitmap.close(); }
}

function simulatedDocument(type: DocumentType, side: DocumentSide): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(captureError('documentCaptureFailed'));
  context.fillStyle = '#e8edf2';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.fillRect(100, 110, 1400, 780);
  context.strokeStyle = '#aab9c8';
  context.lineWidth = 5;
  context.strokeRect(100, 110, 1400, 780);
  context.fillStyle = '#17334b';
  context.font = 'bold 52px sans-serif';
  const label = type === 'passport' ? 'SAMPLE PHOTO PAGE' : type === 'drivers-license' ? 'SAMPLE DRIVER’S LICENSE' : 'SAMPLE IDENTITY CARD';
  context.fillText(label, 160, 215);
  context.font = '30px sans-serif';
  context.fillText(side === 'front' ? 'FRONT · FICTIONAL DOCUMENT' : 'BACK · FICTIONAL DOCUMENT', 160, 270);
  if (side === 'front') {
    context.fillStyle = '#d6e4ed';
    context.fillRect(160, 330, 330, 420);
    context.fillStyle = '#90afc2';
    context.beginPath(); context.ellipse(325, 478, 80, 100, 0, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.ellipse(325, 755, 130, 150, 0, Math.PI, Math.PI * 2); context.fill();
    context.fillStyle = '#dae3eb';
    for (let row = 0; row < 5; row += 1) context.fillRect(550, 355 + row * 75, row % 2 ? 460 : 690, 22);
  } else {
    context.fillStyle = '#dae3eb';
    for (let row = 0; row < 4; row += 1) context.fillRect(160, 355 + row * 65, row % 2 ? 870 : 1160, 22);
    context.fillStyle = '#17334b';
    for (let column = 0; column < 85; column += 1) {
      context.fillRect(180 + column * 14, 650, column % 3 === 0 ? 8 : 4, 100);
    }
  }
  // Both the preview and the delivered blob clearly identify an explicit simulation.
  context.save();
  context.translate(800, 520);
  context.rotate(-0.25);
  context.textAlign = 'center';
  context.fillStyle = 'rgba(138, 40, 55, 0.72)';
  context.font = 'bold 160px sans-serif';
  context.fillText('DEMO', 0, 0);
  context.restore();
  context.fillStyle = '#8a2837';
  context.font = 'bold 34px sans-serif';
  context.textAlign = 'center';
  context.fillText('DEMO ONLY · NOT AN IDENTITY DOCUMENT', 800, 840);
  return encodePhoto(canvas);
}

function waitForFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const clear = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const ready = () => {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      clear(); resolve();
    };
    const failed = () => { clear(); reject(captureError('documentCameraUnavailable')); };
    const aborted = () => { clear(); reject(new DOMException('Camera stopped.', 'AbortError')); };
    timeout = setTimeout(() => { clear(); reject(captureError('cameraTimeout')); }, 15_000);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else ready();
  });
}

/** Rear-camera photographs with a quality-gated automatic shutter and manual fallback. */
export function useDocumentCapture({ options, assets, type, side = 'front', simulation, onCapture, onFailure }: {
  options: DocumentOptions;
  assets: AssetOptions;
  type: DocumentType;
  side?: DocumentSide;
  simulation: boolean;
  onCapture: (photo: Blob) => void;
  onFailure: (error: Error) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef<{ stop(): void } | null>(null);
  const guidanceAvailable = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const trackListeners = useRef<Array<() => void>>([]);
  const holdRef = useRef(createDocumentHold(options.holdDurationMs));
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const automaticCapture = useRef<() => void>(() => {});
  const generation = useRef(0);
  const mounted = useRef(true);
  const statusRef = useRef<DocumentCameraStatus>('idle');
  const configuration = useRef({ options, assets, type, side, simulation });
  const callbacks = useRef({ onCapture, onFailure });
  configuration.current = { options, assets, type, side, simulation };
  callbacks.current = { onCapture, onFailure };
  const [status, setStatus] = useState<DocumentCameraStatus>('idle');
  const [feedback, setFeedback] = useState<DocumentGuideFeedback>('searching');
  const [progress, setProgress] = useState(0);

  const updateStatus = useCallback((next: DocumentCameraStatus) => {
    statusRef.current = next;
    if (mounted.current) setStatus(next);
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    clearTimeout(holdTimer.current); holdTimer.current = undefined;
    holdRef.current.reset();
    guidanceAvailable.current = false;
    controllerRef.current?.abort(); controllerRef.current = null;
    trackerRef.current?.stop(); trackerRef.current = null;
    trackListeners.current.forEach(remove => remove()); trackListeners.current = [];
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mounted.current) { setFeedback('searching'); setProgress(0); }
    updateStatus('idle');
  }, [updateStatus]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  const fail = useCallback((failure: unknown, attempt: number) => {
    if (!mounted.current || generation.current !== attempt) return;
    const error = failure instanceof Error ? failure : new Error(String(failure));
    stop(); callbacks.current.onFailure(error);
  }, [stop]);

  const start = useCallback(async () => {
    if (!mounted.current) return;
    stop();
    const attempt = generation.current;
    const settings = configuration.current;
    holdRef.current = createDocumentHold(settings.options.holdDurationMs);
    if (settings.simulation) { setFeedback('off'); updateStatus('ready'); return; }
    const controller = new AbortController(); controllerRef.current = controller;
    updateStatus('requesting');
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        const error = new Error('cameraUnsupported'); error.name = 'UnsupportedCameraError'; throw error;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, ...settings.options.camera },
      });
      if (!mounted.current || generation.current !== attempt) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw captureError('documentCameraUnavailable');
      for (const track of stream.getVideoTracks()) {
        const ended = () => fail(captureError('documentCameraUnavailable'), attempt);
        track.addEventListener('ended', ended);
        trackListeners.current.push(() => track.removeEventListener('ended', ended));
      }
      video.srcObject = stream;
      await Promise.all([waitForFrame(video, controller.signal), video.play()]);
      if (!mounted.current || generation.current !== attempt) return;
      updateStatus('ready');
      if (settings.options.detection === false) { setFeedback('off'); return; }
      const guide = guideRef.current;
      if (!guide) { setFeedback('unavailable'); return; }
      const currentAttempt = () => mounted.current && generation.current === attempt && statusRef.current === 'ready';
      const resetHold = () => {
        if (!currentAttempt() || !guidanceAvailable.current) return;
        clearTimeout(holdTimer.current); holdTimer.current = undefined;
        holdRef.current.reset(performance.now()); setProgress(0); setFeedback('searching');
      };
      window.addEventListener('resize', resetHold);
      window.addEventListener('orientationchange', resetHold);
      document.addEventListener('visibilitychange', resetHold);
      trackListeners.current.push(() => {
        window.removeEventListener('resize', resetHold);
        window.removeEventListener('orientationchange', resetHold);
        document.removeEventListener('visibilitychange', resetHold);
      });
      try {
        const tracker = await createDocumentTracker({ video, guide, type: settings.type, assets: settings.assets, signal: controller.signal,
          onDetection: (detection, timestamp) => {
            if (!currentAttempt()) return;
            guidanceAvailable.current = true;
            clearTimeout(holdTimer.current);
            const now = performance.now();
            const geometry = documentPreviewGeometry(video, guide);
            const result = holdRef.current.observe(document.hidden ? { reason: 'searching' } : detection,
              timestamp, now, geometry?.key ?? '');
            setFeedback(result.feedback); setProgress(result.progress);
            holdTimer.current = setTimeout(resetHold, Math.max(0, 500 - (now - timestamp)));
            if (result.capture && configuration.current.options.autoCapture !== false) automaticCapture.current();
          },
          onError: () => {
            if (!mounted.current || generation.current !== attempt) return;
            guidanceAvailable.current = false;
            clearTimeout(holdTimer.current); holdRef.current.reset(); setProgress(0);
            if (statusRef.current === 'ready') setFeedback('unavailable');
          },
        });
        if (!mounted.current || generation.current !== attempt || statusRef.current === 'idle') tracker.stop();
        else trackerRef.current = tracker;
      } catch {
        // Guidance is optional: unsupported/blocked workers must not prevent photographs.
        if (currentAttempt()) { guidanceAvailable.current = false; setFeedback('unavailable'); }
      }
    } catch (failure) { fail(failure, attempt); }
  }, [fail, stop, updateStatus]);

  const capture = useCallback(async (type: DocumentType, side: DocumentSide, automatic = false) => {
    if (!mounted.current || statusRef.current !== 'ready') return;
    const attempt = generation.current;
    updateStatus('capturing');
    clearTimeout(holdTimer.current); holdRef.current.reset(performance.now()); setProgress(0);
    try {
      const video = videoRef.current;
      if (!configuration.current.simulation && !video) throw captureError('documentCameraUnavailable');
      const geometry = video && guideRef.current ? documentPreviewGeometry(video, guideRef.current) : null;
      if (automatic && (!geometry || document.hidden)) {
        setFeedback('searching'); updateStatus('ready'); return;
      }
      const photo = configuration.current.simulation ? await simulatedDocument(type, side) : await snapshot(video!);
      if (!mounted.current || generation.current !== attempt) return;
      if (automatic) {
        const detection = await checkPhoto(photo, geometry!, type);
        if (!mounted.current || generation.current !== attempt) return;
        const currentGeometry = video && guideRef.current ? documentPreviewGeometry(video, guideRef.current) : null;
        if (detection.reason !== 'ready' || geometry!.key !== currentGeometry?.key || document.hidden) {
          setFeedback(guidanceAvailable.current ? detection.reason === 'ready' ? 'searching' : detection.reason : 'unavailable');
          updateStatus('ready'); return;
        }
      }
      stop(); callbacks.current.onCapture(photo);
    } catch (failure) { fail(failure, attempt); }
  }, [fail, stop, updateStatus]);

  automaticCapture.current = () => {
    const settings = configuration.current;
    if (!settings.simulation && settings.options.detection !== false && settings.options.autoCapture !== false) {
      void capture(settings.type, settings.side, true);
    }
  };

  return { videoRef, guideRef, feedback, progress, status, start, capture, stop };
}
