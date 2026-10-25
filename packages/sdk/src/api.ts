import type { CapturePayload, HttpApiOptions, KycApi, KycSession } from './types';

export class KycHttpError extends Error {
  readonly status: number;
  /** Server-requested delay from a Retry-After header in seconds, when present. */
  retryAfterMs?: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'KycHttpError';
    this.status = status;
  }
}

const MAX_RETRY_DELAY_MS = 30_000;

function httpError(status: number, bodyText: string | undefined, retryAfter: string | null): KycHttpError {
  let reason = `Request failed (${status}).`;
  try {
    const body = JSON.parse(bodyText ?? '') as { error?: unknown };
    if (typeof body?.error === 'string') reason = body.error;
  } catch { /* Keep the HTTP status if the server did not send JSON. */ }
  const error = new KycHttpError(reason, status);
  if (retryAfter !== null && /^\s*\d+\s*$/.test(retryAfter)) error.retryAfterMs = Math.min(Number(retryAfter) * 1000, MAX_RETRY_DELAY_MS);
  return error;
}

async function checkedJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    let text: string | undefined;
    try { text = await response.text(); } catch { /* Keep the HTTP status. */ }
    throw httpError(response.status, text, response.headers.get('Retry-After'));
  }
  return response.json();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Multipart POST with upload progress. Matches fetch semantics: same-origin credentials and a JSON body. */
function xhrJson(url: string, headers: Headers, body: FormData, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortReason(signal)); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = (action: () => void) => { signal.removeEventListener('abort', abort); action(); };
    xhr.open('POST', url);
    xhr.withCredentials = false; // Same-origin requests still include cookies, like credentials: 'same-origin'.
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = event => { if (event.lengthComputable) try { onProgress(event.loaded, event.total); } catch { /* Host callbacks must not break uploads. */ } };
    xhr.onload = () => settle(() => {
      if (xhr.status === 0) { reject(new TypeError('Network request failed.')); return; }
      if (xhr.status < 200 || xhr.status > 299) { reject(httpError(xhr.status, xhr.responseText, xhr.getResponseHeader('Retry-After'))); return; }
      try { resolve(JSON.parse(xhr.responseText)); } catch (error) { reject(error); }
    });
    xhr.onerror = () => settle(() => reject(new TypeError('Network request failed.')));
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => settle(() => reject(abortReason(signal)));
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

function retryable(error: unknown): boolean {
  if (error instanceof KycHttpError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return error instanceof TypeError; // fetch and XMLHttpRequest network failures
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortReason(signal)); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortReason(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Exponential backoff with jitter, or the server's capped Retry-After. */
export function retryDelay(attempt: number, baseDelayMs: number, error: unknown, random = Math.random): number {
  if (error instanceof KycHttpError && error.retryAfterMs !== undefined) return error.retryAfterMs;
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(baseDelayMs * 2 ** attempt * (0.5 + random() / 2)));
}

/** Validate adapter options; KycFlow reports these as configuration errors. */
export function validateHttpApiOptions(options: unknown): void {
  if (options === undefined) return;
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('upload must be an options object.');
  const { retry, onProgress } = options as HttpApiOptions;
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new Error('upload.onProgress must be a function.');
  if (retry === undefined) return;
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) throw new Error('upload.retry must be an options object.');
  if (retry.attempts !== undefined && (!Number.isInteger(retry.attempts) || retry.attempts < 0 || retry.attempts > 5)) throw new Error('upload.retry.attempts must be an integer between 0 and 5.');
  if (retry.baseDelayMs !== undefined && (typeof retry.baseDelayMs !== 'number' || !Number.isFinite(retry.baseDelayMs) || retry.baseDelayMs < 0 || retry.baseDelayMs > MAX_RETRY_DELAY_MS)) throw new Error('upload.retry.baseDelayMs must be between 0 and 30000.');
}

/** Same-origin-friendly HTTP contract. Token is scoped to one capture session. */
export function createHttpApi(baseUrl: string, extraHeaders?: HeadersInit, options: HttpApiOptions = {}): KycApi {
  validateHttpApiOptions(options);
  const base = baseUrl.replace(/\/+$/, '');
  // Retries are opt-in so a plain adapter keeps sending each request once.
  const attempts = options.retry ? options.retry.attempts ?? 2 : 0;
  const baseDelayMs = options.retry?.baseDelayMs ?? 500;
  const withRetry = async <T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      try { return await run(); }
      catch (error) {
        if (signal.aborted || attempt >= attempts || !retryable(error)) throw error;
        await wait(retryDelay(attempt, baseDelayMs, error), signal);
      }
    }
  };
  return {
    async createSession(signal) {
      const headers = new Headers(extraHeaders);
      headers.set('Content-Type', 'application/json');
      const data = await withRetry(async () => checkedJson(await fetch(`${base}/sessions`, {
        method: 'POST', headers, body: '{}', credentials: 'same-origin', signal,
      })), signal) as Partial<KycSession>;
      if (typeof data?.id !== 'string' || !data.id || (data.token !== undefined && typeof data.token !== 'string')) {
        throw new Error('The session endpoint returned an invalid session.');
      }
      return { id: data.id, token: data.token };
    },
    async submitCapture(session, payload: CapturePayload, signal) {
      const body = new FormData();
      body.append('selfie', payload.selfie, `selfie.${imageExtension(payload.selfie)}`);
      if (payload.video) {
        const videoType = payload.video.type.split(';', 1)[0].trim().toLowerCase();
        body.append('faceVideo', payload.video, videoType === 'video/mp4' ? 'face-video.mp4' : 'face-video.webm');
      }
      if (payload.document) {
        body.append('documentFront', payload.document.front, `document-front.${imageExtension(payload.document.front)}`);
        if (payload.document.back) body.append('documentBack', payload.document.back, `document-back.${imageExtension(payload.document.back)}`);
      }
      body.append('metadata', JSON.stringify({ challenges: payload.challenges, capturedAt: payload.capturedAt, mode: payload.mode, ...(payload.document ? { document: { type: payload.document.type, ...(payload.document.mrz ? { mrz: payload.document.mrz } : {}) } } : {}) }));
      const headers = new Headers(extraHeaders);
      headers.delete('Content-Type'); // The browser supplies the multipart boundary.
      if (session.token) headers.set('Authorization', `Bearer ${session.token}`);
      const url = `${base}/sessions/${encodeURIComponent(session.id)}/capture`;
      const { onProgress } = options;
      return withRetry(async () => onProgress && typeof XMLHttpRequest !== 'undefined'
        ? xhrJson(url, headers, body, signal, onProgress)
        : checkedJson(await fetch(url, { method: 'POST', headers, body, credentials: 'same-origin', signal })), signal);
    },
  };
}

/** File extension for a captured image's MIME type. */
export function imageExtension(image: Blob): 'png' | 'webp' | 'jpg' {
  const type = image.type.split(';', 1)[0].trim().toLowerCase();
  return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
}
