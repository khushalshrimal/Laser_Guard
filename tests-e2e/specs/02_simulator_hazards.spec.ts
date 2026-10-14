import { test, expect } from '@playwright/test';

test.describe('Simulator Hazard Scenarios & Real-time Recovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('executes Fire Hazard trigger and verifies hazard alert & telemetry change', async ({ page }) => {
    // Navigate to Settings & Simulator
    await page.locator('aside nav button:has-text("Settings & Simulator")').click();

    // Trigger Fire Hazard
    const fireBtn = page.locator('button:has-text("Fire Hazard Trigger")');
    await expect(fireBtn).toBeVisible();
    await fireBtn.click();

    // Confirm dispatch confirmation banner
    await expect(page.locator('text=Scenario \'FIRE\' dispatched successfully')).toBeVisible({ timeout: 5000 });

    // Header updates to HAZARD ALERT via WebSocket
    await expect(page.locator('header')).toContainText('SYSTEM HAZARD ALERT', { timeout: 5000 });

    // Navigate to Dashboard and verify Flame Sensor card
    await page.locator('aside nav button:has-text("Dashboard")').click();
    await expect(page.locator('text=FIRE DETECTED')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=ACTIVE FLAME')).toBeVisible();
  });

  test('executes Door Trip scenario and verifies safety stop alert', async ({ page }) => {
    await page.locator('aside nav button:has-text("Settings & Simulator")').click();

    const doorTripBtn = page.locator('button:has-text("Door Trip (Running)")');
    await expect(doorTripBtn).toBeVisible();
    await doorTripBtn.click();

    await expect(page.locator('text=Scenario \'DOOR_TRIP\' dispatched successfully')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('header')).toContainText('SYSTEM HAZARD ALERT', { timeout: 5000 });
  });

  test('executes Coolant Failure scenario and verifies Water Flow alarm', async ({ page }) => {
    await page.locator('aside nav button:has-text("Settings & Simulator")').click();

    const coolantBtn = page.locator('button:has-text("Coolant Flow Failure")');
    await expect(coolantBtn).toBeVisible();
    await coolantBtn.click();

    await expect(page.locator('text=Scenario \'COOLANT_FAIL\' dispatched successfully')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('header')).toContainText('SYSTEM HAZARD ALERT', { timeout: 5000 });

    // Navigate to Dashboard and check water flow sensor indicator
    await page.locator('aside nav button:has-text("Dashboard")').click();
    await expect(page.locator('text=FLOW LOW').or(page.locator('text=FLOW CRITICAL')).first()).toBeVisible({ timeout: 5000 });
  });

  test('executes Overheat Spike scenario and verifies Temperature alarm', async ({ page }) => {
    await page.locator('aside nav button:has-text("Settings & Simulator")').click();

    const overheatBtn = page.locator('button:has-text("Overheat Spike (75°C)")');
    await expect(overheatBtn).toBeVisible();
    await overheatBtn.click();

    await expect(page.locator('text=Scenario \'OVERHEAT\' dispatched successfully')).toBeVisible({ timeout: 5000 });

    // Navigate to Dashboard and check temperature sensor shows warning state
    await page.locator('aside nav button:has-text("Dashboard")').click();
    await expect(page.locator('text=OVERHEAT LIMIT')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=74.5 °C')).toBeVisible();
  });

  test('recovers safely to Normal Operation', async ({ page }) => {
    await page.locator('aside nav button:has-text("Settings & Simulator")').click();

    const nominalBtn = page.locator('button:has-text("Normal Operation")');
    await expect(nominalBtn).toBeVisible();
    await nominalBtn.click();

    await expect(page.locator('text=Scenario \'NOMINAL\' dispatched successfully')).toBeVisible({ timeout: 5000 });

    // Header returns to System Online
    await expect(page.locator('header')).toContainText('System Online', { timeout: 5000 });

    // Dashboard flame sensor returns to safe state
    await page.locator('aside nav button:has-text("Dashboard")').click();
    await expect(page.locator('text=No Flame Detected')).toBeVisible({ timeout: 5000 });
  });

  test('disarming in-charge permission and starting machine triggers unauthorized running hazard', async ({ page }) => {
    // On Dashboard, click In-Charge Permission OFF button
    const offBtn = page.getByRole('button', { name: 'OFF', exact: true });
    await expect(offBtn).toBeVisible();
    await offBtn.click();

    // Verify interlock is locked
    await expect(page.locator('text=Interlock Locked (DISARMED)')).toBeVisible({ timeout: 5000 });

    // Now attempt to start machine cutting while permission is OFF
    const startBtn = page.getByRole('button', { name: 'Start (Sim)' });
    await startBtn.click();

    // Must trigger critical UNAUTHORIZED RUNNING
    await expect(page.locator('header')).toContainText('SYSTEM HAZARD ALERT', { timeout: 5000 });
    await expect(page.locator('text=UNAUTHORIZED RUNNING')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=CRITICAL: Machine running WITHOUT in-charge authorization!')).toBeVisible();

    // Grant permission back ON
    const onBtn = page.getByRole('button', { name: 'ON', exact: true });
    await onBtn.click();

    // Machine recovers to authorized operation
    await expect(page.locator('header')).toContainText('System Online', { timeout: 5000 });
    await expect(page.locator('text=Permission Granted')).toBeVisible();
  });
});
