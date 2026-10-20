import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';

// Prefer a provisioned Chromium if present (CI/sandbox); otherwise use the one
// Playwright downloads with `npx playwright install chromium` (your machine).
const provisioned = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = fs.existsSync(provisioned) ? { executablePath: provisioned } : {};

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
    launchOptions,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bash e2e/serve.sh',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
