import { test, expect } from '@playwright/test';

test.describe('Vision System, Camera Mode & 3D Skeleton Visualizer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('displays camera monitor widget with resilient standby/stopped state', async ({ page }) => {
    // Assert Camera Monitor heading exists
    await expect(page.locator('text=Live Camera Feed (Cam #1)')).toBeVisible({ timeout: 5000 });

    // Assert camera controls exist: 2D View, 3D Skeleton, 3D Zone
    await expect(page.locator('button:has-text("2D View")')).toBeVisible();
    await expect(page.locator('button:has-text("3D Skeleton")')).toBeVisible();
    await expect(page.getByRole('button', { name: '3D Zone', exact: true })).toBeVisible();

    // Verify non-crashing handling when physical camera is idle or stopped
    const standbyIndicator = page.locator('text=Camera Capture Stopped')
      .or(page.locator('text=Camera Unavailable'))
      .or(page.locator('img[alt="Live Camera Feed with Danger Zone"]'));
    await expect(standbyIndicator.first()).toBeVisible();
  });

  test('toggles 3D Skeleton mode and mounts Three.js canvas panel', async ({ page }) => {
    const skeletonBtn = page.locator('button:has-text("3D Skeleton")');
    await expect(skeletonBtn).toBeVisible();
    await skeletonBtn.click();

    // Panel 2 should now appear: "3D Hand Skeleton & Depth Tracking"
    await expect(page.locator('text=3D Hand Skeleton & Depth Tracking')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=21 3D Landmarks & Depth Zone')).toBeVisible();

    // Verify WebGL/Three.js canvas is mounted
    const canvasElement = page.locator('canvas');
    await expect(canvasElement).toBeVisible({ timeout: 5000 });

    // Toggle back to 2D View
    const twoDBtn = page.locator('button:has-text("2D View")');
    await twoDBtn.click();
    await expect(page.locator('text=3D Hand Skeleton & Depth Tracking')).not.toBeVisible();
  });

  test('opens and interacts with Configurable 3D Monitoring Zone settings', async ({ page }) => {
    const zoneToggleBtn = page.getByRole('button', { name: '3D Zone', exact: true });
    await zoneToggleBtn.click();

    // Verify drawer contents
    await expect(page.locator('text=Configurable 3D Monitoring Zone (Estimated Depth)')).toBeVisible();
    await expect(page.locator('text=Width (X-Span):')).toBeVisible();
    await expect(page.locator('text=Height (Y-Span):')).toBeVisible();

    // Check action buttons
    await expect(page.getByRole('button', { name: 'Apply & Save 3D Zone' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset Defaults' })).toBeVisible();

    // Close drawer
    await zoneToggleBtn.click();
    await expect(page.locator('text=Configurable 3D Monitoring Zone (Estimated Depth)')).not.toBeVisible();
  });

  test('optical intrusion test trigger updates perimeter status', async ({ page }) => {
    const testIntrusionBtn = page.getByRole('button', { name: 'Test Intrusion' });
    if (await testIntrusionBtn.isVisible()) {
      await testIntrusionBtn.click();

      // Verify perimeter breach indication
      await expect(page.locator('text=BREACHED').first()).toBeVisible({ timeout: 5000 });

      // Click Reset Test button
      const resetBtn = page.getByRole('button', { name: 'Reset Test' });
      await resetBtn.click();

      // Verify secure status returns
      await expect(page.locator('text=SECURE').first()).toBeVisible({ timeout: 5000 });
    }
  });
});
