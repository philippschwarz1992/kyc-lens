import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FaceMatchResult } from '../../src/matching/protocol.js';

const clientUrl = `/@fs/${resolve('src/matching/client.ts').replaceAll('\\', '/')}`;
type ImageKind = 'portrait' | 'changed' | 'blank' | 'double' | 'small' | 'invalid';

async function prepare(page: Page) {
  const portrait = await readFile(resolve('tests/fixtures/astronaut.png'));
  await page.route('**/qa-fixtures/portrait.png', route => route.fulfill({ contentType: 'image/png', body: portrait }));
  await page.goto('/settings?document=0');
}

async function compare(page: Page, document: ImageKind, selfie: ImageKind = 'portrait', overrides: Record<string, unknown> = {}): Promise<FaceMatchResult> {
  return page.evaluate(async ({ clientUrl, document, selfie, overrides }) => {
    const { compareFaces } = await import(clientUrl);
    const portrait = await (await fetch('/qa-fixtures/portrait.png')).blob();
    const make = async (kind: string) => {
      if (kind === 'portrait') return portrait;
      if (kind === 'invalid') return new Blob(['invalid image'], { type: 'image/png' });
      const bitmap = await createImageBitmap(portrait);
      const canvas = new OffscreenCanvas(kind === 'double' ? 1024 : kind === 'small' ? 64 : 512, kind === 'small' ? 64 : 512);
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#777'; context.fillRect(0, 0, canvas.width, canvas.height);
      if (kind !== 'blank') {
        context.drawImage(bitmap, 0, 0, kind === 'small' ? 64 : 512, kind === 'small' ? 64 : 512);
        if (kind === 'double') context.drawImage(bitmap, 512, 0);
        if (kind === 'changed') {
          const pixels = context.getImageData(0, 0, 512, 512);
          for (let i = 0; i < pixels.data.length; i += 4) for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] = Math.trunc(pixels.data[i + channel]! * .85 + 15);
          context.putImageData(pixels, 0, 0);
        }
      }
      bitmap.close();
      return canvas.convertToBlob({ type: 'image/png' });
    };
    return compareFaces({ document: await make(document), selfie: await make(selfie), ...overrides });
  }, { clientUrl, document, selfie, overrides });
}

test('packaged YuNet and SFace compare real image pixels using only same-origin assets', async ({ page, context }) => {
  test.setTimeout(90_000);
  const external: string[] = [], posts: string[] = [], requested: string[] = [], errors: string[] = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== 'http://127.0.0.1:5173') { external.push(url.href); await route.abort(); return; }
    if (request.method() === 'POST') posts.push(url.pathname);
    requested.push(url.pathname);
    await route.fallback();
  });
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  const result = await compare(page, 'portrait');
  expect(result).toMatchObject({ status: 'match', reason: 'compared', threshold: .363, inconclusiveMargin: .03 });
  expect(result.score).toBeCloseTo(1, 5);
  expect(Object.keys(result).sort()).toEqual(['durationMs', 'inconclusiveMargin', 'models', 'reason', 'score', 'status', 'threshold'].sort());
  expect(requested).toContain('/kyc-assets/match-worker.js');
  expect(requested).toContain('/kyc-assets/matching/face_detection_yunet_2023mar.onnx');
  expect(requested).toContain('/kyc-assets/matching/face_recognition_sface_2021dec.onnx');
  expect(requested).toContain('/kyc-assets/matching/ort/ort-wasm-simd-threaded.wasm');
  expect(external).toEqual([]); expect(posts).toEqual([]); expect(errors).toEqual([]);
  const reference = JSON.parse(await readFile(resolve('tests/fixtures/astronaut-reference.json'), 'utf8'));
  const adjusted = await compare(page, 'portrait', 'changed');
  expect(adjusted.status).toBe('match');
  expect(Math.abs(adjusted.score! - reference.adjusted.pairScore)).toBeLessThan(.002);
  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  expect(storage).toEqual({ local: [], session: [] });
});

test('missing, ambiguous and undecodable faces return nondecisions', async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page);
  expect(await compare(page, 'blank')).toMatchObject({ status: 'inconclusive', reason: 'no_document_face' });
  expect(await compare(page, 'portrait', 'blank')).toMatchObject({ status: 'inconclusive', reason: 'no_selfie_face' });
  expect(await compare(page, 'portrait', 'double')).toMatchObject({ status: 'inconclusive', reason: 'multiple_selfie_faces' });
  expect(await compare(page, 'double')).toMatchObject({ status: 'inconclusive', reason: 'ambiguous_document_face' });
  expect(await compare(page, 'small')).toMatchObject({ status: 'inconclusive', reason: 'invalid_image' });
  expect(await compare(page, 'invalid')).toMatchObject({ status: 'inconclusive', reason: 'invalid_image' });
});

test('blocked or corrupt models cannot produce a match', async ({ page }) => {
  await prepare(page);
  await page.route('**/face_detection_yunet_2023mar.onnx', route => route.fulfill({ status: 404, body: 'missing' }));
  expect(await compare(page, 'portrait')).toMatchObject({ status: 'unavailable', reason: 'model_error' });
  await page.unroute('**/face_detection_yunet_2023mar.onnx');
  await page.route('**/face_recognition_sface_2021dec.onnx', route => route.fulfill({ contentType: 'application/octet-stream', body: Buffer.alloc(38696353, 1) }));
  const result = await compare(page, 'portrait');
  expect(result).toMatchObject({ status: 'unavailable', reason: 'model_error' }); expect(result.score).toBeUndefined();
});

test('external assets are rejected before fetch and active comparison aborts cleanly', async ({ page }) => {
  await prepare(page);
  const external: string[] = [];
  await page.route('https://third-party.invalid/**', async route => { external.push(route.request().url()); await route.abort(); });
  expect(await compare(page, 'portrait', 'portrait', { assets: { faceDetectorModelUrl: 'https://third-party.invalid/model.onnx' } })).toMatchObject({ status: 'unavailable', reason: 'invalid_assets' });
  expect(external).toEqual([]);
  const aborted = await page.evaluate(async ({ clientUrl }) => {
    const { compareFaces } = await import(clientUrl);
    const portrait = await (await fetch('/qa-fixtures/portrait.png')).blob();
    const controller = new AbortController();
    const pending = compareFaces({ document: portrait, selfie: portrait, signal: controller.signal });
    controller.abort();
    try { await pending; return 'unexpected completion'; } catch (error) { return (error as Error).name; }
  }, { clientUrl });
  expect(aborted).toBe('AbortError');
});

test('runtime redirects are rejected before contacting another origin', async ({ page }) => {
  await prepare(page);
  const external: string[] = [];
  await page.route('https://third-party.invalid/**', async route => { external.push(route.request().url()); await route.abort(); });
  await page.route('**/matching/ort/ort-wasm-simd-threaded.mjs', route => route.fulfill({ status: 302, headers: { location: 'https://third-party.invalid/runtime.mjs' } }));
  expect(await compare(page, 'portrait')).toMatchObject({ status: 'unavailable', reason: 'model_error' });
  expect(external).toEqual([]);
});
