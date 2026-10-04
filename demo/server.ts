import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Local development receiver only. Completed uploads are saved locally; identity is never approved. */
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 15 * 60 * 1000;
const CHALLENGES = new Set(['center', 'turn-left', 'turn-right', 'look-up', 'look-down', 'closer', 'further']);

interface Evidence {
  challenge: string;
  completedAt: number;
  durationMs: number;
}
interface CaptureMetadata {
  challenges: Evidence[];
  capturedAt: string;
  mode: 'camera' | 'simulation';
  document?: { type: 'id-card' | 'drivers-license' | 'passport' };
}
interface ImageMetadata { type: string; sizeBytes: number }
interface CaptureFiles {
  selfie: string;
  faceVideo?: string;
  documentFront?: string;
  documentBack?: string;
  metadata: 'metadata.json';
}
interface SavedMedia { filename: string; bytes: Uint8Array }
type CaptureReceipt = Omit<CaptureMetadata, 'document'> & {
  receivedAt: string;
  image: ImageMetadata;
  files: CaptureFiles;
  video?: ImageMetadata;
  document?: { type: 'id-card' | 'drivers-license' | 'passport'; front: ImageMetadata; back?: ImageMetadata };
};
interface LocalSession {
  id: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  capture?: CaptureReceipt;
  captureDigest?: string;
  pendingCapture?: { digest: string; save: Promise<CaptureReceipt> };
}

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function validateMetadata(raw: string): CaptureMetadata {
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) throw new ApiError(400, 'Capture metadata is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ApiError(400, 'Capture metadata must be valid JSON.'); }
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['challenges', 'capturedAt', 'mode', ...('document' in parsed ? ['document'] : [])])) {
    throw new ApiError(400, 'Metadata requires challenges, capturedAt, mode, and optionally document.');
  }
  let document: CaptureMetadata['document'];
  if ('document' in parsed) {
    if (!isRecord(parsed.document) || !hasOnlyKeys(parsed.document, ['type']) || !['id-card', 'drivers-license', 'passport'].includes(String(parsed.document.type))) throw new ApiError(400, 'Invalid document type metadata.');
    document = { type: parsed.document.type as NonNullable<CaptureMetadata['document']>['type'] };
  }
  if (parsed.mode !== 'camera' && parsed.mode !== 'simulation') throw new ApiError(400, 'Unsupported capture mode.');
  if (typeof parsed.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(parsed.capturedAt)) {
    throw new ApiError(400, 'capturedAt must be an ISO UTC timestamp.');
  }
  const capturedAt = Date.parse(parsed.capturedAt);
  if (!Number.isFinite(capturedAt) || capturedAt < Date.now() - 24 * 60 * 60 * 1000 || capturedAt > Date.now() + 60_000) {
    throw new ApiError(400, 'Capture timestamp must be within the last 24 hours.');
  }
  if (!Array.isArray(parsed.challenges) || parsed.challenges.length < 1 || parsed.challenges.length > 20) {
    throw new ApiError(400, 'Capture requires between one and twenty challenge entries.');
  }
  const challenges: Evidence[] = parsed.challenges.map((item: unknown) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ['challenge', 'completedAt', 'durationMs'])) throw new ApiError(400, 'Invalid challenge metadata.');
    if (typeof item.challenge !== 'string' || !CHALLENGES.has(item.challenge)) throw new ApiError(400, 'Unknown challenge.');
    if (typeof item.completedAt !== 'number' || !Number.isFinite(item.completedAt) || item.completedAt < 0) throw new ApiError(400, 'Invalid challenge completion timestamp.');
    if (typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) || item.durationMs < 0 || item.durationMs > 120_000) throw new ApiError(400, 'Invalid challenge duration.');
    return { challenge: item.challenge, completedAt: item.completedAt, durationMs: item.durationMs };
  });
  return { challenges, capturedAt: parsed.capturedAt, mode: parsed.mode, ...(document ? { document } : {}) };
}

/** A MIME label alone is untrusted: require the matching image signature and end marker. */
function validateImage(bytes: Uint8Array, claimedType: string): string {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  const isPng = bytes.length >= 45 && pngSignature.every((byte, index) => bytes[index] === byte)
    && bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82
    && bytes[bytes.length - 8] === 73 && bytes[bytes.length - 7] === 69
    && bytes[bytes.length - 6] === 78 && bytes[bytes.length - 5] === 68;
  const isJpeg = bytes.length >= 16 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  const type = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : null;
  if (!type || claimedType !== type) throw new ApiError(400, 'Images must be JPEG or PNG with a matching MIME type.');
  return type;
}

/** Inspect container signatures as well as MIME labels; this is not a liveness verdict. */
function validateVideo(bytes: Uint8Array, claimedType: string): string {
  const type = claimedType.split(';', 1)[0].trim().toLowerCase();
  let valid = false;
  if (type === 'video/webm' && bytes.length >= 16 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // Read the finite EBML header size and its DocType before the WebM Segment.
    const readSize = (offset: number) => {
      let length = 1;
      while (length <= 8 && (bytes[offset] & (0x80 >> (length - 1))) === 0) length++;
      if (length > 8 || offset + length > bytes.length) return null;
      let value = bytes[offset] & (0xff >> length);
      for (let index = 1; index < length; index++) value = value * 256 + bytes[offset + index];
      return Number.isSafeInteger(value) ? { length, value } : null;
    };
    const headerSize = readSize(4);
    if (headerSize && headerSize.value <= 1024) {
      const headerEnd = 4 + headerSize.length + headerSize.value;
      let offset = 4 + headerSize.length;
      let webmDocType = false;
      while (offset < headerEnd && headerEnd + 5 < bytes.length) {
        let idLength = 1;
        while (idLength <= 4 && (bytes[offset] & (0x80 >> (idLength - 1))) === 0) idLength++;
        if (idLength > 4 || offset + idLength > headerEnd) break;
        const isDocType = idLength === 2 && bytes[offset] === 0x42 && bytes[offset + 1] === 0x82;
        offset += idLength;
        const size = readSize(offset);
        if (!size || offset + size.length + size.value > headerEnd) break;
        offset += size.length;
        if (isDocType) webmDocType = size.value === 4 && bytes[offset] === 0x77 && bytes[offset + 1] === 0x65 && bytes[offset + 2] === 0x62 && bytes[offset + 3] === 0x6d;
        offset += size.value;
      }
      valid = offset === headerEnd && webmDocType && bytes[headerEnd] === 0x18 && bytes[headerEnd + 1] === 0x53 && bytes[headerEnd + 2] === 0x80 && bytes[headerEnd + 3] === 0x67;
    }
  } else if (type === 'video/mp4' && bytes.length >= 32) {
    // MediaRecorder MP4 has ftyp, moov and mdat boxes, including fragmented MP4.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const boxTypeAt = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    let offset = 0;
    let ftyp = false;
    let moov = false;
    let mdat = false;
    while (offset + 8 <= bytes.length) {
      let size = view.getUint32(offset);
      const boxType = boxTypeAt(offset + 4);
      let headerLength = 8;
      if (size === 1) {
        if (offset + 16 > bytes.length) break;
        const extendedSize = view.getBigUint64(offset + 8);
        if (extendedSize > BigInt(bytes.length)) break;
        size = Number(extendedSize);
        headerLength = 16;
      } else if (size === 0) size = bytes.length - offset;
      if (size < headerLength || offset + size > bytes.length) break;
      if (offset === 0) {
        if (boxType !== 'ftyp' || size < headerLength + 8 || (size - headerLength) % 4 !== 0) break;
        const brands = [boxTypeAt(offset + headerLength)];
        for (let brandOffset = offset + headerLength + 8; brandOffset + 4 <= offset + size; brandOffset += 4) brands.push(boxTypeAt(brandOffset));
        ftyp = brands.some(brand => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/.test(brand));
      }
      if (boxType === 'moov' && size > headerLength) moov = true;
      if (boxType === 'mdat' && size > headerLength) mdat = true;
      offset += size;
    }
    valid = offset === bytes.length && ftyp && moov && mdat;
  }
  if (!valid) throw new ApiError(400, 'Face video must be WebM or MP4 with a matching MIME type and container signature.');
  return type;
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const contentLength = request.headers['content-length'];
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) throw new ApiError(413, 'Upload exceeds the 24 MB request limit.');
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'Upload exceeds the 24 MB request limit.');
    parts.push(buffer);
  }
  return new Uint8Array(Buffer.concat(parts, size));
}

function checkLocalRequest(request: IncomingMessage) {
  const remoteAddress = request.socket.remoteAddress;
  if (!remoteAddress || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)) throw new ApiError(403, 'The sample API only accepts local development requests.');
  const host = request.headers.host;
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) throw new ApiError(403, 'Unsupported development host.');
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}` && origin !== `https://${host}`) throw new ApiError(403, 'Cross-origin requests are not allowed.');
}

function authenticate(request: IncomingMessage, session: LocalSession) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'A session bearer token is required.');
  const supplied = Buffer.from(authorization.slice(7), 'utf8');
  const expected = Buffer.from(session.token, 'utf8');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ApiError(401, 'Invalid session bearer token.');
}

/** Publish a complete folder by one rename; never clean up results from other requests. */
async function saveCapture(storageDir: string, sessionId: string, receipt: CaptureReceipt, media: SavedMedia[]): Promise<void> {
  const pendingDir = resolve(storageDir, '.pending');
  const finalDir = resolve(storageDir, sessionId);
  let stagingDir: string | undefined;
  try {
    await mkdir(pendingDir, { recursive: true, mode: 0o700 });
    if ((await lstat(pendingDir)).isSymbolicLink()) throw new Error('Unsafe staging directory.');
    stagingDir = await mkdtemp(join(pendingDir, `${sessionId}-`));
    for (const file of media) await writeFile(join(stagingDir, file.filename), file.bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(stagingDir, receipt.files.metadata), `${JSON.stringify({ sessionId, status: 'capture_complete', ...receipt }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    // A previous completed result must never be replaced, even by an empty folder.
    try { await lstat(finalDir); throw new Error('Result directory already exists.'); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    await rename(stagingDir, finalDir);
    stagingDir = undefined;
  } catch {
    throw new ApiError(500, 'The capture could not be saved. Please try again.');
  } finally {
    if (stagingDir && dirname(resolve(stagingDir)) === pendingDir && basename(stagingDir).startsWith(`${sessionId}-`)) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function demoApiPlugin({ storageDir = resolve(process.cwd(), 'results') }: { storageDir?: string } = {}): Plugin {
  storageDir = resolve(storageDir);
  const sessions = new Map<string, LocalSession>();
  const cleanup = () => {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
  };

  return {
    name: 'kyc-kit-local-demo-api',
    apply: 'serve',
    configureServer(server) {
      const timer = setInterval(cleanup, 60_000);
      timer.unref();
      server.httpServer?.once('close', () => { clearInterval(timer); sessions.clear(); });
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0];
        if (!pathname.startsWith('/api/kyc/')) return next();
        void (async () => {
          checkLocalRequest(request);
          cleanup();
          if (pathname === '/api/kyc/sessions' && request.method === 'POST') {
            if (sessions.size >= MAX_SESSIONS) throw new ApiError(429, 'Too many local sessions. Try again after they expire.');
            // Session creation deliberately has no payload in this local example.
            if (Number(request.headers['content-length'] ?? 0) > 1024) throw new ApiError(413, 'Session request is too large.');
            const now = Date.now();
            const session: LocalSession = { id: randomUUID(), token: randomBytes(32).toString('base64url'), createdAt: now, expiresAt: now + SESSION_TTL_MS };
            sessions.set(session.id, session);
            json(response, 201, { id: session.id, token: session.token });
            return;
          }
          const match = /^\/api\/kyc\/sessions\/([a-f\d-]{36})(\/capture)?$/.exec(pathname);
          if (!match) throw new ApiError(404, 'Unknown sample API endpoint.');
          const session = sessions.get(match[1]);
          if (!session || session.expiresAt <= Date.now()) throw new ApiError(404, 'Session not found or expired.');
          authenticate(request, session);
          if (!match[2] && request.method === 'GET') {
            json(response, 200, { sessionId: session.id, status: session.capture ? 'capture_complete' : 'pending_capture', expiresAt: new Date(session.expiresAt).toISOString(), ...(session.capture ?? {}) });
            return;
          }
          if (match[2] && request.method === 'POST') {
            const contentType = request.headers['content-type'];
            if (!contentType?.startsWith('multipart/form-data;')) throw new ApiError(415, 'Upload must use multipart/form-data.');
            const body = await readBody(request);
            let form: FormData;
            try {
              form = await new Request('http://localhost/api/kyc/capture', { method: 'POST', headers: { 'content-type': contentType }, body: body as BodyInit }).formData();
            } catch { throw new ApiError(400, 'Unable to parse multipart upload.'); }
            const file = form.get('selfie');
            const metadataText = form.get('metadata');
            if (!(file instanceof Blob) || file.size === 0 || typeof metadataText !== 'string') throw new ApiError(400, 'Invalid selfie or metadata field.');
            const metadata = validateMetadata(metadataText);
            const requiredFields = ['selfie', 'metadata', ...(form.has('faceVideo') ? ['faceVideo'] : []), ...(metadata.document ? ['documentFront', ...(metadata.document.type !== 'passport' ? ['documentBack'] : [])] : [])];
            if (Array.from(form.keys()).length !== requiredFields.length || requiredFields.some(field => form.getAll(field).length !== 1)) throw new ApiError(400, 'Upload fields must match the selected document type; cards require both sides and passports require only the photo page.');
            const digest = createHash('sha256').update(JSON.stringify(metadata));
            const files: CaptureFiles = { selfie: '', metadata: 'metadata.json' };
            const media: SavedMedia[] = [];
            const checkImage = async (field: 'selfie' | 'documentFront' | 'documentBack'): Promise<ImageMetadata> => {
              const image = form.get(field);
              if (!(image instanceof Blob) || image.size === 0) throw new ApiError(400, `Invalid ${field} image.`);
              if (image.size > MAX_IMAGE_BYTES) throw new ApiError(413, 'Each image must be at most 6 MB.');
              const bytes = new Uint8Array(await image.arrayBuffer());
              const type = validateImage(bytes, image.type);
              // Include field boundaries and byte lengths to avoid ambiguous concatenations.
              digest.update(field).update(String(bytes.length)).update(bytes);
              const prefix = field === 'selfie' ? 'selfie' : field === 'documentFront' ? 'document-front' : 'document-back';
              const filename = `${prefix}.${type === 'image/png' ? 'png' : 'jpg'}`;
              files[field] = filename; media.push({ filename, bytes });
              return { type, sizeBytes: image.size };
            };
            const image = await checkImage('selfie');
            let video: CaptureReceipt['video'];
            if (form.has('faceVideo')) {
              const file = form.get('faceVideo');
              if (!(file instanceof Blob) || file.size === 0) throw new ApiError(400, 'Invalid face video file.');
              if (file.size > MAX_VIDEO_BYTES) throw new ApiError(413, 'Face video must be at most 12 MB.');
              const bytes = new Uint8Array(await file.arrayBuffer());
              const type = validateVideo(bytes, file.type);
              digest.update('faceVideo').update(String(bytes.length)).update(bytes);
              video = { type, sizeBytes: file.size };
              const filename = `face-video.${type === 'video/mp4' ? 'mp4' : 'webm'}`;
              files.faceVideo = filename; media.push({ filename, bytes });
            }
            let document: CaptureReceipt['document'];
            if (metadata.document) {
              const front = await checkImage('documentFront');
              const back = metadata.document.type !== 'passport' ? await checkImage('documentBack') : undefined;
              document = { type: metadata.document.type, front, ...(back ? { back } : {}) };
            }
            const captureDigest = digest.digest('hex');
            if (session.expiresAt <= Date.now() || !sessions.has(session.id)) throw new ApiError(410, 'Session expired during upload.');
            if (session.capture) {
              if (session.captureDigest !== captureDigest) throw new ApiError(409, 'This session already received a different capture.');
              json(response, 200, { sessionId: session.id, status: 'capture_complete', ...session.capture });
              return;
            }
            if (session.pendingCapture) {
              if (session.pendingCapture.digest !== captureDigest) throw new ApiError(409, 'This session is already saving a different capture.');
              const capture = await session.pendingCapture.save;
              json(response, 200, { sessionId: session.id, status: 'capture_complete', ...capture });
              return;
            }
            const receipt: CaptureReceipt = { challenges: metadata.challenges, capturedAt: metadata.capturedAt, mode: metadata.mode, receivedAt: new Date().toISOString(), image, files, ...(video ? { video } : {}), ...(document ? { document } : {}) };
            const save = (async () => {
              await saveCapture(storageDir, session.id, receipt, media);
              // Session success is published only after the complete folder exists.
              session.capture = receipt; session.captureDigest = captureDigest;
              return receipt;
            })();
            const pending = { digest: captureDigest, save };
            session.pendingCapture = pending;
            try {
              const capture = await save;
              json(response, 200, { sessionId: session.id, status: 'capture_complete', ...capture });
            } finally { if (session.pendingCapture === pending) session.pendingCapture = undefined; }
            return;
          }
          throw new ApiError(405, 'Method not allowed.');
        })().catch((error: unknown) => {
          if (response.writableEnded || response.destroyed) return;
          const status = error instanceof ApiError ? error.status : 500;
          json(response, status, { error: error instanceof ApiError ? error.message : 'The sample API could not process this request.' });
        });
      });
    },
  };
}
