import { test, expect } from '@playwright/test';

// Anti-cheat (#2): reloading the page while a timed section is running submits and
// closes the whole assessment. A deliberate reload must NOT resume the test.
// Driven through Part 1 on a fresh candidate (login is allowed because the test
// hasn't started yet; starting Part 1 begins the clock).
test('reloading during a timed section auto-closes the assessment', async ({ page }) => {
  await page.goto('/');
  await page.fill('#login-email', 'p3@e2e.com');
  await page.click('#login-btn');

  await expect(page.locator('#overview-section')).toBeVisible();
  await page.check('#consent-chk'); // consent gate before begin
  await page.click('#begin-part1-btn');
  // Enter the Part 1 gate and start the clock (real full-screen is a no-op headless).
  await page.click('#part1-fullscreen-btn');
  await expect(page.locator('#part1-qpanel')).toContainText('Question 1 of');

  // Reload mid-section.
  await page.reload();

  // The candidate is taken to the terminal "closed" screen, not back into the test.
  await expect(page.locator('#done-section')).toBeVisible();
  await expect(page.locator('#done-section')).toContainText('reloaded');
});
