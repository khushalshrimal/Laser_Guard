/**
 * LaserGuard AI - Frontend Telemetry & Safety Type Definitions
 * Directly aligned with backend Pydantic models (schemas.py)
 */

export type TelemetrySource = 'HARDWARE' | 'SIMULATOR';

export type ConnectivityState = 'ONLINE' | 'STALE';

export type SafetySeverity = 'CRITICAL' | 'WARNING' | 'UNKNOWN' | 'NORMAL';

export type RecommendedMachineState =
  | 'NORMAL_OPERATION'
  | 'STOP_RECOMMENDED'
  | 'MAINTENANCE_REQUIRED'
  | 'SHUTDOWN_RECOMMENDED';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export interface SensorReadings {
  door_open?: boolean | null;
  flame_detected?: boolean | null;
  smoke_level?: number | null;
  temperature_c?: number | null;
  machine_enabled?: boolean | null;
  machine_running?: boolean | null;
  water_flow_lpm?: number | null;
  camera_intrusion_detected?: boolean | null;
  radiation_level?: number | null;
}

export interface SafetyViolation {
  rule_id: string;
  severity: SafetySeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface DeviceSafetyAssessment {
  device_id: string;
  source: TelemetrySource;
  overall_severity: SafetySeverity;
  recommended_state: RecommendedMachineState;
  violations: SafetyViolation[];
  stale: boolean;
  evaluated_at: string;
  disclaimer: string;
}

export interface DeviceStatus {
  device_id: string;
  source: TelemetrySource;
  connectivity_state: ConnectivityState;
  last_seen: string;
  seconds_since_last_seen: number;
  stale_threshold_seconds: number;
  latest_readings: SensorReadings;
  safety?: DeviceSafetyAssessment | null;
}

export interface SystemStatusResponse {
  status: string;
  server_time: string;
  stale_threshold_seconds: number;
  device_count: number;
  devices: DeviceStatus[];
  disclaimer: string;
}

export interface SafetyThresholdsConfig {
  high_temperature_c: number;
  elevated_smoke: number;
  stale_threshold_seconds: number;
}

export interface SystemSafetyResponse {
  status: string;
  evaluated_at: string;
  device_count: number;
  overall_system_severity: SafetySeverity;
  assessments: DeviceSafetyAssessment[];
  thresholds: SafetyThresholdsConfig;
  disclaimer: string;
}

export type WebSocketEventType =
  | 'status_snapshot'
  | 'telemetry_update'
  | 'stale_transition'
  | 'safety_alert';

export interface WebSocketMessage {
  event: WebSocketEventType;
  data: SystemStatusResponse;
}

export interface BlackboxEvent {
  id: number;
  timestamp: string;
  event_type: string;
  device_id: string;
  source: TelemetrySource;
  severity?: SafetySeverity | null;
  rule_id?: string | null;
  recommended_state?: RecommendedMachineState | null;
  message: string;
  details: Record<string, unknown>;
}

export interface EventHistoryResponse {
  status: string;
  count: number;
  total_count: number;
  limit: number;
  before_id?: number | null;
  events: BlackboxEvent[];
  disclaimer: string;
}

export interface BackendHealth {
  status: string;
  app: string;
  version: string;
  environment: string;
  hardware_connected: boolean;
  active_source: string;
  notice: string;
}
