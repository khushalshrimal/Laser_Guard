"""
LaserGuard AI - Smart Laser-Cutting Machine Safety & Monitoring System
FastAPI Backend Entry Point, Telemetry Ingestion API, and Device Health Registry
"""

from datetime import datetime, timezone
from typing import Dict, Any, Optional
from fastapi import FastAPI, Depends, status
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import (
    TelemetryPayload,
    TelemetryIngestResponse,
    NormalizedTelemetryFrame,
    SensorReadings,
    SystemStatusResponse,
    normalize_to_utc_iso,
)
from app.registry import DeviceRegistry, get_device_registry

app = FastAPI(
    title="LaserGuard AI API",
    description="Backend API, Telemetry Ingestion, and Device Health Registry for LaserGuard AI Smart Laser-Cutting Machine Safety System",
    version="0.3.0-device-health",
)

# Enable CORS for local development with frontend
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["Root"])
def read_root() -> Dict[str, Any]:
    """Root endpoint welcoming clients to LaserGuard AI API."""
    return {
        "app": "LaserGuard AI",
        "tagline": "Smart Laser-Cutting Machine Safety & Monitoring System",
        "docs_url": "/docs",
        "health_check": "/health",
        "ingest_endpoint": "/ingest",
        "status_endpoint": "/api/status",
        "status": "online",
    }


@app.get("/health", tags=["Health"])
def get_health() -> Dict[str, Any]:
    """
    Health check endpoint returning application identity, health status,
    and milestone operating notice.
    """
    return {
        "status": "healthy",
        "app": "LaserGuard AI",
        "version": "0.3.0-device-health",
        "environment": "development",
        "hardware_connected": False,
        "active_source": "NONE",
        "notice": "Device health registry active. Real-time telemetry ingestion online at POST /ingest and status tracking at GET /api/status. No physical hardware or e-stop actuation attached.",
    }


@app.post(
    "/ingest",
    response_model=TelemetryIngestResponse,
    status_code=status.HTTP_200_OK,
    tags=["Telemetry"],
    summary="Ingest telemetry from ESP32 hardware or simulator",
)
def ingest_telemetry(
    payload: TelemetryPayload,
    registry: DeviceRegistry = Depends(get_device_registry),
) -> TelemetryIngestResponse:
    """
    Ingest a telemetry frame from either physical HARDWARE (ESP32) or SIMULATOR.

    - Validates incoming payload against strict LaserGuard telemetry contract.
    - Rejects uncalibrated extra fields, invalid types, and out-of-range sensor values (HTTP 422).
    - Normalizes timestamps to standard ISO 8601 UTC representation.
    - Updates in-memory device registry with latest valid frame and server receive timestamp.
    - Returns ingestion acknowledgement along with normalized data frame.

    Safety Notice: Persistence and automated interlock decisions will be attached
    in subsequent milestones.
    """
    server_time = datetime.now(timezone.utc)
    ingested_at = normalize_to_utc_iso(server_time)
    normalized_timestamp = normalize_to_utc_iso(payload.timestamp)

    readings = payload.readings if payload.readings is not None else SensorReadings()

    normalized_frame = NormalizedTelemetryFrame(
        source=payload.source,
        device_id=payload.device_id,
        timestamp=normalized_timestamp,
        readings=readings,
    )

    # Update in-memory device registry with latest valid frame
    registry.register_telemetry(normalized_frame, server_received_at=server_time)

    return TelemetryIngestResponse(
        status="accepted",
        message="Telemetry frame ingested and normalized successfully",
        ingested_at=ingested_at,
        data=normalized_frame,
    )


@app.get(
    "/api/status",
    response_model=SystemStatusResponse,
    tags=["Status"],
    summary="Get current registered devices and connectivity health",
)
def get_status(
    device_id: Optional[str] = None,
    stale_threshold: Optional[float] = None,
    registry: DeviceRegistry = Depends(get_device_registry),
) -> SystemStatusResponse:
    """
    Retrieve registered devices, latest telemetry readings, and connectivity state.

    - Calculates ONLINE vs STALE state based on server receive timestamp.
    - Devices that have never sent data are not falsely reported as online.
    - Registry resets when the server process restarts (in-memory).
    - Notice: Software connectivity state does NOT guarantee physical sensor health or laser isolation.
    """
    return registry.get_system_status(
        threshold=stale_threshold,
        filter_device_id=device_id,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
