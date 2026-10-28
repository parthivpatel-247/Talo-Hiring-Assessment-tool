import { defineConfig, devices } from '@playwright/test';

// Browser-level E2E: drives the real candidate UI in Chromium against a local
// Worker (wrangler dev) seeded with deterministic data (e2e/seed.sql).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    headless: true,
    trace: 'off',
    // Playwright's own Chromium (`npx playwright install chromium`), or a local one
    // given in PW_CHROMIUM_PATH.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bash e2e/serve.sh',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
