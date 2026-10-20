import { test, expect } from '@playwright/test';

// #6 — one test per email. Once the assessment has STARTED on an account, a new
// login with the same email (a second person on the shared link, or a re-entry
// after the session ended) is blocked. e2e-p2 is seeded as already started.
test('a second login to an already-started assessment is blocked', async ({ page }) => {
  await page.goto('/');
  await page.fill('#login-email', 'p2@e2e.com');
  await page.click('#login-btn');

  // Stays on the login screen with the "already started" message; never enters the test.
  await expect(page.locator('#login-error')).toContainText('already been started');
  await expect(page.locator('#login-section')).toBeVisible();
  await expect(page.locator('#overview-section')).toBeHidden();
});
