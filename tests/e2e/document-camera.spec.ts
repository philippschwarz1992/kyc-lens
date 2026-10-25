import { expect, test, type Page } from '@playwright/test';

interface CameraFixture {
  devices: Array<{ deviceId: string; label: string }>;
  requests: MediaTrackConstraints[];
  torchRequests: unknown[];
  failDevices: string[];
  torch: boolean;
}

/** Synthetic cameras: each stream reports the requested device and optional torch support. */

// WebKit can block autoplay of the canvas test stream; the SDK then asks for a tap, as on iOS Low Power Mode.
async function clickOpenCamera(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  const prompt = page.getByText('Tap the screen to start the camera.');
  const takePhoto = page.getByRole('button', { name: 'Take photo', exact: true });
  await expect.poll(async () => await prompt.isVisible() || await takePhoto.isEnabled({ timeout: 100 }).catch(() => false), { timeout: 15_000 }).toBe(true);
  if (await prompt.isVisible()) await prompt.click();
}
async function installCameras(page: Page, devices: CameraFixture['devices'], torch = true): Promise<void> {
  await page.addInitScript(({ devices, torch }) => {
    const fixture: CameraFixture = { devices, requests: [], torchRequests: [], failDevices: [], torch };
    (window as unknown as { cameraFixture: CameraFixture }).cameraFixture = fixture;
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async () => [{ kind: 'audioinput', deviceId: 'mic', label: 'Microphone', groupId: 'a' },
        ...fixture.devices.map(camera => ({ kind: 'videoinput', groupId: camera.deviceId, ...camera }))],
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        const video = constraints.video as MediaTrackConstraints;
        fixture.requests.push(JSON.parse(JSON.stringify(video)) as MediaTrackConstraints);
        const exact = (video.deviceId as ConstrainDOMStringParameters | undefined)?.exact as string | undefined;
        if (exact && fixture.failDevices.includes(exact)) throw new DOMException('Camera busy.', 'NotReadableError');
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
        const context = canvas.getContext('2d')!;
        const draw = () => { context.fillStyle = '#3c4650'; context.fillRect(0, 0, canvas.width, canvas.height); requestAnimationFrame(draw); };
        draw();
        const stream = canvas.captureStream(10);
        const [track] = stream.getVideoTracks();
        const deviceId = exact ?? fixture.devices[0]?.deviceId;
        const settings = track!.getSettings.bind(track);
        track!.getSettings = () => ({ ...settings(), deviceId });
        track!.getCapabilities = () => (fixture.torch ? { torch: true } : {}) as MediaTrackCapabilities;
        track!.applyConstraints = async (value?: MediaTrackConstraints) => { fixture.torchRequests.push(JSON.parse(JSON.stringify(value))); };
        return stream;
      },
    });
  }, { devices, torch });
}

async function openCamera(page: Page) {
  const config = { intro: false, document: true, review: true, result: true, challenges: ['center'], locale: 'en',
    color: '#2563eb', simulation: false, upload: false, faceMatch: false, documentAutoCapture: false };
  await page.goto(`/?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await clickOpenCamera(page);
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
}

const fixture = (page: Page) => page.evaluate(() => (window as unknown as { cameraFixture: CameraFixture }).cameraFixture);
const switchButton = (page: Page) => page.getByRole('button', { name: 'Switch camera', exact: true });

async function expectNoScroll(page: Page) {
  expect(await page.locator('.kyc-screen').evaluate(screen => screen.scrollHeight <= screen.clientHeight + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
}

test('switching cameras reopens the next device exactly and resets the torch', async ({ page }) => {
  await installCameras(page, [{ deviceId: 'back-camera', label: 'Back camera' }, { deviceId: 'front-camera', label: 'Front camera' }]);
  await openCamera(page);
  await expect(switchButton(page)).toBeVisible();
  await expectNoScroll(page);
  expect((await fixture(page)).requests[0]).toMatchObject({ facingMode: { ideal: 'environment' } });

  await page.getByRole('button', { name: 'Turn on flashlight', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Turn off flashlight', exact: true })).toBeVisible();
  expect((await fixture(page)).torchRequests).toEqual([{ advanced: [{ torch: true }] }]);

  await switchButton(page).click();
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
  await expect.poll(async () => (await fixture(page)).requests.length).toBe(2);
  const request = (await fixture(page)).requests[1]!;
  expect(request.deviceId).toEqual({ exact: 'front-camera' });
  expect(request.facingMode).toBeUndefined();
  await expect(page.getByRole('button', { name: 'Turn on flashlight', exact: true })).toBeVisible();

  await switchButton(page).click();
  await expect.poll(async () => (await fixture(page)).requests.at(-1)?.deviceId).toEqual({ exact: 'back-camera' });
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
  await expectNoScroll(page);
});

test('a camera that fails to open falls back to the previous device with a recoverable message', async ({ page }) => {
  await installCameras(page, [{ deviceId: 'back-camera', label: 'Back camera' }, { deviceId: 'broken-camera', label: 'Broken camera' }]);
  await openCamera(page);
  await page.evaluate(() => (window as unknown as { cameraFixture: CameraFixture }).cameraFixture.failDevices.push('broken-camera'));
  await switchButton(page).click();
  await expect(page.getByText('That camera could not be opened. Your previous camera is back on.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
  const requests = (await fixture(page)).requests;
  expect(requests.slice(1).map(request => request.deviceId)).toEqual([{ exact: 'broken-camera' }, { exact: 'back-camera' }]);
});

test('a single camera without torch shows neither control', async ({ page }) => {
  await installCameras(page, [{ deviceId: 'only-camera', label: 'Camera' }], false);
  await openCamera(page);
  await expect(switchButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Turn on flashlight', exact: true })).toHaveCount(0);
});
