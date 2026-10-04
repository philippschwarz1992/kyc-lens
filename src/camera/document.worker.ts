import { analyzeDocument } from '../core/document.js';
import type { DocumentFrameRequest, DocumentWorkerResponse } from './document-protocol.js';

interface DocumentWorkerScope {
  onmessage: ((event: MessageEvent<DocumentFrameRequest>) => void) | null;
  postMessage(message: DocumentWorkerResponse): void;
}
const scope = globalThis as unknown as DocumentWorkerScope;
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null = null;

scope.onmessage = ({ data: request }): void => {
  if (request.type !== 'frame') return;
  try {
    const { width, height } = request.bitmap;
    if (!canvas) {
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!context) throw new Error('Document analysis unavailable.');
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.drawImage(request.bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    const detection = analyzeDocument({ data: pixels.data, width, height, guide: request.guide, type: request.documentType });
    scope.postMessage({ type: 'detection', detection, timestamp: request.timestamp });
  } catch {
    // Do not expose camera pixels or document details in diagnostics.
    scope.postMessage({ type: 'error' });
  } finally { request.bitmap.close(); }
};
scope.postMessage({ type: typeof OffscreenCanvas === 'undefined' ? 'error' : 'ready' });
