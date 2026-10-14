"""
LaserGuard AI - Single-Machine Device Registry & Stale Detection
Maintains the authoritative machine state and latest telemetry snapshot.
Prevents creating or switching between multiple logical machines.
Calculates deterministic online/stale status without persistent storage (resets on restart).
"""

import os
import threading
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import List, Optional

from app.schemas import (
    CANONICAL_DEVICE_ID,
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
    Thread-safe single-machine device registry for LaserGuard AI.
    Maintains one authoritative machine state and latest telemetry snapshot.
    Prevents the application from creating or switching between multiple logical machines.
    """

    def __init__(
        self,
        stale_threshold_seconds: Optional[float] = None,
        canonical_device_id: str = CANONICAL_DEVICE_ID,
    ):
        self._lock = threading.Lock()
        self._canonical_device_id = canonical_device_id
        self._machine: Optional[DeviceRecord] = None
        self._stale_threshold_seconds = stale_threshold_seconds
        self._camera_intrusion_detected: Optional[bool] = None

    @property
    def canonical_device_id(self) -> str:
        return self._canonical_device_id

    @property
    def stale_threshold(self) -> float:
        if self._stale_threshold_seconds is not None:
            return self._stale_threshold_seconds
        return get_configured_stale_threshold()

    def set_stale_threshold(self, threshold: Optional[float]) -> None:
        with self._lock:
            self._stale_threshold_seconds = threshold

    def is_hardware_active(
        self,
        now: Optional[datetime] = None,
        threshold: Optional[float] = None,
    ) -> bool:
        """
        Check if physical HARDWARE is currently registered and actively ONLINE (not stale).
        Returns False if no device is registered, if the active source is SIMULATOR,
        or if HARDWARE has exceeded the stale threshold.
        """
        effective_threshold = threshold if threshold is not None else self.stale_threshold
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        else:
            now = now.astimezone(timezone.utc)

        with self._lock:
            if not self._machine:
                return False
            if self._machine.source != TelemetrySource.HARDWARE:
                return False
            elapsed = max(0.0, (now - self._machine.last_seen_at).total_seconds())
            return elapsed <= effective_threshold

    def update_camera_intrusion(self, detected: Optional[bool]) -> None:
        """
        Update camera intrusion status on the canonical machine's latest readings
        without overwriting other sensor telemetry.
        """
        with self._lock:
            self._camera_intrusion_detected = detected
            if self._machine:
                current_readings = self._machine.latest_frame.readings.model_dump()
                current_readings["camera_intrusion_detected"] = detected
                from app.schemas import SensorReadings
                new_readings = SensorReadings(**current_readings)
                self._machine.latest_frame = NormalizedTelemetryFrame(
                    source=self._machine.latest_frame.source,
                    device_id=self._canonical_device_id,
                    timestamp=self._machine.latest_frame.timestamp,
                    readings=new_readings,
                )

    def register_telemetry(
        self,
        frame: NormalizedTelemetryFrame,
        server_received_at: Optional[datetime] = None,
    ) -> DeviceRecord:
        """
        Record newly validated telemetry for the single authoritative machine.
        Uses the server receive time to track connectivity independently of client clocks.
        Always updates the single authoritative machine state.
        Preserves live camera intrusion state if incoming frame does not specify it.
        """
        if server_received_at is None:
            server_received_at = datetime.now(timezone.utc)
        elif server_received_at.tzinfo is None:
            server_received_at = server_received_at.replace(tzinfo=timezone.utc)
        else:
            server_received_at = server_received_at.astimezone(timezone.utc)

        with self._lock:
            if (
                frame.readings.camera_intrusion_detected is None
                and self._camera_intrusion_detected is not None
            ):
                from app.schemas import SensorReadings
                updated_readings = frame.readings.model_dump()
                updated_readings["camera_intrusion_detected"] = self._camera_intrusion_detected
                frame = NormalizedTelemetryFrame(
                    source=frame.source,
                    device_id=self._canonical_device_id,
                    timestamp=frame.timestamp,
                    readings=SensorReadings(**updated_readings),
                )
            elif frame.readings.camera_intrusion_detected is not None:
                self._camera_intrusion_detected = frame.readings.camera_intrusion_detected

            record = DeviceRecord(
                device_id=self._canonical_device_id,
                source=frame.source,
                last_seen_at=server_received_at,
                latest_frame=frame,
            )
            # Exactly one machine state is maintained; subsequent ingestions update this single machine
            self._machine = record
            return record

    def get_device_status(
        self,
        device_id: Optional[str] = None,
        now: Optional[datetime] = None,
        threshold: Optional[float] = None,
    ) -> Optional[DeviceStatus]:
        """
        Retrieve connectivity and latest readings for the single authoritative machine.
        """
        effective_threshold = threshold if threshold is not None else self.stale_threshold
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        else:
            now = now.astimezone(timezone.utc)

        with self._lock:
            if not self._machine:
                return None

            if (
                device_id is not None
                and device_id != self._canonical_device_id
                and device_id != self._machine.device_id
            ):
                return None

            rec = self._machine
            elapsed = max(0.0, (now - rec.last_seen_at).total_seconds())
            state = (
                ConnectivityState.ONLINE
                if elapsed <= effective_threshold
                else ConnectivityState.STALE
            )

            return DeviceStatus(
                device_id=self._canonical_device_id,
                source=rec.source,
                connectivity_state=state,
                last_seen=normalize_to_utc_iso(rec.last_seen_at),
                seconds_since_last_seen=round(elapsed, 2),
                stale_threshold_seconds=effective_threshold,
                latest_readings=rec.latest_frame.readings,
            )

    def get_system_status(
        self,
        now: Optional[datetime] = None,
        threshold: Optional[float] = None,
        filter_device_id: Optional[str] = None,
    ) -> SystemStatusResponse:
        """
        Generate system status for the single authoritative machine.
        Maintains at most one machine in the devices list.
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
            statuses: List[DeviceStatus] = []
            if self._machine:
                rec = self._machine
                if (
                    filter_device_id is None
                    or filter_device_id == self._canonical_device_id
                    or filter_device_id == rec.device_id
                ):
                    elapsed = max(0.0, (now - rec.last_seen_at).total_seconds())
                    state = (
                        ConnectivityState.ONLINE
                        if elapsed <= effective_threshold
                        else ConnectivityState.STALE
                    )
                    statuses.append(
                        DeviceStatus(
                            device_id=self._canonical_device_id,
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
        """Clear the single registered machine (in-memory reset)."""
        with self._lock:
            self._machine = None
            self._camera_intrusion_detected = None


# Global singleton registry instance used by the FastAPI app
default_device_registry = DeviceRegistry()


def get_device_registry() -> DeviceRegistry:
    """Dependency provider for FastAPI routes."""
    return default_device_registry
