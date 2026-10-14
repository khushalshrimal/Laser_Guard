"""
LaserGuard AI - Automated Tests for SQLite Blackbox Event Store and GET /api/events
Validates table creation, transition logging, deduplication, retention pruning,
query filtering, cursor pagination, and end-to-end HTTP ingestion event recording.
"""

import os
import json
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app
from app.registry import default_device_registry
from app.websocket_manager import default_ws_manager
from app.event_store import EventStore, get_event_store, default_event_store
from app.schemas import (
    TelemetrySource,
    SafetySeverity,
    RecommendedMachineState,
    ConnectivityState,
    DeviceSafetyAssessment,
    SafetyViolation,
    SensorReadings,
    CANONICAL_DEVICE_ID,
)


class TestEventStoreDirect(unittest.TestCase):
    """Direct unit tests for the EventStore class using an isolated temporary database."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp_dir.name) / "test_blackbox.db")
        self.store = EventStore(db_path=self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_database_initialization_and_schema(self):
        """Verify table and indexes are created without error."""
        self.assertTrue(Path(self.db_path).exists())
        with self.store._get_connection() as conn:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='blackbox_events';"
            ).fetchall()
            self.assertEqual(len(tables), 1)

    def test_log_event_and_field_serialization(self):
        """Test inserting a single event and verifying stored fields and JSON serialization."""
        event = self.store.log_event(
            event_type="SAFETY_TRANSITION",
            device_id="laser-cutter-01",
            source=TelemetrySource.HARDWARE,
            severity=SafetySeverity.CRITICAL,
            rule_id="RULE_FIRE_DETECTED",
            recommended_state=RecommendedMachineState.STOP_RECOMMENDED,
            message="Critical fire detected on laser-cutter-01",
            details={"flame_detected": True, "smoke_level": 88.5},
        )

        self.assertIsNotNone(event.id)
        self.assertEqual(event.device_id, "laser-cutter-01")
        self.assertEqual(event.source, TelemetrySource.HARDWARE)
        self.assertEqual(event.severity, SafetySeverity.CRITICAL)
        self.assertEqual(event.rule_id, "RULE_FIRE_DETECTED")
        self.assertEqual(event.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        self.assertEqual(event.details["flame_detected"], True)
        self.assertEqual(event.details["smoke_level"], 88.5)

    def test_persistence_survives_store_reconnect(self):
        """Verify events persist in SQLite file when opening a fresh EventStore instance."""
        self.store.log_event(
            event_type="TEST_EVENT",
            device_id="persisted-dev",
            source=TelemetrySource.SIMULATOR,
            message="Persisted across restarts",
            severity=SafetySeverity.WARNING,
        )

        # Open a new EventStore pointing to the same file
        reconnected_store = EventStore(db_path=self.db_path)
        history = reconnected_store.query_events(device_id="persisted-dev")
        self.assertEqual(history.count, 1)
        self.assertEqual(history.events[0].message, "Persisted across restarts")
        self.assertEqual(history.events[0].source, TelemetrySource.SIMULATOR)

    def test_process_assessment_transition_deduplication(self):
        """
        Verify that identical telemetry frames do not duplicate events,
        while genuine safety and connectivity transitions are logged.
        """
        now = datetime.now(timezone.utc)

        # 1. First frame: Nominal (NORMAL, no violations, ONLINE)
        assessment_normal = DeviceSafetyAssessment(
            device_id="dev-transition",
            source=TelemetrySource.HARDWARE,
            overall_severity=SafetySeverity.NORMAL,
            recommended_state=RecommendedMachineState.NORMAL_OPERATION,
            violations=[],
            stale=False,
            evaluated_at=now.isoformat(),
        )

        events1 = self.store.process_assessment_transition(
            assessment=assessment_normal,
            connectivity_state=ConnectivityState.ONLINE,
            timestamp=now,
        )
        # First normal frame sets initial baseline without flooding
        self.assertEqual(len(events1), 0)

        # 2. Second frame: Identical nominal frame -> ZERO events logged
        events2 = self.store.process_assessment_transition(
            assessment=assessment_normal,
            connectivity_state=ConnectivityState.ONLINE,
            timestamp=now + timedelta(seconds=1),
        )
        self.assertEqual(len(events2), 0)

        # 3. Third frame: Hazard occurs (Fire detected -> CRITICAL)
        fire_violation = SafetyViolation(
            rule_id="RULE_FIRE_DETECTED",
            severity=SafetySeverity.CRITICAL,
            message="Optical flame sensor active",
            details={"flame_detected": True},
        )
        assessment_fire = DeviceSafetyAssessment(
            device_id="dev-transition",
            source=TelemetrySource.HARDWARE,
            overall_severity=SafetySeverity.CRITICAL,
            recommended_state=RecommendedMachineState.STOP_RECOMMENDED,
            violations=[fire_violation],
            stale=False,
            evaluated_at=(now + timedelta(seconds=2)).isoformat(),
        )

        events3 = self.store.process_assessment_transition(
            assessment=assessment_fire,
            connectivity_state=ConnectivityState.ONLINE,
            timestamp=now + timedelta(seconds=2),
        )
        # Should record: 1 SAFETY_TRANSITION (NORMAL -> CRITICAL) + 1 RULE_ACTIVATION (RULE_FIRE_DETECTED)
        self.assertEqual(len(events3), 2)
        event_types = {e.event_type for e in events3}
        self.assertIn("SAFETY_TRANSITION", event_types)
        self.assertIn("RULE_ACTIVATION", event_types)

        # 4. Fourth frame: Identical fire frame -> ZERO duplicate events
        events4 = self.store.process_assessment_transition(
            assessment=assessment_fire,
            connectivity_state=ConnectivityState.ONLINE,
            timestamp=now + timedelta(seconds=3),
        )
        self.assertEqual(len(events4), 0)

        # 5. Fifth frame: Fire cleared back to nominal
        events5 = self.store.process_assessment_transition(
            assessment=assessment_normal,
            connectivity_state=ConnectivityState.ONLINE,
            timestamp=now + timedelta(seconds=4),
        )
        # Should record: 1 SAFETY_TRANSITION (CRITICAL -> NORMAL) + 1 RULE_CLEARANCE (RULE_FIRE_DETECTED)
        self.assertEqual(len(events5), 2)
        event_types5 = {e.event_type for e in events5}
        self.assertIn("SAFETY_TRANSITION", event_types5)
        self.assertIn("RULE_CLEARANCE", event_types5)

    def test_connectivity_transition_logging(self):
        """Verify ONLINE -> STALE and STALE -> ONLINE transitions generate audit events."""
        now = datetime.now(timezone.utc)
        assessment = DeviceSafetyAssessment(
            device_id="dev-conn",
            source=TelemetrySource.SIMULATOR,
            overall_severity=SafetySeverity.NORMAL,
            recommended_state=RecommendedMachineState.NORMAL_OPERATION,
            violations=[],
            stale=False,
            evaluated_at=now.isoformat(),
        )

        # Initial packet: ONLINE
        self.store.process_assessment_transition(assessment, ConnectivityState.ONLINE, timestamp=now)

        # Transition to STALE
        stale_events = self.store.process_assessment_transition(
            assessment, ConnectivityState.STALE, timestamp=now + timedelta(seconds=10)
        )
        self.assertEqual(len(stale_events), 1)
        self.assertEqual(stale_events[0].event_type, "CONNECTIVITY_TRANSITION")
        self.assertEqual(stale_events[0].severity, SafetySeverity.WARNING)
        self.assertEqual(stale_events[0].rule_id, "RULE_STALE_TELEMETRY")
        self.assertEqual(stale_events[0].details["new_state"], "STALE")

        # Recover to ONLINE
        recovery_events = self.store.process_assessment_transition(
            assessment, ConnectivityState.ONLINE, timestamp=now + timedelta(seconds=12)
        )
        self.assertEqual(len(recovery_events), 1)
        self.assertEqual(recovery_events[0].event_type, "CONNECTIVITY_TRANSITION")
        self.assertEqual(recovery_events[0].severity, SafetySeverity.NORMAL)
        self.assertEqual(recovery_events[0].details["new_state"], "ONLINE")

    def test_retention_pruning(self):
        """Verify oldest events are automatically pruned when MAX_EVENTS_RETAINED is exceeded."""
        old_env = os.environ.get("MAX_EVENTS_RETAINED")
        os.environ["MAX_EVENTS_RETAINED"] = "100"  # Minimum supported bound is 100
        try:
            # Insert 105 events
            for i in range(105):
                self.store.log_event(
                    event_type="BATCH_TEST",
                    device_id="prune-dev",
                    source=TelemetrySource.SIMULATOR,
                    message=f"Event number {i}",
                )

            # Query without limit
            res = self.store.query_events(limit=200)
            # Total count should be pruned to 100
            self.assertEqual(res.total_count, 100)
            self.assertEqual(res.count, 100)
            # The oldest remaining event message should be "Event number 5"
            oldest_retained = res.events[-1]
            self.assertEqual(oldest_retained.message, "Event number 5")
            # The newest event should be "Event number 104"
            newest_retained = res.events[0]
            self.assertEqual(newest_retained.message, "Event number 104")
        finally:
            if old_env is not None:
                os.environ["MAX_EVENTS_RETAINED"] = old_env
            else:
                os.environ.pop("MAX_EVENTS_RETAINED", None)

    def test_query_filtering_and_cursor_pagination(self):
        """Verify device_id, severity, event_type filters and before_id cursor pagination."""
        # Insert known diverse events
        self.store.log_event(
            event_type="TYPE_A",
            device_id="dev-1",
            source=TelemetrySource.HARDWARE,
            severity=SafetySeverity.CRITICAL,
            message="Critical A",
        )
        self.store.log_event(
            event_type="TYPE_B",
            device_id="dev-2",
            source=TelemetrySource.SIMULATOR,
            severity=SafetySeverity.WARNING,
            message="Warning B",
        )
        self.store.log_event(
            event_type="TYPE_A",
            device_id="dev-1",
            source=TelemetrySource.HARDWARE,
            severity=SafetySeverity.NORMAL,
            message="Normal A",
        )
        self.store.log_event(
            event_type="TYPE_B",
            device_id="dev-1",
            source=TelemetrySource.HARDWARE,
            severity=SafetySeverity.CRITICAL,
            message="Critical B on dev-1",
        )

        # 1. Filter by device_id
        res_dev = self.store.query_events(device_id="dev-1")
        self.assertEqual(res_dev.total_count, 3)
        self.assertTrue(all(e.device_id == "dev-1" for e in res_dev.events))

        # 2. Filter by severity
        res_sev = self.store.query_events(severity="CRITICAL")
        self.assertEqual(res_sev.total_count, 2)
        self.assertTrue(all(e.severity == SafetySeverity.CRITICAL for e in res_sev.events))

        # 3. Filter by event_type
        res_type = self.store.query_events(event_type="TYPE_B")
        self.assertEqual(res_type.total_count, 2)
        self.assertTrue(all(e.event_type == "TYPE_B" for e in res_type.events))

        # 4. Cursor Pagination: limit=2
        page1 = self.store.query_events(limit=2)
        self.assertEqual(page1.count, 2)
        self.assertEqual(page1.total_count, 4)
        last_id_page1 = page1.events[-1].id

        page2 = self.store.query_events(limit=2, before_id=last_id_page1)
        self.assertEqual(page2.count, 2)
        # All IDs on page 2 should be strictly less than last_id_page1
        self.assertTrue(all(e.id < last_id_page1 for e in page2.events))


class TestEventStoreHTTP(unittest.TestCase):
    """Integration tests for GET /api/events and POST /ingest event generation via FastAPI TestClient."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.test_db_path = str(Path(self.temp_dir.name) / "test_api_blackbox.db")
        self.test_store = EventStore(db_path=self.test_db_path)

        # Override FastAPI dependency for EventStore
        app.dependency_overrides[get_event_store] = lambda: self.test_store

        default_device_registry.clear()
        default_ws_manager.clear()
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        default_device_registry.clear()
        default_ws_manager.clear()
        self.temp_dir.cleanup()

    def test_get_events_empty_database(self):
        """GET /api/events returns empty list when no events exist."""
        resp = self.client.get("/api/events")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["count"], 0)
        self.assertEqual(body["total_count"], 0)
        self.assertEqual(body["events"], [])

    def test_ingest_triggers_event_recording(self):
        """
        Verify that POST /ingest creates an event in the blackbox store
        when a safety hazard is ingested.
        """
        # Ingest a critical unauthorized running frame
        payload = {
            "source": "HARDWARE",
            "device_id": CANONICAL_DEVICE_ID,
            "readings": {
                "door_open": False,
                "flame_detected": False,
                "smoke_level": 12.0,
                "temperature_c": 30.0,
                "machine_enabled": False,
                "machine_running": True,  # Critical unauthorized running
            },
        }
        ingest_resp = self.client.post("/ingest", json=payload)
        self.assertEqual(ingest_resp.status_code, 200)

        # Query GET /api/events
        events_resp = self.client.get(f"/api/events?device_id={CANONICAL_DEVICE_ID}")
        self.assertEqual(events_resp.status_code, 200)
        body = events_resp.json()
        self.assertGreater(body["count"], 0)

        # Check that CRITICAL severity and RULE_UNAUTHORIZED_RUNNING were recorded
        rule_events = [e for e in body["events"] if e.get("rule_id") == "RULE_UNAUTHORIZED_RUNNING"]
        self.assertGreater(len(rule_events), 0)
        self.assertEqual(rule_events[0]["severity"], "CRITICAL")
        self.assertEqual(rule_events[0]["source"], "HARDWARE")

    def test_events_endpoint_validation_errors(self):
        """GET /api/events rejects invalid severity and limit values with 422."""
        # Invalid severity
        resp_bad_sev = self.client.get("/api/events?severity=SUPER_CRITICAL")
        self.assertEqual(resp_bad_sev.status_code, 422)

        # Limit > 200
        resp_bad_limit = self.client.get("/api/events?limit=500")
        self.assertEqual(resp_bad_limit.status_code, 422)

        # Limit < 1
        resp_bad_limit_zero = self.client.get("/api/events?limit=0")
        self.assertEqual(resp_bad_limit_zero.status_code, 422)

    def test_source_fidelity_simulator_vs_hardware(self):
        """Verify that events preserve SIMULATOR vs HARDWARE source labels."""
        self.test_store.log_event(
            event_type="TEST_SOURCE",
            device_id="hw-1",
            source=TelemetrySource.HARDWARE,
            message="Hardware frame",
        )
        self.test_store.log_event(
            event_type="TEST_SOURCE",
            device_id="sim-1",
            source=TelemetrySource.SIMULATOR,
            message="Simulator frame",
        )

        resp = self.client.get("/api/events")
        self.assertEqual(resp.status_code, 200)
        events = resp.json()["events"]
        hw_event = next(e for e in events if e["device_id"] == "hw-1")
        sim_event = next(e for e in events if e["device_id"] == "sim-1")

        self.assertEqual(hw_event["source"], "HARDWARE")
        self.assertEqual(sim_event["source"], "SIMULATOR")


if __name__ == "__main__":
    unittest.main()
