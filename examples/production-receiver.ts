/**
 * Example production receiver for `apiBaseUrl`. It binds every capture session to the logged-in
 * customer and stores the confirmed capture under that customer, so support can look it up later.
 *
 * It uses only the Fetch API (`Request`/`Response`, Web Crypto), so it runs on Node 18+, Next.js
 * route handlers, Hono, Remix, Bun, Deno and Cloudflare Workers. Plug in your own authentication,
 * database and object storage through `ReceiverOptions`. It stores; it never approves an identity.
 *
 * Routes (relative to the `apiBaseUrl` you pass to KycFlow, for example `/api/kyc`):
 *   POST /sessions               -> { id, token }
 *   POST /sessions/:id/capture   -> receipt (metadata and file keys, never media bytes)
 */

const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
const SESSION_TTL_MS = 15 * 60 * 1000;
const CHALLENGES = new Set(['center', 'turn-left', 'turn-right', 'look-up', 'look-down', 'closer', 'further']);
const DOCUMENT_TYPES = new Set(['id-card', 'drivers-license', 'passport']);

export interface CaptureMetadata {
  challenges: { challenge: string; completedAt: number; durationMs: number }[];
  capturedAt: string;
  mode: 'camera' | 'simulation';
  document?: { type: 'id-card' | 'drivers-license' | 'passport' };
}

export interface StoredSession {
  id: string;
  customerId: string;
  /** SHA-256 of the bearer token; the token itself is never stored. */
  tokenHash: string;
  expiresAt: number;
  /** Set once the capture is committed. */
  captureDigest?: string;
  receipt?: CaptureReceipt;
}

export interface MediaFile { field: 'selfie' | 'faceVideo' | 'documentFront' | 'documentBack'; type: string; bytes: Uint8Array<ArrayBuffer> }

export interface CaptureReceipt {
  sessionId: string;
  customerId: string;
  status: 'capture_complete';
  receivedAt: string;
  metadata: CaptureMetadata;
  /** Storage keys by form field, for example `customers/<id>/kyc/<session>/selfie.jpg`. */
  files: Partial<Record<MediaFile['field'], { key: string; type: string; sizeBytes: number }>>;
}

export interface ReceiverOptions {
  /** Resolve the logged-in customer from your own session cookie or auth header, or null. */
  authenticate(request: Request): Promise<{ customerId: string } | null>;
  sessions: {
    create(session: StoredSession): Promise<void>;
    get(id: string): Promise<StoredSession | null>;
    /**
     * Atomically set captureDigest/receipt only if the session has no capture yet
     * (for example `UPDATE ... WHERE id = $1 AND capture_digest IS NULL`). Return false if it already had one.
     */
    commitCapture(id: string, digest: string, receipt: CaptureReceipt): Promise<boolean>;
  };
  /** Write one object to private storage (S3, R2, GCS, Azure Blob). Encrypt at rest; never make it public. */
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Remove objects written for a capture that failed to commit. */
  deleteObjects(keys: string[]): Promise<void>;
  /** Called after commit, for example to attach the receipt to the customer record or start a review. */
  onCaptureStored?(receipt: CaptureReceipt): Promise<void>;
  /** Reject simulated captures in production. Default: true. */
  rejectSimulation?: boolean;
}

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', input)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMetadata(raw: string): CaptureMetadata {
  if (raw.length > 16 * 1024) throw new ApiError(400, 'Capture metadata is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ApiError(400, 'Capture metadata must be valid JSON.'); }
  if (!isRecord(parsed)) throw new ApiError(400, 'Invalid capture metadata.');
  if (parsed.mode !== 'camera' && parsed.mode !== 'simulation') throw new ApiError(400, 'Unsupported capture mode.');
  const capturedAt = typeof parsed.capturedAt === 'string' ? Date.parse(parsed.capturedAt) : NaN;
  if (!Number.isFinite(capturedAt) || capturedAt < Date.now() - 24 * 60 * 60 * 1000 || capturedAt > Date.now() + 60_000) {
    throw new ApiError(400, 'capturedAt must be an ISO timestamp within the last 24 hours.');
  }
  if (!Array.isArray(parsed.challenges) || parsed.challenges.length < 1 || parsed.challenges.length > 20) {
    throw new ApiError(400, 'Capture requires between one and twenty challenge entries.');
  }
  const challenges = parsed.challenges.map((item: unknown) => {
    if (!isRecord(item) || typeof item.challenge !== 'string' || !CHALLENGES.has(item.challenge)
      || typeof item.completedAt !== 'number' || !Number.isFinite(item.completedAt) || item.completedAt < 0
      || typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) || item.durationMs < 0 || item.durationMs > 120_000) {
      throw new ApiError(400, 'Invalid challenge metadata.');
    }
    return { challenge: item.challenge, completedAt: item.completedAt, durationMs: item.durationMs };
  });
  let document: CaptureMetadata['document'];
  if (parsed.document !== undefined) {
    if (!isRecord(parsed.document) || !DOCUMENT_TYPES.has(String(parsed.document.type))) throw new ApiError(400, 'Invalid document type metadata.');
    document = { type: parsed.document.type as NonNullable<CaptureMetadata['document']>['type'] };
  }
  return { challenges, capturedAt: parsed.capturedAt as string, mode: parsed.mode, ...(document ? { document } : {}) };
}

/** Signature check only. Decode or re-encode images server-side before anyone opens them. */
function imageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 16 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return 'image/jpeg';
  if (bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function videoType(bytes: Uint8Array): 'video/webm' | 'video/mp4' | null {
  if (bytes.length >= 16 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  if (bytes.length >= 16 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') return 'video/mp4';
  return null;
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/webm': 'webm', 'video/mp4': 'mp4' };
const FILE_NAMES: Record<MediaFile['field'], string> = { selfie: 'selfie', faceVideo: 'face-video', documentFront: 'document-front', documentBack: 'document-back' };

async function readMedia(form: FormData, field: MediaFile['field'], required: boolean): Promise<MediaFile | undefined> {
  const value = form.get(field);
  if (value === null) {
    if (required) throw new ApiError(400, `Missing ${field}.`);
    return undefined;
  }
  if (typeof value === 'string') throw new ApiError(400, `${field} must be a file.`);
  const video = field === 'faceVideo';
  if (value.size === 0 || value.size > (video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) throw new ApiError(413, `${field} is empty or too large.`);
  const bytes = new Uint8Array(await value.arrayBuffer());
  const type = video ? videoType(bytes) : imageType(bytes);
  const claimed = value.type.split(';', 1)[0].trim().toLowerCase();
  if (!type || claimed !== type) throw new ApiError(400, `${field} has an unsupported or mismatched format.`);
  return { field, type, bytes };
}

/** Read at most MAX_BODY_BYTES, even when Content-Length is missing or wrong. */
async function boundedFormData(request: Request): Promise<FormData> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, 'Capture is too large.');
  if (!request.body) throw new ApiError(400, 'Missing capture body.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, 'Capture is too large.'); }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return await new Response(body, { headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' } }).formData();
  } catch { throw new ApiError(400, 'Capture must be multipart form data.'); }
}

export function createKycReceiver(options: ReceiverOptions) {
  const rejectSimulation = options.rejectSimulation ?? true;

  async function createSession(request: Request): Promise<Response> {
    const customer = await options.authenticate(request);
    if (!customer) throw new ApiError(401, 'Unauthorized.');
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const session: StoredSession = {
      id: crypto.randomUUID(),
      customerId: customer.customerId,
      tokenHash: await sha256(token),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    await options.sessions.create(session);
    return json(201, { id: session.id, token });
  }

  async function submitCapture(request: Request, sessionId: string): Promise<Response> {
    const customer = await options.authenticate(request);
    if (!customer) throw new ApiError(401, 'Unauthorized.');
    const session = await options.sessions.get(sessionId);
    // The same 404 for unknown and foreign sessions, so ids of other customers cannot be probed.
    if (!session || session.customerId !== customer.customerId) throw new ApiError(404, 'Unknown session.');
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!bearer || !constantTimeEqual(await sha256(bearer), session.tokenHash)) throw new ApiError(401, 'Invalid capture token.');

    const form = await boundedFormData(request);
    const metadataField = form.get('metadata');
    if (typeof metadataField !== 'string') throw new ApiError(400, 'Missing metadata.');
    const metadata = validateMetadata(metadataField);
    if (rejectSimulation && metadata.mode === 'simulation') throw new ApiError(400, 'Simulated captures are not accepted.');
    const media = [
      await readMedia(form, 'selfie', true),
      await readMedia(form, 'faceVideo', false),
      await readMedia(form, 'documentFront', Boolean(metadata.document)),
      await readMedia(form, 'documentBack', false),
    ].filter((item): item is MediaFile => item !== undefined);
    if (!metadata.document && media.some(item => item.field.startsWith('document'))) throw new ApiError(400, 'Document photos need document metadata.');

    // The client may retry an identical upload after a network error: return the same receipt.
    const digestParts = [metadataField, ...media.map(item => `${item.field}:${item.type}:${item.bytes.byteLength}`)];
    const digest = await sha256(digestParts.join('\n') + '\n' + (await Promise.all(media.map(item => sha256(item.bytes)))).join(','));
    if (session.captureDigest) {
      if (session.captureDigest === digest && session.receipt) return json(200, session.receipt);
      throw new ApiError(409, 'This session already has a different capture.');
    }
    if (session.expiresAt < Date.now()) throw new ApiError(410, 'This capture session has expired.');

    // The digest in the key keeps a concurrent, different upload from overwriting committed files.
    const prefix = `customers/${encodeURIComponent(customer.customerId)}/kyc/${session.id}/${digest.slice(0, 16)}`;
    const receipt: CaptureReceipt = {
      sessionId: session.id, customerId: customer.customerId, status: 'capture_complete',
      receivedAt: new Date().toISOString(), metadata, files: {},
    };
    const written: string[] = [];
    try {
      for (const item of media) {
        const key = `${prefix}/${FILE_NAMES[item.field]}.${EXTENSIONS[item.type]}`;
        await options.putObject(key, item.bytes, item.type);
        written.push(key);
        receipt.files[item.field] = { key, type: item.type, sizeBytes: item.bytes.byteLength };
      }
      const metadataKey = `${prefix}/metadata.json`;
      await options.putObject(metadataKey, new TextEncoder().encode(JSON.stringify(receipt, null, 2)), 'application/json');
      written.push(metadataKey);
      if (!await options.sessions.commitCapture(session.id, digest, receipt)) {
        // A concurrent request committed first. An identical capture shares our keys, so keep them.
        const current = await options.sessions.get(session.id);
        if (current?.captureDigest === digest && current.receipt) return json(200, current.receipt);
        throw new ApiError(409, 'This session already has a different capture.');
      }
    } catch (error) {
      await options.deleteObjects(written).catch(() => {});
      throw error;
    }
    await options.onCaptureStored?.(receipt);
    return json(201, receipt);
  }

  /** Handle a request whose path is relative to apiBaseUrl, for example `/sessions` or `/sessions/<id>/capture`. */
  return async function handle(request: Request, path: string): Promise<Response> {
    try {
      if (request.method !== 'POST') throw new ApiError(405, 'Method not allowed.');
      if (path === '/sessions') return await createSession(request);
      const match = /^\/sessions\/([0-9a-f-]{36})\/capture$/.exec(path);
      if (match) return await submitCapture(request, match[1]);
      throw new ApiError(404, 'Not found.');
    } catch (error) {
      if (error instanceof ApiError) return json(error.status, { error: error.message });
      // Log the error id only; never log request bodies, media or tokens.
      console.error('kyc receiver failed', error instanceof Error ? error.name : 'unknown');
      return json(500, { error: 'The capture could not be stored.' });
    }
  };
}

/*
 * Wiring example (Next.js App Router, app/api/kyc/[...path]/route.ts):
 *
 *   import { createKycReceiver } from '@/lib/kyc-receiver';
 *   import { getCustomer } from '@/lib/auth';
 *   import { db } from '@/lib/db';
 *   import { s3Put, s3Delete } from '@/lib/storage';
 *
 *   const handle = createKycReceiver({
 *     authenticate: async request => { const user = await getCustomer(request); return user ? { customerId: user.id } : null; },
 *     sessions: {
 *       create: session => db.kycSessions.insert(session),
 *       get: id => db.kycSessions.find(id),
 *       commitCapture: (id, digest, receipt) => db.kycSessions.setCaptureIfEmpty(id, digest, receipt),
 *     },
 *     putObject: (key, bytes, type) => s3Put(process.env.KYC_BUCKET!, key, bytes, type),
 *     deleteObjects: keys => s3Delete(process.env.KYC_BUCKET!, keys),
 *     onCaptureStored: receipt => db.customers.addKycCapture(receipt.customerId, receipt),
 *   });
 *
 *   export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
 *     return handle(request, '/' + (await params).path.join('/'));
 *   }
 *
 * Client: <KycFlow apiBaseUrl="/api/kyc" upload={{ retry: {} }} onComplete={result => ...} />
 */
