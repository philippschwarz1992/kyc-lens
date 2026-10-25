/** Local comparison only. A match does not establish authenticity or liveness. */
export type FaceMatchStatus = 'match' | 'no_match' | 'inconclusive' | 'unavailable';

export type FaceMatchReason =
  | 'compared' | 'uncertain_score' | 'invalid_options' | 'invalid_image'
  | 'no_document_face' | 'no_selfie_face' | 'ambiguous_document_face' | 'multiple_selfie_faces'
  | 'document_face_too_small' | 'selfie_face_too_small'
  | 'document_pose' | 'selfie_pose' | 'document_quality' | 'selfie_quality'
  | 'invalid_embedding' | 'unsupported_browser' | 'invalid_assets' | 'model_error'
  | 'worker_error' | 'timeout' | 'simulation';

export interface FaceMatchResult {
  status: FaceMatchStatus;
  reason: FaceMatchReason;
  /** Cosine similarity, never a probability or a percentage confidence. */
  score?: number;
  threshold: number;
  inconclusiveMargin: number;
  models: { detector: 'yunet-2023mar'; recognizer: 'sface-2021dec' };
  durationMs?: number;
}

export interface FaceMatchAssets {
  /** Same-origin location of copied package assets. Default: /kyc-assets. */
  baseUrl?: string;
  matchWorkerUrl?: string;
  matchWasmBaseUrl?: string;
  faceDetectorModelUrl?: string;
  faceRecognizerModelUrl?: string;
}

export interface FaceMatchOptions {
  document: Blob;
  selfie: Blob;
  assets?: FaceMatchAssets;
  /** Upstream example threshold, not calibrated passport-to-selfie accuracy. Default: 0.363. */
  threshold?: number;
  /** Symmetric nondecision band around the threshold. Default: 0.03. */
  inconclusiveMargin?: number;
  /** Includes worker startup, model loading, and inference. Default: 45000. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type CompareFacesOptions = FaceMatchOptions;

export interface ResolvedFaceMatchAssets {
  workerUrl: string;
  wasmBaseUrl: string;
  detectorUrl: string;
  recognizerUrl: string;
}

export interface FaceMatchWorkerRequest {
  type: 'compare';
  document: Blob;
  selfie: Blob;
  assets: ResolvedFaceMatchAssets;
  threshold: number;
  inconclusiveMargin: number;
}

export interface FaceMatchWorkerResponse {
  type: 'result';
  result: FaceMatchResult;
}

export const DEFAULT_MATCH_THRESHOLD = 0.363;
export const DEFAULT_INCONCLUSIVE_MARGIN = 0.03;
export const FACE_MATCH_MODELS = { detector: 'yunet-2023mar', recognizer: 'sface-2021dec' } as const;

export function comparisonResult(
  status: FaceMatchStatus, reason: FaceMatchReason,
  threshold = DEFAULT_MATCH_THRESHOLD, inconclusiveMargin = DEFAULT_INCONCLUSIVE_MARGIN,
): FaceMatchResult {
  return { status, reason, threshold, inconclusiveMargin, models: { ...FACE_MATCH_MODELS } };
}

export function validDecisionOptions(threshold: number, margin: number): boolean {
  return Number.isFinite(threshold) && Number.isFinite(margin) && margin >= 0 && margin <= 0.25
    && threshold - margin >= -1 && threshold + margin <= 1;
}

export function validImageBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob && value.size > 0 && value.size <= 24 * 1024 * 1024
    && (value.type === 'image/jpeg' || value.type === 'image/png' || value.type === 'image/webp');
}
