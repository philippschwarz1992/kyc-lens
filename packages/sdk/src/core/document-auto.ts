import type { DocumentDetection, DocumentDetectionReason, DocumentPoint } from './document.js';

export interface DocumentHoldState {
  feedback: DocumentDetectionReason | 'hold-still';
  progress: number;
  capture: boolean;
}

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
      if (!Number.isFinite(timestamp) || !Number.isFinite(now) || timestamp > now + 1 || now - timestamp > 1000
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
      if (!anchor || key !== geometryKey || timestamp - previous > 1000 || moved) {
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

/**
 * Keeps on-screen guidance readable. A new message must persist for `settleMs` and the current one
 * stays for at least `dwellMs`, so frame-to-frame detector noise does not flash text or colors.
 * `immediate` values (good news, failures that need action) replace the current message at once.
 */
export function createSteadyFeedback<T>({ settleMs = 700, dwellMs = 2000, immediate = () => false }: {
  settleMs?: number; dwellMs?: number; immediate?: (value: T) => boolean;
} = {}) {
  let shown: { value: T; since: number } | undefined;
  let pending: { value: T; since: number } | undefined;
  return {
    /** Returns the value to display at `now` and, if a change is pending, when to ask again. */
    update(value: T, now: number): { value: T; recheckMs?: number } {
      if (!shown || Object.is(value, shown.value) || immediate(value)) {
        if (!shown || !Object.is(value, shown.value)) shown = { value, since: now };
        pending = undefined;
        return { value: shown.value };
      }
      if (!pending || !Object.is(pending.value, value)) pending = { value, since: now };
      const due = Math.max(pending.since + settleMs, shown.since + dwellMs);
      if (now >= due) { shown = { value, since: now }; pending = undefined; return { value }; }
      return { value: shown.value, recheckMs: due - now };
    },
  };
}

/** Pearson correlation of two equally sized grayscale thumbnails; 1 means the same picture. */
export function thumbnailSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length < 2) return 0;
  let meanA = 0, meanB = 0;
  for (let i = 0; i < a.length; i++) { meanA += a[i]!; meanB += b[i]!; }
  meanA /= a.length; meanB /= b.length;
  let covariance = 0, varianceA = 0, varianceB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i]! - meanA, db = b[i]! - meanB;
    covariance += da * db; varianceA += da * da; varianceB += db * db;
  }
  return varianceA && varianceB ? covariance / Math.sqrt(varianceA * varianceB) : 0;
}

/** Whether `next` shows the same side as `previous`, including a side turned upside down. */
export function sameDocumentSide(previous: ArrayLike<number>, next: ArrayLike<number>, threshold = 0.88): boolean {
  const rotated = Array.from(next).reverse();
  return Math.max(thumbnailSimilarity(previous, next), thumbnailSimilarity(previous, rotated)) >= threshold;
}
