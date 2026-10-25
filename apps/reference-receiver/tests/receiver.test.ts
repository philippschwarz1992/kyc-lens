import { describe, expect, it } from 'vitest';
import { signDelivery, type VerificationEvent } from '@kyc-lens/contracts';
import { browse, receive, type CaseRow, type ReceiverDeps } from '../src/receiver.js';

function deps(): ReceiverDeps & { rows: Map<string, CaseRow>; blobs: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const rows = new Map<string, CaseRow>(), blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    rows, blobs, secret: 'webhook-secret', now: () => Date.now(), username: 'viewer', password: 'pass',
    cases: { async insert(row) { if (rows.has(row.sessionId)) return false; rows.set(row.sessionId, row); return true; }, async list() { return [...rows.values()]; }, async get(id) { return rows.get(id) ?? null; } },
    files: { async put(key, bytes, contentType) { blobs.set(key, { bytes, contentType }); }, async get(key) { return blobs.get(key) ?? null; } },
  };
}
const sessionId = '0f8fad5b-d9cb-469f-a165-70867728950e';
const event: VerificationEvent = { type: 'verification.completed', sessionId, reference: 'crm-42', receivedAt: new Date().toISOString(),
  metadata: { challenges: [{ challenge: 'center', completedAt: 1, durationMs: 650 }], capturedAt: new Date().toISOString(), mode: 'camera' },
  analysis: { status: 'review', reasons: ['liveness-missing'], document: { type: 'passport', quality: { sharpness: 310, glare: 0.01, brightness: 180, rectified: true, acceptable: true, issues: [] }, mrz: null }, faceMatch: null, liveFaceMatch: null, liveness: null },
  files: [{ field: 'selfie', filename: 'selfie.jpg', type: 'image/jpeg', sizeBytes: 3 }] };

async function delivery(secret = 'webhook-secret', body = event) {
  const form = new FormData();
  form.append('event', new Blob([JSON.stringify(body)], { type: 'application/json' }), 'event.json');
  form.append('selfie', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'selfie.jpg');
  const encoded = new Response(form), bytes = new Uint8Array(await encoded.arrayBuffer());
  return new Request('https://crm.test/webhooks/kyc', { method: 'POST', body: bytes, headers: { 'Content-Type': encoded.headers.get('Content-Type')!, 'X-KYC-Signature': await signDelivery(secret, bytes) } });
}

describe('reference receiver', () => {
  it('stores a signed delivery once and acknowledges redeliveries', async () => {
    const store = deps();
    expect(await (await receive(await delivery(), store)).text()).toBe('Stored.');
    expect(await (await receive(await delivery(), store)).text()).toBe('Already stored.');
    expect(store.rows.get(sessionId)).toMatchObject({ reference: 'crm-42', status: 'review' });
    expect([...store.blobs.keys()]).toEqual([`cases/${sessionId}/selfie.jpg`]);
  });

  it('rejects an unsigned or wrongly signed delivery without storing anything', async () => {
    const store = deps();
    expect((await receive(await delivery('other-secret'), store)).status).toBe(401);
    const unsigned = await delivery(); unsigned.headers.delete('X-KYC-Signature');
    expect((await receive(unsigned, store)).status).toBe(401);
    expect(store.rows.size).toBe(0);
  });

  it('shows cases only to the viewer and escapes delivered text', async () => {
    const store = deps();
    await receive(await delivery('webhook-secret', { ...event, reference: '<script>x</script>' }), store);
    expect((await browse(new Request('https://crm.test/'), store, '/')).status).toBe(401);
    const page = await (await browse(new Request('https://crm.test/', { headers: { Authorization: `Basic ${btoa('viewer:pass')}` } }), store, '/')).text();
    expect(page).toContain(sessionId);
    expect(page).not.toContain('<script>x');
    const image = await browse(new Request('https://crm.test/', { headers: { Authorization: `Basic ${btoa('viewer:pass')}` } }), store, `/cases/${sessionId}/files/selfie.jpg`);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
