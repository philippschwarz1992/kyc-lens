import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ViteDevServer } from 'vite';
import { createHttpApi } from '../src/api';
import { demoApiPlugin } from '../demo/server';

const receivers: EventEmitter[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const receiver of receivers.splice(0)) receiver.emit('close');
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

interface ReceiverResponse { status: number; body: Record<string, any> }

function localReceiver() {
  let middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
  const httpServer = new EventEmitter();
  receivers.push(httpServer);
  const plugin = demoApiPlugin();
  const configure = plugin.configureServer;
  if (typeof configure !== 'function') throw new Error('Expected a sample server configuration hook.');
  configure.call({} as ThisParameterType<typeof configure>, { httpServer, middlewares: { use(handler: typeof middleware) { middleware = handler; } } } as unknown as ViteDevServer);
  return async (path: string, { method = 'POST', body, token, headers = {} }: { method?: string; body?: FormData; token?: string; headers?: Record<string, string> } = {}): Promise<ReceiverResponse> => {
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
  ])('accepts %s container signatures and only retains a video receipt', async (claimedType, bytes, type) => {
    const receive = localReceiver();
    const session = (await receive('/api/kyc/sessions')).body;
    const path = `/api/kyc/sessions/${session.id}/capture`;
    const body = captureForm(new Blob([bytes], { type: claimedType }));
    const first = await receive(path, { body, token: session.token });
    expect(first.status).toBe(200);
    expect(first.body.video).toEqual({ type, sizeBytes: bytes.length });
    expect(first.body.status).toBe('capture_complete');
    expect(await receive(path, { body, token: session.token })).toEqual(first);
    const receipt = await receive(`/api/kyc/sessions/${session.id}`, { method: 'GET', token: session.token });
    expect(receipt.body.video).toEqual(first.body.video);
    expect(JSON.stringify(receipt.body)).not.toMatch(/base64|contents|token|approved/);
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
