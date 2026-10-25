import type { DocumentDetection, DocumentGuide } from '../core/document.js';
import type { DocumentType } from '../types.js';

export interface DocumentFrameRequest {
  type: 'frame';
  bitmap: ImageBitmap;
  guide: DocumentGuide;
  documentType: DocumentType;
  timestamp: number;
}
export type DocumentWorkerResponse =
  | { type: 'ready' }
  | { type: 'detection'; detection: DocumentDetection; timestamp: number }
  | { type: 'error' };
