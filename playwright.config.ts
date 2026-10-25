import { defineConfig } from '@playwright/test';
// E2E_PORT lets parallel checkouts run their own dev server instead of reusing another one on 5173.
const port = Number(process.env.E2E_PORT || 5173);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  // Chrome's fake camera is shared; competing capture tests can end its tracks.
  workers: 1,
  // One retry on CI; a test that passes only on retry is still reported as flaky.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, headless: true },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome',
      launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } } },
    { name: 'firefox', use: { browserName: 'firefox',
      launchOptions: { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } } } },
    // Playwright's WebKit has no fake camera and no MediaRecorder video encoder. Its canvas-captured test
    // streams also fail intermittently (SecurityError/NotAllowedError on open, stalled photo encoding), which
    // does not reflect real Safari. So WebKit covers on-device face matching only; camera flows need real
    // iOS/macOS Safari checks (see docs/qa-plan.md).
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: ['local-matching.spec.ts'] },
  ],
  webServer: { command: `npm run dev:no-open -- --port ${port}`, url: baseURL, reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
