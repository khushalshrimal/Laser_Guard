"""
LaserGuard AI - Automated WebSocket Live Telemetry Tests
Validates connection lifecycle, initial snapshot delivery, live /ingest broadcasts,
multi-client distribution, disconnection resilience, and stale transitions.
"""

import unittest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.registry import default_device_registry
from app.websocket_manager import default_ws_manager


class TestWebSocketTelemetryUpdates(unittest.TestCase):
    def setUp(self):
        default_device_registry.clear()
        default_ws_manager.clear()
        self.client = TestClient(app)

    def tearDown(self):
        default_device_registry.clear()
        default_ws_manager.clear()

    # 1. Connection and Initial Status Snapshot
    def test_ws_connection_and_initial_snapshot(self):
        with self.client.websocket_connect("/ws/status") as ws:
            initial = ws.receive_json()
            self.assertEqual(initial["event"], "status_snapshot")
            self.assertEqual(initial["data"]["status"], "ok")
            self.assertEqual(initial["data"]["device_count"], 0)
            self.assertEqual(initial["data"]["devices"], [])
            self.assertIn("server_time", initial["data"])
            self.assertIn("disclaimer", initial["data"])

    # 2. Valid Ingest Request Produces Live WebSocket Update
    def test_valid_ingest_triggers_broadcast(self):
        with self.client.websocket_connect("/ws/status") as ws:
            # Drain initial snapshot
            initial = ws.receive_json()
            self.assertEqual(initial["event"], "status_snapshot")

            # Post valid telemetry to /ingest
            payload = {
                "source": "HARDWARE",
                "device_id": "esp32-live-01",
                "readings": {
                    "door_open": False,
                    "flame_detected": False,
                    "smoke_level": 7.2,
                    "temperature_c": 29.1,
                    "machine_enabled": True,
                    "machine_running": True,
                },
            }
            res = self.client.post("/ingest", json=payload)
            self.assertEqual(res.status_code, 200)

            # Receive broadcasted update on WebSocket
            update = ws.receive_json()
            self.assertEqual(update["event"], "telemetry_update")
            self.assertEqual(update["data"]["device_count"], 1)

            dev = update["data"]["devices"][0]
            self.assertEqual(dev["device_id"], "esp32-live-01")
            self.assertEqual(dev["source"], "HARDWARE")
            self.assertEqual(dev["connectivity_state"], "ONLINE")
            self.assertEqual(dev["latest_readings"]["temperature_c"], 29.1)
            self.assertEqual(dev["latest_readings"]["smoke_level"], 7.2)
            self.assertIn("disclaimer", update["data"])

    # 3. Source Distinction: HARDWARE and SIMULATOR Preserved
    def test_source_labels_preserved_in_broadcast(self):
        with self.client.websocket_connect("/ws/status") as ws:
            ws.receive_json()  # Consume initial snapshot

            # Send HARDWARE
            self.client.post(
                "/ingest",
                json={
                    "source": "HARDWARE",
                    "device_id": "esp32-hw",
                    "readings": {"temperature_c": 32.0},
                },
            )
            update_hw = ws.receive_json()
            devs_hw = {d["device_id"]: d for d in update_hw["data"]["devices"]}
            self.assertEqual(devs_hw["esp32-hw"]["source"], "HARDWARE")

            # Send SIMULATOR
            self.client.post(
                "/ingest",
                json={
                    "source": "SIMULATOR",
                    "device_id": "sim-soft",
                    "readings": {"door_open": True},
                },
            )
            update_sim = ws.receive_json()
            devs_sim = {d["device_id"]: d for d in update_sim["data"]["devices"]}
            self.assertEqual(devs_sim["sim-soft"]["source"], "SIMULATOR")
            self.assertEqual(devs_sim["esp32-hw"]["source"], "HARDWARE")

    # 4. Invalid Ingestion Does Not Broadcast or Corrupt Stored State
    def test_invalid_ingest_does_not_broadcast(self):
        with self.client.websocket_connect("/ws/status") as ws:
            ws.receive_json()  # Consume initial snapshot

            # Send bad payload (negative smoke, string boolean)
            bad_payload = {
                "source": "HARDWARE",
                "device_id": "esp32-invalid",
                "readings": {"smoke_level": -10.0, "door_open": "not_a_bool"},
            }
            res_bad = self.client.post("/ingest", json=bad_payload)
            self.assertEqual(res_bad.status_code, 422)

            # Send a valid payload to verify the next message is for the valid one
            valid_payload = {
                "source": "HARDWARE",
                "device_id": "esp32-valid-after",
                "readings": {"temperature_c": 22.5},
            }
            res_valid = self.client.post("/ingest", json=valid_payload)
            self.assertEqual(res_valid.status_code, 200)

            # The only broadcast received must be for the valid payload
            update = ws.receive_json()
            self.assertEqual(update["event"], "telemetry_update")
            self.assertEqual(update["data"]["device_count"], 1)
            self.assertEqual(update["data"]["devices"][0]["device_id"], "esp32-valid-after")

    # 5. Multiple Clients Receive Live Updates Concurrently
    def test_multiple_clients_receive_updates(self):
        with self.client.websocket_connect("/ws/status") as ws1:
            with self.client.websocket_connect("/ws/status") as ws2:
                # Both receive initial snapshots
                s1 = ws1.receive_json()
                s2 = ws2.receive_json()
                self.assertEqual(s1["event"], "status_snapshot")
                self.assertEqual(s2["event"], "status_snapshot")

                # Ingest payload
                self.client.post(
                    "/ingest",
                    json={
                        "source": "SIMULATOR",
                        "device_id": "multi-cutter",
                        "readings": {"temperature_c": 26.0},
                    },
                )

                # Both receive the update
                u1 = ws1.receive_json()
                u2 = ws2.receive_json()
                self.assertEqual(u1["event"], "telemetry_update")
                self.assertEqual(u2["event"], "telemetry_update")
                self.assertEqual(u1["data"]["devices"][0]["device_id"], "multi-cutter")
                self.assertEqual(u2["data"]["devices"][0]["device_id"], "multi-cutter")

    # 6. Disconnecting One Client Does Not Break Ingestion or Other Clients
    def test_client_disconnect_resilience(self):
        with self.client.websocket_connect("/ws/status") as ws1:
            # Connect and immediately disconnect a second client
            with self.client.websocket_connect("/ws/status") as ws2:
                ws2.receive_json()

            # ws2 is now closed; ws1 is still alive
            ws1.receive_json()  # ws1 initial snapshot

            # Ingest payload: server must not crash trying to send to ws2
            res = self.client.post(
                "/ingest",
                json={
                    "source": "HARDWARE",
                    "device_id": "esp32-resilient",
                    "readings": {"smoke_level": 3.0},
                },
            )
            self.assertEqual(res.status_code, 200)

            # ws1 successfully receives the update
            update = ws1.receive_json()
            self.assertEqual(update["event"], "telemetry_update")
            self.assertEqual(update["data"]["devices"][0]["device_id"], "esp32-resilient")

    # 7. Ping / Pong and Manual Refresh Messages
    def test_ping_pong_and_refresh(self):
        with self.client.websocket_connect("/ws/status") as ws:
            ws.receive_json()  # Snapshot

            # Test ping
            ws.send_text("ping")
            pong = ws.receive_json()
            self.assertEqual(pong["event"], "pong")

            # Test refresh
            ws.send_text("refresh")
            refresh_msg = ws.receive_json()
            self.assertEqual(refresh_msg["event"], "status_snapshot")
            self.assertEqual(refresh_msg["data"]["status"], "ok")

    # 8. Deterministic Stale Transition Broadcast
    def test_stale_transition_broadcast(self):
        with self.client.websocket_connect("/ws/status") as ws:
            ws.receive_json()  # Snapshot

            t0 = datetime(2026, 10, 14, 11, 0, 0, tzinfo=timezone.utc)
            # Ingest device at t0
            self.client.post(
                "/ingest",
                json={
                    "source": "HARDWARE",
                    "device_id": "esp32-stale-detector",
                    "timestamp": "2026-10-14T11:00:00Z",
                    "readings": {"temperature_c": 25.0},
                },
            )
            ws.receive_json()  # telemetry_update

            # Advance time by 15 seconds (exceeding default 10s threshold)
            t_stale = t0 + timedelta(seconds=15)
            import asyncio
            transitioned = asyncio.run(
                default_ws_manager.check_and_broadcast_stale(default_device_registry, now=t_stale)
            )
            self.assertTrue(transitioned)

            stale_msg = ws.receive_json()
            self.assertEqual(stale_msg["event"], "stale_transition")
            dev = stale_msg["data"]["devices"][0]
            self.assertEqual(dev["device_id"], "esp32-stale-detector")
            self.assertEqual(dev["connectivity_state"], "STALE")


if __name__ == "__main__":
    unittest.main()
