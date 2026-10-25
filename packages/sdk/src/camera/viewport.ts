import type { FaceObservation } from '../types.js';

/** Visible source rectangle for a centered object-fit: cover preview, in normalized coordinates. */
export interface FaceViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function coverViewport(sourceWidth: number, sourceHeight: number, viewWidth: number, viewHeight: number): FaceViewport | null {
  if (![sourceWidth, sourceHeight, viewWidth, viewHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.max(viewWidth / sourceWidth, viewHeight / sourceHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const width = Math.min(1, viewWidth / scale / sourceWidth);
  const height = Math.min(1, viewHeight / scale / sourceHeight);
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return null;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

/** Keep full-frame face counts/angles while evaluating centering and size in the visible preview. */
export function mapFaceToViewport(observation: FaceObservation, viewport: FaceViewport | null): FaceObservation {
  if (!viewport || ![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0) {
    return { ...observation, centerX: NaN, centerY: NaN, relativeSize: NaN };
  }
  return {
    ...observation,
    centerX: (observation.centerX - viewport.x) / viewport.width,
    centerY: (observation.centerY - viewport.y) / viewport.height,
    relativeSize: observation.relativeSize / viewport.height,
  };
}
