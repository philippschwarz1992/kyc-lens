import { CaptureError } from './capture.ts';

/**
 * What the customer's backend already knows about the person, given when it creates a session. The analysis service
 * compares it with the document; the outcome is `VerificationResult.applicantCheck`. Personal data: never sent to the browser.
 */
export interface Applicant {
  givenNames?: string;
  surname?: string;
  /** ISO 8601 date, `YYYY-MM-DD`. */
  birthDate?: string;
}
export type ApplicantField = keyof Applicant;
export const APPLICANT_FIELDS: readonly ApplicantField[] = ['givenNames', 'surname', 'birthDate'];

const NAME = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]{0,99}$/u;

/** At least one known field: names of letters, spaces, hyphens, apostrophes and dots, and a real past birth date. */
export function validateApplicant(value: unknown, now = Date.now()): Applicant {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CaptureError(400, 'applicant must be an object.');
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key]) => !APPLICANT_FIELDS.includes(key as ApplicantField))) {
    throw new CaptureError(400, 'applicant takes givenNames, surname and birthDate, at least one of them.');
  }
  const applicant: Applicant = {};
  for (const [key, raw] of entries as Array<[ApplicantField, unknown]>) {
    const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : null;
    if (key === 'birthDate') {
      const time = text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== text || time > now) throw new CaptureError(400, 'applicant.birthDate must be a past date as YYYY-MM-DD.');
    } else if (!text || !NAME.test(text)) throw new CaptureError(400, `applicant.${key} must be 1-100 letters, spaces, hyphens or apostrophes.`);
    applicant[key] = text!;
  }
  return applicant;
}
