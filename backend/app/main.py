"""
LaserGuard AI - Smart Laser-Cutting Machine Safety & Monitoring System
FastAPI Backend Entry Point, Telemetry Ingestion API, Device Health Registry,
Safety Rules Engine, Blackbox Event Store, and WebSocket Live Updates
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from fastapi import FastAPI, Depends, status, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import (
    TelemetryPayload,
    TelemetryIngestResponse,
    NormalizedTelemetryFrame,
    SensorReadings,
    SystemStatusResponse,
    SystemSafetyResponse,
    EventHistoryResponse,
    SafetySeverity,
    SafetyThresholdsConfig,
    normalize_to_utc_iso,
    CANONICAL_DEVICE_ID,
)
from app.registry import DeviceRegistry, get_device_registry
from app.websocket_manager import WebSocketManager, get_ws_manager
from app.safety_engine import SafetyEngine, get_safety_engine
from app.event_store import EventStore, get_event_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifecycle management:
    Initializes database schema and starts background stale detection monitoring on startup;
    gracefully terminates tasks on shutdown.
    """
    ws_mgr = get_ws_manager()
    reg = get_device_registry()
    safety_eng = get_safety_engine()
    event_store = get_event_store()

    # Ensure SQLite database schema and indexes are initialized
    event_store.init_db()

    # Start background stale monitoring loop with safety and event store integration
    ws_mgr.start_stale_monitor(
        registry=reg,
        safety_engine=safety_eng,
        event_store=event_store,
        interval=2.0,
    )
    yield
    await ws_mgr.stop_stale_monitor()


app = FastAPI(
    title="LaserGuard AI API",
    description="Backend API, Telemetry Ingestion, Device Health Registry, Safety Rules Engine, Blackbox Event Store, and WebSocket Live Stream for LaserGuard AI",
    version="0.6.0-blackbox-event-store",
    lifespan=lifespan,
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
        "safety_endpoint": "/api/safety",
        "events_endpoint": "/api/events",
        "websocket_endpoint": "/ws/status",
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
        "version": "0.6.0-blackbox-event-store",
        "environment": "development",
        "hardware_connected": False,
        "active_source": "NONE",
        "notice": "SQLite blackbox event logging active at GET /api/events. Safety rules engine at GET /api/safety, WebSocket live stream at /ws/status, ingestion at POST /ingest. Software decision-support only; no physical hardware or e-stop actuation attached.",
    }


@app.post(
    "/ingest",
    response_model=TelemetryIngestResponse,
    status_code=status.HTTP_200_OK,
    tags=["Telemetry"],
    summary="Ingest telemetry from ESP32 hardware or simulator",
)
async def ingest_telemetry(
    payload: TelemetryPayload,
    registry: DeviceRegistry = Depends(get_device_registry),
    ws_manager: WebSocketManager = Depends(get_ws_manager),
    safety_engine: SafetyEngine = Depends(get_safety_engine),
    event_store: EventStore = Depends(get_event_store),
) -> TelemetryIngestResponse:
    """
    Ingest a telemetry frame from either physical HARDWARE (ESP32) or SIMULATOR.

    - Validates incoming payload against strict LaserGuard telemetry contract.
    - Rejects uncalibrated extra fields, invalid types, and out-of-range sensor values (HTTP 422).
    - Normalizes timestamps to standard ISO 8601 UTC representation.
    - Updates in-memory device registry with latest valid frame and server receive timestamp.
    - Evaluates safety rules and logs meaningful state transitions to the persistent SQLite blackbox.
    - Publishes updated snapshot to WebSocket clients (/ws/status).
    - Returns ingestion acknowledgement along with normalized data frame.
    """
    server_time = datetime.now(timezone.utc)
    ingested_at = normalize_to_utc_iso(server_time)
    normalized_timestamp = normalize_to_utc_iso(payload.timestamp)

    readings = payload.readings if payload.readings is not None else SensorReadings()

    # Always enforce canonical machine identity for the single-machine architecture
    normalized_frame = NormalizedTelemetryFrame(
        source=payload.source,
        device_id=CANONICAL_DEVICE_ID,
        timestamp=normalized_timestamp,
        readings=readings,
    )

    # 1. Update in-memory device registry with latest valid frame for the single machine
    registry.register_telemetry(normalized_frame, server_received_at=server_time)

    # 2. Evaluate real-time safety for the authoritative machine
    dev_status = registry.get_device_status(CANONICAL_DEVICE_ID, now=server_time)
    if dev_status:
        dev_safety = safety_engine.evaluate_device(dev_status, evaluated_at=server_time)
        dev_status.safety = dev_safety

        # 3. Record state transitions in SQLite blackbox (if meaningful transition occurred)
        try:
            event_store.process_assessment_transition(
                assessment=dev_safety,
                connectivity_state=dev_status.connectivity_state,
                timestamp=server_time,
            )
        except Exception as e:
            # Report storage error clearly rather than silently swallowing
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to record event in blackbox audit store: {str(e)}",
            )

    # 4. Asynchronously broadcast status update enriched with safety evaluation to WebSocket clients
    await ws_manager.broadcast_status(
        registry,
        safety_engine=safety_engine,
        event="telemetry_update",
    )

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
    summary="Get current registered devices, connectivity health, and safety state",
)
def get_status(
    device_id: Optional[str] = None,
    stale_threshold: Optional[float] = None,
    registry: DeviceRegistry = Depends(get_device_registry),
    safety_engine: SafetyEngine = Depends(get_safety_engine),
) -> SystemStatusResponse:
    """
    Retrieve registered devices, latest telemetry readings, connectivity state,
    and attached safety assessment.

    - Calculates ONLINE vs STALE state based on server receive timestamp.
    - Evaluates real-time safety rules for each registered device.
    - Notice: Software connectivity state does NOT guarantee physical sensor health or laser isolation.
    """
    system_status = registry.get_system_status(
        threshold=stale_threshold,
        filter_device_id=device_id,
    )
    for dev in system_status.devices:
        dev.safety = safety_engine.evaluate_device(dev)
    return system_status


@app.get(
    "/api/safety",
    response_model=SystemSafetyResponse,
    tags=["Safety"],
    summary="Get real-time safety rules assessment and fail-safe evaluation",
)
def get_safety(
    device_id: Optional[str] = None,
    high_temp_threshold: Optional[float] = None,
    smoke_threshold: Optional[float] = None,
    stale_threshold: Optional[float] = None,
    registry: DeviceRegistry = Depends(get_device_registry),
    safety_engine: SafetyEngine = Depends(get_safety_engine),
) -> SystemSafetyResponse:
    """
    Evaluate safety rules against latest telemetry for each device.

    Evaluated Rules:
    1. CRITICAL: Unauthorized running (machine_running == True and machine_enabled == False)
    2. CRITICAL: Open safety door while running (door_open == True and machine_running == True)
    3. CRITICAL: Fire detected (flame_detected == True)
    4. WARNING: High temperature (temperature_c >= threshold, default 60°C demo setting)
    5. WARNING: Elevated smoke (smoke_level >= threshold, default 50 demo setting)
    6. WARNING: Stale telemetry (connectivity_state == STALE)
    7. FAIL-SAFE: Missing required sensor readings -> STOP_RECOMMENDED / UNKNOWN
    8. NORMAL: All sensors nominal, fresh, and complete -> NORMAL_OPERATION

    Notice: Software decision-support only; does NOT trigger physical hardware relays.
    """
    thresholds = None
    if (
        high_temp_threshold is not None
        or smoke_threshold is not None
        or stale_threshold is not None
    ):
        base = safety_engine.thresholds
        thresholds = SafetyThresholdsConfig(
            high_temperature_c=high_temp_threshold
            if high_temp_threshold is not None
            else base.high_temperature_c,
            elevated_smoke=smoke_threshold
            if smoke_threshold is not None
            else base.elevated_smoke,
            stale_threshold_seconds=stale_threshold
            if stale_threshold is not None
            else base.stale_threshold_seconds,
        )

    return safety_engine.evaluate_system(
        registry=registry,
        thresholds=thresholds,
        filter_device_id=device_id,
    )


@app.get(
    "/api/events",
    response_model=EventHistoryResponse,
    tags=["Blackbox Events"],
    summary="Query persistent blackbox event audit history",
)
def get_events(
    device_id: Optional[str] = None,
    severity: Optional[str] = None,
    event_type: Optional[str] = None,
    limit: int = 50,
    before_id: Optional[int] = None,
    event_store: EventStore = Depends(get_event_store),
) -> EventHistoryResponse:
    """
    Retrieve persistent blackbox safety and connectivity event audit log.

    - Ordered newest-first (descending by event ID).
    - Supports filtering by device_id, severity (CRITICAL, WARNING, NORMAL, UNKNOWN), and event_type.
    - Pagination supported using cursor parameter 'before_id'.
    - Safe default limit of 50 (maximum 200).
    - Note: Unauthenticated read-only endpoint for hackathon demo / local runtime.
    """
    if severity and severity.upper() not in [s.value for s in SafetySeverity]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid severity '{severity}'. Allowed: {[s.value for s in SafetySeverity]}",
        )
    if limit < 1 or limit > 200:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Limit must be between 1 and 200.",
        )

    return event_store.query_events(
        device_id=device_id,
        severity=severity,
        event_type=event_type,
        limit=limit,
        before_id=before_id,
    )


@app.websocket("/ws/status")
async def websocket_status_endpoint(
    websocket: WebSocket,
    registry: DeviceRegistry = Depends(get_device_registry),
    ws_manager: WebSocketManager = Depends(get_ws_manager),
    safety_engine: SafetyEngine = Depends(get_safety_engine),
):
    """
    WebSocket endpoint broadcasting real-time system, device status, and safety updates.

    - On Connect: Delivers immediate SystemStatusResponse snapshot with safety evaluation (event='status_snapshot').
    - On Telemetry Ingestion: Broadcasts updated system status with safety evaluation (event='telemetry_update').
    - On Stale Timeout: Broadcasts transition when a device goes offline (event='stale_transition').
    - Client Messages: Accepts 'ping' (replies with 'pong') and 'refresh' (sends fresh snapshot).
    """
    await ws_manager.connect(websocket, registry, safety_engine=safety_engine)
    try:
        while True:
            client_msg = await websocket.receive_text()
            if client_msg == "ping":
                await websocket.send_json({"event": "pong"})
            elif client_msg == "refresh":
                snapshot = registry.get_system_status()
                for dev in snapshot.devices:
                    dev.safety = safety_engine.evaluate_device(dev)
                await websocket.send_json(
                    {"event": "status_snapshot", "data": snapshot.model_dump()}
                )
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
