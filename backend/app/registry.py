"""
LaserGuard AI - In-Memory Device Registry & Stale Detection
Tracks the latest accepted telemetry frame and server reception time per device.
Calculates deterministic online/stale status without persistent storage (resets on restart).
"""

import os
import threading
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Dict, List, Optional

from app.schemas import (
    TelemetrySource,
    NormalizedTelemetryFrame,
    ConnectivityState,
    DeviceStatus,
    SystemStatusResponse,
    normalize_to_utc_iso,
)


def get_configured_stale_threshold() -> float:
    """
    Read stale threshold in seconds from environment variable STALE_THRESHOLD_SECONDS,
    defaulting to 10.0 seconds. Minimum value is 0.1s.
    """
    raw_val = os.getenv("STALE_THRESHOLD_SECONDS", "10.0")
    try:
        val = float(raw_val)
        return max(0.1, val)
    except (ValueError, TypeError):
        return 10.0


@dataclass
class DeviceRecord:
    device_id: str
    source: TelemetrySource
    last_seen_at: datetime  # Server UTC reception time
    latest_frame: NormalizedTelemetryFrame


class DeviceRegistry:
    """
    Thread-safe in-memory device registry.
    Stores the latest validated telemetry per device_id.
    Note: Resets whenever the backend application process restarts.
    """

    def __init__(self, stale_threshold_seconds: Optional[float] = None):
        self._lock = threading.Lock()
        self._devices: Dict[str, DeviceRecord] = {}
        self._stale_threshold_seconds = stale_threshold_seconds

    @property
    def stale_threshold(self) -> float:
        if self._stale_threshold_seconds is not None:
            return self._stale_threshold_seconds
        return get_configured_stale_threshold()

    def set_stale_threshold(self, threshold: Optional[float]) -> None:
        with self._lock:
            self._stale_threshold_seconds = threshold

    def register_telemetry(
        self,
        frame: NormalizedTelemetryFrame,
        server_received_at: Optional[datetime] = None,
    ) -> DeviceRecord:
        """
        Record newly validated telemetry for a device.
        Uses the server receive time to track connectivity independently of client clocks.
        """
        if server_received_at is None:
            server_received_at = datetime.now(timezone.utc)
        elif server_received_at.tzinfo is None:
            server_received_at = server_received_at.replace(tzinfo=timezone.utc)
        else:
            server_received_at = server_received_at.astimezone(timezone.utc)

        with self._lock:
            record = DeviceRecord(
                device_id=frame.device_id,
                source=frame.source,
                last_seen_at=server_received_at,
                latest_frame=frame,
            )
            self._devices[frame.device_id] = record
            return record

    def get_device_status(
        self,
        device_id: str,
        now: Optional[datetime] = None,
        threshold: Optional[float] = None,
    ) -> Optional[DeviceStatus]:
        """
        Retrieve connectivity and latest readings for a single device.
        Accepts an explicit 'now' datetime for deterministic testing.
        """
        effective_threshold = threshold if threshold is not None else self.stale_threshold
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        else:
            now = now.astimezone(timezone.utc)

        with self._lock:
            record = self._devices.get(device_id)
            if not record:
                return None

            elapsed = max(0.0, (now - record.last_seen_at).total_seconds())
            state = (
                ConnectivityState.ONLINE
                if elapsed <= effective_threshold
                else ConnectivityState.STALE
            )

            return DeviceStatus(
                device_id=record.device_id,
                source=record.source,
                connectivity_state=state,
                last_seen=normalize_to_utc_iso(record.last_seen_at),
                seconds_since_last_seen=round(elapsed, 2),
                stale_threshold_seconds=effective_threshold,
                latest_readings=record.latest_frame.readings,
            )

    def get_system_status(
        self,
        now: Optional[datetime] = None,
        threshold: Optional[float] = None,
        filter_device_id: Optional[str] = None,
    ) -> SystemStatusResponse:
        """
        Generate full system status including all tracked devices.
        Accepts an explicit 'now' datetime for deterministic testing.
        """
        effective_threshold = threshold if threshold is not None else self.stale_threshold
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        else:
            now = now.astimezone(timezone.utc)

        server_time_str = normalize_to_utc_iso(now)

        with self._lock:
            device_keys = sorted(self._devices.keys())
            if filter_device_id:
                device_keys = [k for k in device_keys if k == filter_device_id]

            statuses: List[DeviceStatus] = []
            for key in device_keys:
                rec = self._devices[key]
                elapsed = max(0.0, (now - rec.last_seen_at).total_seconds())
                state = (
                    ConnectivityState.ONLINE
                    if elapsed <= effective_threshold
                    else ConnectivityState.STALE
                )
                statuses.append(
                    DeviceStatus(
                        device_id=rec.device_id,
                        source=rec.source,
                        connectivity_state=state,
                        last_seen=normalize_to_utc_iso(rec.last_seen_at),
                        seconds_since_last_seen=round(elapsed, 2),
                        stale_threshold_seconds=effective_threshold,
                        latest_readings=rec.latest_frame.readings,
                    )
                )

            return SystemStatusResponse(
                status="ok",
                server_time=server_time_str,
                stale_threshold_seconds=effective_threshold,
                device_count=len(statuses),
                devices=statuses,
            )

    def clear(self) -> None:
        """Clear all registered devices (in-memory reset)."""
        with self._lock:
            self._devices.clear()


# Global singleton registry instance used by the FastAPI app
default_device_registry = DeviceRegistry()


def get_device_registry() -> DeviceRegistry:
    """Dependency provider for FastAPI routes."""
    return default_device_registry
