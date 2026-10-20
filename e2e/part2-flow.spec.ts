import { test, expect } from '@playwright/test';

// The assessment is now a SINGLE closed-book part (5 questions). This guards the
// restructure: the overview describes one part covering all sections, and the old
// multi-part / "open book" wording is gone.
test('overview describes a single closed-book part, not multiple parts', async ({ page }) => {
  await page.goto('/');
  await page.fill('#login-email', 'p1@e2e.com');
  await page.click('#login-btn');

  await expect(page.locator('#overview-section')).toBeVisible();
  const overview = page.locator('#overview-section');
  await expect(overview).toContainText('5 questions');
  await expect(overview).toContainText('closed-book');
  // No stale multi-part / open-book language.
  await expect(overview).not.toContainText('open book');
  await expect(overview).not.toContainText('Part 2');
});
