"""
LaserGuard AI - Automated Ingestion API Tests
Validates the POST /ingest endpoint according to the telemetry contract.
"""

import unittest
from fastapi.testclient import TestClient
from app.main import app


class TestTelemetryIngestionContract(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    # 1. Valid HARDWARE Payload
    def test_valid_hardware_payload(self):
        payload = {
            "source": "HARDWARE",
            "device_id": "esp32-cutter-alpha",
            "timestamp": "2026-10-14T10:30:00Z",
            "readings": {
                "door_open": False,
                "flame_detected": False,
                "smoke_level": 12.5,
                "temperature_c": 28.4,
                "machine_enabled": True,
                "machine_running": True,
                "radiation_level": 0.05,
            },
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "accepted")
        self.assertEqual(data["data"]["source"], "HARDWARE")
        self.assertEqual(data["data"]["device_id"], "esp32-cutter-alpha")
        self.assertEqual(data["data"]["timestamp"], "2026-10-14T10:30:00.000000Z")
        self.assertEqual(data["data"]["readings"]["door_open"], False)
        self.assertEqual(data["data"]["readings"]["flame_detected"], False)
        self.assertEqual(data["data"]["readings"]["smoke_level"], 12.5)
        self.assertEqual(data["data"]["readings"]["temperature_c"], 28.4)
        self.assertEqual(data["data"]["readings"]["machine_enabled"], True)
        self.assertEqual(data["data"]["readings"]["machine_running"], True)
        self.assertEqual(data["data"]["readings"]["radiation_level"], 0.05)
        self.assertIn("ingested_at", data)

    # 2. Valid SIMULATOR Payload
    def test_valid_simulator_payload(self):
        payload = {
            "source": "SIMULATOR",
            "device_id": "sim-cutter-beta",
            "readings": {
                "door_open": True,
                "flame_detected": False,
                "smoke_level": 0.0,
                "temperature_c": 22.0,
                "machine_enabled": False,
                "machine_running": False,
            },
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "accepted")
        self.assertEqual(data["data"]["source"], "SIMULATOR")
        self.assertEqual(data["data"]["device_id"], "sim-cutter-beta")
        # Timestamp was omitted: verify server generated a valid UTC ISO 8601 string
        self.assertTrue(data["data"]["timestamp"].endswith("Z"))
        self.assertEqual(data["data"]["readings"]["door_open"], True)
        self.assertEqual(data["data"]["readings"]["machine_enabled"], False)

    # 3. Missing Optional Readings
    def test_missing_optional_readings_entirely(self):
        # Entire 'readings' key omitted
        payload = {
            "source": "SIMULATOR",
            "device_id": "sim-minimal-01",
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "accepted")
        # All individual readings should be None
        readings = data["data"]["readings"]
        self.assertIsNone(readings["door_open"])
        self.assertIsNone(readings["flame_detected"])
        self.assertIsNone(readings["smoke_level"])
        self.assertIsNone(readings["temperature_c"])
        self.assertIsNone(readings["machine_enabled"])
        self.assertIsNone(readings["machine_running"])
        self.assertIsNone(readings["radiation_level"])

    def test_empty_readings_object(self):
        # 'readings' passed as empty object
        payload = {
            "source": "HARDWARE",
            "device_id": "esp32-empty-readings",
            "readings": {},
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"]["readings"]["temperature_c"], None)

    def test_partial_optional_readings(self):
        # Only temperature and smoke available
        payload = {
            "source": "HARDWARE",
            "device_id": "esp32-partial",
            "readings": {
                "temperature_c": 31.5,
                "smoke_level": 4.2,
            },
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"]["readings"]["temperature_c"], 31.5)
        self.assertEqual(data["data"]["readings"]["smoke_level"], 4.2)
        self.assertIsNone(data["data"]["readings"]["door_open"])

    # 4. Missing Required Fields
    def test_missing_source_field(self):
        payload = {
            "device_id": "esp32-no-source",
            "readings": {"temperature_c": 25.0},
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_missing_device_id_field(self):
        payload = {
            "source": "HARDWARE",
            "readings": {"temperature_c": 25.0},
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_empty_or_whitespace_device_id(self):
        for invalid_id in ["", "   ", "\t"]:
            payload = {
                "source": "HARDWARE",
                "device_id": invalid_id,
            }
            response = self.client.post("/ingest", json=payload)
            self.assertEqual(response.status_code, 422)

    # 5. Invalid Source Values
    def test_invalid_source_values(self):
        for bad_source in ["MQTT", "CLOUD", "hardware", "simulator", "OTHER", 123]:
            payload = {
                "source": bad_source,
                "device_id": "test-device",
            }
            response = self.client.post("/ingest", json=payload)
            self.assertEqual(response.status_code, 422)

    # 6. Invalid Types and Negative Sensor Values
    def test_reject_string_coercion_for_boolean(self):
        # Arbitrary strings must NOT be coerced to booleans
        for bad_val in ["true", "false", "yes", "no", "1", "0", "OPEN", "CLOSED"]:
            payload = {
                "source": "HARDWARE",
                "device_id": "esp32-door-test",
                "readings": {"door_open": bad_val},
            }
            response = self.client.post("/ingest", json=payload)
            self.assertEqual(response.status_code, 422)

    def test_reject_integer_for_boolean(self):
        # Strict boolean requirement
        for bad_val in [1, 0]:
            payload = {
                "source": "HARDWARE",
                "device_id": "esp32-flame-test",
                "readings": {"flame_detected": bad_val},
            }
            response = self.client.post("/ingest", json=payload)
            self.assertEqual(response.status_code, 422)

    def test_reject_negative_smoke_level(self):
        payload = {
            "source": "SIMULATOR",
            "device_id": "sim-smoke-neg",
            "readings": {"smoke_level": -0.1},
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_reject_negative_radiation_level(self):
        payload = {
            "source": "SIMULATOR",
            "device_id": "sim-rad-neg",
            "readings": {"radiation_level": -5.0},
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_reject_string_for_temperature(self):
        payload = {
            "source": "HARDWARE",
            "device_id": "esp32-temp-str",
            "readings": {"temperature_c": "overheated"},
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_reject_invented_or_extra_sensor_fields(self):
        # Extra/uncalibrated sensors not in schema must be rejected
        payload = {
            "source": "HARDWARE",
            "device_id": "esp32-extra-sensor",
            "readings": {
                "temperature_c": 25.0,
                "uncalibrated_sensor_reading": 999.0,
            },
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 422)

    # 7. Invalid Timestamps
    def test_invalid_timestamps(self):
        for bad_ts in ["not-a-timestamp", "2026-99-99", "tomorrow", True, []]:
            payload = {
                "source": "HARDWARE",
                "device_id": "esp32-ts-test",
                "timestamp": bad_ts,
            }
            response = self.client.post("/ingest", json=payload)
            self.assertEqual(response.status_code, 422)

    def test_timestamp_timezone_normalization(self):
        # Input with offset (+05:30) must be converted to UTC ISO with 'Z'
        payload = {
            "source": "SIMULATOR",
            "device_id": "sim-tz-norm",
            "timestamp": "2026-10-14T15:30:00+05:30",
        }
        response = self.client.post("/ingest", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"]["timestamp"], "2026-10-14T10:00:00.000000Z")


if __name__ == "__main__":
    unittest.main()
