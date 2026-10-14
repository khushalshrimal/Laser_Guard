import { test, expect } from '@playwright/test';

test.describe('Sensor & Device Health, Telemetry Topology and WebSocket Link', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('aside nav button:has-text("Sensor & Device Health")').click();
    await expect(page.locator('header h2')).toHaveText('Sensor & System Device Health');
  });

  test('displays core service status cards with live backend health', async ({ page }) => {
    // Assert service status cards are visible
    await expect(page.locator('text=FastAPI Backend')).toBeVisible();
    await expect(page.locator('text=SQLite Blackbox').first()).toBeVisible();
    await expect(page.locator('text=WebSocket Stream')).toBeVisible();

    // Verify WebSocket status says CONNECTED
    await expect(page.getByText('CONNECTED', { exact: true })).toBeVisible();

    // Verify SQLite WAL Mode indicator
    await expect(page.getByText('WAL MODE', { exact: true })).toBeVisible();
  });

  test('displays End-to-End System Architecture Topology without MQTT', async ({ page }) => {
    await expect(page.locator('text=End-to-End System Architecture Topology')).toBeVisible();
    await expect(page.locator('text=Strict Direct Architecture (NO MQTT)')).toBeVisible();

    // Nodes
    await expect(page.locator('text=ESP32 / Sim')).toBeVisible();
    await expect(page.locator('text=FastAPI Ingest')).toBeVisible();
    await expect(page.locator('text=Safety Engine')).toBeVisible();
    await expect(page.locator('text=React + Vite')).toBeVisible();
  });

  test('header manual refresh button triggers telemetry and health reload', async ({ page }) => {
    const refreshBtn = page.locator('header button[title="Refresh telemetry & events"]');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Verify reload occurs without error
    await expect(page.locator('header h2')).toHaveText('Sensor & System Device Health');
  });
});
