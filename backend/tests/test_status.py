"""
LaserGuard AI - Automated Device Health & Stale Detection Tests
Validates in-memory registry, GET /api/status, and connectivity state tracking.
"""

import unittest
import time
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.registry import default_device_registry, DeviceRegistry
from app.schemas import (
    TelemetrySource,
    NormalizedTelemetryFrame,
    SensorReadings,
    ConnectivityState,
)


class TestDeviceHealthAndStatus(unittest.TestCase):
    def setUp(self):
        # Reset the global registry before every test method for isolation
        default_device_registry.clear()
        default_device_registry.set_stale_threshold(None)  # Use environment/default
        self.client = TestClient(app)

    def tearDown(self):
        default_device_registry.clear()
        default_device_registry.set_stale_threshold(None)

    # 1. Empty Registry Behavior
    def test_empty_registry_behavior(self):
        response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["device_count"], 0)
        self.assertEqual(data["devices"], [])
        self.assertIn("server_time", data)
        self.assertIn("stale_threshold_seconds", data)
        self.assertIn("disclaimer", data)

    # 2. A Device Becomes Online After Valid Ingestion
    def test_device_online_after_valid_ingestion(self):
        payload = {
            "source": "HARDWARE",
            "device_id": "esp32-safety-01",
            "readings": {
                "door_open": False,
                "flame_detected": False,
                "smoke_level": 5.0,
                "temperature_c": 24.5,
                "machine_enabled": True,
                "machine_running": False,
            },
        }
        ingest_res = self.client.post("/ingest", json=payload)
        self.assertEqual(ingest_res.status_code, 200)

        status_res = self.client.get("/api/status")
        self.assertEqual(status_res.status_code, 200)
        data = status_res.json()
        self.assertEqual(data["device_count"], 1)

        dev = data["devices"][0]
        self.assertEqual(dev["device_id"], "laser-cutter-01")
        self.assertEqual(dev["source"], "HARDWARE")
        self.assertEqual(dev["connectivity_state"], "ONLINE")
        self.assertLess(dev["seconds_since_last_seen"], 5.0)
        self.assertEqual(dev["latest_readings"]["temperature_c"], 24.5)
        self.assertEqual(dev["latest_readings"]["door_open"], False)

    # 3. Correct Distinction Between HARDWARE and SIMULATOR
    def test_source_distinction(self):
        payload_hw = {
            "source": "HARDWARE",
            "device_id": "esp32-unit-1",
            "readings": {"temperature_c": 30.0},
        }
        self.client.post("/ingest", json=payload_hw)
        res_hw = self.client.get("/api/status").json()
        self.assertEqual(res_hw["device_count"], 1)
        self.assertEqual(res_hw["devices"][0]["source"], "HARDWARE")

        payload_sim = {
            "source": "SIMULATOR",
            "device_id": "sim-unit-2",
            "readings": {"temperature_c": 21.0},
        }
        self.client.post("/ingest?force=true", json=payload_sim)
        res_sim = self.client.get("/api/status").json()
        self.assertEqual(res_sim["device_count"], 1)
        self.assertEqual(res_sim["devices"][0]["source"], "SIMULATOR")

    # 4. Single Machine Authoritative State Updated on Subsequent Ingestions
    def test_two_devices_maintain_independent_states(self):
        dev1_payload = {
            "source": "HARDWARE",
            "device_id": "device-alpha",
            "readings": {"temperature_c": 45.0, "smoke_level": 12.0},
        }
        self.client.post("/ingest", json=dev1_payload)

        # Update the machine
        dev1_update = {
            "source": "HARDWARE",
            "device_id": "device-alpha",
            "readings": {"temperature_c": 52.0, "smoke_level": 25.0},
        }
        self.client.post("/ingest", json=dev1_update)

        status_res = self.client.get("/api/status")
        data = status_res.json()
        self.assertEqual(data["device_count"], 1)
        dev = data["devices"][0]
        self.assertEqual(dev["latest_readings"]["temperature_c"], 52.0)
        self.assertEqual(dev["latest_readings"]["smoke_level"], 25.0)

    # 5. Invalid Ingestion Does Not Corrupt or Overwrite State
    def test_invalid_ingestion_preserves_previous_state(self):
        valid_payload = {
            "source": "SIMULATOR",
            "device_id": "sim-cutter-1",
            "readings": {"temperature_c": 28.0, "door_open": False},
        }
        res1 = self.client.post("/ingest", json=valid_payload)
        self.assertEqual(res1.status_code, 200)

        # Send invalid payload (negative smoke level and string boolean)
        bad_payload = {
            "source": "SIMULATOR",
            "device_id": "sim-cutter-1",
            "readings": {"temperature_c": 99.0, "smoke_level": -50.0, "door_open": "invalid_str"},
        }
        res2 = self.client.post("/ingest", json=bad_payload)
        self.assertEqual(res2.status_code, 422)

        # Verify device state remains the previous valid reading (28.0, not 99.0) under canonical ID
        status_res = self.client.get("/api/status")
        devices_by_id = {d["device_id"]: d for d in status_res.json()["devices"]}
        self.assertIn("laser-cutter-01", devices_by_id)
        self.assertEqual(devices_by_id["laser-cutter-01"]["latest_readings"]["temperature_c"], 28.0)
        self.assertEqual(devices_by_id["laser-cutter-01"]["latest_readings"]["door_open"], False)

    # 6. Device Becoming Stale After Threshold (HTTP Query Parameter)
    def test_device_stale_via_threshold_param(self):
        payload = {
            "source": "HARDWARE",
            "device_id": "esp32-fast-stale",
            "readings": {"temperature_c": 25.0},
        }
        self.client.post("/ingest", json=payload)
        time.sleep(0.05)

        # Stale threshold of 0.01 seconds: elapsed > threshold -> STALE
        status_res = self.client.get("/api/status?stale_threshold=0.01")
        data = status_res.json()
        dev = data["devices"][0]
        self.assertEqual(dev["connectivity_state"], "STALE")

        # Stale threshold of 60 seconds: elapsed < threshold -> ONLINE
        online_res = self.client.get("/api/status?stale_threshold=60.0")
        self.assertEqual(online_res.json()["devices"][0]["connectivity_state"], "ONLINE")

    # 7. Deterministic Unit Testing of Registry Clock
    def test_deterministic_stale_calculation(self):
        reg = DeviceRegistry(stale_threshold_seconds=10.0)
        frame = NormalizedTelemetryFrame(
            source=TelemetrySource.HARDWARE,
            device_id="laser-cutter-01",
            timestamp="2026-10-14T10:00:00.000000Z",
            readings=SensorReadings(temperature_c=25.0),
        )

        t0 = datetime(2026, 10, 14, 10, 0, 0, tzinfo=timezone.utc)
        reg.register_telemetry(frame, server_received_at=t0)

        # 5 seconds later: <= 10s -> ONLINE
        t_plus_5 = t0 + timedelta(seconds=5)
        st5 = reg.get_device_status("laser-cutter-01", now=t_plus_5)
        self.assertIsNotNone(st5)
        self.assertEqual(st5.connectivity_state, ConnectivityState.ONLINE)
        self.assertEqual(st5.seconds_since_last_seen, 5.0)

        # Exactly 10 seconds later: <= 10s -> ONLINE
        t_plus_10 = t0 + timedelta(seconds=10)
        st10 = reg.get_device_status("laser-cutter-01", now=t_plus_10)
        self.assertEqual(st10.connectivity_state, ConnectivityState.ONLINE)

        # 10.5 seconds later: > 10s -> STALE
        t_plus_10_5 = t0 + timedelta(seconds=10.5)
        st11 = reg.get_device_status("laser-cutter-01", now=t_plus_10_5)
        self.assertEqual(st11.connectivity_state, ConnectivityState.STALE)
        self.assertEqual(st11.seconds_since_last_seen, 10.5)

    # 8. Stale Calculated from Server Receive Time, Not Client Timestamp
    def test_stale_uses_server_receive_time_not_client_timestamp(self):
        # Client sends an old timestamp from 1 day ago
        old_client_ts = "2026-10-13T10:00:00Z"
        payload = {
            "source": "SIMULATOR",
            "device_id": "sim-old-clock",
            "timestamp": old_client_ts,
            "readings": {"temperature_c": 22.0},
        }
        self.client.post("/ingest", json=payload)

        # Query immediately: status must be ONLINE because server receive time is right now
        status_res = self.client.get("/api/status")
        dev = status_res.json()["devices"][0]
        self.assertEqual(dev["connectivity_state"], "ONLINE")
        self.assertLess(dev["seconds_since_last_seen"], 2.0)

    # 9. Query Filter by Device ID
    def test_filter_by_device_id(self):
        self.client.post("/ingest", json={"source": "HARDWARE", "device_id": "esp-A"})
        self.client.post("/ingest", json={"source": "HARDWARE", "device_id": "esp-B"})

        res = self.client.get("/api/status?device_id=laser-cutter-01")
        data = res.json()
        self.assertEqual(data["device_count"], 1)
        self.assertEqual(data["devices"][0]["device_id"], "laser-cutter-01")

        res_none = self.client.get("/api/status?device_id=esp-nonexistent")
        self.assertEqual(res_none.json()["device_count"], 0)

    # 10. Regression: Canonical Machine Identity Enforced Across Arbitrary Incoming IDs
    def test_canonical_identity_enforced_across_arbitrary_ids(self):
        # Ingest frame 1 with device_id="cutter-alpha"
        res1 = self.client.post("/ingest", json={
            "source": "HARDWARE",
            "device_id": "cutter-alpha",
            "readings": {"temperature_c": 27.0, "smoke_level": 8.0},
        })
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["data"]["device_id"], "laser-cutter-01")

        # Stored and displayed as laser-cutter-01
        status1 = self.client.get("/api/status").json()
        self.assertEqual(status1["device_count"], 1)
        self.assertEqual(status1["devices"][0]["device_id"], "laser-cutter-01")

        # Ingest subsequent frame with device_id="cutter-beta"
        res2 = self.client.post("/ingest?force=true", json={
            "source": "SIMULATOR",
            "device_id": "cutter-beta",
            "readings": {"temperature_c": 31.0, "smoke_level": 9.5},
        })
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["data"]["device_id"], "laser-cutter-01")

        # Machine count remains strictly 1 and still displays laser-cutter-01
        status2 = self.client.get("/api/status").json()
        self.assertEqual(status2["device_count"], 1)
        self.assertEqual(status2["devices"][0]["device_id"], "laser-cutter-01")
        self.assertEqual(status2["devices"][0]["source"], "SIMULATOR")
        self.assertEqual(status2["devices"][0]["latest_readings"]["temperature_c"], 31.0)

    # 11. Regression: WebSocket Snapshot and Broadcast Consistently Expose Canonical Identity
    def test_websocket_snapshot_and_broadcast_canonical_identity(self):
        # Ingest initial frame
        self.client.post("/ingest", json={
            "source": "HARDWARE",
            "device_id": "cutter-gamma",
            "readings": {"temperature_c": 23.0},
        })

        with self.client.websocket_connect("/ws/status") as ws:
            # Initial snapshot must expose laser-cutter-01
            initial = ws.receive_json()
            self.assertEqual(initial["event"], "status_snapshot")
            self.assertEqual(initial["data"]["device_count"], 1)
            self.assertEqual(initial["data"]["devices"][0]["device_id"], "laser-cutter-01")

            # Post frame with another arbitrary ID
            self.client.post("/ingest?force=true", json={
                "source": "SIMULATOR",
                "device_id": "cutter-delta",
                "readings": {"temperature_c": 28.0},
            })

            # Broadcast update must expose laser-cutter-01
            update = ws.receive_json()
            self.assertEqual(update["event"], "telemetry_update")
            self.assertEqual(update["data"]["device_count"], 1)
            self.assertEqual(update["data"]["devices"][0]["device_id"], "laser-cutter-01")


if __name__ == "__main__":
    unittest.main()
