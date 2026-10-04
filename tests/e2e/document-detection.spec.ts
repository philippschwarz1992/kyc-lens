import { expect, test, type Page } from '@playwright/test';

type FixtureMode = 'good' | 'outside' | 'blank' | 'blur' | 'dark' | 'glare';
interface DocumentCameraFixture {
  mode: FixtureMode;
  streams: MediaStream[];
  workers: { source: string; posts: number; terminated: boolean }[];
}

/** Real camera pixels, including the same object-fit crop used by the preview. */
async function installDocumentCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const camera = { mode: 'good', streams: [], workers: [] } as DocumentCameraFixture;
    (window as unknown as { documentCameraFixture: DocumentCameraFixture }).documentCameraFixture = camera;
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, argumentsList, newTarget) {
        const worker = Reflect.construct(target, argumentsList, newTarget) as Worker;
        const record = { source: String(argumentsList[0]), posts: 0, terminated: false };
        camera.workers.push(record);
        const post = worker.postMessage;
        const terminate = worker.terminate;
        worker.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
          record.posts++;
          Reflect.apply(post, this, options === undefined ? [message] : [message, options]);
        };
        worker.terminate = function () { record.terminated = true; terminate.call(this); };
        return worker;
      },
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 800;
        const context = canvas.getContext('2d')!;
        const original = document.createElement('canvas');
        original.width = canvas.width;
        original.height = canvas.height;
        const paper = original.getContext('2d')!;
        const draw = () => {
          paper.fillStyle = '#3c4650';
          paper.fillRect(0, 0, original.width, original.height);
          const video = document.querySelector<HTMLVideoElement>('.kyc-document-video');
          const guide = document.querySelector<HTMLElement>('.kyc-document-guide');
          if (camera.mode !== 'blank' && video && guide) {
            const videoBounds = video.getBoundingClientRect();
            const guideBounds = guide.getBoundingClientRect();
            const scale = Math.max(videoBounds.width / original.width, videoBounds.height / original.height);
            const cropX = (original.width * scale - videoBounds.width) / 2;
            const cropY = (original.height * scale - videoBounds.height) / 2;
            const width = guideBounds.width / scale * 0.91;
            const height = guideBounds.height / scale * 0.91;
            const left = (guideBounds.left - videoBounds.left + cropX) / scale + guideBounds.width / scale * 0.045
              + (camera.mode === 'outside' ? width * 0.22 : 0);
            const top = (guideBounds.top - videoBounds.top + cropY) / scale + guideBounds.height / scale * 0.045;
            paper.fillStyle = camera.mode === 'glare' ? '#ffffff' : '#e6e1d5';
            paper.fillRect(left, top, width, height);
            paper.fillStyle = '#a8b7c6';
            paper.fillRect(left + width * 0.07, top + height * 0.18, width * 0.28, height * 0.54);
            paper.fillStyle = '#718499';
            paper.beginPath();
            paper.arc(left + width * 0.21, top + height * 0.34, height * 0.09, 0, Math.PI * 2);
            paper.fill();
            paper.fillRect(left + width * 0.13, top + height * 0.47, width * 0.16, height * 0.22);
            paper.fillStyle = '#2f3944';
            paper.font = `bold ${width * 0.035}px sans-serif`;
            paper.fillText('FICTIONAL DEMO DOCUMENT', left + width * 0.07, top + height * 0.11);
            paper.font = `${width * 0.034}px monospace`;
            paper.fillText('DEMO PERSON', left + width * 0.41, top + height * 0.28);
            for (let row = 0; row < 7; row++) {
              const lineWidth = width * (row % 2 ? 0.32 : 0.47);
              paper.fillRect(left + width * 0.41, top + height * (0.35 + row * 0.055), lineWidth, height * 0.012);
              paper.fillRect(left + width * 0.42, top + height * (0.375 + row * 0.055), lineWidth * 0.58, height * 0.005);
            }
            for (let column = 0; column < 46; column++) {
              paper.fillRect(left + width * (0.06 + column * 0.019), top + height * 0.84,
                width * (column % 3 === 0 ? 0.009 : 0.004), height * (column % 2 ? 0.07 : 0.1));
            }
          }
          context.filter = camera.mode === 'blur' ? 'blur(18px)' : camera.mode === 'dark' ? 'brightness(0.25)' : 'none';
          context.drawImage(original, 0, 0);
          context.filter = 'none';
          requestAnimationFrame(draw);
        };
        draw();
        const stream = canvas.captureStream(10);
        camera.streams.push(stream);
        return stream;
      },
    });
  });
}

async function openDocumentCamera(page: Page, type: 'id-card' | 'passport' = 'id-card'): Promise<void> {
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'],
    color: '#2563eb', locale: 'en', simulation: false, upload: false };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  if (type === 'passport') await page.getByRole('radio', { name: /Passport/ }).press('Space');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
}

async function changeCameraPixels(page: Page, mode: FixtureMode): Promise<void> {
  await page.evaluate(value => {
    (window as unknown as { documentCameraFixture: DocumentCameraFixture }).documentCameraFixture.mode = value;
  }, mode);
}

async function expectGuidance(page: Page, state: 'ready' | 'adjust'): Promise<void> {
  const guide = page.locator('.kyc-document-guide');
  await expect(guide).toHaveAttribute('data-state', state, { timeout: 15_000 });
  // Color is visible feedback, rather than a test-only status attribute.
  await expect.poll(() => guide.evaluate((element, expectedState) => {
    const color = getComputedStyle(element).borderTopColor.match(/[\d.]+/g)?.map(Number) ?? [];
    return expectedState === 'ready' ? color[1] > color[0] : color[0] > color[1];
  }, state)).toBe(true);
}

async function expectStopped(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const fixture = (window as unknown as { documentCameraFixture: DocumentCameraFixture }).documentCameraFixture;
    return fixture.streams.every(stream => stream.getVideoTracks().every(track => track.readyState === 'ended'));
  })).toBe(true);
  const before = await page.evaluate(() => {
    const workers = (window as unknown as { documentCameraFixture: DocumentCameraFixture }).documentCameraFixture.workers;
    return workers.map(({ source, posts, terminated }) => ({ source, posts, terminated }));
  });
  expect(before.length, 'A real document analysis worker should be started').toBeGreaterThan(0);
  expect(before.every(worker => worker.terminated), 'Document analysis workers should terminate when camera exits').toBe(true);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const workers = (window as unknown as { documentCameraFixture: DocumentCameraFixture }).documentCameraFixture.workers;
    return workers.map(({ source, posts, terminated }) => ({ source, posts, terminated }));
  });
  expect(after).toEqual(before);
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`live ID pixels turn green only when framed and clear at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installDocumentCamera(page);
    const errors: string[] = [];
    const external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173')) external.push(request.url());
    });
    await openDocumentCamera(page);
    await expectGuidance(page, 'ready');
    const frame = await page.locator('.kyc-kit').boundingBox();
    const actions = await page.locator('.kyc-actions').boundingBox();
    await changeCameraPixels(page, 'outside');
    await expectGuidance(page, 'adjust');
    await changeCameraPixels(page, 'good');
    await expectGuidance(page, 'ready');
    await changeCameraPixels(page, 'dark');
    await expect(page.locator('.kyc-document-guide')).toHaveAttribute('data-reason', 'dark');
    await expectGuidance(page, 'adjust');
    await expect(page.getByRole('status')).toContainText('brighter');
    await changeCameraPixels(page, 'good');
    await expectGuidance(page, 'ready');
    await changeCameraPixels(page, 'glare');
    await expect(page.locator('.kyc-document-guide')).toHaveAttribute('data-reason', 'glare');
    await expectGuidance(page, 'adjust');
    await expect(page.getByRole('status')).toContainText('reflections');
    await changeCameraPixels(page, 'good');
    await expectGuidance(page, 'ready');
    await changeCameraPixels(page, 'blur');
    await expectGuidance(page, 'adjust');
    await changeCameraPixels(page, 'good');
    await expectGuidance(page, 'ready');
    await changeCameraPixels(page, 'blank');
    await expectGuidance(page, 'adjust');
    expect(await page.locator('.kyc-kit').boundingBox()).toEqual(frame);
    expect(await page.locator('.kyc-actions').boundingBox()).toEqual(actions);
    // Guidance remains advisory: a false negative cannot lock out manual capture.
    await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Take photo', exact: true }).click();
    const photo = page.getByRole('img', { name: 'Photograph of the front of your document', exact: true });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate(image => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight })))
      .toEqual({ width: 1200, height: 800 });
    await expectStopped(page);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('passport page framing runs on camera pixels and stops on Back and camera disconnection', async ({ page }) => {
  await installDocumentCamera(page);
  await openDocumentCamera(page, 'passport');
  await expectGuidance(page, 'ready');
  await expect(page.locator('.kyc-dismiss')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open camera', exact: true })).toBeVisible();
  await expectStopped(page);
  await changeCameraPixels(page, 'blank');
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
  await expectGuidance(page, 'adjust');
  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('.kyc-document-video')!;
    (video.srcObject as MediaStream).getVideoTracks()[0].dispatchEvent(new Event('ended'));
  });
  await expect(page.locator('.kyc-error-detail')).toHaveText('Your document camera is unavailable. Try again.');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await expectStopped(page);
});

test('simulation document camera does not imply a real detection result', async ({ page }) => {
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'],
    color: '#2563eb', locale: 'en', simulation: true, upload: false };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.kyc-document-guide')).toHaveAttribute('data-state', 'off');
  await expect(page.locator('.kyc-simulation-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
});

test('a blocked guidance worker keeps document feedback red and manual capture usable', async ({ page }) => {
  await installDocumentCamera(page);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, argumentsList, newTarget) {
        if (argumentsList[1]?.name === 'kyc-document-tracker') throw new DOMException('Worker blocked by test CSP', 'SecurityError');
        return Reflect.construct(target, argumentsList, newTarget);
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openDocumentCamera(page);
  await expect(page.locator('.kyc-document-guide')).toHaveAttribute('data-reason', 'unavailable');
  await expectGuidance(page, 'adjust');
  await expect(page.getByRole('status')).toContainText('Check the photo after capture');
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Photograph of the front of your document', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    return (window as unknown as { documentCameraFixture: DocumentCameraFixture }).documentCameraFixture.streams[0].getVideoTracks()[0].readyState;
  })).toBe('ended');
  expect(errors).toEqual([]);
});
