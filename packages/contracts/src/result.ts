/**
 * The analysis service's verdict (`services/analysis`, `POST /analyze`; mirrors `app/schema.py`).
 * The gateway passes it through unchanged; only the customer's backend receives it, never the browser.
 */
export type VerificationStatus = 'approved' | 'review' | 'rejected';

export interface DocumentQuality {
  /** Variance of the Laplacian at 1000 px width; higher is sharper. */
  sharpness: number;
  /** Share of near-white pixels, 0–1. */
  glare: number;
  /** Mean grey level, 0–255. */
  brightness: number;
  /** The document outline was found and flattened. */
  rectified: boolean;
  acceptable: boolean;
  issues: Array<'blurry' | 'glare' | 'too-dark' | 'too-bright'>;
}

/** Fields parsed from the machine-readable zone. Personal data: for the customer backend only. */
export interface MrzFields {
  documentCode: string;
  issuingState: string;
  documentNumber: string;
  surname: string;
  givenNames: string;
  nationality: string;
  /** ISO 8601 date, null when the zone holds no real date. */
  birthDate: string | null;
  sex: 'M' | 'F' | 'X';
  expiryDate: string | null;
  optionalData: string | null;
}

export interface DocumentZoneRead {
  format: 'TD1' | 'TD2' | 'TD3';
  kind: 'passport' | 'id-card' | 'visa' | 'other';
  /** Every check digit matches and the dates are real calendar dates. */
  valid: boolean;
  fields: MrzFields;
}

export interface VerificationResult {
  status: VerificationStatus;
  /**
   * Machine-readable reasons, e.g. `mrz-invalid`, `mrz-not-found`, `document-expired`, `document-type-mismatch`,
   * `document-quality-poor`, `document-face-not-found`, `face-mismatch`, `liveness-failed`, `liveness-missing`.
   */
  reasons: string[];
  document: {
    /** Detected from the zone, or from printed keywords without one. */
    type: 'id-card' | 'drivers-license' | 'passport' | null;
    quality: DocumentQuality;
    mrz: DocumentZoneRead | null;
    ocrText?: string | null;
  };
  /** Cosine similarity of the document portrait and the selfie. */
  faceMatch: { score: number; threshold: number; decision: 'match' | 'no-match' } | null;
  /** Mean passive anti-spoofing real-face probability, 0–1, over the sampled video frames. */
  liveness: { score: number; decision: 'pass' | 'fail'; framesWithFace: number; framesSampled: number } | null;
}

/** Shape check for what the analysis service returns; the gateway refuses anything else. */
export function isVerificationResult(value: unknown): value is VerificationResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  const document = result.document as Record<string, unknown> | null;
  return ['approved', 'review', 'rejected'].includes(String(result.status))
    && Array.isArray(result.reasons) && result.reasons.every(reason => typeof reason === 'string')
    && typeof document === 'object' && document !== null && typeof document.quality === 'object' && 'mrz' in document
    && 'faceMatch' in result && 'liveness' in result;
}
