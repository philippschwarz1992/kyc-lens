import type { ApplicantField } from './applicant.ts';

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

/**
 * Data printed on the page, read by label (or by EU field number on driving licences). Text is folded as in the
 * MRZ and dates are ISO. Personal data: for the customer backend only.
 */
export interface PrintedFields {
  surname: string | null;
  givenNames: string | null;
  documentNumber: string | null;
  nationality: string | null;
  birthDate: string | null;
  placeOfBirth: string | null;
  sex: 'M' | 'F' | 'X' | null;
  issueDate: string | null;
  expiryDate: string | null;
}
export type CrossCheckedField = 'documentNumber' | 'surname' | 'givenNames' | 'birthDate' | 'expiryDate' | 'sex';

export interface ApplicantFieldCheck {
  /** The applicant's value; names folded as in the MRZ (Müller becomes MUELLER). */
  expected: string;
  /** The document's value, null when neither the zone nor the printed page gave one. */
  document: string | null;
  /** Where the document value was read: a valid zone or the printed page. */
  source: 'mrz' | 'printed' | null;
  result: 'match' | 'mismatch' | 'not-read';
}

/**
 * The applicant data from session creation against the document. Names match on their letters, in German (Ü as UE)
 * or plain transliteration; a first given name alone matches the full given names; a name the zone truncated only
 * has to start the applicant's. A field matches when the valid zone or the printed page agrees.
 */
export interface ApplicantCheck {
  /** `mismatch` when any field disagrees, `incomplete` when none does but one was not read. */
  result: 'match' | 'mismatch' | 'incomplete';
  /** One entry per field the applicant data held. */
  fields: Partial<Record<ApplicantField, ApplicantFieldCheck>>;
}

export interface VerificationResult {
  status: VerificationStatus;
  /**
   * Machine-readable reasons, e.g. `mrz-invalid`, `mrz-not-found`, `document-expired`, `document-type-mismatch`,
   * `document-quality-poor`, `document-face-not-found`, `face-mismatch`, `live-face-mismatch`, `liveness-failed`, `liveness-missing`,
   * and for review `applicant-data-mismatch` and `applicant-data-not-read` (see `applicantCheck`),
   * `printed-data-mismatch` (printed data and a valid MRZ disagree) and `printed-expiry-passed`.
   */
  reasons: string[];
  document: {
    /** Detected from the zone, or from printed keywords without one. */
    type: 'id-card' | 'drivers-license' | 'passport' | null;
    quality: DocumentQuality;
    mrz: DocumentZoneRead | null;
    /** Null when no labelled field was read. */
    printedFields: PrintedFields | null;
    /** Printed fields that disagree with a valid MRZ; empty when all agree or there is no valid MRZ. */
    fieldMismatches: CrossCheckedField[];
    ocrText?: string | null;
  };
  /** Cosine similarity of the document portrait and the selfie. */
  faceMatch: { score: number; threshold: number; decision: 'match' | 'no-match' } | null;
  /**
   * The document portrait against the face in each sampled video frame; `score` is the median cosine similarity.
   * Null when no video was sent, or the document or the video shows no face.
   */
  liveFaceMatch: { score: number; threshold: number; decision: 'match' | 'no-match'; framesCompared: number; framesMatched: number } | null;
  /** Mean passive anti-spoofing real-face probability, 0–1, over the sampled video frames. */
  liveness: { score: number; decision: 'pass' | 'fail'; framesWithFace: number; framesSampled: number } | null;
  /** Null (or absent from older analysis versions) when the session carried no applicant data. */
  applicantCheck?: ApplicantCheck | null;
}

/** Shape check for what the analysis service returns; the gateway refuses anything else. */
export function isVerificationResult(value: unknown): value is VerificationResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  const document = result.document as Record<string, unknown> | null;
  return ['approved', 'review', 'rejected'].includes(String(result.status))
    && Array.isArray(result.reasons) && result.reasons.every(reason => typeof reason === 'string')
    && typeof document === 'object' && document !== null && typeof document.quality === 'object' && 'mrz' in document
    && 'faceMatch' in result && 'liveFaceMatch' in result && 'liveness' in result;
}
