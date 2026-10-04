import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function openConfiguredPreview(page: Page): Promise<void> {
  const preview = page.getByRole('link', { name: 'Open preview', exact: true });
  await expect(preview).toHaveAttribute('target', '_blank');
  const href = await preview.getAttribute('href');
  if (!href) throw new Error('The settings page did not provide a preview URL.');
  await page.goto(href);
}

async function expectInsideViewport(page: Page, control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('The capture control has no viewport geometry.');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await control.click({ trial: true });
}

async function expectNoCancelControls(page: Page): Promise<void> {
  await expect(page.locator('.kyc-dismiss')).toHaveCount(0);
  await expect(page.locator('.kyc-kit').getByRole('button', { name: /^(Cancel|Close|Abbrechen|Schließen)$/i })).toHaveCount(0);
}

async function expectAutomaticFaceReview(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /^(Start camera|Start simulation|Simulate this movement|Kamera starten|Simulation starten|Bewegung simulieren)$/ })).toHaveCount(0);
  try {
    await expect(page.locator('.kyc-review-screen, .kyc-error-screen')).toBeVisible({ timeout: 25_000 });
    if (await page.locator('.kyc-error-screen').isVisible()) throw new Error(`Automatic face recording failed: ${await page.locator('.kyc-error-detail').textContent()}`);
  }
  catch (error) {
    const events = await page.evaluate(() => (window as unknown as { faceRecordingEvents?: unknown[] }).faceRecordingEvents);
    if (events) throw new Error(`${String(error)}\nMediaRecorder events: ${JSON.stringify(events)}`);
    throw error;
  }
  await expect(page.locator('.kyc-review-screen video')).toBeVisible();
}

async function fixedFrameChecks(page: Page): Promise<(phase: string) => Promise<void>> {
  await page.evaluate(() => document.fonts.ready);
  const initial = await page.locator('.kyc-kit').boundingBox();
  if (!initial) throw new Error('The capture frame did not render.');
  const actions = await page.locator('.kyc-actions').boundingBox();
  const initialActionBottom = actions ? actions.y + actions.height : undefined;
  return async (phase: string) => {
    await expectNoCancelControls(page);
    const current = await page.locator('.kyc-kit').boundingBox();
    if (!current) throw new Error(`${phase}: capture frame disappeared.`);
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(current[dimension] - initial[dimension]), `${phase}: frame ${dimension} changed`).toBeLessThanOrEqual(1);
    }
    const viewport = page.viewportSize()!;
    if (viewport.width > 480) {
      expect(Math.abs(current.x + current.width / 2 - viewport.width / 2), `${phase}: frame is not horizontally centered`).toBeLessThanOrEqual(1);
      expect(Math.abs(current.y + current.height / 2 - viewport.height / 2), `${phase}: frame is not vertically centered`).toBeLessThanOrEqual(1);
    } else {
      expect(current).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    }
    const overflow = await page.evaluate(() => {
      const elements = [document.documentElement, document.body, ...document.querySelectorAll('.kyc-kit, .kyc-content, .kyc-screen')];
      return elements.flatMap(element => {
        const { width, height } = element.getBoundingClientRect();
        if (width === 0 || height === 0) return [];
        return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1
          ? [{ name: element.className || element.tagName, client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight] }]
          : [];
      });
    });
    expect(overflow, `${phase}: capture content is scrollable or overflows`).toEqual([]);
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })), `${phase}: document scrolled`).toEqual({ x: 0, y: 0 });
    if (initialActionBottom !== undefined) {
      // Read the rail and its controls atomically: a fast upload may switch the
      // submitting screen to the result between separate browser round trips.
      const geometry = await page.evaluate(() => {
        const element = document.querySelector('.kyc-actions');
        if (!element) throw new Error('The capture actions rail is missing.');
        const railBox = element.getBoundingClientRect();
        return { bottom: railBox.y + railBox.height, controls: Array.from(element.querySelectorAll<HTMLButtonElement>('button'), button => {
          const box = button.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height,
            receivesPointer: button.disabled || button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
        }) };
      });
      expect(Math.abs(geometry.bottom - initialActionBottom), `${phase}: bottom actions moved`).toBeLessThanOrEqual(1);
      for (const control of geometry.controls) {
        expect(control.x).toBeGreaterThanOrEqual(0);
        expect(control.y).toBeGreaterThanOrEqual(0);
        expect(control.x + control.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(control.y + control.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(control.receivesPointer, `${phase}: a bottom control cannot receive a click`).toBe(true);
      }
    }
  };
}

test('simulation completes selected challenges, review and authenticated local upload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/settings?simulate=1&document=0');
  await page.getByRole('switch', { name: 'Local upload API' }).check();
  await openConfiguredPreview(page);
  await page.getByRole('button', { name: 'Start face capture', exact: true }).click();
  await expectAutomaticFaceReview(page);
  const upload = page.waitForResponse(response => response.url().endsWith('/capture') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
  const response = await upload;
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.status).toBe('capture_complete');
  expect(body.mode).toBe('simulation');
  expect(body.challenges.map((c: {challenge: string}) => c.challenge)).toEqual(['center', 'turn-left', 'turn-right', 'closer', 'further']);
  await expect(page.getByRole('heading', { name: 'Your capture is complete.' })).toBeVisible();
  await page.goto('/settings?document=0');
  await page.getByRole('tab', { name: 'Capture summary', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('local API saved capture files');
  expect(errors).toEqual([]);
});

async function installRecordingDiagnostics(page: Page, cameraCountOnly = false): Promise<void> {
  await page.addInitScript(cameraCountOnly => {
    const events: Record<string, unknown>[] = [];
    (window as unknown as { faceRecordingEvents: typeof events }).faceRecordingEvents = events;
    const nativeCamera = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let cameraRequest = 0;
    navigator.mediaDevices.getUserMedia = async constraints => {
      const request = ++cameraRequest;
      events.push({ event: 'camera-request', time: performance.now(), request });
      const stream = await nativeCamera(constraints);
      events.push({ event: 'camera-ready', time: performance.now(), request, stream: stream.id,
        tracks: stream.getTracks().map(track => ({ id: track.id, state: track.readyState, muted: track.muted })) });
      if (cameraCountOnly) return stream;
      for (const track of stream.getTracks()) {
        const nativeStop = track.stop.bind(track);
        track.stop = () => {
          events.push({ event: 'track-stop', time: performance.now(), request, id: track.id,
            state: track.readyState, caller: new Error().stack?.split('\n').slice(1, 5).join('\n') });
          nativeStop();
        };
        track.addEventListener('ended', () => events.push({ event: 'track-ended', time: performance.now(), request, id: track.id }));
      }
      return stream;
    };
    if (cameraCountOnly) return;
    const NativeRecorder = window.MediaRecorder;
    window.MediaRecorder = new Proxy(NativeRecorder, {
      construct(target, args, newTarget) {
        const recorder = Reflect.construct(target, args, newTarget) as MediaRecorder;
        events.push({ event: 'constructed', time: performance.now(), mime: recorder.mimeType,
          tracks: recorder.stream.getTracks().map(track => ({ muted: track.muted, settings: track.getSettings() })) });
        const samples = setInterval(() => {
          const video = document.querySelector<HTMLVideoElement>('.kyc-video');
          events.push({ event: 'sample', time: performance.now(), state: recorder.state,
            videoTime: video?.currentTime, videoReadyState: video?.readyState, frames: video?.getVideoPlaybackQuality().totalVideoFrames,
            muted: recorder.stream.getTracks().map(track => track.muted) });
        }, 100);
        for (const kind of ['start', 'stop', 'error', 'dataavailable']) recorder.addEventListener(kind, event => {
          if (kind === 'stop') clearInterval(samples);
          events.push({ event: kind, time: performance.now(), state: recorder.state,
            ...(kind === 'dataavailable' ? { size: (event as BlobEvent).data.size } : {}),
            trackStates: recorder.stream.getTracks().map(track => track.readyState) });
        });
        return recorder;
      },
    });
  }, cameraCountOnly);
}

test('optional screens, German locale, retake and upload retry preserve the capture flow', async ({ page }) => {
  await installRecordingDiagnostics(page);
  await page.goto('/settings?simulate=1&document=0');
  await page.getByRole('switch', { name: 'Introduction' }).uncheck();
  await page.locator('#demo-locale').selectOption('de');
  for (const name of ['Turn left', 'Turn right', 'Move closer', 'Move further']) await page.getByRole('checkbox', { name, exact: false }).uncheck();
  await page.getByRole('switch', { name: 'Local upload API' }).check();
  await openConfiguredPreview(page);
  await expect(page.getByRole('button', { name: 'Gesichtsaufnahme starten' })).toHaveCount(0);
  await expectAutomaticFaceReview(page);
  await expect(page.getByRole('button', { name: 'Erneut aufnehmen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Erneut aufnehmen', exact: true }).click();
  await expectAutomaticFaceReview(page);
  let attempts = 0;
  await page.route('**/api/kyc/sessions/*/capture', async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary upload failure.' }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Bestätigen & weiter', exact: true }).click();
  await expect(page.locator('.kyc-error-detail')).toHaveText('Temporary upload failure.');
  await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ihre Aufnahme ist abgeschlossen.' })).toBeVisible();
  expect(attempts).toBe(2);
});

test('real worker initializes with local assets, runs on fake camera frames and cleans up after a camera frame error', async ({ page }) => {
  await installRecordingDiagnostics(page, true);
  await page.addInitScript(() => {
    const state = { failFrame: false, workerTerminated: false };
    (window as unknown as { faceCameraFixture: typeof state }).faceCameraFixture = state;
    const createBitmap = window.createImageBitmap;
    window.createImageBitmap = (image: ImageBitmapSource, ...argumentsList: unknown[]) => {
      if (state.failFrame) return Promise.reject(new DOMException('Camera frame became unavailable.', 'InvalidStateError'));
      return Reflect.apply(createBitmap, window, [image, ...argumentsList]) as Promise<ImageBitmap>;
    };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, argumentsList, newTarget) {
        const worker = Reflect.construct(target, argumentsList, newTarget) as Worker;
        const terminate = worker.terminate;
        worker.terminate = function () { state.workerTerminated = true; terminate.call(this); };
        return worker;
      },
    });
  });
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173')) external.push(request.url()); });
  await page.goto('/?document=0');
  let modelLoaded = false;
  page.on('response', response => { if (response.url().endsWith('/face_landmarker.task')) modelLoaded = response.ok(); });
  await page.getByRole('button', { name: 'Start face capture', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0);
  await expect(page.locator('.kyc-current-instruction[role="status"], .kyc-error-screen')).toBeVisible({ timeout: 30_000 });
  if (await page.locator('.kyc-error-screen').isVisible()) {
    const events = await page.evaluate(() => (window as unknown as { faceRecordingEvents?: unknown[] }).faceRecordingEvents);
    throw new Error(`Real camera recording failed: ${await page.locator('.kyc-error-detail').textContent()}\nMediaRecorder events: ${JSON.stringify(events)}`);
  }
  expect(modelLoaded).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Bring your face into the circle' })).toBeVisible({ timeout: 30_000 });
  // StrictMode's discarded effect must not open a second camera session.
  expect(await page.evaluate(() => (window as unknown as { faceRecordingEvents: { event: string }[] }).faceRecordingEvents.filter(event => event.event === 'camera-request').length)).toBe(1);
  await expectNoCancelControls(page);
  const trackHandle = await page.evaluateHandle(() => (document.querySelector('video')!.srcObject as MediaStream).getVideoTracks()[0]);
  await page.evaluate(() => { (window as unknown as { faceCameraFixture: { failFrame: boolean } }).faceCameraFixture.failFrame = true; });
  await expect(page.locator('.kyc-error-detail')).toHaveText('Camera frame became unavailable.');
  expect(await trackHandle.evaluate(track => track.readyState)).toBe('ended');
  expect(await page.evaluate(() => (window as unknown as { faceCameraFixture: { workerTerminated: boolean } }).faceCameraFixture.workerTerminated)).toBe(true);
  await expectNoCancelControls(page);
  await page.evaluate(() => { (window as unknown as { faceCameraFixture: { failFrame: boolean } }).faceCameraFixture.failFrame = false; });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Bring your face into the circle' })).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { faceRecordingEvents: { event: string }[] }).faceRecordingEvents.filter(event => event.event === 'camera-request').length)).toBe(2);
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('camera denial stays in real mode and gives a recoverable message', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')), configurable: true });
  });
  await page.goto('/?document=0');
  await page.getByRole('button', { name: 'Start face capture', exact: true }).click();
  await expect(page.locator('.kyc-error-detail')).toContainText('Camera permission was denied');
  await expect(page.getByRole('button', { name: 'Start simulation', exact: true })).toHaveCount(0);
  await page.locator('.kyc-kit').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.kyc-error-detail')).toContainText('Camera permission was denied');
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0);
});

test('sample endpoint rejects missing tokens and fake image data', async ({ request }) => {
  const created = await request.post('/api/kyc/sessions', { data: {} });
  expect(created.status()).toBe(201);
  const session = await created.json();
  expect((await request.get(`/api/kyc/sessions/${session.id}`)).status()).toBe(401);
  const validAuth = { Authorization: `Bearer ${session.token}` };
  expect((await request.get(`/api/kyc/sessions/${session.id}`, { headers: validAuth })).status()).toBe(200);
  const rejected = await request.post(`/api/kyc/sessions/${session.id}/capture`, {
    headers: validAuth,
    multipart: { selfie: { name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('invalid image contents') }, metadata: JSON.stringify({ capturedAt: new Date().toISOString(), mode: 'camera', challenges: [{ challenge: 'center', completedAt: 1000, durationMs: 650 }] }) },
  });
  expect(rejected.status()).toBe(400);
  await expect(readdir(resolve('results', session.id))).rejects.toMatchObject({ code: 'ENOENT' });
  const unauthenticated = await request.post(`/api/kyc/sessions/${session.id}/capture`, {
    multipart: { selfie: { name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('unauthenticated upload') },
      metadata: JSON.stringify({ capturedAt: new Date().toISOString(), mode: 'camera', challenges: [{ challenge: 'center', completedAt: 1000, durationMs: 650 }] }) },
  });
  expect(unauthenticated.status()).toBe(401);
  await expect(readdir(resolve('results', session.id))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('sample API accepts repeated challenges and older review captures, and identical retries are idempotent', async ({ request }) => {
  const session = await (await request.post('/api/kyc/sessions', { data: {} })).json();
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7t8AAAAASUVORK5CYII=', 'base64');
  const metadata = JSON.stringify({ capturedAt: new Date(Date.now() - 120_000).toISOString(), mode: 'simulation', challenges: [
    { challenge: 'center', completedAt: 1000, durationMs: 650 },
    { challenge: 'center', completedAt: 2000, durationMs: 650 },
  ] });
  const options = { headers: { Authorization: `Bearer ${session.token}` }, multipart: { selfie: { name: 'demo.png', mimeType: 'image/png', buffer: image }, metadata } };
  const first = await request.post(`/api/kyc/sessions/${session.id}/capture`, options);
  expect(first.status()).toBe(200);
  const firstReceipt = await first.json();
  const beforeRetryFiles = (await readdir(resolve('results', session.id))).sort();
  const retry = await request.post(`/api/kyc/sessions/${session.id}/capture`, options);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual(firstReceipt);
  expect((await readdir(resolve('results', session.id))).sort()).toEqual(beforeRetryFiles);
});

test('preview is a standalone capture page and configuration lives on its own route', async ({ page }) => {
  await page.goto('/?document=0');
  await expect(page.locator('.kyc-kit')).toHaveCount(1);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open preview', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.goto('/settings?document=0');
  await expect(page.locator('.kyc-kit')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Local upload API' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open preview', exact: true })).toHaveAttribute('href', /\?config=/);
  await openConfiguredPreview(page);
  await expect(page.locator('.kyc-kit')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Start face capture', exact: true })).toBeVisible();
});

test('a configured preview opens separately and sends only capture metadata back to settings', async ({ page }) => {
  await page.goto('/settings?simulate=1&document=0');
  await page.getByRole('switch', { name: 'Simulation mode' }).check();
  await page.getByRole('switch', { name: 'Introduction' }).uncheck();
  for (const name of ['Turn left', 'Turn right', 'Move closer', 'Move further']) await page.getByRole('checkbox', { name, exact: false }).uncheck();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open preview', exact: true }).click();
  const popup = await popupPromise;
  try {
    await expect(popup.getByRole('button', { name: 'Start face capture', exact: true })).toHaveCount(0);
    await expectAutomaticFaceReview(popup);
    await popup.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
    await expect(popup.getByRole('heading', { name: 'Your capture is complete.' })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\?simulate=1&document=0$/);
    await expect(page.locator('.kyc-kit')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Capture summary', exact: true })).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('capture_complete');
    const metadata = JSON.parse((await panel.locator('pre').textContent())!);
    expect(metadata.status).toBe('capture_complete');
    expect(metadata.mode).toBe('simulation');
    expect(metadata.challenges).toEqual(['center']);
    expect(metadata.selfie.sizeBytes).toBeGreaterThan(0);
    expect(metadata.selfie.contents).toBe('[not displayed]');
    expect(JSON.stringify(metadata)).not.toMatch(/"token"|"dataUrl"|data:image|base64/i);
    await expect(panel.getByRole('img')).toHaveCount(0);
  } finally { await popup.close(); }
});

test('capture stays centered on desktop and its mobile controls fit without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?simulate=1&document=0');
  const desktopBox = await page.locator('.kyc-kit').boundingBox();
  if (!desktopBox) throw new Error('The standalone capture did not render.');
  expect(desktopBox.width).toBeLessThanOrEqual(420);
  expect(Math.abs(desktopBox.x + desktopBox.width / 2 - 640)).toBeLessThanOrEqual(2);
  await expectInsideViewport(page, page.getByRole('button', { name: 'Start face capture', exact: true }));
  await expectNoCancelControls(page);

  await page.setViewportSize({ width: 1024, height: 650 });
  await page.goto('/?document=0');
  const compactBox = await page.locator('.kyc-kit').boundingBox();
  if (!compactBox) throw new Error('The compact desktop capture did not render.');
  expect(compactBox.x).toBeGreaterThanOrEqual(0);
  expect(compactBox.y).toBeGreaterThanOrEqual(0);
  expect(compactBox.x + compactBox.width).toBeLessThanOrEqual(1025);
  expect(compactBox.y + compactBox.height).toBeLessThanOrEqual(651);
  const compactStart = page.getByRole('button', { name: 'Start face capture', exact: true });
  await expectInsideViewport(page, compactStart);
  await expectNoCancelControls(page);
  await compactStart.click();
  await expect(page.locator('.kyc-face-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0);
  await expectNoCancelControls(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?simulate=1&document=0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const start = page.getByRole('button', { name: 'Start face capture', exact: true });
  await expectInsideViewport(page, start);
  await start.click();
  await expect(page.locator('.kyc-face-screen')).toBeVisible();
  await expectAutomaticFaceReview(page);
  await expectInsideViewport(page, page.getByRole('button', { name: 'Confirm & continue', exact: true }));
  await expectNoCancelControls(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.goto('/settings?document=0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const settingControls = page.locator('.demo-switch-row, .demo-switch-row input');
  expect(await settingControls.count()).toBeGreaterThan(0);
  for (const control of await settingControls.all()) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    if (!box) throw new Error('A settings switch or its label has no bounding box.');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1024, height: 650 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`capture frame stays fixed through every step at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const config = {
      intro: true, review: true, result: true, challenges: ['center'],
      color: '#2563eb', locale: 'en', simulation: true, upload: true,
    };
    await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
    await expect(page.getByRole('button', { name: 'Start face capture', exact: true })).toBeVisible();
    const expectFixed = await fixedFrameChecks(page);
    const clickControl = async (name: string) => {
      const control = page.getByRole('button', { name, exact: true });
      await expectInsideViewport(page, control);
      await expectFixed(`Before ${name}`);
      await control.click();
    };
    await expectFixed('Introduction');

    await clickControl('Start face capture');
    await expect(page.locator('.kyc-face-screen')).toBeVisible();
    await expectFixed('Simulation tracking');
    await expectAutomaticFaceReview(page);
    await expectFixed('Selfie review');

    await clickControl('Record again');
    await expect(page.locator('.kyc-face-screen')).toBeVisible();
    await expectFixed('Retake tracking');
    await expectAutomaticFaceReview(page);
    await expectFixed('Retake review');

    let firstCapture: (route: Route) => void = () => {};
    let retryCapture: (route: Route) => void = () => {};
    const firstRequest = new Promise<Route>(resolve => { firstCapture = resolve; });
    const retryRequest = new Promise<Route>(resolve => { retryCapture = resolve; });
    let attempts = 0;
    await page.route('**/api/kyc/sessions/*/capture', route => {
      attempts++;
      if (attempts === 1) firstCapture(route);
      else retryCapture(route);
    });
    await clickControl('Confirm & continue');
    const failedUpload = await firstRequest;
    await expect(page.getByRole('heading', { name: 'Sending your capture', exact: true })).toBeVisible();
    await expectFixed('Submitting');
    await failedUpload.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary upload failure.' }) });
    await expect(page.locator('.kyc-error-detail')).toHaveText('Temporary upload failure.');
    await expectFixed('Upload error');

    await clickControl('Try again');
    const successfulUpload = await retryRequest;
    await expect(page.getByRole('heading', { name: 'Sending your capture', exact: true })).toBeVisible();
    await expectFixed('Retry submitting');
    await successfulUpload.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'capture_complete' }) });
    await expect(page.getByRole('heading', { name: 'Your capture is complete.', exact: true })).toBeVisible();
    await expectFixed('Complete');
    expect(attempts).toBe(2);
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 568 }]) {
  test(`document front/back capture, retakes and selfie upload fit without scrolling at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const config = { intro: false, document: true, review: true, result: true, challenges: ['center'], color: '#2563eb', locale: 'en', simulation: true, upload: true };
    await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
    await expect(page.getByRole('heading', { name: 'Choose your document', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Identity card/ })).toBeChecked();
    const expectFixed = await fixedFrameChecks(page);
    const click = async (name: string, phase: string) => {
      await expectInsideViewport(page, page.getByRole('button', { name, exact: true }));
      await page.getByRole('button', { name, exact: true }).click();
      await expectFixed(phase);
    };
    await expectFixed('Document selection');
    await click('Continue', 'Prepare front');
    await expect(page.getByRole('heading', { name: 'Photograph the front', exact: true })).toBeVisible();
    await click('Continue', 'Front camera');
    await click('Take photo', 'Front review');
    const frontPreview = page.getByRole('img', { name: 'Photograph of the front of your document', exact: true });
    await expect(frontPreview).toBeVisible();
    await expect.poll(() => frontPreview.evaluate(element => {
      const image = element as HTMLImageElement;
      return { width: image.naturalWidth, height: image.naturalHeight, fit: getComputedStyle(image).objectFit };
    })).toEqual({ width: 1600, height: 1000, fit: 'contain' });
    await click('Retake photo', 'Front retake camera');
    await click('Take photo', 'Front retake review');
    await click('Looks good', 'Prepare back');
    await expect(page.getByRole('heading', { name: 'Photograph the back', exact: true })).toBeVisible();
    await click('Back', 'Return to front review');
    await expect(page.getByRole('img', { name: 'Photograph of the front of your document', exact: true })).toBeVisible();
    await click('Looks good', 'Prepare back again');
    await click('Continue', 'Back camera');
    await click('Take photo', 'Back review');
    await expect(page.getByRole('img', { name: 'Photograph of the back of your document', exact: true })).toBeVisible();
    await click('Retake photo', 'Back retake camera');
    await click('Take photo', 'Back retake review');
    await click('Looks good', 'Selfie tracking');
    await expectAutomaticFaceReview(page);
    await expectFixed('Selfie review');
    const upload = page.waitForResponse(response => response.url().endsWith('/capture') && response.request().method() === 'POST');
    await click('Confirm & continue', 'Upload');
    const response = await upload;
    expect(response.status()).toBe(200);
    const receipt = await response.json();
    expect(receipt.status).toBe('capture_complete');
    expect(receipt.document.type).toBe('id-card');
    expect(receipt.document.front.sizeBytes).toBeGreaterThan(0);
    expect(receipt.document.back.sizeBytes).toBeGreaterThan(0);
    const resultDirectory = resolve('results', receipt.sessionId);
    expect(receipt.files.documentFront).toBe('document-front.jpg');
    expect(receipt.files.documentBack).toBe('document-back.jpg');
    for (const [field, expectedSize] of [
      ['selfie', receipt.image.sizeBytes], ['faceVideo', receipt.video.sizeBytes],
      ['documentFront', receipt.document.front.sizeBytes], ['documentBack', receipt.document.back.sizeBytes],
    ] as const) {
      expect((await readFile(resolve(resultDirectory, receipt.files[field]))).byteLength).toBe(expectedSize);
    }
    expect(JSON.parse(await readFile(resolve(resultDirectory, 'metadata.json'), 'utf8'))).toEqual(receipt);
    expect((await readdir(resultDirectory)).sort()).toEqual(Object.values(receipt.files).sort());
    expect(JSON.stringify(receipt)).not.toMatch(/data:image|base64|"token"/i);
    await expect(page.getByRole('heading', { name: 'Your capture is complete.', exact: true })).toBeVisible();
    await expectFixed('Complete');
  });
}

test('passport capture requires a single photo page before the selfie', async ({ page }) => {
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'], color: '#2563eb', locale: 'en', simulation: true, upload: true };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.getByRole('radio', { name: /Passport/ }).press('Space');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Photograph the photo page', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await page.getByRole('button', { name: 'Looks good', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Photograph the back', exact: true })).toHaveCount(0);
  await expectAutomaticFaceReview(page);
  const upload = page.waitForResponse(response => response.url().endsWith('/capture') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
  const response = await upload;
  expect(response.status()).toBe(200);
  const receipt = await response.json();
  expect(receipt.document.type).toBe('passport');
  expect(receipt.document.front.sizeBytes).toBeGreaterThan(0);
  expect(receipt.document.back).toBeUndefined();
  expect(receipt.files.documentFront).toBe('document-front.jpg');
  expect(receipt.files.documentBack).toBeUndefined();
  const directory = resolve('results', receipt.sessionId);
  expect((await readFile(resolve(directory, receipt.files.documentFront))).byteLength).toBe(receipt.document.front.sizeBytes);
  expect((await readdir(directory)).sort()).toEqual(Object.values(receipt.files).sort());
});

test('leaving document camera during permission stops a late stream without advancing the screen', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { resolveCamera?: (stream: MediaStream) => void };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => new Promise<MediaStream>(resolve => { state.resolveCamera = resolve; }), configurable: true,
    });
  });
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'], color: '#2563eb', locale: 'en', simulation: false, upload: false };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.locator('.kyc-document-screen').getByRole('status')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  const track = await page.evaluateHandle(() => {
    const state = window as unknown as { resolveCamera: (stream: MediaStream) => void };
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#dde7f1';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(1);
    state.resolveCamera(stream);
    return stream.getVideoTracks()[0]!;
  });
  await expect.poll(() => track.evaluate(value => value.readyState)).toBe('ended');
  await expect(page.getByRole('button', { name: 'Open camera', exact: true })).toBeVisible();
  await expect(page.locator('.kyc-error-detail')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /Photograph of/ })).toHaveCount(0);
});

test('sample receiver validates document sides and includes all media in retry identity', async ({ request }) => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7t8AAAAASUVORK5CYII=', 'base64');
  const file = { name: 'demo.png', mimeType: 'image/png', buffer: image };
  const metadata = { capturedAt: new Date().toISOString(), mode: 'simulation', challenges: [{ challenge: 'center', completedAt: 1000, durationMs: 650 }], document: { type: 'id-card' } };
  const session = await (await request.post('/api/kyc/sessions', { data: {} })).json();
  const endpoint = `/api/kyc/sessions/${session.id}/capture`;
  const headers = { Authorization: `Bearer ${session.token}` };
  const incomplete = await request.post(endpoint, { headers, multipart: { selfie: file, documentFront: file, metadata: JSON.stringify(metadata) } });
  expect(incomplete.status()).toBe(400);
  const forged = await request.post(endpoint, { headers, multipart: { selfie: file, documentFront: file, documentBack: { ...file, buffer: Buffer.from('fake photo') }, metadata: JSON.stringify(metadata) } });
  expect(forged.status()).toBe(400);
  const options = { headers, multipart: { selfie: file, documentFront: file, documentBack: file, metadata: JSON.stringify(metadata) } };
  const accepted = await request.post(endpoint, options);
  expect(accepted.status()).toBe(200);
  const retry = await request.post(endpoint, options);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual(await accepted.json());
  const anotherImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAH6n3K8AAAAASUVORK5CYII=', 'base64');
  const changed = await request.post(endpoint, { headers, multipart: { ...options.multipart, documentBack: { ...file, buffer: anotherImage } } });
  expect(changed.status()).toBe(409);

  const passport = await (await request.post('/api/kyc/sessions', { data: {} })).json();
  const extraSide = await request.post(`/api/kyc/sessions/${passport.id}/capture`, { headers: { Authorization: `Bearer ${passport.token}` }, multipart: { ...options.multipart, metadata: JSON.stringify({ ...metadata, document: { type: 'passport' } }) } });
  expect(extraSide.status()).toBe(400);
});
