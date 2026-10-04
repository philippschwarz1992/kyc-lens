import { expect, test, type Page } from '@playwright/test';

interface ComparisonFixture {
  mode: 'unavailable' | 'match' | 'pending';
  jobs: Array<{ document: Blob; selfie: Blob; terminated: boolean; respond: () => void }>;
  streams: MediaStream[];
}

// Test state and resource ownership separately from the real-model tests in local-matching.spec.ts.
async function install(page: Page, mode: ComparisonFixture['mode']) {
  await page.addInitScript(mode => {
    const fixture: ComparisonFixture = { mode, jobs: [], streams: [] };
    (window as unknown as { comparisonFixture: ComparisonFixture }).comparisonFixture = fixture;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => { context.fillStyle = '#ddd'; context.fillRect(0, 0, 640, 480); context.fillStyle = '#357'; context.fillRect(80 + frame++ % 200, 80, 120, 200); };
      draw();
      const stream = canvas.captureStream(20); fixture.streams.push(stream);
      const timer = setInterval(() => { if (stream.getTracks().every(track => track.readyState === 'ended')) clearInterval(timer); else draw(); }, 50);
      return stream;
    } });
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, { construct(target, args, newTarget) {
      const name = args[1]?.name;
      if (name !== 'kyc-face-tracker' && name !== 'kyc-face-match') return Reflect.construct(target, args, newTarget);
      return new class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror = null; onmessageerror = null;
        ended = false;
        job?: ComparisonFixture['jobs'][number];
        terminate() { this.ended = true; if (this.job) this.job.terminated = true; }
        postMessage(request: { type: string; bitmap?: ImageBitmap; timestamp?: number; document: Blob; selfie: Blob; threshold: number; inconclusiveMargin: number }) {
          const deliver = (data: unknown) => { if (!this.ended) this.onmessage?.(new MessageEvent('message', { data })); };
          if (name === 'kyc-face-match') {
            const mode = fixture.mode;
            const respond = () => deliver({ type: 'result', result: { status: mode === 'unavailable' ? 'unavailable' : 'match', reason: mode === 'unavailable' ? 'worker_error' : 'compared',
              ...(mode === 'unavailable' ? {} : { score: .9 }), threshold: request.threshold, inconclusiveMargin: request.inconclusiveMargin, models: { detector: 'yunet-2023mar', recognizer: 'sface-2021dec' } } });
            this.job = { document: request.document, selfie: request.selfie, terminated: false, respond }; fixture.jobs.push(this.job);
            if (mode !== 'pending') queueMicrotask(respond);
          } else if (request.type === 'init') queueMicrotask(() => deliver({ type: 'ready' }));
          else if (request.type === 'frame') {
            request.bitmap?.close();
            queueMicrotask(() => deliver({ type: 'observation', observation: { timestamp: request.timestamp, faceCount: 1, centerX: .5, centerY: .5, relativeSize: .4, yaw: 0, pitch: 0 } }));
          }
        }
      }();
    } });
  }, mode);
}

async function reachReview(page: Page) {
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'], simulation: false, upload: false, documentAutoCapture: false };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.getByRole('radio', { name: /Passport/ }).press('Space');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await page.getByRole('button', { name: 'Looks good', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your video', exact: true })).toBeVisible({ timeout: 15_000 });
}

test('comparison failure retains the accepted images and retry produces one completion without upload', async ({ page }) => {
  await install(page, 'unavailable');
  const uploads: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()); });
  await reachReview(page);
  await page.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Photo comparison is unavailable');
  expect(await page.evaluate(() => sessionStorage.getItem('kyc-kit-demo-summary'))).toBeNull();
  await page.evaluate(() => { (window as unknown as { comparisonFixture: ComparisonFixture }).comparisonFixture.mode = 'match'; });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('The faces look similar');
  const state = await page.evaluate(() => {
    const fixture = (window as unknown as { comparisonFixture: ComparisonFixture }).comparisonFixture;
    return { count: fixture.jobs.length, sameDocument: fixture.jobs[0]!.document === fixture.jobs[1]!.document, sameSelfie: fixture.jobs[0]!.selfie === fixture.jobs[1]!.selfie,
      stopped: fixture.jobs.every(job => job.terminated) && fixture.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')),
      summary: JSON.parse(sessionStorage.getItem('kyc-kit-demo-summary')!) };
  });
  expect(state).toMatchObject({ count: 2, sameDocument: true, sameSelfie: true, stopped: true, summary: { status: 'capture_complete', mode: 'camera' } });
  expect(state.summary).not.toHaveProperty('faceMatch'); expect(uploads).toEqual([]);
});

test('cancelling a pending comparison terminates the worker and discards late completion', async ({ page }) => {
  await install(page, 'pending');
  await reachReview(page);
  await page.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comparing your photos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capture cancelled', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const fixture = (window as unknown as { comparisonFixture: ComparisonFixture }).comparisonFixture;
    fixture.jobs[0]!.respond();
    return fixture.jobs[0]!.terminated;
  })).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('kyc-kit-demo-summary'))).toBeNull();
  await expect(page.getByRole('heading', { name: 'Your capture is complete.', exact: true })).toHaveCount(0);
});
