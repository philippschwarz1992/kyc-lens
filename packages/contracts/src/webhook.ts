import type { CaptureField, CaptureMetadata } from './capture.ts';
import { sha256Hex } from './capture.ts';
import type { VerificationResult } from './result.ts';

/**
 * Delivery to the customer's backend: one multipart POST per session.
 * Part `event` is the JSON below; the media follow as files named by their capture field.
 */
export interface VerificationEvent {
  type: 'verification.completed';
  sessionId: string;
  /** The customer's own reference, given when the session was created. */
  reference?: string;
  receivedAt: string;
  metadata: CaptureMetadata;
  /** Null when analysis could not run; `analysisError` then says why and the case needs manual review. */
  analysis: VerificationResult | null;
  analysisError?: string;
  files: Array<{ field: CaptureField; filename: string; type: string; sizeBytes: number }>;
}

export const SIGNATURE_HEADER = 'X-KYC-Signature';
export const DELIVERY_HEADER = 'X-KYC-Delivery';
/** Deliveries older than this are refused, so a captured request cannot be replayed later. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<hex SHA-256 of the raw body>")>`. */
export async function signDelivery(secret: string, body: Uint8Array, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${await sha256Hex(body)}`)}`;
}

/** Constant-time check of a delivery signature against the raw request body. */
export async function verifyDelivery(secret: string, header: string | null, body: Uint8Array, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header || !secret) return false;
  const fields = Object.fromEntries(header.split(',').map(part => part.trim().split('=', 2) as [string, string]));
  const timestamp = Number(fields.t);
  if (!/^\d{1,12}$/.test(fields.t ?? '') || !/^[0-9a-f]{64}$/.test(fields.v1 ?? '') || Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = await hmacHex(secret, `${timestamp}.${await sha256Hex(body)}`);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ fields.v1!.charCodeAt(i);
  return difference === 0;
}
