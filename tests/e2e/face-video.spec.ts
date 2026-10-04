import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

type Pose = 'no-face' | 'off-center' | 'crop-off-center' | 'center' | 'closer' | 'further' | 'turned' | 'worker-error';
interface FaceVideoFixture {
  pose: Pose;
  streams: MediaStream[];
  workers: { terminated: boolean; frames: number }[];
  recorders: { starts: number; stops: number; chunks: Blob[]; audioTracks: number }[];
  cameraRequests: number;
  permissionResolvers: (() => void)[];
}

// Camera pixels and MediaRecorder are real. Only the local face worker's observation
// messages are replaced so the browser can exercise the runner with known poses.
async function installFaceVideoCamera(page: Page, deferPermission = false): Promise<void> {
  await page.addInitScript(deferred => {
    const fixture: FaceVideoFixture = { pose: 'no-face', streams: [], workers: [], recorders: [], cameraRequests: 0, permissionResolvers: [] };
    (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture = fixture;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        if (constraints.audio) throw new Error('Face capture must not request a microphone.');
        fixture.cameraRequests += 1;
        if (deferred) await new Promise<void>(resolve => fixture.permissionResolvers.push(resolve));
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const context = canvas.getContext('2d')!;
        let frame = 0;
        const draw = () => {
          context.fillStyle = '#dce8ef'; context.fillRect(0, 0, 640, 480);
          context.fillStyle = '#31596c'; context.fillRect(60 + frame++ % 200, 380, 150, 30);
          context.fillStyle = '#e1ac87'; context.beginPath(); context.ellipse(320, 215, 90, 120, 0, 0, Math.PI * 2); context.fill();
          context.fillStyle = '#142c3c'; context.font = '24px sans-serif'; context.fillText(`CAMERA FIXTURE ${fixture.pose}`, 35, 55);
        };
        draw();
        const stream = canvas.captureStream(30);
        fixture.streams.push(stream);
        const timer = setInterval(() => {
          if (stream.getVideoTracks().every(track => track.readyState === 'ended')) clearInterval(timer);
          else draw();
        }, 33);
        return stream;
      },
    });
    const NativeRecorder = window.MediaRecorder;
    if (NativeRecorder) window.MediaRecorder = new Proxy(NativeRecorder, {
      construct(target, args, newTarget) {
        const recorder = Reflect.construct(target, args, newTarget) as MediaRecorder;
        const recording = { starts: 0, stops: 0, chunks: [] as Blob[], audioTracks: recorder.stream.getAudioTracks().length };
        fixture.recorders.push(recording);
        recorder.addEventListener('start', () => { recording.starts += 1; });
        recorder.addEventListener('stop', () => { recording.stops += 1; });
        recorder.addEventListener('dataavailable', event => { if (event.data.size) recording.chunks.push(event.data); });
        return recorder;
      },
    });
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        if (args[1]?.name !== 'kyc-face-tracker') return Reflect.construct(target, args, newTarget);
        const state = { terminated: false, frames: 0 };
        fixture.workers.push(state);
        return new class extends EventTarget {
          onmessage: ((event: MessageEvent) => void) | null = null;
          onerror: ((event: ErrorEvent) => void) | null = null;
          onmessageerror: ((event: MessageEvent) => void) | null = null;
          terminate() { state.terminated = true; }
          postMessage(request: { type: string; bitmap?: ImageBitmap; timestamp?: number }) {
            if (state.terminated) { request.bitmap?.close(); return; }
            let response: unknown;
            if (request.type === 'init') response = { type: 'ready' };
            else if (request.type === 'frame') {
              state.frames += 1; request.bitmap?.close();
              const pose = fixture.pose;
              response = pose === 'worker-error' ? { type: 'error', message: 'Face video fixture tracking failed.' }
                : { type: 'observation', observation: {
                  timestamp: request.timestamp, faceCount: pose === 'no-face' ? 0 : 1,
                  centerX: pose === 'off-center' ? 0.85 : pose === 'crop-off-center' ? 0.62 : 0.5, centerY: 0.5,
                  relativeSize: pose === 'closer' ? 0.56 : pose === 'further' ? 0.26 : 0.4,
                  yaw: pose === 'turned' ? 35 : 0, pitch: 0,
                } };
            }
            if (response) queueMicrotask(() => {
              if (!state.terminated) this.onmessage?.(new MessageEvent('message', { data: response }));
            });
          }
        }();
      },
    });
  }, deferPermission);
}

async function pose(page: Page, next: Pose): Promise<void> {
  await page.evaluate(nextPose => { (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.pose = nextPose; }, next);
}

function previewUrl(simulation = false, challenges = ['center', 'closer', 'further']): string {
  return `/?config=${encodeURIComponent(JSON.stringify({ intro: false, document: false, review: true, result: true,
    challenges, color: '#2563eb', locale: 'en', simulation, upload: true }))}`;
}

async function expectStopped(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const fixture = (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture;
    return fixture.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))
      && fixture.workers.every(worker => worker.terminated)
      && fixture.recorders.every(recorder => recorder.starts === recorder.stops);
  })).toBe(true);
  const frames = await page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.workers.map(worker => worker.frames));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.workers.map(worker => worker.frames))).toEqual(frames);
}

async function openFaceHarness(page: Page, face: { recordVideo?: boolean; autoStart?: boolean } = {}): Promise<void> {
  const workspace = process.cwd().replaceAll('\\', '/');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/face-video-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <html><head><link rel="stylesheet" href="/@fs/${workspace}/src/styles.css"></head><body><div id="capture"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const [{ default: React }, { default: ReactDOM }, { KycFlow }] = await Promise.all([
        import('/@fs/${workspace}/node_modules/.vite/deps/react.js'), import('/@fs/${workspace}/node_modules/.vite/deps/react-dom_client.js'), import('/@fs/${workspace}/src/index.ts')
      ]);
      const root = ReactDOM.createRoot(document.getElementById('capture'));
      window.unmountFaceVideo = () => root.unmount();
      window.faceCompletions = [];
      root.render(React.createElement(KycFlow, { steps: ['face', 'review', 'result'],
        face: { challenges: ['center', 'closer', 'further'], ...${JSON.stringify(face)} },
        onComplete: result => window.faceCompletions.push(result) }));
    </script></body></html>` }));
  await page.goto('/face-video-harness');
  await expect.poll(async () => ({ errors, count: await page.locator('.kyc-kit').count() })).toEqual({ errors: [], count: 1 });
}

async function finishDistanceChecks(page: Page): Promise<void> {
  await pose(page, 'center');
  await expect(page.locator('.kyc-face-guide')).toHaveAttribute('data-distance', 'closer');
  await pose(page, 'closer');
  await expect(page.locator('.kyc-challenge-list .is-done')).toHaveCount(2);
  await expect(page.locator('.kyc-face-guide')).toHaveAttribute('data-distance', 'normal');
  await pose(page, 'center');
  await expect(page.locator('.kyc-face-guide')).toHaveAttribute('data-distance', 'further');
  await pose(page, 'further');
  await expect(page.locator('.kyc-challenge-list .is-done')).toHaveCount(3);
  // Finishing the last movement still requires a neutral frontal pose.
  await expect(page.locator('.kyc-review-screen')).toHaveCount(0);
  await pose(page, 'center');
  await expect(page.getByRole('button', { name: 'Confirm & continue', exact: true })).toBeVisible();
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`automatic face video requires valid centered distance holds at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installFaceVideoCamera(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(previewUrl());
    await expect(page.locator('.kyc-face-screen')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.cameraRequests)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /Start camera|Start simulation|Simulate this movement|Take photo|Cancel|Close/ })).toHaveCount(0);
    const frame = await page.locator('.kyc-kit').boundingBox();
    await expect(page.getByRole('status').filter({ hasText: 'Bring your face into the circle' })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('.kyc-challenge-list .is-done')).toHaveCount(0);
    // This pose is centered in the full landscape camera frame but falls outside
    // the allowed center tolerance after the portrait preview's visible crop.
    await pose(page, 'crop-off-center');
    await expect(page.getByRole('status').filter({ hasText: 'Center your face' })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('.kyc-challenge-list .is-done')).toHaveCount(0);
    await expect(page.locator('.kyc-review-screen')).toHaveCount(0);
    await pose(page, 'off-center');
    await expect(page.getByRole('status').filter({ hasText: 'Center your face' })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('.kyc-challenge-list .is-done')).toHaveCount(0);
    await pose(page, 'center');
    await expect(page.locator('.kyc-face-guide')).toHaveAttribute('data-distance', 'closer');
    await expect.poll(() => page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.recorders.filter(recorder => recorder.starts > 0).length)).toBe(1);
    await page.waitForTimeout(800);
    // Merely keeping the centered baseline cannot satisfy the closer movement.
    await expect(page.locator('.kyc-challenge-list .is-done')).toHaveCount(1);
    await expect(page.locator('.kyc-review-screen')).toHaveCount(0);
    await pose(page, 'closer');
    await expect(page.locator('.kyc-challenge-list .is-done')).toHaveCount(2);
    await pose(page, 'center');
    await expect(page.locator('.kyc-face-guide')).toHaveAttribute('data-distance', 'further');
    await pose(page, 'further');
    await expect(page.locator('.kyc-challenge-list .is-done')).toHaveCount(3);
    await page.waitForTimeout(800);
    await expect(page.locator('.kyc-review-screen')).toHaveCount(0);
    await pose(page, 'turned');
    await page.waitForTimeout(800);
    await expect(page.locator('.kyc-review-screen')).toHaveCount(0);
    await pose(page, 'center');
    const review = page.getByRole('button', { name: 'Confirm & continue', exact: true });
    await expect(review).toBeVisible();
    await expectStopped(page);
    expect(await page.locator('.kyc-kit').boundingBox()).toEqual(frame);
    const video = page.getByLabel('Your recorded face video', { exact: true });
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate(element => ({ width: (element as HTMLVideoElement).videoWidth, height: (element as HTMLVideoElement).videoHeight })))
      .toEqual({ width: 640, height: 480 });
    await video.evaluate(async element => { const recorded = element as HTMLVideoElement; recorded.muted = true; await recorded.play(); });
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.2);
    await video.evaluate(element => (element as HTMLVideoElement).pause());
    await page.screenshot({ path: `.cache/face-video-review-${viewport.width}.png` });
    const browserMedia = await video.evaluate(async element => {
      const recorded = element as HTMLVideoElement;
      const fingerprint = async (url: string) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
        return { size: bytes.byteLength, sha256 };
      };
      return { video: await fingerprint(recorded.src), selfie: await fingerprint(recorded.poster) };
    });
    expect(await page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.recorders.every(recorder => recorder.audioTracks === 0))).toBe(true);
    const upload = page.waitForResponse(response => response.url().endsWith('/capture') && response.request().method() === 'POST');
    await review.click();
    const response = await upload;
    expect(response.status()).toBe(200);
    const receipt = await response.json();
    expect(receipt.mode).toBe('camera');
    expect(receipt.challenges.map((item: { challenge: string }) => item.challenge)).toEqual(['center', 'closer', 'further']);
    expect(receipt.challenges.every((item: { durationMs: number }) => item.durationMs >= 650)).toBe(true);
    expect(receipt.video.type).toMatch(/^video\/(webm|mp4)$/);
    expect(receipt.video.sizeBytes).toBeGreaterThan(1000);
    expect(receipt.sessionId).toMatch(/^[a-f\d-]{36}$/);
    expect(receipt.files.selfie).toBe('selfie.jpg');
    expect(receipt.files.faceVideo).toMatch(/^face-video\.(webm|mp4)$/);
    expect(receipt.files.metadata).toBe('metadata.json');
    const resultDirectory = resolve('results', receipt.sessionId);
    const savedVideo = await readFile(resolve(resultDirectory, receipt.files.faceVideo));
    const savedSelfie = await readFile(resolve(resultDirectory, receipt.files.selfie));
    expect(savedVideo.byteLength).toBe(browserMedia.video.size);
    expect(createHash('sha256').update(savedVideo).digest('hex')).toBe(browserMedia.video.sha256);
    expect(savedSelfie.byteLength).toBe(browserMedia.selfie.size);
    expect(createHash('sha256').update(savedSelfie).digest('hex')).toBe(browserMedia.selfie.sha256);
    const savedJson = await readFile(resolve(resultDirectory, receipt.files.metadata), 'utf8');
    expect(JSON.parse(savedJson)).toEqual(receipt);
    expect(savedJson).not.toMatch(/"token"|"authorization"|data:image|base64/i);
    expect((await readdir(resultDirectory)).sort()).toEqual(Object.values(receipt.files).sort());
    for (const filename of Object.values(receipt.files) as string[]) {
      const direct = await page.request.get(`/results/${receipt.sessionId}/${filename}`);
      expect([403, 404]).toContain(direct.status());
      const viteFile = await page.request.get(`/@fs/${resolve(resultDirectory, filename).replaceAll('\\', '/')}`);
      expect([403, 404]).toContain(viteFile.status());
    }
    await expect(page.getByRole('heading', { name: 'Your capture is complete.' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('record again automatically begins a fresh clip and releases the previous preview', async ({ page }) => {
  await installFaceVideoCamera(page);
  await page.goto(previewUrl(false, ['center']));
  await pose(page, 'center');
  const video = page.getByLabel('Your recorded face video', { exact: true });
  await expect(video).toBeVisible();
  const oldUrl = await video.getAttribute('src');
  await expectStopped(page);
  await pose(page, 'no-face');
  await page.getByRole('button', { name: 'Record again', exact: true }).click();
  await expect(page.locator('.kyc-face-screen')).toBeVisible();
  await expect(video).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0);
  await pose(page, 'center');
  await expect(video).toBeVisible();
  expect(await video.getAttribute('src')).not.toBe(oldUrl);
  await expectStopped(page);
  const counts = await page.evaluate(() => {
    const fixture = (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture;
    return { streams: fixture.streams.length, recordings: fixture.recorders.filter(recorder => recorder.starts === 1 && recorder.stops === 1).length };
  });
  // React StrictMode may request a late stream that is immediately released.
  expect(counts.streams).toBeGreaterThanOrEqual(2);
  expect(counts.recordings).toBe(2);
});

test('a tracking failure discards a running clip and retry starts automatically', async ({ page }) => {
  await installFaceVideoCamera(page);
  await page.goto(previewUrl());
  await pose(page, 'center');
  await expect(page.locator('.kyc-face-guide')).toHaveAttribute('data-distance', 'closer');
  await pose(page, 'worker-error');
  await expect(page.locator('.kyc-error-detail')).toHaveText('Face video fixture tracking failed.');
  await expectStopped(page);
  await expect(page.locator('.kyc-review-screen')).toHaveCount(0);
  await pose(page, 'no-face');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Bring your face into the circle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0);
  await finishDistanceChecks(page);
  await expectStopped(page);
});

test('leaving the face step stops camera, worker and recording without submitting', async ({ page }) => {
  await installFaceVideoCamera(page);
  await openFaceHarness(page);
  await pose(page, 'center');
  await expect(page.locator('.kyc-face-guide')).toHaveAttribute('data-distance', 'closer');
  await page.evaluate(() => (window as unknown as { unmountFaceVideo(): void }).unmountFaceVideo());
  await expect(page.locator('.kyc-kit')).toHaveCount(0);
  await expectStopped(page);
  expect(await page.evaluate(() => (window as unknown as { faceCompletions: unknown[] }).faceCompletions)).toEqual([]);
});

test('automatic camera permission resolving after unmount releases the late stream', async ({ page }) => {
  await installFaceVideoCamera(page, true);
  await openFaceHarness(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.permissionResolvers.length)).toBe(1);
  await page.evaluate(() => (window as unknown as { unmountFaceVideo(): void }).unmountFaceVideo());
  await page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.permissionResolvers.forEach(resolve => resolve()));
  await expect.poll(() => page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.streams.length)).toBe(1);
  await expectStopped(page);
  expect(await page.evaluate(() => (window as unknown as { faceCompletions: unknown[] }).faceCompletions)).toEqual([]);
  await expect(page.locator('.kyc-kit')).toHaveCount(0);
});

test('recordVideo false explicitly keeps automatic landmark checks with a still-photo payload', async ({ page }) => {
  await installFaceVideoCamera(page);
  await page.addInitScript(() => { Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: undefined }); });
  await openFaceHarness(page, { recordVideo: false });
  await finishDistanceChecks(page);
  await expect(page.getByRole('img', { name: 'Your captured selfie', exact: true })).toBeVisible();
  await expect(page.getByLabel('Your recorded face video', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your capture is complete.' })).toBeVisible();
  const payload = await page.evaluate(() => {
    const result = (window as unknown as { faceCompletions: { payload: { video?: Blob; selfie: Blob; mode: string; challenges: { challenge: string }[] } }[] }).faceCompletions[0];
    return { video: result.payload.video?.size, selfie: result.payload.selfie.size, mode: result.payload.mode,
      challenges: result.payload.challenges.map(item => item.challenge) };
  });
  expect(payload.video).toBeUndefined();
  expect(payload.selfie).toBeGreaterThan(0);
  expect(payload.mode).toBe('camera');
  expect(payload.challenges).toEqual(['center', 'closer', 'further']);
  await expectStopped(page);
});

test('autoStart false defers camera permission until the host opts in', async ({ page }) => {
  await installFaceVideoCamera(page);
  await openFaceHarness(page, { autoStart: false });
  const start = page.getByRole('button', { name: 'Start camera', exact: true });
  await expect(start).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { faceVideoFixture: FaceVideoFixture }).faceVideoFixture.cameraRequests)).toBe(0);
  await start.click();
  await finishDistanceChecks(page);
  await expect(page.getByLabel('Your recorded face video', { exact: true })).toBeVisible();
  await expectStopped(page);
});

test('unsupported recording produces a recoverable error instead of silently submitting a selfie', async ({ page }) => {
  await installFaceVideoCamera(page);
  await page.addInitScript(() => { Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: undefined }); });
  await page.goto(previewUrl());
  await pose(page, 'center');
  await expect(page.locator('.kyc-error-detail')).toContainText(/record|video/i);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.locator('.kyc-review-screen')).toHaveCount(0);
  await expectStopped(page);
});

test('simulation auto-records a decodable watermarked video and retains an explicit demo mode', async ({ page }) => {
  await page.goto(previewUrl(true, ['center', 'closer', 'further']));
  await expect(page.locator('.kyc-simulation-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start simulation|Simulate this movement/ })).toHaveCount(0);
  const video = page.getByLabel('Your recorded face video', { exact: true });
  await expect(video).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  const darkWatermarkPixels = await video.evaluate(element => {
    const recorded = element as HTMLVideoElement;
    const canvas = document.createElement('canvas'); canvas.width = recorded.videoWidth; canvas.height = recorded.videoHeight;
    const context = canvas.getContext('2d')!; context.drawImage(recorded, 0, 0);
    const strip = context.getImageData(0, Math.floor(canvas.height * 0.89), canvas.width, Math.floor(canvas.height * 0.05)).data;
    let dark = 0;
    for (let index = 0; index < strip.length; index += 4) if (strip[index] < 80 && strip[index + 1] < 90 && strip[index + 2] < 110) dark += 1;
    return dark;
  });
  expect(darkWatermarkPixels, 'Demo watermark should be burned into the captured video pixels').toBeGreaterThan(100);
  const upload = page.waitForResponse(response => response.url().endsWith('/capture') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
  const response = await upload;
  expect(response.status()).toBe(200);
  const receipt = await response.json();
  expect(receipt.mode).toBe('simulation');
  expect(receipt.video.sizeBytes).toBeGreaterThan(1000);
  expect(receipt.challenges.map((item: { challenge: string }) => item.challenge)).toEqual(['center', 'closer', 'further']);
  const saved = JSON.parse(await readFile(resolve('results', receipt.sessionId, 'metadata.json'), 'utf8'));
  expect(saved.mode).toBe('simulation');
  expect(saved.files.faceVideo).toMatch(/^face-video\.(webm|mp4)$/);
  expect((await readFile(resolve('results', receipt.sessionId, saved.files.faceVideo))).byteLength).toBe(receipt.video.sizeBytes);
});
