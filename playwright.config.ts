import { defineConfig } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_PORT || 5173);
const isCi = !!process.env.CI;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // CI: gate job already ran `npm run build`; preview is faster/more stable than cold `vite` dev.
    // Local: keep `npm run dev` for HMR.
    command: isCi
      ? `npm run preview -- --port ${port}`
      : `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !isCi,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  reporter: 'list',
});
