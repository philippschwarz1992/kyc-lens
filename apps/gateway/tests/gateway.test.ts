import { describe, expect, it, vi } from 'vitest';
import { verifyDelivery, type VerificationEvent, type VerificationResult } from '@kyc-lens/contracts';
import { handleApi, type ApiDeps, type DeliveryJob } from '../src/api.js';
import { deliver, retryDelaySeconds, type DeliveryDeps } from '../src/delivery.js';
import type { BeginCapture, SessionRecord, SessionStatus, SessionStore } from '../src/sessions.js';
import type { Staging } from '../src/staging.js';

function memorySessions(): SessionStore & { records: Map<string, SessionRecord> } {
  const records = new Map<string, SessionRecord>();
  return {
    records,
    async create(record) { records.set(record.id, record); },
    async get(id) { return records.get(id) ?? null; },
    async beginCapture(id, digest, receivedAt, now): Promise<BeginCapture> {
      const record = records.get(id);
      if (!record) return { result: 'missing' };
      if (record.captureDigest) return record.captureDigest === digest ? { result: 'duplicate', record } : { result: 'conflict' };
      if (record.expiresAt <= now) return { result: 'expired' };
      const next = { ...record, captureDigest: digest, receivedAt, status: 'processing' as const };
      records.set(id, next);
      return { result: 'started', record: next };
    },
    async abandonCapture(id, digest) {
      const record = records.get(id);
      if (record?.captureDigest === digest) { const { captureDigest: _d, receivedAt: _r, ...rest } = record; records.set(id, { ...rest, status: 'pending_capture' }); }
    },
    async setStatus(id: string, status: SessionStatus) { const record = records.get(id); if (record) records.set(id, { ...record, status }); },
  };
}
function memoryStaging(): Staging & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, value) { objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value); },
    async get(key) { return objects.get(key) ?? null; },
    async deletePrefix(prefix) { for (const key of [...objects.keys()]) if (key.startsWith(prefix)) objects.delete(key); },
  };
}

const jpeg = (size = 64) => { const bytes = new Uint8Array(size); bytes.set([255, 216, 255]); bytes.set([255, 217], size - 2); return bytes; };
const metadata = () => JSON.stringify({ challenges: [{ challenge: 'center', completedAt: 1, durationMs: 650 }], capturedAt: new Date().toISOString(), mode: 'camera', document: { type: 'passport' } });
function captureForm(front = jpeg(80), meta = metadata()) {
  const form = new FormData();
  form.append('selfie', new Blob([jpeg()], { type: 'image/jpeg' }), 'selfie.jpg');
  form.append('documentFront', new Blob([front], { type: 'image/jpeg' }), 'document-front.jpg');
  form.append('metadata', meta);
  return form;
}
const result: VerificationResult = { status: 'approved', reasons: [], document: { type: 'passport', quality: { sharpness: 310, glare: 0.01, brightness: 180, rectified: true, acceptable: true, issues: [] }, mrz: null, printedFields: null, fieldMismatches: [] }, faceMatch: { score: 0.71, threshold: 0.363, decision: 'match' }, liveFaceMatch: null, liveness: null };

function setup(mode: 'server' | 'open' = 'server') {
  const sessions = memorySessions(), staging = memoryStaging(), jobs: DeliveryJob[] = [];
  const deps: ApiDeps = { config: { sessionMode: mode, apiKey: 'server-key', sessionTtlMs: 15 * 60_000 }, sessions, staging, enqueue: async job => { jobs.push(job); }, now: Date.now };
  const call = (path: string, init: RequestInit = {}) => handleApi(new Request(`https://gateway.test${path}`, init), deps, path);
  return { sessions, staging, jobs, deps, call };
}

async function newSession(call: ReturnType<typeof setup>['call'], reference?: string) {
  const response = await call('/api/kyc/sessions', { method: 'POST', headers: { Authorization: 'Bearer server-key' }, body: JSON.stringify(reference ? { reference } : {}) });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string; token: string }>;
}
const upload = (call: ReturnType<typeof setup>['call'], session: { id: string; token: string }, form = captureForm()) =>
  call(`/api/kyc/sessions/${session.id}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: form });

describe('gateway API', () => {
  it('lets only the customer backend create sessions in server mode', async () => {
    const { call } = setup();
    expect((await call('/api/kyc/sessions', { method: 'POST' })).status).toBe(401);
    expect((await call('/api/kyc/sessions', { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    const session = await newSession(call, 'crm-42');
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await setup('open').call('/api/kyc/sessions', { method: 'POST' })).status).toBe(201);
  });

  it('stores only a token hash and stages an upload for delivery', async () => {
    const { call, sessions, staging, jobs } = setup();
    const session = await newSession(call, 'crm-42');
    expect(JSON.stringify(sessions.records.get(session.id))).not.toContain(session.token);
    const response = await upload(call, session);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessionId: session.id, status: 'processing' });
    expect(jobs).toEqual([{ sessionId: session.id }]);
    expect([...staging.objects.keys()].sort()).toEqual([`sessions/${session.id}/capture.json`, `sessions/${session.id}/document-front.jpg`, `sessions/${session.id}/selfie.jpg`]);
  });

  it('answers a retried upload once and refuses a different second capture', async () => {
    const { call, jobs } = setup();
    const session = await newSession(call);
    const meta = metadata();
    expect((await upload(call, session, captureForm(jpeg(80), meta))).status).toBe(200);
    expect((await upload(call, session, captureForm(jpeg(80), meta))).status).toBe(200);
    expect(jobs).toHaveLength(1);
    expect((await upload(call, session, captureForm(jpeg(90), meta))).status).toBe(409);
  });

  it('requires the session token, rejects invalid uploads and hides the verdict from status', async () => {
    const { call } = setup();
    const session = await newSession(call);
    expect((await upload(call, { ...session, token: 'x'.repeat(43) })).status).toBe(401);
    const bad = new FormData(); bad.append('selfie', new Blob([new Uint8Array(64)], { type: 'image/jpeg' })); bad.append('metadata', metadata());
    expect((await upload(call, session, bad)).status).toBe(400);
    const status = await call(`/api/kyc/sessions/${session.id}`, { headers: { Authorization: 'Bearer server-key' } });
    expect(await status.json()).toEqual({ sessionId: session.id, status: 'pending_capture', expiresAt: expect.any(String) });
    expect((await call('/api/kyc/sessions/not-a-uuid', { headers: { Authorization: 'Bearer server-key' } })).status).toBe(404);
  });

  it('refuses uploads after the capture window', async () => {
    const { call, deps } = setup();
    const session = await newSession(call);
    deps.now = () => Date.now() + 16 * 60_000;
    expect((await upload(call, session)).status).toBe(410);
  });
});

describe('delivery', () => {
  async function staged() {
    const context = setup();
    const session = await newSession(context.call, 'crm-42');
    await upload(context.call, session);
    return { ...context, session };
  }
  function deliveryDeps(context: Awaited<ReturnType<typeof staged>>, overrides: Partial<DeliveryDeps> = {}): DeliveryDeps & { requests: Request[] } {
    const requests: Request[] = [];
    return {
      requests,
      config: { webhookUrl: 'https://crm.test/webhooks/kyc', webhookSecret: 'webhook-secret', analysisAttempts: 3, deliveryAttempts: 3 },
      sessions: context.sessions, staging: context.staging, now: Date.now,
      analyze: vi.fn(async () => result),
      fetch: async request => { requests.push(request); return new Response('ok'); },
      ...overrides,
    };
  }

  it('posts a signed multipart case with the verdict and media, then deletes the staged copy', async () => {
    const context = await staged();
    const deps = deliveryDeps(context);
    expect(await deliver(context.session.id, 1, deps)).toBe('delivered');
    const request = deps.requests[0]!;
    const body = new Uint8Array(await request.clone().arrayBuffer());
    expect(await verifyDelivery('webhook-secret', request.headers.get('X-KYC-Signature'), body)).toBe(true);
    expect(request.headers.get('X-KYC-Delivery')).toBe(context.session.id);
    const form = await request.formData();
    const event = JSON.parse(await (form.get('event') as Blob).text()) as VerificationEvent;
    expect(event).toMatchObject({ type: 'verification.completed', sessionId: context.session.id, reference: 'crm-42', analysis: result });
    expect((form.get('selfie') as File).name).toBe('selfie.jpg');
    expect(context.staging.objects.size).toBe(0);
    expect(context.sessions.records.get(context.session.id)!.status).toBe('delivered');
    expect(await deliver(context.session.id, 2, deps)).toBe('already-delivered');
  });

  it('retries a failing webhook without re-running analysis, then marks the session failed', async () => {
    const context = await staged();
    const deps = deliveryDeps(context, { fetch: async () => new Response('down', { status: 503 }) });
    expect(await deliver(context.session.id, 1, deps)).toBe('retry');
    expect(await deliver(context.session.id, 2, deps)).toBe('retry');
    expect(await deliver(context.session.id, 3, deps)).toBe('failed');
    expect(deps.analyze).toHaveBeenCalledTimes(1);
    expect(context.sessions.records.get(context.session.id)!.status).toBe('failed');
    // Staged media stay for the bucket lifecycle rule, not forever in code.
    expect(context.staging.objects.size).toBeGreaterThan(0);
  });

  it('delivers the media for manual review when analysis keeps failing', async () => {
    const context = await staged();
    const deps = deliveryDeps(context, { analyze: async () => { throw new Error('container cold'); } });
    expect(await deliver(context.session.id, 1, deps)).toBe('retry');
    expect(await deliver(context.session.id, 3, deps)).toBe('delivered');
    const event = JSON.parse(await ((await deps.requests[0]!.formData()).get('event') as Blob).text()) as VerificationEvent;
    expect(event).toMatchObject({ analysis: null, analysisError: 'analysis_unavailable' });
  });

  it('refuses an analysis response of the wrong shape', async () => {
    const context = await staged();
    const deps = deliveryDeps(context, { analyze: async () => ({ status: 'approved' }) });
    expect(await deliver(context.session.id, 1, deps)).toBe('retry');
    expect(deps.requests).toHaveLength(0);
  });

  it('backs off exponentially up to 15 minutes', () => {
    expect([1, 2, 3, 10].map(retryDelaySeconds)).toEqual([10, 20, 40, 900]);
  });
});
