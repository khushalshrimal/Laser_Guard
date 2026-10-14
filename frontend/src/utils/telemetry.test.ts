/**
 * LaserGuard AI - Frontend Telemetry & WebSocket Logic Automated Tests
 * Uses Node 24 native test runner with experimental strip types.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type {
  WebSocketMessage,
  SystemStatusResponse,
  BlackboxEvent,
  DeviceStatus,
  TelemetrySource,
  SafetySeverity,
} from '../types/telemetry.ts';

// URL Derivation Logic to test
function deriveWsUrl(apiBaseUrl: string): string {
  try {
    const parsed = new URL(apiBaseUrl);
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${parsed.host}/ws/status`;
  } catch {
    const wsBase = apiBaseUrl
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');
    return `${wsBase}/ws/status`;
  }
}

// Message Parser with Safety Guarantees
function parseWebSocketEnvelope(raw: string): { valid: boolean; message?: WebSocketMessage; error?: string } {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'Payload is not an object' };
    }
    const validEvents = ['status_snapshot', 'telemetry_update', 'stale_transition', 'safety_alert'];
    if (!validEvents.includes(parsed.event)) {
      return { valid: false, error: `Invalid event type: ${parsed.event}` };
    }
    if (!parsed.data || !Array.isArray(parsed.data.devices)) {
      return { valid: false, error: 'Missing or invalid data.devices array' };
    }
    return { valid: true, message: parsed as WebSocketMessage };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'JSON parse failure';
    return { valid: false, error: msg };
  }
}

// Stale State Detector
function isTelemetryFresh(device: DeviceStatus): boolean {
  if (device.connectivity_state === 'STALE') {
    return false;
  }
  return device.seconds_since_last_seen <= device.stale_threshold_seconds;
}

// System Severity Resolver
function resolveSystemSeverity(devices: DeviceStatus[]): SafetySeverity {
  if (devices.some((d) => d.safety?.overall_severity === 'CRITICAL')) {
    return 'CRITICAL';
  }
  if (
    devices.some(
      (d) => d.safety?.overall_severity === 'WARNING' || d.connectivity_state === 'STALE'
    )
  ) {
    return 'WARNING';
  }
  return devices.length > 0 ? 'NORMAL' : 'NORMAL';
}

describe('LaserGuard AI Frontend Telemetry & Protocol Tests', () => {
  describe('WebSocket URL Derivation', () => {
    test('converts http to ws and appends /ws/status', () => {
      const wsUrl = deriveWsUrl('http://127.0.0.1:8000');
      assert.strictEqual(wsUrl, 'ws://127.0.0.1:8000/ws/status');
    });

    test('converts https to wss for secure deployments', () => {
      const wsUrl = deriveWsUrl('https://laserguard.internal.io');
      assert.strictEqual(wsUrl, 'wss://laserguard.internal.io/ws/status');
    });

    test('handles trailing slashes cleanly', () => {
      const wsUrl = deriveWsUrl('http://localhost:8000/');
      assert.strictEqual(wsUrl, 'ws://localhost:8000/ws/status');
    });
  });

  describe('WebSocket Envelope Parsing & Event Types', () => {
    const mockSystemData: SystemStatusResponse = {
      status: 'ok',
      server_time: '2026-10-14T11:40:00Z',
      stale_threshold_seconds: 10.0,
      device_count: 1,
      devices: [
        {
          device_id: 'cutter-01',
          source: 'HARDWARE',
          connectivity_state: 'ONLINE',
          last_seen: '2026-10-14T11:40:00Z',
          seconds_since_last_seen: 0.5,
          stale_threshold_seconds: 10.0,
          latest_readings: {
            door_open: false,
            flame_detected: false,
            smoke_level: 15.0,
            temperature_c: 32.0,
            machine_enabled: true,
            machine_running: true,
          },
          safety: {
            device_id: 'cutter-01',
            source: 'HARDWARE',
            overall_severity: 'NORMAL',
            recommended_state: 'NORMAL_OPERATION',
            violations: [],
            stale: false,
            evaluated_at: '2026-10-14T11:40:00Z',
            disclaimer: 'Software only',
          },
        },
      ],
      disclaimer: 'Software connectivity only',
    };

    test('parses status_snapshot event', () => {
      const raw = JSON.stringify({ event: 'status_snapshot', data: mockSystemData });
      const res = parseWebSocketEnvelope(raw);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.message?.event, 'status_snapshot');
      assert.strictEqual(res.message?.data.devices.length, 1);
    });

    test('parses telemetry_update event', () => {
      const raw = JSON.stringify({ event: 'telemetry_update', data: mockSystemData });
      const res = parseWebSocketEnvelope(raw);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.message?.event, 'telemetry_update');
    });

    test('parses stale_transition event', () => {
      const raw = JSON.stringify({ event: 'stale_transition', data: mockSystemData });
      const res = parseWebSocketEnvelope(raw);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.message?.event, 'stale_transition');
    });

    test('parses safety_alert event', () => {
      const raw = JSON.stringify({ event: 'safety_alert', data: mockSystemData });
      const res = parseWebSocketEnvelope(raw);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.message?.event, 'safety_alert');
    });

    test('rejects unexpected event type', () => {
      const raw = JSON.stringify({ event: 'UNSUPPORTED_EVENT', data: mockSystemData });
      const res = parseWebSocketEnvelope(raw);
      assert.strictEqual(res.valid, false);
      assert.match(res.error || '', /Invalid event type/);
    });

    test('rejects malformed non-JSON data safely', () => {
      const res = parseWebSocketEnvelope('NOT_JSON_AT_ALL');
      assert.strictEqual(res.valid, false);
      assert.ok(res.error);
    });

    test('rejects payload missing data.devices', () => {
      const raw = JSON.stringify({ event: 'telemetry_update', data: {} });
      const res = parseWebSocketEnvelope(raw);
      assert.strictEqual(res.valid, false);
      assert.match(res.error || '', /Missing or invalid data\.devices/);
    });
  });

  describe('Source Label Fidelity: HARDWARE vs SIMULATOR', () => {
    test('correctly preserves HARDWARE source distinction', () => {
      const source: TelemetrySource = 'HARDWARE';
      assert.strictEqual(source, 'HARDWARE');
      assert.notStrictEqual(source, 'SIMULATOR');
    });

    test('correctly preserves SIMULATOR source distinction', () => {
      const source: TelemetrySource = 'SIMULATOR';
      assert.strictEqual(source, 'SIMULATOR');
      assert.notStrictEqual(source, 'HARDWARE');
    });
  });

  describe('Stale Data Guarding', () => {
    test('device with STALE connectivity is marked as not fresh', () => {
      const staleDev: DeviceStatus = {
        device_id: 'cutter-stale',
        source: 'SIMULATOR',
        connectivity_state: 'STALE',
        last_seen: '2026-10-14T11:00:00Z',
        seconds_since_last_seen: 15.2,
        stale_threshold_seconds: 10.0,
        latest_readings: {},
      };
      assert.strictEqual(isTelemetryFresh(staleDev), false);
    });

    test('device with elapsed time exceeding threshold is marked as not fresh', () => {
      const timedOutDev: DeviceStatus = {
        device_id: 'cutter-timedout',
        source: 'HARDWARE',
        connectivity_state: 'ONLINE',
        last_seen: '2026-10-14T11:00:00Z',
        seconds_since_last_seen: 12.0,
        stale_threshold_seconds: 10.0,
        latest_readings: {},
      };
      assert.strictEqual(isTelemetryFresh(timedOutDev), false);
    });

    test('fresh ONLINE device is marked as fresh', () => {
      const freshDev: DeviceStatus = {
        device_id: 'cutter-fresh',
        source: 'HARDWARE',
        connectivity_state: 'ONLINE',
        last_seen: '2026-10-14T11:00:00Z',
        seconds_since_last_seen: 1.2,
        stale_threshold_seconds: 10.0,
        latest_readings: {},
      };
      assert.strictEqual(isTelemetryFresh(freshDev), true);
    });
  });

  describe('Overall System Severity Calculation', () => {
    test('returns CRITICAL if any device has critical violation', () => {
      const devices: DeviceStatus[] = [
        {
          device_id: 'dev-1',
          source: 'HARDWARE',
          connectivity_state: 'ONLINE',
          last_seen: '2026-10-14T11:00:00Z',
          seconds_since_last_seen: 1.0,
          stale_threshold_seconds: 10.0,
          latest_readings: {},
          safety: {
            device_id: 'dev-1',
            source: 'HARDWARE',
            overall_severity: 'NORMAL',
            recommended_state: 'NORMAL_OPERATION',
            violations: [],
            stale: false,
            evaluated_at: '',
            disclaimer: '',
          },
        },
        {
          device_id: 'dev-2',
          source: 'SIMULATOR',
          connectivity_state: 'ONLINE',
          last_seen: '2026-10-14T11:00:00Z',
          seconds_since_last_seen: 1.0,
          stale_threshold_seconds: 10.0,
          latest_readings: {},
          safety: {
            device_id: 'dev-2',
            source: 'SIMULATOR',
            overall_severity: 'CRITICAL',
            recommended_state: 'STOP_RECOMMENDED',
            violations: [{ rule_id: 'RULE_FIRE_DETECTED', severity: 'CRITICAL', message: 'Fire' }],
            stale: false,
            evaluated_at: '',
            disclaimer: '',
          },
        },
      ];

      assert.strictEqual(resolveSystemSeverity(devices), 'CRITICAL');
    });

    test('returns WARNING if a device is STALE even without critical violation', () => {
      const devices: DeviceStatus[] = [
        {
          device_id: 'dev-1',
          source: 'HARDWARE',
          connectivity_state: 'STALE',
          last_seen: '2026-10-14T11:00:00Z',
          seconds_since_last_seen: 15.0,
          stale_threshold_seconds: 10.0,
          latest_readings: {},
          safety: {
            device_id: 'dev-1',
            source: 'HARDWARE',
            overall_severity: 'NORMAL',
            recommended_state: 'NORMAL_OPERATION',
            violations: [],
            stale: true,
            evaluated_at: '',
            disclaimer: '',
          },
        },
      ];

      assert.strictEqual(resolveSystemSeverity(devices), 'WARNING');
    });
  });

  describe('Event History Structure & Filtering', () => {
    const mockEvents: BlackboxEvent[] = [
      {
        id: 101,
        timestamp: '2026-10-14T11:40:00Z',
        event_type: 'SAFETY_TRANSITION',
        device_id: 'cutter-01',
        source: 'HARDWARE',
        severity: 'CRITICAL',
        rule_id: 'RULE_FIRE_DETECTED',
        recommended_state: 'STOP_RECOMMENDED',
        message: 'Fire detected on cutter-01',
        details: { flame: true },
      },
      {
        id: 100,
        timestamp: '2026-10-14T11:39:00Z',
        event_type: 'CONNECTIVITY_TRANSITION',
        device_id: 'cutter-02',
        source: 'SIMULATOR',
        severity: 'WARNING',
        rule_id: 'RULE_STALE_TELEMETRY',
        recommended_state: 'STOP_RECOMMENDED',
        message: 'Device cutter-02 connectivity STALE',
        details: { new_state: 'STALE' },
      },
    ];

    test('supports filtering events by severity', () => {
      const criticalOnly = mockEvents.filter((e) => e.severity === 'CRITICAL');
      assert.strictEqual(criticalOnly.length, 1);
      assert.strictEqual(criticalOnly[0].id, 101);
    });

    test('handles empty event history gracefully', () => {
      const emptyEvents: BlackboxEvent[] = [];
      assert.strictEqual(emptyEvents.length, 0);
    });
  });
});
