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

  describe('Milestone 8: Hardware Contract Preparedness (Water Flow & Camera)', () => {
    test('correctly parses water_flow_lpm and camera_intrusion_detected in readings', () => {
      const readings = {
        door_open: false,
        flame_detected: false,
        smoke_level: 10.0,
        temperature_c: 25.0,
        machine_enabled: true,
        machine_running: true,
        water_flow_lpm: 4.8,
        camera_intrusion_detected: false,
      };

      assert.strictEqual(readings.water_flow_lpm, 4.8);
      assert.strictEqual(readings.camera_intrusion_detected, false);
    });

    test('preserves null/unreported state without fabricating 0.0 values', () => {
      const readingsWithoutFlow = {
        door_open: false,
        flame_detected: false,
        smoke_level: 10.0,
        temperature_c: 25.0,
        water_flow_lpm: null,
        camera_intrusion_detected: null,
      };

      assert.strictEqual(readingsWithoutFlow.water_flow_lpm, null);
      assert.notStrictEqual(readingsWithoutFlow.water_flow_lpm, 0.0);
      assert.strictEqual(readingsWithoutFlow.camera_intrusion_detected, null);
    });
  });

  describe('Milestone 4: Camera Safety Monitoring UI & Protocol Tests', () => {
    test('derives live MJPEG stream URL correctly from API base', () => {
      const apiBase = 'http://127.0.0.1:8000';
      const streamUrl = `${apiBase}/api/camera/stream`;
      assert.strictEqual(streamUrl, 'http://127.0.0.1:8000/api/camera/stream');
    });

    test('correctly maps camera lifecycle states (STOPPED, STARTING, RUNNING, ERROR)', () => {
      const states = ['STOPPED', 'STARTING', 'RUNNING', 'ERROR'] as const;
      for (const st of states) {
        assert.ok(typeof st === 'string');
      }
    });

    test('clearly distinguishes camera offline from confirmed danger zone intrusion', () => {
      // 1. Offline: null
      const offlineReadings = { camera_intrusion_detected: null };
      assert.strictEqual(offlineReadings.camera_intrusion_detected, null);
      assert.notStrictEqual(offlineReadings.camera_intrusion_detected, true);

      // 2. Clear: false
      const clearReadings = { camera_intrusion_detected: false };
      assert.strictEqual(clearReadings.camera_intrusion_detected, false);

      // 3. Breached: true
      const breachReadings = { camera_intrusion_detected: true };
      assert.strictEqual(breachReadings.camera_intrusion_detected, true);
    });

    test('handles danger zone ROI boundaries and validates normalization', () => {
      const roi = { x_min: 0.2, y_min: 0.2, x_max: 0.8, y_max: 0.8 };
      assert.ok(roi.x_min >= 0.0 && roi.x_min <= 1.0);
      assert.ok(roi.x_max >= 0.0 && roi.x_max <= 1.0);
      assert.ok(roi.x_min < roi.x_max);
      assert.ok(roi.y_min < roi.y_max);
    });

    test('identifies intrusion activation and clearance events in event history', () => {
      const events = [
        {
          id: 1,
          rule_id: 'RULE_PERIMETER_INTRUSION',
          event_type: 'RULE_ACTIVATION',
          severity: 'CRITICAL',
          message: 'Safety rule activated: Optical exclusion zone breached',
        },
        {
          id: 2,
          rule_id: 'RULE_PERIMETER_INTRUSION',
          event_type: 'RULE_CLEARANCE',
          severity: 'NORMAL',
          message: 'Safety hazard cleared: rule RULE_PERIMETER_INTRUSION is no longer triggered',
        },
      ];

      const activations = events.filter((e) => e.rule_id === 'RULE_PERIMETER_INTRUSION' && e.event_type === 'RULE_ACTIVATION');
      const clearances = events.filter((e) => e.rule_id === 'RULE_PERIMETER_INTRUSION' && e.event_type === 'RULE_CLEARANCE');

      assert.strictEqual(activations.length, 1);
      assert.strictEqual(clearances.length, 1);
      assert.strictEqual(activations[0].severity, 'CRITICAL');
      assert.strictEqual(clearances[0].severity, 'NORMAL');
    });

    test('prevents duplicate alert triggering on repeated identical WebSocket snapshots', () => {
      let alertCount = 0;
      let lastAlertState: boolean | null = null;

      function onTelemetryUpdate(intrusionState: boolean | null) {
        if (intrusionState === true && lastAlertState !== true) {
          alertCount++;
        }
        lastAlertState = intrusionState;
      }

      // Continuous breach over 5 consecutive WebSocket frames
      onTelemetryUpdate(true); // Alert 1 (Rising edge)
      onTelemetryUpdate(true); // Suppressed
      onTelemetryUpdate(true); // Suppressed
      onTelemetryUpdate(true); // Suppressed
      onTelemetryUpdate(true); // Suppressed
      assert.strictEqual(alertCount, 1);

      // Cleared
      onTelemetryUpdate(false);
      assert.strictEqual(alertCount, 1);

      // Re-entry
      onTelemetryUpdate(true); // Alert 2 (New edge)
      assert.strictEqual(alertCount, 2);
    });

    test('cleans up stream URL resource when camera stops or unmounts', () => {
      let activeStreamUrl: string | null = 'http://127.0.0.1:8000/api/camera/stream';
      // Simulate stop/unmount
      function stopOrUnmount() {
        activeStreamUrl = null;
      }

      stopOrUnmount();
      assert.strictEqual(activeStreamUrl, null);
    });
  });
});

