import { expect, test, type Page } from '@playwright/test';

interface AutomaticDocumentFixture {
  mode: 'good' | 'blank';
  duplicateTimestamps: boolean;
  corruptPhoto: boolean;
  failEncoding: boolean;
  manualRace: boolean;
  deferEncoding: boolean;
  pendingEncodes: Array<() => void>;
  encodes: number;
  streams: MediaStream[];
}

/** Real moving camera pixels and the packaged analyzer; only faults are injected. */
async function installCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixture: AutomaticDocumentFixture = { mode: 'good', duplicateTimestamps: false, corruptPhoto: false,
      failEncoding: false, manualRace: false, deferEncoding: false, pendingEncodes: [], encodes: 0, streams: [] };
    (window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture }).automaticDocumentFixture = fixture;
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if (args[1]?.name !== 'kyc-document-tracker') return worker;
        const post = worker.postMessage;
        let previous = -1;
        worker.postMessage = function (message: { type?: string; timestamp?: number }, options?: Transferable[] | StructuredSerializeOptions) {
          if (message.type === 'frame' && typeof message.timestamp === 'number') {
            if (fixture.duplicateTimestamps && previous >= 0) message.timestamp = previous;
            else previous = message.timestamp;
          }
          Reflect.apply(post, this, options === undefined ? [message] : [message, options]);
        };
        return worker;
      },
    });
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (this.width === 1200 && this.height === 800) {
        fixture.encodes++;
        if (fixture.manualRace) {
          // React has not committed its disabled state yet; the hook must own the race lock.
          [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Take photo'))?.click();
        }
        if (fixture.corruptPhoto) {
          const context = this.getContext('2d')!;
          context.fillStyle = '#525c66'; context.fillRect(0, 0, this.width, this.height);
          fixture.mode = 'blank';
        }
        if (fixture.failEncoding) { callback(null); return; }
        if (fixture.deferEncoding) { fixture.pendingEncodes.push(() => encode.call(this, callback, type, quality)); return; }
      }
      encode.call(this, callback, type, quality);
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
        const context = canvas.getContext('2d')!;
        const draw = () => {
          context.fillStyle = '#3c4650'; context.fillRect(0, 0, canvas.width, canvas.height);
          const video = document.querySelector<HTMLVideoElement>('.kyc-document-video');
          const guide = document.querySelector<HTMLElement>('.kyc-document-guide');
          if (fixture.mode === 'good' && video && guide) {
            const view = video.getBoundingClientRect(), frame = guide.getBoundingClientRect();
            const scale = Math.max(view.width / canvas.width, view.height / canvas.height);
            const width = frame.width / scale * 0.91, height = frame.height / scale * 0.91;
            const left = (frame.left - view.left + (canvas.width * scale - view.width) / 2) / scale + frame.width / scale * 0.045;
            const top = (frame.top - view.top + (canvas.height * scale - view.height) / 2) / scale + frame.height / scale * 0.045;
            context.fillStyle = '#e6e1d5'; context.fillRect(left, top, width, height);
            context.fillStyle = '#a8b7c6'; context.fillRect(left + width * 0.07, top + height * 0.18, width * 0.28, height * 0.54);
            context.fillStyle = '#718499'; context.beginPath();
            context.arc(left + width * 0.21, top + height * 0.34, height * 0.09, 0, Math.PI * 2); context.fill();
            context.fillRect(left + width * 0.13, top + height * 0.47, width * 0.16, height * 0.22);
            context.fillStyle = '#2f3944'; context.font = `bold ${width * 0.035}px sans-serif`;
            context.fillText('FICTIONAL DEMO DOCUMENT', left + width * 0.07, top + height * 0.11);
            context.font = `${width * 0.034}px monospace`; context.fillText('DEMO PERSON', left + width * 0.41, top + height * 0.28);
            for (let row = 0; row < 7; row++) {
              const line = width * (row % 2 ? 0.32 : 0.47);
              context.fillRect(left + width * 0.41, top + height * (0.35 + row * 0.055), line, height * 0.012);
              context.fillRect(left + width * 0.42, top + height * (0.375 + row * 0.055), line * 0.58, height * 0.005);
            }
            for (let column = 0; column < 46; column++) context.fillRect(left + width * (0.06 + column * 0.019),
              top + height * 0.84, width * (column % 3 === 0 ? 0.009 : 0.004), height * (column % 2 ? 0.07 : 0.1));
          }
          requestAnimationFrame(draw);
        };
        draw(); const stream = canvas.captureStream(10); fixture.streams.push(stream); return stream;
      },
    });
  });
}

async function openCamera(page: Page, options: Record<string, unknown> = {}) {
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'], locale: 'en',
    color: '#2563eb', simulation: false, upload: false, faceMatch: false, documentHoldDurationMs: 1200, ...options };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
}

async function changeFixture(page: Page, changes: Partial<AutomaticDocumentFixture>) {
  await page.evaluate(values => Object.assign((window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture }).automaticDocumentFixture, values), changes);
}

async function encodes(page: Page) {
  return page.evaluate(() => (window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture }).automaticDocumentFixture.encodes);
}

test('automatic quality-gated photos retain full resolution and respect front/back and manual races', async ({ page }) => {
  await installCamera(page);
  await openCamera(page);
  await changeFixture(page, { manualRace: true });
  const front = page.getByRole('img', { name: 'Photograph of the front of your document', exact: true });
  await expect(front).toBeVisible({ timeout: 15_000 });
  expect(await front.evaluate(image => [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight])).toEqual([1200, 800]);
  expect(await encodes(page)).toBe(1);
  await page.getByRole('button', { name: 'Looks good', exact: true }).click();
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Photograph of the back of your document', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await encodes(page)).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture })
    .automaticDocumentFixture.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
});

test('the captured JPEG is checked again and unusable pixels return to the camera', async ({ page }) => {
  await installCamera(page);
  await openCamera(page);
  await changeFixture(page, { corruptPhoto: true });
  await expect.poll(() => encodes(page), { timeout: 15_000 }).toBe(1);
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
  await expect(page.locator('.kyc-document-guide')).toHaveAttribute('data-reason', 'searching');
  await expect(page.getByRole('button', { name: 'Looks good', exact: true })).toHaveCount(0);
  await changeFixture(page, { corruptPhoto: false, mode: 'good' });
  await expect(page.getByRole('img', { name: 'Photograph of the front of your document', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await encodes(page)).toBe(2);
});

test('duplicate and stale worker observations cannot finish the hold', async ({ page }) => {
  await installCamera(page);
  await openCamera(page);
  await expect(page.getByRole('progressbar', { name: 'Automatic photo capture' })).toHaveAttribute('aria-valuenow', /[1-9]/);
  await changeFixture(page, { duplicateTimestamps: true });
  await page.waitForTimeout(1800);
  expect(await encodes(page)).toBe(0);
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
  await changeFixture(page, { duplicateTimestamps: false });
  await expect(page.getByRole('img', { name: 'Photograph of the front of your document', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await encodes(page)).toBe(1);
});

test('failed photo encoding never accepts a photo and stops the camera', async ({ page }) => {
  await installCamera(page);
  await openCamera(page);
  await changeFixture(page, { failEncoding: true });
  await expect(page.locator('.kyc-error-detail')).toHaveText('The document photo could not be captured. Try again.', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Looks good', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture })
    .automaticDocumentFixture.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
});

test('Back during automatic encoding discards the late photo and the next attempt starts cleanly', async ({ page }) => {
  await installCamera(page);
  await openCamera(page);
  await changeFixture(page, { deferEncoding: true });
  await expect.poll(() => encodes(page), { timeout: 15_000 }).toBe(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open camera', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const fixture = (window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture }).automaticDocumentFixture;
    fixture.deferEncoding = false;
    fixture.pendingEncodes.splice(0).forEach(complete => complete());
  });
  await expect(page.getByRole('button', { name: 'Open camera', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Looks good', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Photograph of the front of your document', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await encodes(page)).toBe(2);
});

test('an unavailable analyzer never auto-captures and the manual fallback remains usable', async ({ page }) => {
  await installCamera(page);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        if (args[1]?.name === 'kyc-document-tracker') throw new DOMException('Worker blocked for test', 'SecurityError');
        return Reflect.construct(target, args, newTarget);
      },
    });
  });
  await openCamera(page);
  await expect(page.locator('.kyc-document-guide')).toHaveAttribute('data-reason', 'unavailable');
  await page.waitForTimeout(1500);
  expect(await encodes(page)).toBe(0);
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Photograph of the front of your document', exact: true })).toBeVisible();
  expect(await encodes(page)).toBe(1);
});
