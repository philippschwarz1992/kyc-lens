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

export type SourceRect = { x: number; y: number; width: number; height: number };

// Space kept around the guide, as a share of its size, so slightly misplaced edges stay in the photo.
const DOCUMENT_CROP_MARGIN = 0.06;

/** The guide in camera pixels, widened by the margin: what the person framed, in the document's own proportions. */
export function documentCropRect(geometry: { crop: SourceRect; guide: DocumentGuide }, sourceWidth: number, sourceHeight: number): { rect: SourceRect; guide: DocumentGuide } {
  const { crop, guide } = geometry;
  const gx = crop.x + guide.x * crop.width, gy = crop.y + guide.y * crop.height;
  const gw = guide.width * crop.width, gh = guide.height * crop.height;
  const x = Math.max(0, Math.floor(gx - gw * DOCUMENT_CROP_MARGIN)), y = Math.max(0, Math.floor(gy - gh * DOCUMENT_CROP_MARGIN));
  const right = Math.min(sourceWidth, Math.ceil(gx + gw * (1 + DOCUMENT_CROP_MARGIN))), bottom = Math.min(sourceHeight, Math.ceil(gy + gh * (1 + DOCUMENT_CROP_MARGIN)));
  const rect = { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  return { rect, guide: { x: (gx - x) / rect.width, y: (gy - y) / rect.height, width: gw / rect.width, height: gh / rect.height } };
}
