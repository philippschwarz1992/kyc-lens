import { defineConfig } from '@playwright/test';
// E2E_PORT lets parallel checkouts run their own dev server instead of reusing another one on 5173.
const port = Number(process.env.E2E_PORT || 5173);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  // Chrome's fake camera is shared; competing capture tests can end its tracks.
  workers: 1,
  use: { baseURL, headless: true },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome',
      launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } } },
    { name: 'firefox', use: { browserName: 'firefox',
      launchOptions: { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } } } },
    // Playwright's WebKit has no fake camera and no MediaRecorder video encoder, so face recording,
    // the element flow and live document detection cannot run there. Keep the specs it can execute.
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: ['document-auto.spec.ts', 'document-camera.spec.ts', 'local-matching.spec.ts'] },
  ],
  webServer: { command: `npm run dev:no-open -- --port ${port}`, url: baseURL, reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
