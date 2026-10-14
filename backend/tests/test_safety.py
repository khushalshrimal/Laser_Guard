"""
LaserGuard AI - Automated Safety Rules Engine Tests
Validates the 8 safety rules, severity precedence, fail-safe recommendations,
threshold boundaries, GET /api/safety, and WebSocket safety enrichment.
"""

import unittest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.registry import default_device_registry
from app.websocket_manager import default_ws_manager
from app.safety_engine import (
    SafetyEngine,
    default_safety_engine,
    parse_threshold_env,
    RULE_UNAUTHORIZED_RUNNING,
    RULE_DOOR_OPEN_WHILE_RUNNING,
    RULE_FIRE_DETECTED,
    RULE_HIGH_TEMPERATURE,
    RULE_ELEVATED_SMOKE,
    RULE_STALE_TELEMETRY,
    RULE_MISSING_READINGS,
    RULE_COOLANT_FLOW_LOW,
    RULE_PERIMETER_INTRUSION,
)
from app.schemas import (
    SafetySeverity,
    RecommendedMachineState,
    SafetyThresholdsConfig,
    SensorReadings,
    DeviceStatus,
    TelemetrySource,
    ConnectivityState,
    CANONICAL_DEVICE_ID,
)


class TestSafetyRulesEngine(unittest.TestCase):
    def setUp(self):
        default_device_registry.clear()
        default_ws_manager.clear()
        self.client = TestClient(app)
        self.engine = SafetyEngine()

    def tearDown(self):
        default_device_registry.clear()
        default_ws_manager.clear()

    # --- Unit Tests on SafetyEngine Direct Logic ---

    def _create_nominal_readings(self) -> SensorReadings:
        return SensorReadings(
            door_open=False,
            flame_detected=False,
            smoke_level=10.0,
            temperature_c=25.0,
            machine_enabled=True,
            machine_running=True,
        )

    def _create_nominal_status(self, device_id: str = "dev-1") -> DeviceStatus:
        return DeviceStatus(
            device_id=device_id,
            source=TelemetrySource.HARDWARE,
            connectivity_state=ConnectivityState.ONLINE,
            last_seen="2026-10-14T10:00:00.000000Z",
            seconds_since_last_seen=1.0,
            stale_threshold_seconds=10.0,
            latest_readings=self._create_nominal_readings(),
        )

    # 1. Rule 8: Normal Telemetry
    def test_rule_normal_telemetry(self):
        status = self._create_nominal_status()
        assessment = self.engine.evaluate_device(status)

        self.assertEqual(assessment.overall_severity, SafetySeverity.NORMAL)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.NORMAL_OPERATION)
        self.assertEqual(len(assessment.violations), 0)
        self.assertFalse(assessment.stale)

    # 2. Rule 1: CRITICAL — Unauthorized Running
    def test_rule_unauthorized_running(self):
        readings = self._create_nominal_readings()
        readings.machine_running = True
        readings.machine_enabled = False  # Disabled interlock while running

        status = self._create_nominal_status()
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.CRITICAL)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_UNAUTHORIZED_RUNNING, v_ids)

    # 3. Rule 2: CRITICAL — Open Safety Door While Running
    def test_rule_door_open_while_running(self):
        readings = self._create_nominal_readings()
        readings.door_open = True
        readings.machine_running = True

        status = self._create_nominal_status()
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.CRITICAL)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_DOOR_OPEN_WHILE_RUNNING, v_ids)

    def test_door_open_while_idle_is_not_critical(self):
        # When machine is NOT running, opening the door to load materials is normal operator behavior
        readings = self._create_nominal_readings()
        readings.door_open = True
        readings.machine_running = False

        status = self._create_nominal_status()
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.NORMAL)
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertNotIn(RULE_DOOR_OPEN_WHILE_RUNNING, v_ids)

    # 4. Rule 3: CRITICAL — Fire Detected
    def test_rule_fire_detected(self):
        readings = self._create_nominal_readings()
        readings.flame_detected = True

        status = self._create_nominal_status()
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.CRITICAL)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_FIRE_DETECTED, v_ids)

    # 5. Rule 4: WARNING — High Temperature
    def test_rule_high_temperature(self):
        readings = self._create_nominal_readings()
        readings.temperature_c = 65.0  # Above default 60.0°C

        status = self._create_nominal_status()
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.WARNING)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.INVESTIGATION_RECOMMENDED)
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_HIGH_TEMPERATURE, v_ids)

    # 6. Rule 5: WARNING — Elevated Smoke
    def test_rule_elevated_smoke(self):
        readings = self._create_nominal_readings()
        readings.smoke_level = 58.0  # Above default 50.0

        status = self._create_nominal_status()
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.WARNING)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.INVESTIGATION_RECOMMENDED)
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_ELEVATED_SMOKE, v_ids)

    # 7. Rule 6: WARNING — Stale Telemetry Overrides Normal Readings
    def test_rule_stale_telemetry_overrides_normal(self):
        # Readings themselves look completely clean and nominal
        status = self._create_nominal_status()
        status.connectivity_state = ConnectivityState.STALE
        status.seconds_since_last_seen = 25.0

        assessment = self.engine.evaluate_device(status)
        # Stale reading MUST NOT be treated as proof of safety!
        self.assertNotEqual(assessment.overall_severity, SafetySeverity.NORMAL)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_STALE_TELEMETRY, v_ids)
        self.assertTrue(assessment.stale)

    # 8. Rule 7: FAIL-SAFE — Missing Required Sensor Readings
    def test_rule_missing_readings_failsafe(self):
        # Empty readings: all sensors missing
        empty_readings = SensorReadings()
        status = self._create_nominal_status()
        status.latest_readings = empty_readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.UNKNOWN)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_MISSING_READINGS, v_ids)

    # 9. Multiple Simultaneous Hazards & Severity Precedence
    def test_multiple_hazards_severity_precedence(self):
        readings = self._create_nominal_readings()
        readings.temperature_c = 75.0       # WARNING
        readings.smoke_level = 80.0         # WARNING
        readings.door_open = True           # CRITICAL (while running)
        readings.flame_detected = True      # CRITICAL

        status = self._create_nominal_status()
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        # CRITICAL takes precedence over WARNING
        self.assertEqual(assessment.overall_severity, SafetySeverity.CRITICAL)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        # All 4 triggered rules must be listed
        v_ids = [v.rule_id for v in assessment.violations]
        self.assertEqual(len(v_ids), 4)
        self.assertIn(RULE_DOOR_OPEN_WHILE_RUNNING, v_ids)
        self.assertIn(RULE_FIRE_DETECTED, v_ids)
        self.assertIn(RULE_HIGH_TEMPERATURE, v_ids)
        self.assertIn(RULE_ELEVATED_SMOKE, v_ids)

    # 10. Threshold Boundaries
    def test_threshold_boundaries(self):
        status = self._create_nominal_status()
        custom_cfg = SafetyThresholdsConfig(high_temperature_c=60.0, elevated_smoke=50.0)

        # 59.9°C: below threshold -> no violation
        status.latest_readings.temperature_c = 59.9
        a1 = self.engine.evaluate_device(status, thresholds=custom_cfg)
        self.assertEqual(a1.overall_severity, SafetySeverity.NORMAL)

        # 60.0°C: exactly at threshold -> triggers warning
        status.latest_readings.temperature_c = 60.0
        a2 = self.engine.evaluate_device(status, thresholds=custom_cfg)
        self.assertEqual(a2.overall_severity, SafetySeverity.WARNING)

        # Smoke boundary: 49.9 -> normal, 50.0 -> warning
        status.latest_readings.temperature_c = 25.0
        status.latest_readings.smoke_level = 49.9
        a3 = self.engine.evaluate_device(status, thresholds=custom_cfg)
        self.assertEqual(a3.overall_severity, SafetySeverity.NORMAL)

        status.latest_readings.smoke_level = 50.0
        a4 = self.engine.evaluate_device(status, thresholds=custom_cfg)
        self.assertEqual(a4.overall_severity, SafetySeverity.WARNING)

    # 11. Environment Variable Parsing Validation
    def test_parse_threshold_env_validation(self):
        # Safe fallback on invalid/negative bounds
        import os
        os.environ["TEST_INVALID_TH"] = "-50"
        val = parse_threshold_env("TEST_INVALID_TH", default=60.0, min_val=0.0, max_val=500.0)
        self.assertEqual(val, 60.0)

        os.environ["TEST_STR_TH"] = "not_a_number"
        val_str = parse_threshold_env("TEST_STR_TH", default=50.0, min_val=0.0, max_val=1000.0)
        self.assertEqual(val_str, 50.0)

    # --- HTTP API GET /api/safety Tests ---

    # 12. Empty Registry Behavior for GET /api/safety
    def test_api_safety_empty_registry(self):
        res = self.client.get("/api/safety")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["device_count"], 0)
        self.assertEqual(data["overall_system_severity"], "NORMAL")
        self.assertEqual(data["assessments"], [])
        self.assertIn("thresholds", data)
        self.assertIn("disclaimer", data)

    # 13. Populated Safety Evaluation and Source Preservation
    def test_api_safety_populated_and_sources(self):
        # Ingest HARDWARE device with fire hazard
        self.client.post(
            "/ingest",
            json={
                "source": "HARDWARE",
                "device_id": "esp32-safety-fire",
                "readings": {
                    "door_open": False,
                    "flame_detected": True,
                    "smoke_level": 80.0,
                    "temperature_c": 95.0,
                    "machine_enabled": True,
                    "machine_running": True,
                },
            },
        )

        # Ingest SIMULATOR device with nominal readings (force override)
        self.client.post(
            "/ingest?force=true",
            json={
                "source": "SIMULATOR",
                "device_id": "sim-safety-nominal",
                "readings": {
                    "door_open": False,
                    "flame_detected": False,
                    "smoke_level": 5.0,
                    "temperature_c": 22.0,
                    "machine_enabled": True,
                    "machine_running": False,
                },
            },
        )

        res = self.client.get("/api/safety")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["device_count"], 1)
        self.assertEqual(data["overall_system_severity"], "NORMAL")

        assessment = data["assessments"][0]
        self.assertEqual(assessment["source"], "SIMULATOR")
        self.assertEqual(assessment["overall_severity"], "NORMAL")
        self.assertEqual(assessment["recommended_state"], "NORMAL_OPERATION")

    # 14. Filter by Device ID on GET /api/safety
    def test_api_safety_filter_device_id(self):
        self.client.post(
            "/ingest",
            json={
                "source": "HARDWARE",
                "device_id": "target-device",
                "readings": {"flame_detected": True},
            },
        )
        self.client.post(
            "/ingest",
            json={
                "source": "HARDWARE",
                "device_id": "other-device",
                "readings": {"flame_detected": False},
            },
        )

        res = self.client.get(f"/api/safety?device_id={CANONICAL_DEVICE_ID}")
        data = res.json()
        self.assertEqual(data["device_count"], 1)
        self.assertEqual(data["assessments"][0]["device_id"], CANONICAL_DEVICE_ID)

        res_none = self.client.get("/api/safety?device_id=nonexistent")
        self.assertEqual(res_none.json()["device_count"], 0)

    # 15. Invalid Ingestion Does Not Corrupt Safety State
    def test_invalid_ingestion_preserves_safety_assessment(self):
        # Valid ingestion with nominal state
        self.client.post(
            "/ingest",
            json={
                "source": "SIMULATOR",
                "device_id": "sim-corrupt-test",
                "readings": {
                    "door_open": False,
                    "flame_detected": False,
                    "smoke_level": 5.0,
                    "temperature_c": 22.0,
                    "machine_enabled": True,
                    "machine_running": False,
                },
            },
        )
        before = self.client.get(f"/api/safety?device_id={CANONICAL_DEVICE_ID}").json()
        self.assertEqual(before["assessments"][0]["overall_severity"], "NORMAL")

        # Send invalid ingestion (HTTP 422)
        bad_res = self.client.post(
            "/ingest",
            json={
                "source": "SIMULATOR",
                "device_id": "sim-corrupt-test",
                "readings": {"smoke_level": -99.0},
            },
        )
        self.assertEqual(bad_res.status_code, 422)

        # Assessment remains NORMAL and uncorrupted
        after = self.client.get(f"/api/safety?device_id={CANONICAL_DEVICE_ID}").json()
        self.assertEqual(after["assessments"][0]["overall_severity"], "NORMAL")

    # 16. WebSocket Live Stream Enriched with Safety Assessment
    def test_websocket_includes_safety_assessment(self):
        with self.client.websocket_connect("/ws/status") as ws:
            ws.receive_json()  # initial snapshot

            # Send telemetry triggering a safety hazard
            self.client.post(
                "/ingest",
                json={
                    "source": "HARDWARE",
                    "device_id": "esp32-ws-hazard",
                    "readings": {
                        "door_open": True,
                        "machine_running": True,  # CRITICAL hazard
                        "flame_detected": False,
                        "smoke_level": 10.0,
                        "temperature_c": 25.0,
                        "machine_enabled": True,
                    },
                },
            )

            update = ws.receive_json()
            self.assertEqual(update["event"], "telemetry_update")
            dev = update["data"]["devices"][0]
            self.assertEqual(dev["device_id"], CANONICAL_DEVICE_ID)
            self.assertIsNotNone(dev.get("safety"))
            self.assertEqual(dev["safety"]["overall_severity"], "CRITICAL")
            self.assertEqual(dev["safety"]["recommended_state"], "STOP_RECOMMENDED")

    # 17. Coolant Water Flow Low Rule (YF-S201)
    def test_coolant_flow_low_rule(self):
        # Machine running with flow < 1.0 L/min -> CRITICAL
        readings = self._create_nominal_readings()
        readings.water_flow_lpm = 0.5  # Below 1.0 L/min
        status = self._create_nominal_status("cutter-coolant")
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.CRITICAL)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        rule_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_COOLANT_FLOW_LOW, rule_ids)

        # Machine idle with flow = 0.0 -> Nominal (no flow needed when laser is idle)
        readings_idle = self._create_nominal_readings()
        readings_idle.machine_running = False
        readings_idle.water_flow_lpm = 0.0
        status_idle = self._create_nominal_status("cutter-idle")
        status_idle.latest_readings = readings_idle

        assessment_idle = self.engine.evaluate_device(status_idle)
        rule_ids_idle = [v.rule_id for v in assessment_idle.violations]
        self.assertNotIn(RULE_COOLANT_FLOW_LOW, rule_ids_idle)

    # 18. Optical Perimeter Intrusion Rule (Camera)
    def test_camera_intrusion_rule(self):
        # Intrusion detected while running -> CRITICAL
        readings = self._create_nominal_readings()
        readings.camera_intrusion_detected = True
        status = self._create_nominal_status("cutter-cam")
        status.latest_readings = readings

        assessment = self.engine.evaluate_device(status)
        self.assertEqual(assessment.overall_severity, SafetySeverity.CRITICAL)
        self.assertEqual(assessment.recommended_state, RecommendedMachineState.STOP_RECOMMENDED)
        rule_ids = [v.rule_id for v in assessment.violations]
        self.assertIn(RULE_PERIMETER_INTRUSION, rule_ids)

        # Intrusion detected while machine is idle -> WARNING
        readings_idle = self._create_nominal_readings()
        readings_idle.machine_running = False
        readings_idle.camera_intrusion_detected = True
        status_idle = self._create_nominal_status("cutter-cam-idle")
        status_idle.latest_readings = readings_idle

        assessment_idle = self.engine.evaluate_device(status_idle)
        self.assertEqual(assessment_idle.overall_severity, SafetySeverity.WARNING)
        rule_ids_idle = [v.rule_id for v in assessment_idle.violations]
        self.assertIn(RULE_PERIMETER_INTRUSION, rule_ids_idle)


if __name__ == "__main__":
    unittest.main()

