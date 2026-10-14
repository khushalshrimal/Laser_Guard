import { test, expect } from '@playwright/test';

test.describe('Blackbox Event History & Audit Trail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('aside nav button:has-text("Event History")').click();
    await expect(page.locator('header h2')).toHaveText('Safety Incident Event History');
  });

  test('displays Blackbox Event History view with audit controls', async ({ page }) => {
    // Assert audit trail title & description
    await expect(page.locator('text=Event History & Blackbox Audit Trail')).toBeVisible();
    await expect(page.locator('text=Export JSON')).toBeVisible();
    await expect(page.locator('text=Reload')).toBeVisible();

    // Verify search input
    const searchInput = page.locator('input[placeholder="Search by event type, rule ID, or message..."]');
    await expect(searchInput).toBeVisible();

    // Verify severity filter buttons
    await expect(page.locator('button:has-text("ALL")')).toBeVisible();
    await expect(page.locator('button:has-text("CRITICAL")')).toBeVisible();
    await expect(page.locator('button:has-text("WARNING")')).toBeVisible();
    await expect(page.locator('button:has-text("NORMAL")')).toBeVisible();
  });

  test('filters events by severity category', async ({ page }) => {
    // Click CRITICAL filter
    await page.locator('button:has-text("CRITICAL")').click();
    await page.waitForTimeout(500);

    // Verify table or empty state renders cleanly
    const content = page.locator('table').or(page.locator('text=No events found'));
    await expect(content.first()).toBeVisible();

    // Switch back to ALL
    await page.locator('button:has-text("ALL")').click();
  });

  test('performs search query on audit events', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Search by event type, rule ID, or message..."]');
    await searchInput.fill('laser');
    await page.waitForTimeout(300);

    // Content should update without crashing
    const content = page.locator('table').or(page.locator('text=No events found'));
    await expect(content.first()).toBeVisible();
  });
});
