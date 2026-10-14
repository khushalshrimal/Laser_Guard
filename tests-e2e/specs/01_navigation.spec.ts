import { test, expect } from '@playwright/test';

test.describe('Platform Navigation & Route Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('loads Dashboard as initial view with correct brand and header', async ({ page }) => {
    // Verify brand title in sidebar
    await expect(page.locator('aside h1')).toHaveText('LASERGUARD');
    // Verify header title
    await expect(page.locator('header h2')).toHaveText('Industrial Laser Safety Dashboard');
    // Verify subtitle text in header
    await expect(page.locator('header')).toContainText(/Laser-Cutter Safety & Monitoring/);
  });

  test('navigates through all primary sidebar views deterministically', async ({ page }) => {
    const navItems = [
      { label: 'Live Readings', expectedTitle: 'Live Sensor Telemetry Readings' },
      { label: 'Event History', expectedTitle: 'Safety Incident Event History' },
      { label: 'Safety Replay', expectedTitle: 'Forensic Safety Incident Replay' },
      { label: 'Sensor & Device Health', expectedTitle: 'Sensor & System Device Health' },
      { label: 'Settings & Simulator', expectedTitle: 'Settings & Telemetry Simulator' },
      { label: 'Dashboard', expectedTitle: 'Industrial Laser Safety Dashboard' },
    ];

    for (const item of navItems) {
      const navButton = page.locator(`aside nav button:has-text("${item.label}")`);
      await expect(navButton).toBeVisible();
      await navButton.click();

      // Assert header title updates
      await expect(page.locator('header h2')).toHaveText(item.expectedTitle);
    }
  });

  test('persists system source switch across views', async ({ page }) => {
    const sourceToggle = page.locator('header button[title*="switch between Simulator and Physical Hardware"]');
    await expect(sourceToggle).toBeVisible();
    await expect(sourceToggle).toContainText('Simulation Mode');

    // Click to switch
    await sourceToggle.click();
    await expect(sourceToggle).toContainText('Hardware Mode');

    // Navigate to Settings & Simulator and verify active source is reflected
    await page.locator('aside nav button:has-text("Settings & Simulator")').click();
    await expect(page.locator('header h2')).toHaveText('Settings & Telemetry Simulator');

    // Switch back to simulation mode for subsequent tests
    await sourceToggle.click();
    await expect(sourceToggle).toContainText('Simulation Mode');
  });
});
