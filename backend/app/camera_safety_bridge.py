"""
LaserGuard AI - Camera Safety Bridge
Integrates camera hand detection events with the DeviceRegistry, SafetyEngine,
SQLite Blackbox EventStore, and WebSocket live updates.
Edge-triggered deduplication prevents event flooding on continuous intrusions.
"""

import logging
import threading
import asyncio
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from app.schemas import (
    CANONICAL_DEVICE_ID,
    TelemetrySource,
    SafetySeverity,
    RecommendedMachineState,
    BlackboxEvent,
    ConnectivityState,
    normalize_to_utc_iso,
)
from app.registry import DeviceRegistry, get_device_registry
from app.safety_engine import (
    SafetyEngine,
    get_safety_engine,
    RULE_PERIMETER_INTRUSION,
)
from app.event_store import EventStore, get_event_store
from app.websocket_manager import WebSocketManager, get_ws_manager
from app.camera_service import (
    CameraDetectionResult,
    CameraService,
    get_camera_service,
)

logger = logging.getLogger("laserguard.camera_safety_bridge")


class CameraSafetyBridge:
    """
    Subscribes to CameraService detection frames and translates danger zone breaches
    into structured safety violations and persistent blackbox audit events.
    Enforces edge-triggered latching to avoid logging events on every frame during continuous intrusions.
    """

    def __init__(
        self,
        registry: Optional[DeviceRegistry] = None,
        safety_engine: Optional[SafetyEngine] = None,
        event_store: Optional[EventStore] = None,
        ws_manager: Optional[WebSocketManager] = None,
        loop: Optional[asyncio.AbstractEventLoop] = None,
        canonical_device_id: str = CANONICAL_DEVICE_ID,
    ):
        self._registry = registry or get_device_registry()
        self._safety_engine = safety_engine or get_safety_engine()
        self._event_store = event_store or get_event_store()
        self._ws_manager = ws_manager or get_ws_manager()
        self._loop = loop
        self._canonical_device_id = canonical_device_id

        self._lock = threading.Lock()
        self._intrusion_latched = False
        self._is_attached = False

    @property
    def is_intrusion_latched(self) -> bool:
        """Returns True if a danger zone intrusion is currently active."""
        with self._lock:
            return self._intrusion_latched

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Assign the active asyncio event loop for WebSocket broadcasts."""
        self._loop = loop

    def reset(self) -> None:
        """Reset internal latch state without deleting database events."""
        with self._lock:
            self._intrusion_latched = False

    def attach_to_camera_service(self, camera_service: CameraService) -> None:
        """
        Attach bridge callback to camera service frames.
        Idempotent: prevents duplicate callback registrations.
        """
        with self._lock:
            if not self._is_attached:
                camera_service.add_detection_callback(self.handle_detection)
                self._is_attached = True

    def detach_from_camera_service(self, camera_service: CameraService) -> None:
        """
        Detach bridge callback from camera service.
        Idempotent: safely unregisters without errors.
        """
        with self._lock:
            if self._is_attached:
                camera_service.remove_detection_callback(self.handle_detection)
                self._is_attached = False

    def handle_detection(
        self,
        detection: Optional[CameraDetectionResult],
        timestamp: Optional[datetime] = None,
    ) -> List[BlackboxEvent]:
        """
        Process a camera detection result.
        Returns a list of BlackboxEvent records created during this call (empty if deduplicated).
        Thread-safe and edge-triggered.
        """
        if timestamp is None:
            timestamp = datetime.now(timezone.utc)

        events_generated: List[BlackboxEvent] = []

        # Graceful handling of missing or camera-stopped/offline notification
        if detection is None:
            with self._lock:
                if self._intrusion_latched:
                    self._intrusion_latched = False
                    events_generated.extend(self._on_intrusion_cleared(timestamp))
                else:
                    self._registry.update_camera_intrusion(None)
            return events_generated

        danger_breached = bool(getattr(detection, "danger_zone_breached", False))

        with self._lock:
            if danger_breached:
                if not self._intrusion_latched:
                    # RISING EDGE: Fresh intrusion into danger zone
                    self._intrusion_latched = True
                    events_generated.extend(self._on_intrusion_detected(detection, timestamp))
                else:
                    # Continuous intrusion: latched, do NOT create duplicate events
                    pass
            else:
                if self._intrusion_latched:
                    # FALLING EDGE: Hand exited danger zone (or 0 hands detected)
                    self._intrusion_latched = False
                    events_generated.extend(self._on_intrusion_cleared(timestamp))
                else:
                    # Continues to be clear
                    self._registry.update_camera_intrusion(False)

        return events_generated

    def _on_intrusion_detected(
        self,
        detection: CameraDetectionResult,
        timestamp: datetime,
    ) -> List[BlackboxEvent]:
        """Execute rising edge intrusion actions: update registry, safety assessment, event store, ws."""
        events: List[BlackboxEvent] = []

        # 1. Update canonical machine readings in registry
        self._registry.update_camera_intrusion(True)

        dev_status = self._registry.get_device_status(self._canonical_device_id, now=timestamp)
        is_running = False
        source = TelemetrySource.SIMULATOR

        if dev_status:
            source = dev_status.source
            is_running = dev_status.latest_readings.machine_running is True
            # Re-evaluate safety with camera intrusion active
            assessment = self._safety_engine.evaluate_device(dev_status, evaluated_at=timestamp)
            dev_status.safety = assessment

            # Process state transitions in event store
            transition_events = self._event_store.process_assessment_transition(
                assessment=assessment,
                connectivity_state=dev_status.connectivity_state,
                timestamp=timestamp,
            )
            events.extend(transition_events)
        else:
            # If no machine telemetry has been ingested yet, log the direct RULE_ACTIVATION event
            rule_severity = SafetySeverity.WARNING
            rec_state = RecommendedMachineState.INVESTIGATION_RECOMMENDED
            hand_summaries = []
            for h in getattr(detection, "hands", []):
                hand_summaries.append({
                    "label": getattr(h, "label", None),
                    "score": getattr(h, "score", None),
                    "in_danger_zone": getattr(h, "in_danger_zone", False),
                    "bbox": h.bbox.model_dump() if hasattr(h, "bbox") and hasattr(h.bbox, "model_dump") else {},
                })

            e = self._event_store.log_event(
                event_type="RULE_ACTIVATION",
                device_id=self._canonical_device_id,
                source=source,
                severity=rule_severity,
                rule_id=RULE_PERIMETER_INTRUSION,
                recommended_state=rec_state,
                message="Safety rule activated: Optical perimeter boundary breached while machine is idle.",
                details={
                    "camera_intrusion_detected": True,
                    "danger_zone_breached": True,
                    "hand_count": getattr(detection, "hand_count", 0),
                    "machine_running": is_running,
                    "hands": hand_summaries,
                    "source": "CAMERA",
                },
                timestamp=timestamp,
            )
            events.append(e)

        # Broadcast live status update via WebSocket
        self._broadcast_websocket()
        return events

    def _on_intrusion_cleared(
        self,
        timestamp: datetime,
    ) -> List[BlackboxEvent]:
        """Execute falling edge clearance actions."""
        events: List[BlackboxEvent] = []

        # 1. Update canonical machine readings in registry
        self._registry.update_camera_intrusion(False)

        dev_status = self._registry.get_device_status(self._canonical_device_id, now=timestamp)
        source = TelemetrySource.SIMULATOR

        if dev_status:
            source = dev_status.source
            assessment = self._safety_engine.evaluate_device(dev_status, evaluated_at=timestamp)
            dev_status.safety = assessment

            transition_events = self._event_store.process_assessment_transition(
                assessment=assessment,
                connectivity_state=dev_status.connectivity_state,
                timestamp=timestamp,
            )
            events.extend(transition_events)
        else:
            # Fallback clearance log if no device record exists
            e = self._event_store.log_event(
                event_type="RULE_CLEARANCE",
                device_id=self._canonical_device_id,
                source=source,
                severity=SafetySeverity.NORMAL,
                rule_id=RULE_PERIMETER_INTRUSION,
                recommended_state=RecommendedMachineState.NORMAL_OPERATION,
                message=f"Safety hazard cleared: rule {RULE_PERIMETER_INTRUSION} is no longer triggered.",
                details={
                    "camera_intrusion_detected": False,
                    "danger_zone_breached": False,
                    "source": "CAMERA",
                },
                timestamp=timestamp,
            )
            events.append(e)

        self._broadcast_websocket()
        return events

    def _broadcast_websocket(self) -> None:
        """Safely schedule a status snapshot broadcast on the running asyncio event loop."""
        if not self._ws_manager or self._ws_manager.active_connection_count == 0:
            return

        target_loop = self._loop
        if target_loop is None or not target_loop.is_running():
            try:
                target_loop = asyncio.get_running_loop()
            except RuntimeError:
                target_loop = None

        if target_loop and target_loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(
                    self._ws_manager.broadcast_status(
                        self._registry,
                        safety_engine=self._safety_engine,
                        event="telemetry_update",
                    ),
                    target_loop,
                )
            except Exception as e:
                logger.warning(f"Failed to schedule WebSocket broadcast: {e}")


# Global singleton instance
_camera_bridge: Optional[CameraSafetyBridge] = None


def get_camera_safety_bridge() -> CameraSafetyBridge:
    """Dependency provider returning the global CameraSafetyBridge instance."""
    global _camera_bridge
    if _camera_bridge is None:
        _camera_bridge = CameraSafetyBridge()
    return _camera_bridge


def reset_camera_safety_bridge() -> None:
    """Helper for testing to cleanly reset bridge singleton."""
    global _camera_bridge
    if _camera_bridge is not None:
        _camera_bridge.reset()
        _camera_bridge = None
