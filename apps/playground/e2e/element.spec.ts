import { expect, test } from '@playwright/test';

type RecordedEvent = { type: string; detail: unknown };
const recordedEvents = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { kycLensEvents: RecordedEvent[] }).kycLensEvents);

test('custom element renders the simulated flow and dispatches kyc-complete', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/element.html');
  const element = page.locator('kyc-lens');
  // Light DOM: the flow is a direct child, styled by the host-loaded stylesheet.
  await expect(element.locator('> section.kyc-kit')).toBeVisible();
  await expect(element.locator('.kyc-simulation-banner')).toBeVisible();

  // Attributes and the config property re-render the running element; the property wins.
  await element.evaluate(node => node.setAttribute('locale', 'de'));
  await expect(page.getByRole('button', { name: 'Gesichtsaufnahme starten', exact: true })).toBeVisible();
  await element.evaluate(node => { (node as HTMLElement & { config: unknown }).config = { locale: 'en' }; });
  await expect(page.getByRole('button', { name: 'Start face capture', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Start face capture', exact: true }).click();
  await expect(page.locator('.kyc-review-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your capture is complete.' })).toBeVisible();

  await expect.poll(() => recordedEvents(page)).toHaveLength(1);
  const [event] = await recordedEvents(page);
  expect(event.type).toBe('kyc-complete');
  expect(event.detail).toMatchObject({ status: 'capture_complete', payload: { mode: 'simulation' } });
  expect(errors).toEqual([]);
});

test('removing the custom element unmounts the flow and stops the camera', async ({ page }) => {
  await page.addInitScript(() => {
    const streams: MediaStream[] = [];
    (window as unknown as { kycStreams: MediaStream[] }).kycStreams = streams;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      streams.push(stream);
      return stream;
    };
  });
  await page.goto('/element.html');
  const element = page.locator('kyc-lens');
  await element.evaluate(node => node.removeAttribute('simulation'));
  await expect(element.locator('.kyc-simulation-banner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start face capture', exact: true }).click();

  const liveTracks = () => page.evaluate(() => (window as unknown as { kycStreams: MediaStream[] }).kycStreams
    .flatMap(stream => stream.getTracks()).filter(track => track.readyState === 'live').length);
  await expect.poll(liveTracks, { timeout: 15_000 }).toBeGreaterThan(0);

  await element.evaluate(node => node.remove());
  await expect.poll(liveTracks).toBe(0);
  await expect(page.locator('.kyc-kit')).toHaveCount(0);
});
