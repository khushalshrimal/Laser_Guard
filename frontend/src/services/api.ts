/**
 * LaserGuard AI - Central REST and WebSocket API Client
 * Manages URL resolution, network requests, error normalization, and fallback states.
 */

import {
  BackendHealth,
  SystemStatusResponse,
  SystemSafetyResponse,
  EventHistoryResponse,
} from '../types/telemetry';

export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return `http://${window.location.hostname}:8000`;
  }
  return 'http://127.0.0.1:8000';
}

export function getWebSocketUrl(): string {
  // Respect explicit VITE_WS_URL if set
  const explicitWs = import.meta.env.VITE_WS_URL;
  if (explicitWs && typeof explicitWs === 'string' && explicitWs.trim().length > 0) {
    return explicitWs.trim();
  }

  // Derive from API base URL: convert http(s) to ws(s) and append /ws/status
  const apiBase = getApiBaseUrl();
  try {
    const parsed = new URL(apiBase);
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${parsed.host}/ws/status`;
  } catch {
    const wsBase = apiBase
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');
    return `${wsBase}/ws/status`;
  }
}

export async function fetchBackendHealth(): Promise<BackendHealth> {
  const url = `${getApiBaseUrl()}/health`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Health check failed: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function toggleInChargePermission(enabled: boolean): Promise<{ ok: boolean; in_charge_permission: boolean }> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/in-charge-permission?enabled=${enabled}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to toggle in-charge permission: HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchSystemStatus(deviceId?: string): Promise<SystemStatusResponse> {
  const baseUrl = getApiBaseUrl();
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const response = await fetch(`${baseUrl}/api/status${query}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch system status: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchSystemSafety(deviceId?: string): Promise<SystemSafetyResponse> {
  const baseUrl = getApiBaseUrl();
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const response = await fetch(`${baseUrl}/api/safety${query}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch safety status: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export interface EventQueryOptions {
  deviceId?: string;
  severity?: string;
  eventType?: string;
  limit?: number;
  beforeId?: number;
}

export async function fetchBlackboxEvents(options: EventQueryOptions = {}): Promise<EventHistoryResponse> {
  const baseUrl = getApiBaseUrl();
  const params = new URLSearchParams();
  if (options.deviceId) params.append('device_id', options.deviceId);
  if (options.severity) params.append('severity', options.severity);
  if (options.eventType) params.append('event_type', options.eventType);
  if (options.limit !== undefined) params.append('limit', options.limit.toString());
  if (options.beforeId !== undefined) params.append('before_id', options.beforeId.toString());

  const queryString = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${baseUrl}/api/events${queryString}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch blackbox events: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function ingestTelemetryPayload(payload: Record<string, unknown>): Promise<{ status: string; message: string }> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ingestion failed: HTTP ${response.status} - ${errorText}`);
  }
  return response.json();
}

export function getCameraStreamUrl(): string {
  return `${getApiBaseUrl()}/api/camera/stream`;
}

export async function fetchCameraStatus(): Promise<import('../types/telemetry').CameraStatusResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/camera/status`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch camera status: HTTP ${response.status}`);
  }
  return response.json();
}

export async function startCamera(payload?: {
  device_index?: number;
  target_fps?: number;
  roi?: import('../types/telemetry').RoiConfig;
}): Promise<import('../types/telemetry').CameraStatusResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/camera/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to start camera: HTTP ${response.status} - ${errText}`);
  }
  return response.json();
}

export async function stopCamera(): Promise<import('../types/telemetry').CameraStatusResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/camera/stop`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to stop camera: HTTP ${response.status} - ${errText}`);
  }
  return response.json();
}

export async function updateCameraZone3d(
  zone3d: import('../types/telemetry').Zone3dConfig
): Promise<import('../types/telemetry').CameraStatusResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/camera/zone3d`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(zone3d),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to update 3D monitoring zone: HTTP ${response.status} - ${errText}`);
  }
  return response.json();
}

export async function resetCameraZone3d(): Promise<import('../types/telemetry').CameraStatusResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/camera/zone3d/reset`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to reset 3D monitoring zone: HTTP ${response.status} - ${errText}`);
  }
  return response.json();
}

