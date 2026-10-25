import { CaptureError, MAX_BODY_BYTES, parseCapture, sha256Hex, validateApplicant } from '@kyc-lens/contracts';
import { HttpError, json } from './http.js';
import type { SessionRecord, SessionStore } from './sessions.js';
import { captureKey, stagingPrefix, type StagedCapture, type Staging } from './staging.js';

export interface ApiConfig {
  /** `server`: only the customer backend (API key) creates sessions. `open`: anyone may, for the playground. */
  sessionMode: 'server' | 'open';
  apiKey?: string;
  /** Capture window after session creation. */
  sessionTtlMs: number;
}
export interface ApiDeps {
  config: ApiConfig;
  sessions: SessionStore;
  staging: Staging;
  enqueue(job: DeliveryJob): Promise<void>;
  now(): number;
}
export interface DeliveryJob { sessionId: string }

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function equal(a: string, b: string): boolean {
  const left = encoder.encode(a), right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}

const bearer = (request: Request) => {
  const header = request.headers.get('Authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
};
const isServer = (request: Request, config: ApiConfig) => {
  const token = bearer(request);
  return Boolean(config.apiKey && token && equal(token, config.apiKey));
};

async function authorizeSession(request: Request, deps: ApiDeps, id: string, allowServer: boolean): Promise<SessionRecord> {
  if (!SESSION_ID.test(id)) throw new HttpError(404, 'Unknown session.');
  const record = await deps.sessions.get(id);
  if (!record) throw new HttpError(404, 'Unknown session.');
  if (allowServer && isServer(request, deps.config)) return record;
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'A session bearer token is required.');
  if (!equal(await sha256Hex(encoder.encode(token)), record.tokenHash)) throw new HttpError(401, 'Invalid session bearer token.');
  return record;
}

/** Status for the browser and the customer backend: no media, no verdict. */
const statusBody = (record: SessionRecord) => ({
  sessionId: record.id, status: record.status, expiresAt: new Date(record.expiresAt).toISOString(),
  ...(record.receivedAt ? { receivedAt: record.receivedAt } : {}), ...(record.deliveredAt ? { deliveredAt: record.deliveredAt } : {}),
});

async function createSession(request: Request, deps: ApiDeps): Promise<Response> {
  if (deps.config.sessionMode !== 'open' && !isServer(request, deps.config)) throw new HttpError(401, 'Sessions are created by your backend with its API key.');
  if (deps.config.sessionMode === 'open') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Cross-origin requests are not allowed.');
  }
  const text = await request.text();
  if (text.length > 2048) throw new HttpError(413, 'Session request too large.');
  let body: unknown = {};
  if (text.trim()) { try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Session request must be JSON.'); } }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Session request must be a JSON object.');
  const { reference, applicant: rawApplicant, ...rest } = body as { reference?: unknown; applicant?: unknown };
  if (Object.keys(rest).length) throw new HttpError(400, 'A session request takes only reference and applicant.');
  if (reference !== undefined && (typeof reference !== 'string' || !/^[\w.:-]{1,128}$/.test(reference))) throw new HttpError(400, 'reference must be 1-128 letters, digits or ._:-');
  // The comparison is only worth something when the data comes from the customer backend, not from the browser.
  if (rawApplicant !== undefined && deps.config.sessionMode === 'open' && !isServer(request, deps.config)) throw new HttpError(403, 'Only your backend can send applicant data.');
  const applicant = rawApplicant === undefined ? undefined : validateApplicant(rawApplicant, deps.now());
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = deps.now();
  const record: SessionRecord = { id: crypto.randomUUID(), tokenHash: await sha256Hex(encoder.encode(token)), status: 'pending_capture', createdAt: now, expiresAt: now + deps.config.sessionTtlMs, ...(reference ? { reference } : {}), ...(applicant ? { applicant } : {}) };
  await deps.sessions.create(record);
  return json({ id: record.id, token, expiresAt: new Date(record.expiresAt).toISOString() }, 201);
}

async function submitCapture(request: Request, deps: ApiDeps, record: SessionRecord): Promise<Response> {
  if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data;')) throw new HttpError(415, 'Upload must use multipart/form-data.');
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new HttpError(413, 'Upload exceeds the 24 MB request limit.');
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_BODY_BYTES) throw new HttpError(413, 'Upload exceeds the 24 MB request limit.');
  let form: FormData;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('Content-Type')! }, body }).formData(); }
  catch { throw new HttpError(400, 'Unable to parse multipart upload.'); }
  const capture = await parseCapture(form, deps.now());
  const receivedAt = new Date(deps.now()).toISOString();
  const claim = await deps.sessions.beginCapture(record.id, capture.digest, receivedAt, deps.now());
  if (claim.result === 'missing') throw new HttpError(404, 'Unknown session.');
  if (claim.result === 'expired') throw new HttpError(410, 'This session has expired.');
  if (claim.result === 'conflict') throw new HttpError(409, 'This session already received a different capture.');
  // A retry of the same upload (lost response) gets the same answer and is not delivered twice.
  if (claim.result === 'duplicate') return json(statusBody(claim.record));
  try {
    const staged: StagedCapture = { sessionId: record.id, receivedAt, metadata: capture.metadata, files: [], ...(record.reference ? { reference: record.reference } : {}), ...(record.applicant ? { applicant: record.applicant } : {}) };
    for (const file of capture.files) {
      const key = `${stagingPrefix(record.id)}${file.filename}`;
      await deps.staging.put(key, file.bytes, file.type);
      staged.files.push({ field: file.field, filename: file.filename, type: file.type, sizeBytes: file.bytes.length, key });
    }
    await deps.staging.put(captureKey(record.id), JSON.stringify(staged), 'application/json');
    await deps.enqueue({ sessionId: record.id });
  } catch (error) {
    await deps.staging.deletePrefix(stagingPrefix(record.id)).catch(() => {});
    await deps.sessions.abandonCapture(record.id, capture.digest);
    throw error;
  }
  return json(statusBody(claim.record));
}

/** `/api/kyc/*`: session creation, status and capture upload. */
export async function handleApi(request: Request, deps: ApiDeps, pathname: string): Promise<Response> {
  try {
    if (pathname === '/api/kyc/sessions') {
      if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
      return await createSession(request, deps);
    }
    const match = /^\/api\/kyc\/sessions\/([^/]+)(\/capture)?$/.exec(pathname);
    if (!match) throw new HttpError(404, 'Not found.');
    const id = decodeURIComponent(match[1]!);
    if (!match[2]) {
      if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      return json(statusBody(await authorizeSession(request, deps, id, true)));
    }
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    return await submitCapture(request, deps, await authorizeSession(request, deps, id, false));
  } catch (error) {
    if (error instanceof HttpError || error instanceof CaptureError) return json({ error: error.message }, error.status);
    // Never echo internal errors to the client; the log keeps a short message for operators.
    console.error('kyc api error', error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : 'unknown');
    return json({ error: 'The request could not be processed.' }, 500);
  }
}
