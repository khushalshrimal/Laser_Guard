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
