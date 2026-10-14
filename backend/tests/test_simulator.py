"""
LaserGuard AI - Automated Tests for Software Telemetry Simulator
Validates payload generation, mode scenarios, strict SIMULATOR source enforcement,
and HTTP POST ingestion using FastAPI TestClient.
"""

import unittest
from fastapi.testclient import TestClient

from app.main import app
from app.registry import default_device_registry
from app.websocket_manager import default_ws_manager
import sys
from pathlib import Path

# Add repository root to Python path so simulator module can be imported
repo_root = str(Path(__file__).resolve().parent.parent.parent)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from simulator.simulate_telemetry import generate_telemetry_payload
from app.schemas import CANONICAL_DEVICE_ID


class TestSimulatorScenarios(unittest.TestCase):
    def setUp(self):
        default_device_registry.clear()
        default_ws_manager.clear()
        self.client = TestClient(app)

    def tearDown(self):
        default_device_registry.clear()
        default_ws_manager.clear()

    def test_all_scenarios_have_simulator_source(self):
        """Verify EVERY generated payload strictly has source='SIMULATOR'."""
        modes = ["nominal", "door_trip", "fire", "overheat", "smoke", "coolant_fail", "camera_intrusion", "idle", "unauthorized_running"]
        for mode in modes:
            payload = generate_telemetry_payload(mode=mode, device_id="test-sim")
            self.assertEqual(payload["source"], "SIMULATOR")
            self.assertEqual(payload["device_id"], "test-sim")
            self.assertIn("readings", payload)

    def test_nominal_scenario_ingestion(self):
        """Nominal simulator frame is accepted and evaluates to NORMAL."""
        payload = generate_telemetry_payload(mode="nominal", device_id="sim-nominal")
        resp = self.client.post("/ingest", json=payload)
        self.assertEqual(resp.status_code, 200)

        # Check safety assessment for canonical machine
        status_resp = self.client.get(f"/api/status?device_id={CANONICAL_DEVICE_ID}")
        self.assertEqual(status_resp.status_code, 200)
        dev = status_resp.json()["devices"][0]
        self.assertEqual(dev["device_id"], CANONICAL_DEVICE_ID)
        self.assertEqual(dev["source"], "SIMULATOR")
        self.assertEqual(dev["safety"]["overall_severity"], "NORMAL")
        self.assertEqual(dev["safety"]["recommended_state"], "NORMAL_OPERATION")

    def test_door_trip_scenario_ingestion(self):
        """Door trip scenario is accepted and triggers CRITICAL / STOP_RECOMMENDED."""
        payload = generate_telemetry_payload(mode="door_trip", device_id="sim-door")
        resp = self.client.post("/ingest", json=payload)
        self.assertEqual(resp.status_code, 200)

        status_resp = self.client.get(f"/api/status?device_id={CANONICAL_DEVICE_ID}")
        dev = status_resp.json()["devices"][0]
        self.assertEqual(dev["device_id"], CANONICAL_DEVICE_ID)
        self.assertEqual(dev["safety"]["overall_severity"], "CRITICAL")
        self.assertEqual(dev["safety"]["recommended_state"], "STOP_RECOMMENDED")
        rule_ids = [v["rule_id"] for v in dev["safety"]["violations"]]
        self.assertIn("RULE_DOOR_OPEN_WHILE_RUNNING", rule_ids)

    def test_coolant_fail_scenario_ingestion(self):
        """Coolant fail scenario triggers CRITICAL RULE_COOLANT_FLOW_LOW."""
        payload = generate_telemetry_payload(mode="coolant_fail", device_id="sim-coolant")
        resp = self.client.post("/ingest", json=payload)
        self.assertEqual(resp.status_code, 200)

        status_resp = self.client.get(f"/api/status?device_id={CANONICAL_DEVICE_ID}")
        dev = status_resp.json()["devices"][0]
        self.assertEqual(dev["device_id"], CANONICAL_DEVICE_ID)
        self.assertEqual(dev["safety"]["overall_severity"], "CRITICAL")
        rule_ids = [v["rule_id"] for v in dev["safety"]["violations"]]
        self.assertIn("RULE_COOLANT_FLOW_LOW", rule_ids)

    def test_camera_intrusion_scenario_ingestion(self):
        """Camera intrusion scenario triggers CRITICAL RULE_PERIMETER_INTRUSION."""
        payload = generate_telemetry_payload(mode="camera_intrusion", device_id="sim-cam")
        resp = self.client.post("/ingest", json=payload)
        self.assertEqual(resp.status_code, 200)

        status_resp = self.client.get(f"/api/status?device_id={CANONICAL_DEVICE_ID}")
        dev = status_resp.json()["devices"][0]
        self.assertEqual(dev["device_id"], CANONICAL_DEVICE_ID)
        self.assertEqual(dev["safety"]["overall_severity"], "CRITICAL")
        rule_ids = [v["rule_id"] for v in dev["safety"]["violations"]]
        self.assertIn("RULE_PERIMETER_INTRUSION", rule_ids)


if __name__ == "__main__":
    unittest.main()
