#!/usr/bin/env python3
"""
LaserGuard AI - Software-First Telemetry Simulator
Generates calibrated and anomalous synthetic telemetry packets for LaserGuard AI.
Strictly adheres to:
- Source is ALWAYS 'SIMULATOR'.
- Ingests via HTTP POST /ingest (NO MQTT).
- Pure standard library (runs anywhere without extra dependencies).
"""

import sys
import json
import time
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Dict, Any, Optional

DEFAULT_INGEST_URL = "http://127.0.0.1:8000/ingest"
DEFAULT_DEVICE_ID = "laser-cutter-01"


def generate_telemetry_payload(
    mode: str = "nominal",
    device_id: str = DEFAULT_DEVICE_ID,
    timestamp: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Generate a validated telemetry payload matching backend Pydantic TelemetryPayload schema.
    Guaranteed: source is always 'SIMULATOR'.
    """
    if timestamp is None:
        timestamp = datetime.now(timezone.utc)

    ts_iso = timestamp.isoformat()

    # Base nominal sensor readings
    readings: Dict[str, Any] = {
        "door_open": False,
        "flame_detected": False,
        "smoke_level": 12.0,
        "temperature_c": 28.5,
        "machine_enabled": True,
        "machine_running": True,
        "water_flow_lpm": 4.5,
        "camera_intrusion_detected": False,
    }

    # Apply mode-specific conditions
    if mode == "nominal":
        pass  # All nominal

    elif mode == "door_trip":
        # CRITICAL: Door opened while laser is running
        readings["door_open"] = True
        readings["machine_running"] = True

    elif mode == "fire":
        # CRITICAL: Optical flame sensor triggered
        readings["flame_detected"] = True

    elif mode == "overheat":
        # WARNING: Chamber temperature above warning threshold (>= 60.0°C)
        readings["temperature_c"] = 74.5

    elif mode == "smoke":
        # WARNING: Elevated particulate index above warning threshold (>= 50.0)
        readings["smoke_level"] = 68.0

    elif mode == "coolant_fail":
        # CRITICAL: Coolant flow dropped below safe operating minimum (1.0 L/min) while running
        readings["water_flow_lpm"] = 0.2
        readings["machine_running"] = True

    elif mode == "camera_intrusion":
        # CRITICAL: Optical exclusion zone breached by operator hand while running
        readings["camera_intrusion_detected"] = True
        readings["machine_running"] = True

    elif mode == "idle":
        # Nominal idle state (stopped, safe)
        readings["machine_running"] = False
        readings["temperature_c"] = 22.0
        readings["smoke_level"] = 5.0
        readings["water_flow_lpm"] = 0.0

    elif mode == "unauthorized_running":
        # CRITICAL: Laser running without safety permission
        readings["machine_enabled"] = False
        readings["machine_running"] = True

    else:
        raise ValueError(f"Unknown simulation mode '{mode}'. Supported: nominal, door_trip, fire, overheat, smoke, coolant_fail, camera_intrusion, idle, unauthorized_running")

    return {
        "source": "SIMULATOR",
        "device_id": device_id,
        "timestamp": ts_iso,
        "readings": readings,
    }


def send_telemetry(payload: Dict[str, Any], url: str = DEFAULT_INGEST_URL, timeout: float = 5.0) -> Dict[str, Any]:
    """Send telemetry payload via HTTP POST to the backend /ingest endpoint."""
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data_bytes,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status_code = response.getcode()
            response_body = response.read().decode("utf-8")
            return {
                "status_code": status_code,
                "data": json.loads(response_body),
                "error": None,
            }
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {
            "status_code": e.code,
            "data": None,
            "error": f"HTTP {e.code}: {error_body}",
        }
    except urllib.error.URLError as e:
        return {
            "status_code": None,
            "data": None,
            "error": f"Connection failed to {url}: {e.reason}",
        }


def main():
    parser = argparse.ArgumentParser(
        description="LaserGuard AI Software-First Telemetry Simulator (HTTP POST Ingestion)"
    )
    parser.add_argument(
        "--mode",
        choices=["nominal", "door_trip", "fire", "overheat", "smoke", "coolant_fail", "camera_intrusion", "idle", "unauthorized_running"],
        default="nominal",
        help="Simulation scenario mode (default: nominal)",
    )
    parser.add_argument(
        "--device-id",
        default=DEFAULT_DEVICE_ID,
        help=f"Simulator device identifier (default: {DEFAULT_DEVICE_ID})",
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_INGEST_URL,
        help=f"Backend ingestion endpoint URL (default: {DEFAULT_INGEST_URL})",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=1,
        help="Number of telemetry frames to dispatch (default: 1; use 0 for infinite loop)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Seconds between consecutive frames in loop mode (default: 1.0)",
    )

    args = parser.parse_args()

    print(f"[LaserGuard AI Simulator] Initialized.")
    print(f"  Target: {args.url}")
    print(f"  Source: SIMULATOR (Enforced)")
    print(f"  Device: {args.device_id}")
    print(f"  Mode:   {args.mode.upper()}")
    print("-" * 50)

    sent_count = 0
    try:
        while True:
            payload = generate_telemetry_payload(mode=args.mode, device_id=args.device_id)
            result = send_telemetry(payload, url=args.url)

            if result["error"]:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Frame #{sent_count + 1} FAILED: {result['error']}")
            else:
                resp = result["data"]
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Frame #{sent_count + 1} ACCEPTED (HTTP {result['status_code']}) -> State: {resp.get('status')}")

            sent_count += 1
            if args.count > 0 and sent_count >= args.count:
                break

            time.sleep(args.interval)

    except KeyboardInterrupt:
        print("\n[LaserGuard AI Simulator] Stopped by operator.")

    print(f"[LaserGuard AI Simulator] Finished. Dispatched {sent_count} frames.")


if __name__ == "__main__":
    main()
