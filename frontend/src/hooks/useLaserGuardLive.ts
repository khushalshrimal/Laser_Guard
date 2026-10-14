/**
 * LaserGuard AI - React Hook for Live WebSocket Updates & REST State Management
 * Connects to /ws/status with bounded exponential backoff and REST fallback.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ConnectionState,
  SystemStatusResponse,
  WebSocketMessage,
  BlackboxEvent,
} from '../types/telemetry';
import {
  getWebSocketUrl,
  fetchSystemStatus,
  fetchBlackboxEvents,
  EventQueryOptions,
} from '../services/api';

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10000;
const BACKOFF_MULTIPLIER = 1.5;

export interface LaserGuardLiveState {
  connectionState: ConnectionState;
  systemStatus: SystemStatusResponse | null;
  events: BlackboxEvent[];
  eventsLoading: boolean;
  eventsTotalCount: number;
  lastUpdated: string | null;
  lastError: string | null;
  wsUrl: string;
  refreshStatus: () => Promise<void>;
  refreshEvents: (options?: EventQueryOptions, isSilent?: boolean) => Promise<void>;
}

export function useLaserGuardLive(): LaserGuardLiveState {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [events, setEvents] = useState<BlackboxEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState<boolean>(false);
  const [eventsTotalCount, setEventsTotalCount] = useState<number>(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const isUnmountedRef = useRef<boolean>(false);
  const activeEventFilterRef = useRef<EventQueryOptions>({});

  const wsUrl = getWebSocketUrl();

  // 1. REST Fallback Fetchers
  const refreshStatus = useCallback(async () => {
    try {
      setLastError(null);
      const data = await fetchSystemStatus();
      if (!isUnmountedRef.current) {
        setSystemStatus(data);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (err: unknown) {
      if (!isUnmountedRef.current) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch status';
        setLastError(msg);
      }
    }
  }, []);

  const refreshEvents = useCallback(async (options: EventQueryOptions = {}, isSilent = false) => {
    activeEventFilterRef.current = options;
    if (!isSilent) setEventsLoading(true);
    try {
      const data = await fetchBlackboxEvents(options);
      if (!isUnmountedRef.current) {
        setEvents(data.events || []);
        setEventsTotalCount(data.total_count || 0);
      }
    } catch (err: unknown) {
      if (!isUnmountedRef.current) {
        console.warn('Failed to load blackbox events:', err);
      }
    } finally {
      if (!isUnmountedRef.current && !isSilent) {
        setEventsLoading(false);
      }
    }
  }, []);

  // 2. WebSocket Connection Lifecycle
  useEffect(() => {
    isUnmountedRef.current = false;

    // Load initial state via REST immediately
    refreshStatus();
    refreshEvents({ limit: 20 });

    function connectWebSocket() {
      if (isUnmountedRef.current) return;

      // Close existing socket if open
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // ignore
        }
        socketRef.current = null;
      }

      setConnectionState((prev) => (prev === 'connected' ? 'reconnecting' : 'reconnecting'));

      try {
        const ws = new WebSocket(wsUrl);
        socketRef.current = ws;

        ws.onopen = () => {
          if (isUnmountedRef.current) {
            ws.close();
            return;
          }
          reconnectAttemptsRef.current = 0;
          setConnectionState('connected');
          setLastError(null);
        };

        ws.onmessage = (event: MessageEvent) => {
          if (isUnmountedRef.current) return;
          try {
            const parsed: WebSocketMessage = JSON.parse(event.data);
            if (parsed && parsed.data && Array.isArray(parsed.data.devices)) {
              setSystemStatus(parsed.data);
              setLastUpdated(new Date().toLocaleTimeString());

              // When an event happens (e.g. stale_transition or safety_alert), refresh recent event history silently
              if (parsed.event === 'stale_transition' || parsed.event === 'safety_alert' || parsed.event === 'telemetry_update') {
                refreshEvents(activeEventFilterRef.current, true);
              }
            }
          } catch (err) {
            console.warn('Malformed WebSocket message received:', err);
          }
        };

        ws.onerror = () => {
          if (isUnmountedRef.current) return;
          setConnectionState('disconnected');
          setLastError(`WebSocket connection error to ${wsUrl}`);
        };

        ws.onclose = () => {
          if (isUnmountedRef.current) return;
          setConnectionState('disconnected');

          // Schedule reconnect with bounded exponential backoff
          const attempt = reconnectAttemptsRef.current;
          const delay = Math.min(
            MAX_RECONNECT_DELAY_MS,
            INITIAL_RECONNECT_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt)
          );
          reconnectAttemptsRef.current = attempt + 1;

          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isUnmountedRef.current) {
              setConnectionState('reconnecting');
              connectWebSocket();
            }
          }, delay);
        };
      } catch (err: unknown) {
        if (!isUnmountedRef.current) {
          setConnectionState('disconnected');
          const msg = err instanceof Error ? err.message : 'Failed to instantiate WebSocket';
          setLastError(msg);
        }
      }
    }

    connectWebSocket();

    // Fallback heartbeat polling if WebSocket is offline
    const fallbackInterval = setInterval(() => {
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        refreshStatus();
      }
    }, 15000);

    // High-frequency background event sync (every 2.5 seconds) to guarantee real-time blackbox freshness
    const eventPollingInterval = setInterval(() => {
      refreshEvents(activeEventFilterRef.current, true);
    }, 2500);

    return () => {
      isUnmountedRef.current = true;
      clearInterval(fallbackInterval);
      clearInterval(eventPollingInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // ignore
        }
        socketRef.current = null;
      }
    };
  }, [wsUrl, refreshStatus, refreshEvents]);

  return {
    connectionState,
    systemStatus,
    events,
    eventsLoading,
    eventsTotalCount,
    lastUpdated,
    lastError,
    wsUrl,
    refreshStatus,
    refreshEvents,
  };
}
