import type { DocumentDetection, DocumentDetectionReason, DocumentPoint } from './document.js';

export interface DocumentHoldState {
  feedback: DocumentDetectionReason | 'hold-still';
  progress: number;
  capture: boolean;
}

/** Longest gap between document observations, so handheld jitter and slower phone analysis keep the hold. */
export const MAX_DOCUMENT_OBSERVATION_GAP_MS = 1000;

/**
 * A shutter advances only on fresh, consecutive observations of the same stationary outline.
 * With no hold (the default) the first fresh, clear observation captures at once.
 */
export function createDocumentHold(holdDurationMs = 0) {
  const duration = Number.isFinite(holdDurationMs) ? Math.max(0, Math.min(10_000, holdDurationMs)) : 0;
  let started = -Infinity;
  let previous = -Infinity;
  let lastObservation = -Infinity;
  let frames = 0;
  let key = '';
  let anchor: readonly DocumentPoint[] | undefined;
  const reset = (minimumTimestamp = -Infinity) => {
    started = previous = -Infinity; frames = 0; key = ''; anchor = undefined;
    if (Number.isFinite(minimumTimestamp)) lastObservation = Math.max(lastObservation, minimumTimestamp);
  };
  const usableCorners = (corners: readonly DocumentPoint[] | undefined): corners is readonly DocumentPoint[] =>
    corners?.length === 4 && corners.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);

  return {
    reset,
    observe(detection: DocumentDetection, timestamp: number, now: number, geometryKey: string): DocumentHoldState {
      if (!Number.isFinite(timestamp) || !Number.isFinite(now) || timestamp > now + 1 || now - timestamp > MAX_DOCUMENT_OBSERVATION_GAP_MS
        || timestamp <= lastObservation || !geometryKey) {
        reset(); return { feedback: 'searching', progress: 0, capture: false };
      }
      lastObservation = timestamp;
      if (detection.reason !== 'ready' || !usableCorners(detection.corners)) {
        reset(); return { feedback: detection.reason === 'ready' ? 'searching' : detection.reason, progress: 0, capture: false };
      }
      const moved = anchor?.some((point, index) => Math.hypot(point.x - detection.corners![index]!.x,
        point.y - detection.corners![index]!.y) > 0.04);
      // Handheld jitter and slower phone analysis must not restart the hold; real repositioning does.
      if (!anchor || key !== geometryKey || timestamp - previous > MAX_DOCUMENT_OBSERVATION_GAP_MS || moved) {
        started = timestamp; frames = 0; anchor = detection.corners.map(point => ({ ...point })); key = geometryKey;
      }
      previous = timestamp; frames++;
      if (duration === 0) return { feedback: 'ready', progress: 1, capture: true };
      const progress = Math.min(1, (timestamp - started) / duration);
      const capture = progress >= 1 && frames >= 3;
      return { feedback: capture ? 'ready' : 'hold-still', progress: capture ? 1 : Math.min(progress, 0.99), capture };
    },
  };
}
