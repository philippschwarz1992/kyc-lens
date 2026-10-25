import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, join, posix, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { CaptureError, MAX_BODY_BYTES, parseCapture, type CaptureMetadata, type MediaMetadata } from '@kyc-lens/contracts';

/** Local development receiver only. Completed uploads are saved locally; identity is never approved. */
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 15 * 60 * 1000;
type ImageMetadata = MediaMetadata;
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
    await mkdir(storageDir, { recursive: true, mode: 0o700 });
    const storageInfo = await lstat(storageDir);
    if (!storageInfo.isDirectory() || storageInfo.isSymbolicLink()) throw new Error('Unsafe result directory.');
    await mkdir(pendingDir, { recursive: true, mode: 0o700 });
    const pendingInfo = await lstat(pendingDir);
    if (!pendingInfo.isDirectory() || pendingInfo.isSymbolicLink()) throw new Error('Unsafe staging directory.');
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
        let pathname: string;
        try { pathname = posix.normalize(decodeURIComponent((request.url ?? '').split('?')[0]).replace(/\\/g, '/')); }
        catch { json(response, 400, { error: 'Invalid request path.' }); return; }
        const privateRoot = storageDir.replace(/\\/g, '/').toLowerCase();
        const fsPath = /^\/@fs\/(.*)$/i.exec(pathname);
        // Vite's /@fs/ prefix carries an absolute path; POSIX paths lose their leading slash to it.
        const fsTarget = fsPath ? resolve(/^[a-z]:/i.test(fsPath[1]) ? fsPath[1] : `/${fsPath[1]}`).replace(/\\/g, '/').toLowerCase() : undefined;
        if (/^\/results(?:\/|$)/i.test(pathname) || (fsTarget && (fsTarget === privateRoot || fsTarget.startsWith(`${privateRoot}/`)))) {
          json(response, 403, { error: 'Saved captures are private local files.' });
          return;
        }
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
            const parsed = await parseCapture(form);
            const files: CaptureFiles = { selfie: '', metadata: 'metadata.json' };
            const media: SavedMedia[] = parsed.files.map(file => {
              files[file.field] = file.filename;
              return { filename: file.filename, bytes: file.bytes };
            });
            const { metadata, image, video } = parsed;
            const document: CaptureReceipt['document'] = parsed.document;
            const captureDigest = parsed.digest;
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
          const known = error instanceof ApiError || error instanceof CaptureError;
          json(response, known ? error.status : 500, { error: known ? error.message : 'The sample API could not process this request.' });
        });
      });
    },
  };
}
