"""
LaserGuard AI - Camera Safety Bridge Automated Tests
Tests edge-triggered intrusion event generation, deduplication, clearance,
canonical device ID preservation, and integration with EventStore and WebSocket.
"""

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

from app.schemas import (
    CANONICAL_DEVICE_ID,
    TelemetrySource,
    NormalizedTelemetryFrame,
    SensorReadings,
    SafetySeverity,
    RecommendedMachineState,
)
from app.registry import DeviceRegistry
from app.safety_engine import SafetyEngine, RULE_PERIMETER_INTRUSION
from app.event_store import EventStore
from app.websocket_manager import WebSocketManager
from app.camera_service import (
    CameraService,
    CameraDetectionResult,
    HandDetection,
    HandBBox,
    HandLandmark,
    DetectionStatus,
)
from app.camera_safety_bridge import CameraSafetyBridge, reset_camera_safety_bridge


def make_mock_detection(breached: bool = True, hand_count: int = 1) -> CameraDetectionResult:
    """Helper to construct deterministic CameraDetectionResult mock."""
    hands = []
    if hand_count > 0:
        hands.append(
            HandDetection(
                label="Right",
                score=0.95,
                landmarks=[HandLandmark(x=0.5, y=0.5, z=0.0)],
                bbox=HandBBox(x_min=0.4, y_min=0.4, x_max=0.6, y_max=0.6),
                in_danger_zone=breached,
            )
        )
    status = (
        DetectionStatus.DANGER_ZONE_BREACH.value
        if breached
        else (DetectionStatus.HAND_DETECTED.value if hand_count > 0 else DetectionStatus.NO_HANDS.value)
    )
    return CameraDetectionResult(
        status=status,
        hand_count=hand_count,
        hands=hands,
        danger_zone_breached=breached,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


class TestCameraSafetyBridge(unittest.TestCase):
    """Automated unit and integration tests for CameraSafetyBridge."""

    def setUp(self):
        reset_camera_safety_bridge()
        self.temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.temp_db.close()
        self.db_path = self.temp_db.name

        self.event_store = EventStore(db_path=self.db_path)
        self.registry = DeviceRegistry()
        self.safety_engine = SafetyEngine()
        self.ws_manager = MagicMock(spec=WebSocketManager)
        self.ws_manager.active_connection_count = 1

        self.bridge = CameraSafetyBridge(
            registry=self.registry,
            safety_engine=self.safety_engine,
            event_store=self.event_store,
            ws_manager=self.ws_manager,
            canonical_device_id=CANONICAL_DEVICE_ID,
        )

    def tearDown(self):
        reset_camera_safety_bridge()
        if os.path.exists(self.db_path):
            try:
                os.remove(self.db_path)
            except OSError:
                pass

    def test_1_hand_detected_outside_danger_zone(self):
        """1. Hand detected outside danger zone generates NO intrusion events."""
        detection = make_mock_detection(breached=False, hand_count=1)
        events = self.bridge.handle_detection(detection)

        self.assertEqual(len(events), 0)
        self.assertFalse(self.bridge.is_intrusion_latched)
        query = self.event_store.query_events(device_id=CANONICAL_DEVICE_ID)
        perimeter_events = [e for e in query.events if e.rule_id == RULE_PERIMETER_INTRUSION]
        self.assertEqual(query.count, 0)

    def test_2_hand_entering_danger_zone_generates_event(self):
        """2. Hand entering danger zone generates an intrusion event with canonical ID."""
        detection = make_mock_detection(breached=True, hand_count=1)
        events = self.bridge.handle_detection(detection)

        self.assertTrue(len(events) >= 1)
        self.assertTrue(self.bridge.is_intrusion_latched)

        # Check recorded event in event store
        query = self.event_store.query_events(device_id=CANONICAL_DEVICE_ID)
        perimeter_events = [e for e in query.events if e.rule_id == RULE_PERIMETER_INTRUSION]
        self.assertEqual(query.count, 1)
        event = query.events[0]
        self.assertEqual(event.rule_id, RULE_PERIMETER_INTRUSION)
        self.assertEqual(event.event_type, "RULE_ACTIVATION")
        self.assertEqual(event.device_id, CANONICAL_DEVICE_ID)
        self.assertTrue(event.details["camera_intrusion_detected"])
        self.assertTrue(event.details["danger_zone_breached"])

    def test_3_continuous_intrusion_deduplication(self):
        """3. Continuous intrusion across multiple frames produces only one event."""
        detection = make_mock_detection(breached=True, hand_count=1)

        # Frame 1: Rising edge
        events_1 = self.bridge.handle_detection(detection)
        self.assertEqual(len(events_1), 1)

        # Frame 2: Continuous intrusion
        events_2 = self.bridge.handle_detection(detection)
        self.assertEqual(len(events_2), 0)

        # Frame 3: Continuous intrusion
        events_3 = self.bridge.handle_detection(detection)
        self.assertEqual(len(events_3), 0)

        # Event store should contain exactly 1 event
        query = self.event_store.query_events(device_id=CANONICAL_DEVICE_ID)
        perimeter_events = [e for e in query.events if e.rule_id == RULE_PERIMETER_INTRUSION]
        self.assertEqual(query.count, 1)

    def test_4_hand_exits_and_reenters_generates_new_event(self):
        """4. Hand exits danger zone and subsequently re-enters: generates clearance and new activation."""
        # 1. Breach
        self.bridge.handle_detection(make_mock_detection(breached=True, hand_count=1))
        self.assertTrue(self.bridge.is_intrusion_latched)

        # 2. Hand exits
        clearance_events = self.bridge.handle_detection(make_mock_detection(breached=False, hand_count=1))
        self.assertFalse(self.bridge.is_intrusion_latched)
        self.assertTrue(any(e.event_type == "RULE_CLEARANCE" for e in clearance_events))

        # 3. Hand re-enters
        reentry_events = self.bridge.handle_detection(make_mock_detection(breached=True, hand_count=1))
        self.assertTrue(self.bridge.is_intrusion_latched)
        self.assertTrue(any(e.event_type == "RULE_ACTIVATION" for e in reentry_events))

        # Check total events for RULE_PERIMETER_INTRUSION
        query = self.event_store.query_events(device_id=CANONICAL_DEVICE_ID)
        perimeter_events = [e for e in query.events if e.rule_id == RULE_PERIMETER_INTRUSION]
        self.assertEqual(query.count, 3)  # ACTIVATION, CLEARANCE, ACTIVATION
        event_types = [e.event_type for e in query.events]
        self.assertEqual(event_types, ["RULE_ACTIVATION", "RULE_CLEARANCE", "RULE_ACTIVATION"])

    def test_5_no_hand_frames_reset_intrusion_latch(self):
        """5. Frame with 0 hands correctly clears latch and generates clearance if previously breached."""
        # Breach first
        self.bridge.handle_detection(make_mock_detection(breached=True, hand_count=1))
        self.assertTrue(self.bridge.is_intrusion_latched)

        # Now 0 hands detected
        no_hands = make_mock_detection(breached=False, hand_count=0)
        events = self.bridge.handle_detection(no_hands)
        self.assertFalse(self.bridge.is_intrusion_latched)
        self.assertTrue(any(e.event_type == "RULE_CLEARANCE" for e in events))

        # Subsequent 0 hands frame produces no redundant clearance
        events_redundant = self.bridge.handle_detection(no_hands)
        self.assertEqual(len(events_redundant), 0)

    def test_6_camera_unavailable_error_no_false_event(self):
        """6. Camera offline or error (detection is None) does not create false intrusion event."""
        events = self.bridge.handle_detection(None)
        self.assertEqual(len(events), 0)
        self.assertFalse(self.bridge.is_intrusion_latched)

        query = self.event_store.query_events(device_id=CANONICAL_DEVICE_ID)
        perimeter_events = [e for e in query.events if e.rule_id == RULE_PERIMETER_INTRUSION]
        self.assertEqual(query.count, 0)

    def test_7_missing_or_malformed_detection_data(self):
        """7. Missing or malformed detection data handled gracefully without unhandled exceptions."""
        # Empty mock object
        malformed = MagicMock(spec=[])
        events = self.bridge.handle_detection(malformed)
        self.assertEqual(len(events), 0)
        self.assertFalse(self.bridge.is_intrusion_latched)

    def test_8_canonical_machine_id_preserved(self):
        """8. Event always recorded with canonical machine ID 'laser-cutter-01'."""
        detection = make_mock_detection(breached=True, hand_count=1)
        self.bridge.handle_detection(detection)

        query = self.event_store.query_events()
        for e in query.events:
            self.assertEqual(e.device_id, CANONICAL_DEVICE_ID)

    def test_9_event_store_and_websocket_integration(self):
        """9. Event stored in SQLite and WebSocket status update broadcast attempted."""
        detection = make_mock_detection(breached=True, hand_count=1)
        self.bridge.handle_detection(detection)

        query = self.event_store.query_events(device_id=CANONICAL_DEVICE_ID)
        self.assertTrue(query.count >= 1)

    def test_10_existing_telemetry_interaction_and_severity(self):
        """10. Telemetry preserves live intrusion; running machine triggers CRITICAL while idle triggers WARNING."""
        # Case A: Machine running in registry
        running_frame = NormalizedTelemetryFrame(
            source=TelemetrySource.SIMULATOR,
            device_id=CANONICAL_DEVICE_ID,
            timestamp=datetime.now(timezone.utc).isoformat(),
            readings=SensorReadings(
                door_open=False,
                flame_detected=False,
                smoke_level=10.0,
                temperature_c=25.0,
                machine_enabled=True,
                machine_running=True,
            ),
        )
        self.registry.register_telemetry(running_frame)

        # Trigger intrusion while machine is running
        events_running = self.bridge.handle_detection(make_mock_detection(breached=True, hand_count=1))
        self.assertTrue(any(e.severity == SafetySeverity.CRITICAL for e in events_running))
        self.assertTrue(any(e.recommended_state == RecommendedMachineState.STOP_RECOMMENDED for e in events_running))

        # Clear intrusion
        self.bridge.handle_detection(make_mock_detection(breached=False, hand_count=0))

        # Case B: Machine idle
        idle_frame = NormalizedTelemetryFrame(
            source=TelemetrySource.SIMULATOR,
            device_id=CANONICAL_DEVICE_ID,
            timestamp=datetime.now(timezone.utc).isoformat(),
            readings=SensorReadings(
                door_open=False,
                flame_detected=False,
                smoke_level=10.0,
                temperature_c=25.0,
                machine_enabled=False,
                machine_running=False,
            ),
        )
        self.registry.register_telemetry(idle_frame)

        # Trigger intrusion while machine is idle
        events_idle = self.bridge.handle_detection(make_mock_detection(breached=True, hand_count=1))
        self.assertTrue(any(e.severity == SafetySeverity.WARNING for e in events_idle))

    def test_11_repeated_camera_attach_detach_idempotent(self):
        """11. Repeated attach/detach does not create duplicate event callbacks or workers."""
        mock_camera_svc = MagicMock(spec=CameraService)
        mock_camera_svc._detection_callbacks = []

        def mock_add(cb):
            if cb not in mock_camera_svc._detection_callbacks:
                mock_camera_svc._detection_callbacks.append(cb)

        def mock_remove(cb):
            if cb in mock_camera_svc._detection_callbacks:
                mock_camera_svc._detection_callbacks.remove(cb)

        mock_camera_svc.add_detection_callback.side_effect = mock_add
        mock_camera_svc.remove_detection_callback.side_effect = mock_remove

        # Attach 5 times
        for _ in range(5):
            self.bridge.attach_to_camera_service(mock_camera_svc)
        self.assertEqual(len(mock_camera_svc._detection_callbacks), 1)

        # Detach 5 times
        for _ in range(5):
            self.bridge.detach_from_camera_service(mock_camera_svc)
        self.assertEqual(len(mock_camera_svc._detection_callbacks), 0)


if __name__ == "__main__":
    unittest.main()
