import type { DocumentGuide } from '../core/document.js';

/** Source crop displayed by a centered object-fit: cover video. */
export function documentPreviewCrop(sourceWidth: number, sourceHeight: number, viewWidth: number, viewHeight: number) {
  if (![sourceWidth, sourceHeight, viewWidth, viewHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.max(viewWidth / sourceWidth, viewHeight / sourceHeight);
  const width = Math.min(sourceWidth, viewWidth / scale);
  const height = Math.min(sourceHeight, viewHeight / scale);
  const sampleScale = Math.min(320 / viewWidth, 480 / viewHeight, 1);
  return {
    x: Math.max(0, Math.floor((sourceWidth - width) / 2)),
    y: Math.max(0, Math.floor((sourceHeight - height) / 2)),
    width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)),
    sampleWidth: Math.max(1, Math.round(viewWidth * sampleScale)),
    sampleHeight: Math.max(1, Math.round(viewHeight * sampleScale)),
  };
}

/** Measure the actual guide, including changes caused by viewport/safe-area resizing. */
export function documentPreviewGeometry(video: HTMLVideoElement, guideElement: HTMLElement) {
  const view = video.getBoundingClientRect();
  const frame = guideElement.getBoundingClientRect();
  const crop = documentPreviewCrop(video.videoWidth, video.videoHeight, view.width, view.height);
  if (!crop || !frame.width || !frame.height) return null;
  const guide: DocumentGuide = {
    x: (frame.left - view.left) / view.width, y: (frame.top - view.top) / view.height,
    width: frame.width / view.width, height: frame.height / view.height,
  };
  return { crop, guide, key: [video.videoWidth, video.videoHeight, crop.x, crop.y, crop.width, crop.height,
    view.width, view.height, guide.x, guide.y, guide.width, guide.height].map(value => value.toFixed(3)).join(':') };
}
