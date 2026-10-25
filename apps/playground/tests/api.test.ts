import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ViteDevServer } from 'vite';
import { createHttpApi, imageExtension, retryDelay } from '@sdk/api';
import { demoApiPlugin } from '../server';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) };
});

const receivers: EventEmitter[] = [];
const storageRoots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const receiver of receivers.splice(0)) receiver.emit('close');
  for (const root of storageRoots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('kyc-api-test-')) throw new Error('Unsafe test cleanup path.');
    await fs.rm(root, { recursive: true, force: true });
  }
});
describe('HTTP adapter', () => {
  it('sends session-scoped auth and lets the browser choose multipart boundaries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'id/one', token: 'capture-token' }))
      .mockResolvedValueOnce(Response.json({ status: 'capture_complete' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createHttpApi('/api/kyc/', { 'X-App': 'host-app', 'Content-Type': 'application/json' });
    const signal = new AbortController().signal;
    const session = await api.createSession(signal);
    await api.submitCapture(session, { selfie: new Blob(['photo'], { type: 'image/jpeg' }), challenges: [], capturedAt: '2026-10-02T10:00:00.000Z', mode: 'camera' }, signal);
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/kyc/sessions/id%2Fone/capture');
    expect(options.headers.get('Authorization')).toBe('Bearer capture-token');
    expect(options.headers.get('X-App')).toBe('host-app');
    expect(options.headers.has('Content-Type')).toBe(false);
    expect(options.signal).toBe(signal);
    expect(options.body.get('selfie').type).toBe('image/jpeg');
    expect(options.body.has('faceVideo')).toBe(false);
    expect(options.body.has('documentFront')).toBe(false);
    expect(options.body.has('documentBack')).toBe(false);
    expect(JSON.parse(options.body.get('metadata'))).toEqual({ challenges: [], capturedAt: '2026-10-02T10:00:00.000Z', mode: 'camera' });
  });
  it.each([
    ['video/webm;codecs=vp8', 'face-video.webm'],
    ['video/mp4;codecs=avc1.42e01e', 'face-video.mp4'],
  ])('submits %s video as a file with the matching extension', async (type, filename) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'capture_complete' }));
    vi.stubGlobal('fetch', fetchMock);
    const video = new Blob([new Uint8Array([0, 255, 16, 32])], { type });
    const payload = {
      selfie: new Blob(['selfie'], { type: 'image/jpeg' }), video,
      challenges: [], capturedAt: '2026-10-02T10:00:00.000Z', mode: 'camera' as const,
      document: { type: 'passport' as const, front: new Blob(['front'], { type: 'image/png' }) },
    };
    await createHttpApi('/api/kyc').submitCapture({ id: 'session', token: 'capture-token' }, payload, new AbortController().signal);
    const form = fetchMock.mock.calls[0]![1].body as FormData;
    const file = form.get('faceVideo') as File;
    expect(file.name).toBe(filename);
    expect(file.type).toBe(type);
    expect(file.size).toBe(video.size);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(await video.arrayBuffer()));
    expect(form.getAll('faceVideo')).toHaveLength(1);
    expect(JSON.parse(form.get('metadata') as string)).toEqual({ challenges: [], capturedAt: payload.capturedAt, mode: 'camera', document: { type: 'passport' } });
    expect(fetchMock.mock.calls[0]![1].headers.get('Authorization')).toBe('Bearer capture-token');
  });
  it('submits optional document sides as files and keeps binary media out of JSON metadata', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ status: 'capture_complete' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createHttpApi('/api/kyc');
    const signal = new AbortController().signal;
    const payload = {
      selfie: new Blob(['selfie'], { type: 'image/jpeg' }),
      challenges: [], capturedAt: '2026-10-02T10:00:00.000Z', mode: 'camera' as const,
      document: { type: 'id-card' as const, front: new Blob(['front'], { type: 'image/jpeg' }), back: new Blob(['back'], { type: 'image/png' }) },
    };
    await api.submitCapture({ id: 'session' }, payload, signal);
    const form = fetchMock.mock.calls[0]![1].body as FormData;
    expect(await (form.get('documentFront') as Blob).text()).toBe('front');
    expect((form.get('documentFront') as Blob).type).toBe('image/jpeg');
    expect(await (form.get('documentBack') as Blob).text()).toBe('back');
    expect((form.get('documentBack') as Blob).type).toBe('image/png');
    expect(JSON.parse(form.get('metadata') as string)).toEqual({ challenges: [], capturedAt: payload.capturedAt, mode: 'camera', document: { type: 'id-card' } });

    await api.submitCapture({ id: 'passport-session' }, { ...payload, document: { type: 'passport', front: payload.document.front } }, signal);
    const passportForm = fetchMock.mock.calls[1]![1].body as FormData;
    expect(passportForm.has('documentFront')).toBe(true);
    expect(passportForm.has('documentBack')).toBe(false);

    // The on-device zone summary travels as metadata; it carries no personal data.
    const mrz = { format: 'TD3' as const, kind: 'passport' as const, valid: true };
    await api.submitCapture({ id: 'zone-session' }, { ...payload, document: { type: 'passport', front: payload.document.front, mrz } }, signal);
    expect(JSON.parse((fetchMock.mock.calls[2]![1].body as FormData).get('metadata') as string).document).toEqual({ type: 'passport', mrz });
    expect(JSON.parse(passportForm.get('metadata') as string).document).toEqual({ type: 'passport' });
  });
  it('rejects malformed sessions and surfaces a readable server error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ id: 42 }))
      .mockResolvedValueOnce(Response.json({ error: 'Session expired.' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createHttpApi('/api/kyc');
    await expect(api.createSession(new AbortController().signal)).rejects.toThrow('invalid session');
    await expect(api.createSession(new AbortController().signal)).rejects.toThrow('Session expired.');
  });
});

const photoPayload = (type: string) => ({
  selfie: new Blob(['selfie'], { type }), challenges: [], capturedAt: '2026-10-02T10:00:00.000Z', mode: 'camera' as const,
  document: { type: 'id-card' as const, front: new Blob(['front'], { type }), back: new Blob(['back'], { type }) },
});

describe('HTTP adapter image formats', () => {
  it.each([
    ['image/webp', 'webp'], ['image/jpeg', 'jpg'], ['image/png', 'png'], ['', 'jpg'],
  ])('names %s photos with the matching extension', async (type, extension) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'capture_complete' }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpApi('/api/kyc').submitCapture({ id: 'session' }, photoPayload(type), new AbortController().signal);
    const form = fetchMock.mock.calls[0]![1].body as FormData;
    expect((form.get('selfie') as File).name).toBe(`selfie.${extension}`);
    expect((form.get('documentFront') as File).name).toBe(`document-front.${extension}`);
    expect((form.get('documentBack') as File).name).toBe(`document-back.${extension}`);
  });
  it('maps MIME types with parameters to file extensions', () => {
    expect(imageExtension(new Blob([], { type: 'IMAGE/WEBP; q=1' }))).toBe('webp');
  });
});

describe('HTTP adapter retry', () => {
  afterEach(() => { vi.useRealTimers(); });
  const failing = (status: number, headers: Record<string, string> = {}) => Response.json({ error: `Status ${status}.` }, { status, headers });

  it('validates retry and progress options', () => {
    expect(() => createHttpApi('/api', undefined, { retry: { attempts: 6 } })).toThrow('upload.retry.attempts must be an integer between 0 and 5.');
    expect(() => createHttpApi('/api', undefined, { retry: { attempts: 1.5 } })).toThrow(/attempts/);
    expect(() => createHttpApi('/api', undefined, { retry: { baseDelayMs: -1 } })).toThrow(/baseDelayMs/);
    expect(() => createHttpApi('/api', undefined, { onProgress: 'yes' as never })).toThrow(/onProgress/);
    expect(() => createHttpApi('/api', undefined, { retry: { attempts: 0, baseDelayMs: 0 } })).not.toThrow();
  });

  it('does not retry unless retry options are provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failing(503));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createHttpApi('/api').createSession(new AbortController().signal)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially for 5xx and network failures, then succeeds', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(1);
    const fetchMock = vi.fn().mockResolvedValueOnce(failing(503)).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(Response.json({ id: 'session' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = createHttpApi('/api', undefined, { retry: { baseDelayMs: 100 } }).createSession(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(99); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199); expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(result).resolves.toEqual({ id: 'session', token: undefined });
  });

  it('applies jitter between half and the full exponential delay', () => {
    expect(retryDelay(0, 100, new TypeError('x'), () => 0)).toBe(50);
    expect(retryDelay(2, 100, new TypeError('x'), () => 1)).toBe(400);
    expect(retryDelay(10, 1000, new TypeError('x'), () => 1)).toBe(30_000);
  });

  it('respects Retry-After seconds with a cap and stops after the configured attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(failing(429, { 'Retry-After': '120' })).mockResolvedValueOnce(failing(500));
    vi.stubGlobal('fetch', fetchMock);
    const result = createHttpApi('/api', undefined, { retry: { attempts: 1 } }).submitCapture({ id: 's' }, photoPayload('image/jpeg'), new AbortController().signal);
    const settled = expect(result).rejects.toMatchObject({ name: 'KycHttpError', status: 500, message: 'Status 500.' });
    await vi.advanceTimersByTimeAsync(29_999); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(2);
    await settled;
  });

  it.each([400, 401, 404, 409, 413])('never retries a %s response', async status => {
    const fetchMock = vi.fn().mockResolvedValue(failing(status));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createHttpApi('/api', undefined, { retry: { attempts: 5, baseDelayMs: 0 } }).createSession(new AbortController().signal)).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 408 and stops waiting as soon as the request is aborted', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(failing(408));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const result = createHttpApi('/api', undefined, { retry: { baseDelayMs: 5_000 } }).createSession(controller.signal);
    const settled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10); controller.abort();
    await settled;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

class MockXhr {
  static instances: MockXhr[] = [];
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null; onabort: (() => void) | null = null;
  method = ''; url = ''; body: unknown; withCredentials = true; aborted = false;
  status = 0; responseText = ''; requestHeaders: Record<string, string> = {}; responseHeaders: Record<string, string> = {};
  constructor() { MockXhr.instances.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.requestHeaders[name.toLowerCase()] = value; }
  getResponseHeader(name: string) { return this.responseHeaders[name.toLowerCase()] ?? null; }
  send(body: unknown) { this.body = body; }
  abort() { this.aborted = true; this.onabort?.(); }
  respond(status: number, text: string, headers: Record<string, string> = {}) { this.status = status; this.responseText = text; this.responseHeaders = headers; this.onload?.(); }
}

describe('HTTP adapter upload progress', () => {
  afterEach(() => { MockXhr.instances = []; vi.useRealTimers(); });

  it('uploads with XMLHttpRequest, reports progress and keeps auth and header semantics', async () => {
    vi.stubGlobal('XMLHttpRequest', MockXhr);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const progress: Array<[number, number]> = [];
    const api = createHttpApi('/api/kyc/', { 'X-App': 'host-app', 'Content-Type': 'application/json' }, { onProgress: (loaded, total) => { progress.push([loaded, total]); if (loaded === 0) throw new Error('host bug'); } });
    const result = api.submitCapture({ id: 'id/one', token: 'capture-token' }, photoPayload('image/webp'), new AbortController().signal);
    const xhr = MockXhr.instances[0]!;
    expect([xhr.method, xhr.url, xhr.withCredentials]).toEqual(['POST', '/api/kyc/sessions/id%2Fone/capture', false]);
    expect(xhr.requestHeaders).toEqual({ authorization: 'Bearer capture-token', 'x-app': 'host-app' });
    expect(((xhr.body as FormData).get('selfie') as File).name).toBe('selfie.webp');
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 0, total: 200 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 200, total: 200 });
    xhr.respond(200, JSON.stringify({ status: 'capture_complete' }));
    await expect(result).resolves.toEqual({ status: 'capture_complete' });
    expect(progress).toEqual([[0, 200], [200, 200]]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns JSON error bodies into KycHttpError and retries 5xx with a fresh request', async () => {
    vi.useFakeTimers(); vi.stubGlobal('XMLHttpRequest', MockXhr);
    const api = createHttpApi('/api', undefined, { onProgress: () => {}, retry: { attempts: 1, baseDelayMs: 10 } });
    const result = api.submitCapture({ id: 's' }, photoPayload('image/jpeg'), new AbortController().signal);
    const settled = expect(result).rejects.toMatchObject({ name: 'KycHttpError', status: 401, message: 'Session expired.' });
    MockXhr.instances[0]!.respond(502, 'Bad gateway');
    await vi.advanceTimersByTimeAsync(10);
    expect(MockXhr.instances).toHaveLength(2);
    MockXhr.instances[1]!.respond(401, JSON.stringify({ error: 'Session expired.' }));
    await settled;
  });

  it('treats XHR network failures as retryable and aborts the request with the signal', async () => {
    vi.useFakeTimers(); vi.stubGlobal('XMLHttpRequest', MockXhr);
    const controller = new AbortController();
    const api = createHttpApi('/api', undefined, { onProgress: () => {}, retry: { attempts: 2, baseDelayMs: 10 } });
    const result = api.submitCapture({ id: 's' }, photoPayload('image/jpeg'), controller.signal);
    const settled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    MockXhr.instances[0]!.onerror?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(MockXhr.instances).toHaveLength(2);
    controller.abort();
    await settled;
    expect(MockXhr.instances[1]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(MockXhr.instances).toHaveLength(2);
  });

  it('falls back to fetch where XMLHttpRequest is unavailable', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createHttpApi('/api', undefined, { onProgress: () => {} }).submitCapture({ id: 's' }, photoPayload('image/jpeg'), new AbortController().signal)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

interface ReceiverResponse { status: number; body: Record<string, any> }

function isolatedStorage() {
  const root = mkdtempSync(join(tmpdir(), 'kyc-api-test-'));
  storageRoots.push(root);
  return join(root, 'results');
}

function localReceiver(storageDir = isolatedStorage()) {
  let middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
  const httpServer = new EventEmitter();
  receivers.push(httpServer);
  const plugin = demoApiPlugin({ storageDir });
  const configure = plugin.configureServer;
  if (typeof configure !== 'function') throw new Error('Expected a sample server configuration hook.');
  configure.call({} as ThisParameterType<typeof configure>, { httpServer, middlewares: { use(handler: typeof middleware) { middleware = handler; } } } as unknown as ViteDevServer);
  const receive = async (path: string, { method = 'POST', body, token, headers = {} }: { method?: string; body?: FormData; token?: string; headers?: Record<string, string> } = {}): Promise<ReceiverResponse> => {
    const upload = body ? new Request('http://localhost', { method: 'POST', body }) : undefined;
    const bytes = upload ? Buffer.from(await upload.arrayBuffer()) : Buffer.alloc(0);
    const request = Object.assign(Readable.from([bytes]), {
      url: path, method,
      headers: { host: 'localhost', origin: 'http://localhost', 'content-length': String(bytes.length), ...(upload ? { 'content-type': upload.headers.get('content-type')! } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      socket: { remoteAddress: '127.0.0.1' },
    });
    return new Promise(resolve => {
      const response = {
        statusCode: 200, writableEnded: false, destroyed: false,
        setHeader() {},
        end(value: string) { this.writableEnded = true; resolve({ status: this.statusCode, body: JSON.parse(value) }); },
      };
      middleware(request as unknown as IncomingMessage, response as unknown as ServerResponse, () => { throw new Error('Unexpected middleware fallthrough.'); });
    });
  };
  return Object.assign(receive, { storageDir, close: () => httpServer.emit('close') });
}

const sampleImage = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7t8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x18, 0x53, 0x80, 0x67, 0xff, 0x00]);
const mp4Bytes = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
  0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
]);

function captureForm(video?: Blob, capturedAt = new Date().toISOString()) {
  const form = new FormData();
  form.append('selfie', sampleImage, 'selfie.png');
  if (video) form.append('faceVideo', video, 'face-video.webm');
  form.append('metadata', JSON.stringify({ challenges: [{ challenge: 'center', completedAt: 1000, durationMs: 650 }], capturedAt, mode: 'camera' }));
  return form;
}

describe('local capture receiver video contract', () => {
  it.each([
    ['video/webm;codecs=vp8', webmBytes, 'video/webm'],
    ['video/mp4;codecs=avc1.42e01e', mp4Bytes, 'video/mp4'],
  ])('accepts %s container signatures and returns only a video receipt', async (claimedType, bytes, type) => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    const body = captureForm(new Blob([bytes], { type: claimedType }));
    const first = await receive(path, { body, token: session.token });
    expect(first.status).toBe(200);
    expect(first.body.video).toEqual({ type, sizeBytes: bytes.length });
    expect(first.body.status).toBe('capture_complete');
    const savedFolder = join(receive.storageDir, session.id);
    expect(first.body.files).toEqual({ selfie: 'selfie.png', faceVideo: `face-video.${type === 'video/mp4' ? 'mp4' : 'webm'}`, metadata: 'metadata.json' });
    expect(await fs.readFile(join(savedFolder, first.body.files.faceVideo))).toEqual(Buffer.from(bytes));
    expect(await fs.readFile(join(savedFolder, first.body.files.selfie))).toEqual(Buffer.from(await sampleImage.arrayBuffer()));
    expect(JSON.parse(await fs.readFile(join(savedFolder, 'metadata.json'), 'utf8'))).toEqual(first.body);
    expect(await receive(path, { body, token: session.token })).toEqual(first);
    const receipt = await receive(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token });
    expect(receipt.body.video).toEqual(first.body.video);
    expect(JSON.stringify(receipt.body)).not.toMatch(/base64|contents|token|approved/);
  });

  it('accepts WebP photos only with a matching RIFF/WEBP signature', async () => {
    const webp = (form = 'WEBP', chunk = 'VP8L') => {
      const bytes = new Uint8Array(22);
      bytes.set(Buffer.from('RIFF'), 0); new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
      bytes.set(Buffer.from(form), 8); bytes.set(Buffer.from(chunk), 12); bytes.set([1, 0, 0, 0, 0x2f], 16);
      return bytes;
    };
    const formWith = (selfie: Blob) => { const form = captureForm(); form.set('selfie', selfie, 'selfie.webp'); return form; };
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    for (const forged of [new Blob([webp('WAVE')], { type: 'image/webp' }), new Blob([webp('WEBP', 'JUNK')], { type: 'image/webp' }), new Blob([webp().subarray(0, 21)], { type: 'image/webp' }), new Blob([webp()], { type: 'image/jpeg' })]) {
      const rejected = await receive(path, { body: formWith(forged), token: session.token });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error).toContain('JPEG, PNG or WebP');
    }
    const accepted = await receive(path, { body: formWith(new Blob([webp()], { type: 'image/webp' })), token: session.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.files.selfie).toBe('selfie.webp');
    expect(accepted.body.image).toEqual({ type: 'image/webp', sizeBytes: 22 });
    expect(await fs.readFile(join(receive.storageDir, session.id, 'selfie.webp'))).toEqual(Buffer.from(webp()));
  });

  it('accepts legacy photo-only captures and authenticates before accepting media', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    const body = captureForm();
    expect((await receive(path, { body })).status).toBe(401);
    expect((await receive(path, { body, token: 'wrong-token' })).status).toBe(401);
    expect((await receive(path, { body, token: session.token, headers: { origin: 'https://example.com' } })).status).toBe(403);
    const accepted = await receive(path, { body, token: session.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.video).toBeUndefined();
  });

  it.each([
    [new Blob(['forged'], { type: 'video/webm' }), 'container signature'],
    [new Blob([webmBytes], { type: 'video/mp4' }), 'matching MIME'],
    [new Blob([mp4Bytes.subarray(0, 24)], { type: 'video/mp4' }), 'container signature'],
    [new Blob([webmBytes], { type: 'text/plain' }), 'matching MIME'],
    [new Blob([], { type: 'video/webm' }), 'Invalid face video'],
    [new Blob([new Uint8Array(12 * 1024 * 1024 + 1)], { type: 'video/webm' }), 'at most 12 MB'],
  ])('rejects invalid or oversized video without completing the capture', async (video, error) => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const result = await receive(`/api/kyc/sessions/${session.id}/capture`, { body: captureForm(video), token: session.token });
    expect(result.status).toBe(video.size > 12 * 1024 * 1024 ? 413 : 400);
    expect(result.body.error).toContain(error);
    expect((await receive(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token })).body.status).toBe('pending_capture');
    await expect(fs.stat(receive.storageDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects duplicate video fields, non-file video, and requests above the total bound', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    const body = captureForm(new Blob([webmBytes], { type: 'video/webm' }));
    body.append('faceVideo', new Blob([webmBytes], { type: 'video/webm' }), 'duplicate.webm');
    expect((await receive(path, { body, token: session.token })).status).toBe(400);
    body.delete('faceVideo');
    body.append('faceVideo', 'not a file');
    expect((await receive(path, { body, token: session.token })).body.error).toContain('Invalid face video');
    const oversized = await receive(path, { body: captureForm(), token: session.token, headers: { 'content-length': String(24 * 1024 * 1024 + 1) } });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toContain('24 MB request limit');
  });

  it('detects changed or removed video in an otherwise identical capture retry', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    const capturedAt = new Date().toISOString();
    const original = captureForm(new Blob([webmBytes], { type: 'video/webm' }), capturedAt);
    expect((await receive(path, { body: original, token: session.token })).status).toBe(200);
    const changedBytes = webmBytes.slice();
    changedBytes[changedBytes.length - 1] = 1;
    const changed = captureForm(new Blob([changedBytes], { type: 'video/webm' }), capturedAt);
    expect((await receive(path, { body: changed, token: session.token })).status).toBe(409);
    expect((await receive(path, { body: captureForm(undefined, capturedAt), token: session.token })).status).toBe(409);
  });
});

describe('local completed capture storage', () => {
  it('saves every image, video and movement entry using fixed filenames without credentials', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const jpegBytes = new Uint8Array([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 217]);
    const jpeg = new Blob([jpegBytes], { type: 'image/jpeg' });
    const body = captureForm(new Blob([mp4Bytes], { type: 'video/mp4' }));
    body.set('selfie', jpeg, '../../untrusted-name.jpg');
    body.append('documentFront', sampleImage, 'arbitrary.png');
    body.append('documentBack', jpeg, 'arbitrary.jpg');
    const metadata = JSON.parse(body.get('metadata') as string);
    metadata.document = { type: 'id-card' };
    metadata.challenges.push({ challenge: 'closer', completedAt: 2500, durationMs: 650 });
    body.set('metadata', JSON.stringify(metadata));
    const result = await receive(`/api/kyc/sessions/${session.id}/capture`, { body, token: session.token, headers: { 'x-private-app-key': 'must-never-be-saved' } });
    expect(result.status).toBe(200);
    expect(result.body.files).toEqual({ selfie: 'selfie.jpg', faceVideo: 'face-video.mp4', documentFront: 'document-front.png', documentBack: 'document-back.jpg', metadata: 'metadata.json' });
    const folder = join(receive.storageDir, session.id);
    expect((await fs.readdir(folder)).sort()).toEqual(Object.values(result.body.files).sort());
    expect(await fs.readFile(join(folder, 'selfie.jpg'))).toEqual(Buffer.from(jpegBytes));
    expect(await fs.readFile(join(folder, 'document-front.png'))).toEqual(Buffer.from(await sampleImage.arrayBuffer()));
    expect(await fs.readFile(join(folder, 'document-back.jpg'))).toEqual(Buffer.from(jpegBytes));
    expect(await fs.readFile(join(folder, 'face-video.mp4'))).toEqual(Buffer.from(mp4Bytes));
    const raw = await fs.readFile(join(folder, 'metadata.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(result.body);
    expect(JSON.parse(raw).challenges).toEqual(metadata.challenges);
    expect(raw).not.toContain(session.token);
    expect(raw).not.toMatch(/authorization|x-private-app-key|must-never-be-saved|untrusted-name/i);
    expect(await fs.readdir(join(receive.storageDir, '.pending'))).toEqual([]);
  });

  it('validates the complete capture before creating any result or staging files', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const body = captureForm(new Blob([webmBytes], { type: 'video/webm' }));
    const metadata = JSON.parse(body.get('metadata') as string);
    metadata.document = { type: 'id-card' };
    body.set('metadata', JSON.stringify(metadata));
    body.append('documentFront', sampleImage, 'front.png');
    body.append('documentBack', new Blob(['invalid'], { type: 'image/png' }), 'back.png');
    const result = await receive(`/api/kyc/sessions/${session.id}/capture`, { body, token: session.token });
    expect(result.status).toBe(400);
    await expect(fs.stat(receive.storageDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans only its partial staging folder after a failed write and permits an identical retry', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    const body = captureForm(new Blob([webmBytes], { type: 'video/webm' }));
    await fs.mkdir(join(receive.storageDir, '.pending', 'another-owned-request'), { recursive: true });
    await fs.writeFile(join(receive.storageDir, '.pending', 'another-owned-request', 'keep.txt'), 'keep');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.writeFile).mockImplementationOnce(actual.writeFile).mockRejectedValueOnce(new Error('disk full'));
    const failure = await receive(path, { body, token: session.token });
    expect(failure.status).toBe(500);
    expect(failure.body.error).toContain('Please try again');
    expect(failure.body.error).not.toContain(receive.storageDir);
    expect((await receive(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token })).body.status).toBe('pending_capture');
    await expect(fs.stat(join(receive.storageDir, session.id))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(join(receive.storageDir, '.pending'))).toEqual(['another-owned-request']);
    expect(await fs.readFile(join(receive.storageDir, '.pending', 'another-owned-request', 'keep.txt'), 'utf8')).toBe('keep');
    const retry = await receive(path, { body, token: session.token });
    expect(retry.status).toBe(200);
    expect(await fs.readFile(join(receive.storageDir, session.id, 'face-video.webm'))).toEqual(Buffer.from(webmBytes));
  });

  it('publishes one complete folder for concurrent identical requests and conflicts changed media', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    const capturedAt = new Date().toISOString();
    const body = captureForm(new Blob([webmBytes], { type: 'video/webm' }), capturedAt);
    let signalSaving!: () => void;
    let releaseSave!: () => void;
    const saving = new Promise<void>(resolve => { signalSaving = resolve; });
    const blocked = new Promise<void>(resolve => { releaseSave = resolve; });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const callsBefore = vi.mocked(fs.rename).mock.calls.length;
    vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => { signalSaving(); await blocked; return actual.rename(from, to); });
    const first = receive(path, { body, token: session.token });
    await saving;
    const same = receive(path, { body, token: session.token });
    const changedBytes = webmBytes.slice(); changedBytes[changedBytes.length - 1] = 1;
    const changed = captureForm(new Blob([changedBytes], { type: 'video/webm' }), capturedAt);
    try {
      expect((await receive(path, { body: changed, token: session.token })).status).toBe(409);
      expect((await receive(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token })).body.status).toBe('pending_capture');
      await expect(fs.stat(join(receive.storageDir, session.id))).rejects.toMatchObject({ code: 'ENOENT' });
      const staged = await fs.readdir(join(receive.storageDir, '.pending'));
      expect(staged).toHaveLength(1);
      expect((await fs.readdir(join(receive.storageDir, '.pending', staged[0]))).sort()).toEqual(['face-video.webm', 'metadata.json', 'selfie.png']);
    } finally { releaseSave(); }
    const accepted = await first;
    expect(accepted.status).toBe(200);
    expect(await same).toEqual(accepted);
    const file = join(receive.storageDir, session.id, 'metadata.json');
    const beforeRetry = await fs.stat(file);
    expect(await receive(path, { body, token: session.token })).toEqual(accepted);
    expect((await fs.stat(file)).mtimeMs).toBe(beforeRetry.mtimeMs);
    expect(vi.mocked(fs.rename).mock.calls.length - callsBefore).toBe(1);
    expect(await fs.readdir(join(receive.storageDir, '.pending'))).toEqual([]);
  });

  it('never overwrites an existing completed folder and retries after a failed atomic rename', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    const body = captureForm();
    const folder = join(receive.storageDir, session.id);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(join(folder, 'keep.txt'), 'existing result');
    expect((await receive(path, { body, token: session.token })).status).toBe(500);
    expect(await fs.readFile(join(folder, 'keep.txt'), 'utf8')).toBe('existing result');
    expect(await fs.readdir(join(receive.storageDir, '.pending'))).toEqual([]);
    // This test owns this exact temporary UUID directory; completed user results are never removed.
    expect(dirname(resolve(folder))).toBe(resolve(receive.storageDir));
    await fs.rm(folder, { recursive: true });
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('rename unavailable'));
    expect((await receive(path, { body, token: session.token })).status).toBe(500);
    await expect(fs.stat(folder)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(join(receive.storageDir, '.pending'))).toEqual([]);
    expect((await receive(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token })).body.status).toBe('pending_capture');
    expect((await receive(path, { body, token: session.token })).status).toBe(200);
  });

  it('keeps completed files after auth expiry and server close or restart', async () => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const accepted = await receive(`/api/kyc/sessions/${session.id}/capture`, { body: captureForm(), token: session.token });
    const file = join(receive.storageDir, session.id, 'metadata.json');
    const saved = await fs.readFile(file, 'utf8');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
    expect((await receive(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token })).status).toBe(404);
    expect(await fs.readFile(file, 'utf8')).toBe(saved);
    receive.close();
    expect(await fs.readFile(file, 'utf8')).toBe(saved);
    const restarted = localReceiver(receive.storageDir);
    expect((await restarted(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token })).status).toBe(404);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(accepted.body);
  });

  it('blocks saved captures and configured storage directories from browser file routes', async () => {
    const receive = localReceiver();
    const fsUrl = `/@fs/${receive.storageDir.replace(/\\/g, '/')}/anything/metadata.json`;
    for (const path of ['/results', '/ReSuLtS/anything', '/%72%65sults%2Fanything', '/a/../results/private.png', fsUrl, encodeURI(fsUrl.toUpperCase())]) {
      const result = await receive(path, { method: 'GET' });
      expect(result.status).toBe(403);
      expect(JSON.stringify(result.body)).not.toContain(receive.storageDir);
    }
  });

  it.each(['results', '.pending'])('rejects a %s symlink or junction before writing outside the storage root', async field => {
    const receive = localReceiver();
    const target = isolatedStorage();
    await fs.mkdir(target, { recursive: true });
    const link = field === 'results' ? receive.storageDir : join(receive.storageDir, '.pending');
    await fs.mkdir(dirname(link), { recursive: true });
    await fs.symlink(target, link, 'junction');
    const session = (await receive('/api/kyc/sessions')).body;
    const failed = await receive(`/api/kyc/sessions/${session.id}/capture`, { body: captureForm(), token: session.token });
    expect(failed.status).toBe(500);
    expect(await fs.readdir(target)).toEqual([]);
    expect((await receive(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token })).body.status).toBe('pending_capture');
  });
});
