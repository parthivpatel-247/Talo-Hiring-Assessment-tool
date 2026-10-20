import { test, expect } from '@playwright/test';
import fs from 'fs';

// Admin candidate filters: clicking a chip must visibly activate it, filter the
// table, show per-chip counts, and an empty combination must offer "Clear filters".
const ADMIN_EMAIL = (fs.readFileSync('wrangler.toml', 'utf8').match(/ADMIN_EMAIL\s*=\s*"([^"]+)"/) || [])[1];
const ADMIN_PASSWORD = (fs.readFileSync('.dev.vars', 'utf8').match(/ADMIN_PASSWORD\s*=\s*"?([^"\n]+)"?/) || [])[1];

test('status and college chips activate, filter, show counts, and clear', async ({ page }) => {
  await page.goto('/admin/');
  await page.fill('#login-email', ADMIN_EMAIL);
  await page.fill('#login-password', ADMIN_PASSWORD);
  await page.click('#login-btn');
  await expect(page.locator('#candidate-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#candidate-table')).toContainText('Filter Shortlisted');

  const status = (v: string) => page.locator(`#filter-status [data-status="${v}"]`);
  const college = (v: string) => page.locator(`#filter-college [data-college="${v}"]`);

  // counts are shown on the chips
  await expect(status('shortlisted')).toContainText('1');
  await expect(status('in_progress')).toContainText('1');

  // clicking a status chip highlights it immediately and filters the table
  await status('shortlisted').click();
  await expect(status('shortlisted')).toHaveClass(/\bon\b/);
  await expect(status('all')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#candidate-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#candidate-table')).toContainText('Filter Shortlisted');

  await status('in_progress').click();
  await expect(status('in_progress')).toHaveClass(/\bon\b/);
  await expect(page.locator('#candidate-table')).toContainText('Filter InProgress');

  // college chip counts respect the status filter; an empty combination offers Clear filters
  await status('shortlisted').click();
  await expect(college('College Name 1')).toContainText('0');
  await college('College Name 1').click();
  await expect(college('College Name 1')).toHaveClass(/\bon\b/);
  await expect(page.locator('#clear-filters-btn')).toBeVisible();
  await page.click('#clear-filters-btn');
  await expect(status('all')).toHaveClass(/\bon\b/);
  await expect(college('all')).toHaveClass(/\bon\b/);
  await expect(page.locator('#candidate-table')).toContainText('Filter Evaluated');
});
