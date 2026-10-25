import { expect, test, type Page } from '@playwright/test';

interface AutomaticDocumentFixture {
  mode: 'good' | 'blank';
  /** `auto` shows the back layout on the back camera; `front` keeps holding the front side up. */
  side: 'auto' | 'front';
  sizes: Array<[number, number]>;
  duplicateTimestamps: boolean;
  corruptPhoto: boolean;
  failEncoding: boolean;
  deferEncoding: boolean;
  pendingEncodes: Array<() => void>;
  encodes: number;
  streams: MediaStream[];
}

/** Real moving camera pixels and the packaged analyzer; only faults are injected. */

// WebKit can block autoplay of the canvas test stream; the SDK then asks for a tap, as on iOS Low Power Mode.
async function clickOpenCamera(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  const prompt = page.getByText('Tap the screen to start the camera.');
  await expect.poll(async () => await prompt.isVisible() || await cameraReady(page), { timeout: 15_000 }).toBe(true);
  if (await prompt.isVisible()) await prompt.click();
}
/** The preview shows frames and no opening/capturing status remains; the shutter itself is automatic. */
async function cameraReady(page: Page): Promise<boolean> {
  return page.evaluate(() => (document.querySelector<HTMLVideoElement>('.kyc-document-video')?.readyState ?? 0) >= 2
    && !document.querySelector('.kyc-document-status'));
}
async function installCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixture: AutomaticDocumentFixture = { mode: 'good', side: 'auto', sizes: [], duplicateTimestamps: false, corruptPhoto: false,
      failEncoding: false, deferEncoding: false, pendingEncodes: [], encodes: 0, streams: [] };
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
      // Document photos are cropped to the guide, so match any large camera-derived canvas, not the 1200x800 frame.
      if (this.width >= 400 && this.height >= 250 && this.width <= 1200 && this.height <= 800) {
        fixture.encodes++; fixture.sizes.push([this.width, this.height]);
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
    Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
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
            const backCamera = document.querySelector('h2')?.textContent?.includes('back');
            if (backCamera && fixture.side === 'auto') {
              // A fictional back layout: full-width text lines, a dark block and machine-readable-zone-like rows.
              context.fillStyle = '#2f3944';
              for (let row = 0; row < 6; row++) context.fillRect(left + width * 0.06, top + height * (0.1 + row * 0.065), width * (row % 2 ? 0.55 : 0.86), height * 0.022);
              context.fillRect(left + width * 0.64, top + height * 0.5, width * 0.28, height * 0.22);
              context.font = `${width * 0.04}px monospace`;
              for (let row = 0; row < 3; row++) context.fillText('IDDEMO<<FICTIONAL<<SAMPLE<<<<', left + width * 0.06, top + height * (0.8 + row * 0.07));
              setTimeout(draw, 100); return;
            }
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
          // The stream captures 10 fps; redrawing per animation frame only loads the main thread on slow runners.
          setTimeout(draw, 100);
        };
        draw(); const stream = canvas.captureStream(10); fixture.streams.push(stream); return stream;
      },
    });
  });
}

async function openCamera(page: Page, options: Record<string, unknown> = {}) {
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'], locale: 'en',
    color: '#2563eb', simulation: false, upload: false, faceMatch: false, documentHoldMs: 1200, ...options };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await clickOpenCamera(page);
  await expect.poll(() => cameraReady(page)).toBe(true);
}

async function changeFixture(page: Page, changes: Partial<AutomaticDocumentFixture>) {
  await page.evaluate(values => Object.assign((window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture }).automaticDocumentFixture, values), changes);
}

async function encodes(page: Page) {
  return page.evaluate(() => (window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture }).automaticDocumentFixture.encodes);
}

async function fixture(page: Page) {
  return page.evaluate(() => (window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture }).automaticDocumentFixture);
}

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });

test('a clear document is photographed at once and both sides continue without a review step', async ({ page }) => {
  await installCamera(page);
  await openCamera(page, { documentHoldMs: 0 });
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toHaveCount(0);
  await expect(heading(page, 'Front captured')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Now turn your document over.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Looks good', exact: true })).toHaveCount(0);
  // The back camera opens by itself after the confirmation.
  await expect(heading(page, 'Photograph the back')).toBeVisible({ timeout: 5000 });
  await expect(heading(page, 'Back captured')).toBeVisible({ timeout: 15_000 });
  const { encodes: count, sizes, streams } = await fixture(page);
  expect(count).toBe(2);
  // Each photo is cropped to the guide (ID-card proportions plus margin) at the camera's native pixel density.
  for (const [width, height] of sizes) { expect(width).toBeLessThanOrEqual(1200); expect(height).toBeLessThan(800); expect(width / height).toBeCloseTo(1.58, 1); }
  expect(streams).toHaveLength(2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { automaticDocumentFixture: AutomaticDocumentFixture })
    .automaticDocumentFixture.streams.slice(0, 2).every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await expect(heading(page, 'Back captured')).toHaveCount(0, { timeout: 5000 });
});

test('the back camera refuses the same side again until the document is turned over', async ({ page }) => {
  await installCamera(page);
  await openCamera(page, { documentHoldMs: 0 });
  await changeFixture(page, { side: 'front' });
  await expect(heading(page, 'Photograph the back')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('This is the same side. Turn your document over.')).toBeVisible({ timeout: 15_000 });
  await expect(heading(page, 'Back captured')).toHaveCount(0);
  await changeFixture(page, { side: 'auto' });
  await expect(heading(page, 'Back captured')).toBeVisible({ timeout: 15_000 });
});

test('the captured JPEG is checked again and unusable pixels return to the camera', async ({ page }) => {
  await installCamera(page);
  await openCamera(page);
  await changeFixture(page, { corruptPhoto: true });
  await expect.poll(() => encodes(page), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => cameraReady(page)).toBe(true);
  await expect(page.locator('.kyc-document-guide')).toHaveAttribute('data-reason', 'searching');
  await expect(page.getByRole('button', { name: 'Looks good', exact: true })).toHaveCount(0);
  await changeFixture(page, { corruptPhoto: false, mode: 'good' });
  await expect(heading(page, 'Front captured')).toBeVisible({ timeout: 15_000 });
  expect(await encodes(page)).toBe(2);
});

test('duplicate and stale worker observations cannot finish the hold', async ({ page }) => {
  await installCamera(page);
  await openCamera(page);
  await expect(page.getByRole('progressbar', { name: 'Automatic photo capture' })).toHaveAttribute('aria-valuenow', /[1-9]/);
  await changeFixture(page, { duplicateTimestamps: true });
  await page.waitForTimeout(1800);
  expect(await encodes(page)).toBe(0);
  await changeFixture(page, { duplicateTimestamps: false });
  await expect(heading(page, 'Front captured')).toBeVisible({ timeout: 15_000 });
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
  await clickOpenCamera(page);
  await expect(heading(page, 'Front captured')).toBeVisible({ timeout: 15_000 });
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

test('blocked camera autoplay asks for a tap instead of reporting denied permission', async ({ page }) => {
  await installCamera(page);
  await page.addInitScript(() => {
    // The first play() fails as it does in iOS Low Power Mode; later ones come from the tap.
    const play = HTMLMediaElement.prototype.play;
    let blocked = false;
    HTMLMediaElement.prototype.play = function () {
      if (!blocked && this.classList.contains('kyc-document-video')) { blocked = true; return Promise.reject(new DOMException('Autoplay blocked.', 'NotAllowedError')); }
      return play.call(this);
    };
  });
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'], locale: 'en', simulation: false, upload: false, faceMatch: false };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.getByText('Tap the screen to start the camera.')).toBeVisible();
  await expect(page.locator('.kyc-error-screen')).toHaveCount(0);
  await page.getByText('Tap the screen to start the camera.').click();
  await expect(page.getByText('Tap the screen to start the camera.')).toHaveCount(0);
  await expect(heading(page, 'Front captured')).toBeVisible({ timeout: 15_000 });
});
