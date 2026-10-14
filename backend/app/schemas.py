"""
LaserGuard AI - Telemetry Ingestion Schemas and Contracts
Defines validated data models shared between HARDWARE (ESP32) and SIMULATOR.
"""

from enum import Enum
from typing import Optional, Any, List
from datetime import datetime, timezone
from pydantic import BaseModel, Field, StrictBool, ConfigDict, field_validator


class TelemetrySource(str, Enum):
    """
    Identifies the origin of incoming telemetry frames.
    - HARDWARE: Physical ESP32 microcontroller sending sensor readings via HTTP POST.
    - SIMULATOR: Software simulator generating synthetic physical and safety test frames.
    """
    HARDWARE = "HARDWARE"
    SIMULATOR = "SIMULATOR"


class ConnectivityState(str, Enum):
    """
    Device connectivity state determined by elapsed time since last server ingestion.
    - ONLINE: Device has transmitted valid telemetry within the stale threshold.
    - STALE: Device has not communicated within the stale threshold window.
    Note: Software connectivity indicator only. Does not guarantee physical sensor health.
    """
    ONLINE = "ONLINE"
    STALE = "STALE"


class SensorReadings(BaseModel):
    """
    Optional sensor readings reported by an industrial laser cutter monitor.
    All readings are strictly typed and optional; uninstalled sensors evaluate to None.
    Unknown extra fields are forbidden to reject uncalibrated or unrecognized data.
    """
    model_config = ConfigDict(extra="forbid")

    door_open: Optional[StrictBool] = Field(
        default=None,
        description="Protective enclosure safety door / interlock status. True if open/broken, False if closed/secure. Unit: Boolean."
    )
    flame_detected: Optional[StrictBool] = Field(
        default=None,
        description="Optical flame sensor detection state. True if active flame or fire detected, False if nominal. Unit: Boolean."
    )
    smoke_level: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Smoke or particulate concentration index. Unit: Obscuration index / analog ADC / PPM (non-negative scale >= 0.0)."
    )
    temperature_c: Optional[float] = Field(
        default=None,
        ge=-40.0,
        le=500.0,
        description="Laser chamber, focus lens, or workpiece ambient temperature. Unit: Degrees Celsius (°C)."
    )
    machine_enabled: Optional[StrictBool] = Field(
        default=None,
        description="Safety interlock authorization state. True if system is armed and permitted to fire, False if interlocked. Unit: Boolean."
    )
    machine_running: Optional[StrictBool] = Field(
        default=None,
        description="Laser cutting operation state. True if the laser beam is actively cutting/firing, False if idle. Unit: Boolean."
    )
    radiation_level: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Optional future optical / scattered radiation reading (e.g. µW/cm²). Non-negative >= 0.0. (Placeholder for compatible future sensor; does not imply physical hardware exists)."
    )


class TelemetryPayload(BaseModel):
    """
    Ingestion payload expected at POST /ingest from ESP32 hardware or simulator.
    """
    model_config = ConfigDict(extra="forbid")

    source: TelemetrySource = Field(
        ...,
        description="Source identifier: must be exactly 'HARDWARE' or 'SIMULATOR'."
    )
    device_id: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Non-empty unique hardware or simulator device identifier (e.g., 'esp32-cutter-01')."
    )
    timestamp: Optional[datetime] = Field(
        default=None,
        description="Optional client timestamp in ISO 8601 format. If omitted or null, the server generates a UTC timestamp upon ingestion."
    )
    readings: Optional[SensorReadings] = Field(
        default_factory=SensorReadings,
        description="Dictionary of optional sensor readings. May be empty if device has no active sensors."
    )

    @field_validator("device_id")
    @classmethod
    def validate_device_id(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("device_id must not be empty or blank whitespace")
        return cleaned

    @field_validator("readings", mode="before")
    @classmethod
    def set_default_readings(cls, v: Any) -> Any:
        if v is None:
            return {}
        return v


class NormalizedTelemetryFrame(BaseModel):
    """
    Normalized telemetry frame produced after ingestion validation.
    Timestamp is guaranteed to be a standardized UTC ISO 8601 string.
    """
    source: TelemetrySource
    device_id: str
    timestamp: str = Field(description="Normalized ISO 8601 UTC timestamp (YYYY-MM-DDTHH:MM:SS.ffffffZ)")
    readings: SensorReadings


class TelemetryIngestResponse(BaseModel):
    """
    Response model returned by POST /ingest acknowledging valid ingestion.
    """
    status: str = Field(default="accepted", description="Status indicator ('accepted')")
    message: str = Field(
        default="Telemetry frame ingested and normalized successfully",
        description="Human-readable processing confirmation"
    )
    ingested_at: str = Field(description="Server UTC timestamp when payload was received")
    data: NormalizedTelemetryFrame = Field(description="Normalized accepted payload")


class DeviceStatus(BaseModel):
    """
    Status and latest state for an individual tracked device.
    """
    device_id: str = Field(description="Unique device identifier")
    source: TelemetrySource = Field(description="Origin source: HARDWARE or SIMULATOR")
    connectivity_state: ConnectivityState = Field(description="ONLINE or STALE")
    last_seen: str = Field(description="Server UTC timestamp when last valid telemetry was received (ISO 8601)")
    seconds_since_last_seen: float = Field(description="Elapsed seconds since last server reception")
    stale_threshold_seconds: float = Field(description="Active stale detection threshold in seconds")
    latest_readings: SensorReadings = Field(description="Latest valid sensor readings reported by this device")


class SystemStatusResponse(BaseModel):
    """
    Response schema for GET /api/status returning registry overview and all devices.
    """
    status: str = Field(default="ok", description="API status indicator")
    server_time: str = Field(description="Current server UTC timestamp")
    stale_threshold_seconds: float = Field(description="Active stale detection threshold in seconds")
    device_count: int = Field(description="Total number of registered devices")
    devices: List[DeviceStatus] = Field(description="List of tracked devices and their connectivity state")
    disclaimer: str = Field(
        default="Software connectivity state only. Does not guarantee physical sensor health or hardware interlock engagement.",
        description="Safety notice regarding software connectivity state"
    )


def normalize_to_utc_iso(dt: Optional[datetime]) -> str:
    """
    Normalize an optional datetime into a standardized ISO 8601 UTC string.
    If dt is None, generates current UTC timestamp.
    If dt is naive (no timezone), assumes UTC.
    If dt is timezone-aware, converts to UTC.
    """
    if dt is None:
        dt = datetime.now(timezone.utc)
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
