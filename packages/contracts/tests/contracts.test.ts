import { describe, expect, it } from 'vitest';
import { CaptureError, parseCapture, signDelivery, validateApplicant, verifyDelivery } from '../src/index.js';

const jpeg = (size = 32) => { const bytes = new Uint8Array(size); bytes.set([255, 216, 255]); bytes.set([255, 217], size - 2); return bytes; };
const metadata = (document?: object) => JSON.stringify({ challenges: [{ challenge: 'center', completedAt: 1, durationMs: 650 }], capturedAt: new Date().toISOString(), mode: 'camera', ...(document ? { document } : {}) });
function form(fields: Record<string, string | Uint8Array>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === 'string') data.append(name, value);
    else data.append(name, new Blob([value as BlobPart], { type: 'image/jpeg' }), `${name}.jpg`);
  }
  return data;
}

describe('capture upload contract', () => {
  it('accepts an identity card capture and names its files by field', async () => {
    const parsed = await parseCapture(form({ selfie: jpeg(), metadata: metadata({ type: 'id-card' }), documentFront: jpeg(40), documentBack: jpeg(48) }));
    expect(parsed.files.map(file => [file.field, file.filename])).toEqual([['selfie', 'selfie.jpg'], ['documentFront', 'document-front.jpg'], ['documentBack', 'document-back.jpg']]);
    expect(parsed.document).toEqual({ type: 'id-card', front: { type: 'image/jpeg', sizeBytes: 40 }, back: { type: 'image/jpeg', sizeBytes: 48 } });
    expect(parsed.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same digest for a retry and a different one for other bytes', async () => {
    const fields = { selfie: jpeg(), metadata: metadata({ type: 'passport' }), documentFront: jpeg(40) };
    const first = await parseCapture(form(fields)), retry = await parseCapture(form(fields));
    const other = await parseCapture(form({ ...fields, documentFront: jpeg(41) }));
    expect(retry.digest).toBe(first.digest);
    expect(other.digest).not.toBe(first.digest);
  });

  it('rejects a card without its back, a spoofed image type and stale metadata', async () => {
    await expect(parseCapture(form({ selfie: jpeg(), metadata: metadata({ type: 'id-card' }), documentFront: jpeg() }))).rejects.toMatchObject({ status: 400 });
    await expect(parseCapture(form({ selfie: new Uint8Array(32).fill(1), metadata: metadata() }))).rejects.toBeInstanceOf(CaptureError);
    const old = JSON.stringify({ challenges: [{ challenge: 'center', completedAt: 1, durationMs: 1 }], capturedAt: '2020-01-01T00:00:00Z', mode: 'camera' });
    await expect(parseCapture(form({ selfie: jpeg(), metadata: old }))).rejects.toThrow(/24 hours/);
  });
});

describe('signed delivery', () => {
  const body = new TextEncoder().encode('--boundary\r\nexample body');
  it('verifies its own signature and rejects tampering, wrong secrets and replays', async () => {
    const header = await signDelivery('secret', body, 1_700_000_000);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(await verifyDelivery('secret', header, body, 1_700_000_100)).toBe(true);
    expect(await verifyDelivery('other', header, body, 1_700_000_100)).toBe(false);
    expect(await verifyDelivery('secret', header, new TextEncoder().encode('changed'), 1_700_000_100)).toBe(false);
    expect(await verifyDelivery('secret', header, body, 1_700_000_000 + 301)).toBe(false);
    expect(await verifyDelivery('secret', null, body)).toBe(false);
    expect(await verifyDelivery('secret', 't=abc,v1=00', body)).toBe(false);
  });
});

describe('applicant data', () => {
  it('accepts names with diacritics, hyphens and apostrophes and tidies whitespace', () => {
    expect(validateApplicant({ givenNames: '  Zoë  Anne-Marie ', surname: "O'Brien-Müller", birthDate: '1974-08-12' }))
      .toEqual({ givenNames: 'Zoë Anne-Marie', surname: "O'Brien-Müller", birthDate: '1974-08-12' });
  });

  it.each([
    [{}], [null], [['Anna']], [{ email: 'a@b.c' }], [{ surname: '' }], [{ surname: 42 }], [{ surname: 'R2-D2' }],
    [{ surname: 'x'.repeat(101) }], [{ birthDate: '1974-02-30' }], [{ birthDate: '12.08.1974' }], [{ birthDate: '2999-01-01' }],
  ])('refuses %j', value => {
    expect(() => validateApplicant(value)).toThrow(CaptureError);
  });
});
