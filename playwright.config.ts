import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  // Chrome's fake camera is shared; competing capture tests can end its tracks.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true, channel: 'chrome',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
  webServer: { command: 'npm run dev:no-open', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
