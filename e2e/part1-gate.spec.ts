import { test, expect } from '@playwright/test';

// Part 1 intro + full-screen gate + background prefetch. We stop at the gate on
// purpose: entering real full-screen is browser-chrome behavior that isn't
// reliable headless, so the lockdown itself is verified manually / in the unit
// suite, while this confirms the pre-start UX and that questions are prefetched.
test('Assessment shows the single-part intro, the full-screen gate, and prefetches 5 questions', async ({ page }) => {
  await page.goto('/');
  await page.fill('#login-email', 'p1@e2e.com');
  await page.click('#login-btn');

  // Single-part overview copy.
  await expect(page.locator('#overview-section')).toBeVisible();
  await expect(page.locator('#overview-section')).toContainText('Technical Assessment');
  await expect(page.locator('#overview-section')).toContainText('closed-book');

  // Begin is disabled until the consent checkbox is ticked.
  await expect(page.locator('#begin-part1-btn')).toBeDisabled();
  await page.check('#consent-chk');
  await expect(page.locator('#begin-part1-btn')).toBeEnabled();
  await page.click('#begin-part1-btn');

  // The full-screen gate is shown before questions are revealed.
  await expect(page.locator('#part1-fullscreen-gate')).toBeVisible();
  await expect(page.locator('#part1-fullscreen-btn')).toBeVisible();

  // Prefetch: the question nav should already hold 5 pills (2 SQL + 1 Python +
  // 1 DSA + 1 Scenario), rendered in the background while they read the intro.
  await expect(page.locator('#part1-qnav .qpill')).toHaveCount(5, { timeout: 10000 });
});
