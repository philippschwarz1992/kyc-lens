/**
 * The analysis service's verdict (`services/analysis`, `POST /analyze`). The gateway passes it
 * through unchanged; only the customer's backend receives it, never the browser.
 */
export type VerificationStatus = 'approved' | 'review' | 'rejected';
export type CheckDecision = 'pass' | 'fail' | 'inconclusive';

export interface DocumentZoneRead {
  format: 'TD1' | 'TD2' | 'TD3';
  kind: 'passport' | 'id-card' | 'visa' | 'other';
  valid: boolean;
  /** Parsed fields (names, number, nationality, dates, sex). Personal data: for the customer backend only. */
  fields: Record<string, string>;
}

export interface VerificationResult {
  status: VerificationStatus;
  /** Machine-readable reasons, e.g. `mrz_invalid`, `document_expired`, `face_mismatch`, `liveness_failed`. */
  reasons: string[];
  document: {
    type: string | null;
    quality: Record<string, number | boolean>;
    mrz: DocumentZoneRead | null;
    ocrText?: string;
  } | null;
  faceMatch: { score: number; threshold: number; decision: CheckDecision } | null;
  liveness: { score: number; decision: CheckDecision; framesWithFace: number } | null;
}

/** Shape check for what the analysis service returns; the gateway refuses anything else. */
export function isVerificationResult(value: unknown): value is VerificationResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return ['approved', 'review', 'rejected'].includes(String(result.status))
    && Array.isArray(result.reasons) && result.reasons.every(reason => typeof reason === 'string')
    && 'document' in result && 'faceMatch' in result && 'liveness' in result;
}
