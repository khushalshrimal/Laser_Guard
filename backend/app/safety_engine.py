"""
LaserGuard AI - Safety Rules Engine & Fail-Safe Evaluation
Evaluates real-time telemetry against industrial laser cutting safety rules
and produces structured, deterministic safety assessments and recommended states.
"""

import os
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone

from app.schemas import (
    SafetySeverity,
    RecommendedMachineState,
    SafetyViolation,
    SafetyThresholdsConfig,
    DeviceSafetyAssessment,
    SystemSafetyResponse,
    DeviceStatus,
    ConnectivityState,
    normalize_to_utc_iso,
)
from app.registry import DeviceRegistry

logger = logging.getLogger("laserguard.safety_engine")

# Stable Rule Identifiers
RULE_UNAUTHORIZED_RUNNING = "RULE_UNAUTHORIZED_RUNNING"
RULE_DOOR_OPEN_WHILE_RUNNING = "RULE_DOOR_OPEN_WHILE_RUNNING"
RULE_FIRE_DETECTED = "RULE_FIRE_DETECTED"
RULE_HIGH_TEMPERATURE = "RULE_HIGH_TEMPERATURE"
RULE_ELEVATED_SMOKE = "RULE_ELEVATED_SMOKE"
RULE_STALE_TELEMETRY = "RULE_STALE_TELEMETRY"
RULE_MISSING_READINGS = "RULE_MISSING_READINGS"
RULE_COOLANT_FLOW_LOW = "RULE_COOLANT_FLOW_LOW"
RULE_PERIMETER_INTRUSION = "RULE_PERIMETER_INTRUSION"

# Strict Severity Precedence Ordering
SEVERITY_ORDER: Dict[SafetySeverity, int] = {
    SafetySeverity.CRITICAL: 4,
    SafetySeverity.WARNING: 3,
    SafetySeverity.UNKNOWN: 2,
    SafetySeverity.NORMAL: 1,
}

# Core physical telemetry readings required for a NORMAL_OPERATION evaluation
CORE_SAFETY_FIELDS = [
    "door_open",
    "flame_detected",
    "smoke_level",
    "temperature_c",
    "machine_enabled",
    "machine_running",
]


def parse_threshold_env(
    var_name: str,
    default: float,
    min_val: float,
    max_val: float,
) -> float:
    """Safely parse a numeric environment variable with boundary validation."""
    raw = os.getenv(var_name)
    if raw is None:
        return default
    try:
        val = float(raw)
        if val < min_val or val > max_val:
            logger.warning(
                f"Configuration {var_name}={val} outside valid range [{min_val}, {max_val}]. Falling back to default {default}."
            )
            return default
        return val
    except (ValueError, TypeError):
        logger.warning(
            f"Invalid non-numeric value for {var_name}='{raw}'. Falling back to default {default}."
        )
        return default


def get_configured_safety_thresholds() -> SafetyThresholdsConfig:
    """Load and validate active safety thresholds from environment."""
    high_temp = parse_threshold_env("HIGH_TEMP_THRESHOLD_C", 60.0, 0.0, 500.0)
    elevated_smoke = parse_threshold_env("ELEVATED_SMOKE_THRESHOLD", 50.0, 0.0, 1000.0)
    stale_sec = parse_threshold_env("STALE_THRESHOLD_SECONDS", 10.0, 0.1, 3600.0)

    return SafetyThresholdsConfig(
        high_temperature_c=high_temp,
        elevated_smoke=elevated_smoke,
        stale_threshold_seconds=stale_sec,
    )


class SafetyEngine:
    """
    Decoupled backend safety rules evaluation engine.
    Produces deterministic safety assessments based on latest device telemetry.
    Note: Software decision-support only; does NOT trigger physical hardware relays.
    """

    def __init__(self, thresholds: Optional[SafetyThresholdsConfig] = None):
        self._default_thresholds = thresholds

    @property
    def thresholds(self) -> SafetyThresholdsConfig:
        if self._default_thresholds is not None:
            return self._default_thresholds
        return get_configured_safety_thresholds()

    def evaluate_device(
        self,
        device_status: DeviceStatus,
        thresholds: Optional[SafetyThresholdsConfig] = None,
        evaluated_at: Optional[datetime] = None,
    ) -> DeviceSafetyAssessment:
        """
        Evaluate all 8 safety rules for an individual device.
        """
        active_thresholds = thresholds if thresholds is not None else self.thresholds
        if evaluated_at is None:
            evaluated_at = datetime.now(timezone.utc)

        eval_time_str = normalize_to_utc_iso(evaluated_at)
        readings = device_status.latest_readings
        violations: List[SafetyViolation] = []

        is_stale = device_status.connectivity_state == ConnectivityState.STALE

        # 1. CRITICAL — Unauthorized running: machine_running == True while machine_enabled == False
        if readings.machine_running is True and readings.machine_enabled is False:
            violations.append(
                SafetyViolation(
                    rule_id=RULE_UNAUTHORIZED_RUNNING,
                    severity=SafetySeverity.CRITICAL,
                    message="Unauthorized laser operation: machine is running while safety enable interlock is false.",
                    details={"machine_running": True, "machine_enabled": False},
                )
            )

        # 2. CRITICAL — Open safety door while running: door_open == True while machine_running == True
        if readings.door_open is True and readings.machine_running is True:
            violations.append(
                SafetyViolation(
                    rule_id=RULE_DOOR_OPEN_WHILE_RUNNING,
                    severity=SafetySeverity.CRITICAL,
                    message="Enclosure safety door opened while laser cutter is actively running.",
                    details={"door_open": True, "machine_running": True},
                )
            )

        # 3. CRITICAL — Fire detected: flame_detected == True
        if readings.flame_detected is True:
            violations.append(
                SafetyViolation(
                    rule_id=RULE_FIRE_DETECTED,
                    severity=SafetySeverity.CRITICAL,
                    message="Optical flame sensor detected fire / flame flicker in laser cutting chamber.",
                    details={"flame_detected": True},
                )
            )

        # 4. WARNING — High temperature: temperature_c >= threshold (demo calibration)
        if (
            readings.temperature_c is not None
            and readings.temperature_c >= active_thresholds.high_temperature_c
        ):
            violations.append(
                SafetyViolation(
                    rule_id=RULE_HIGH_TEMPERATURE,
                    severity=SafetySeverity.WARNING,
                    message=(
                        f"Workpiece/chamber temperature ({readings.temperature_c}°C) exceeds warning threshold "
                        f"({active_thresholds.high_temperature_c}°C). (Demo threshold)."
                    ),
                    details={
                        "temperature_c": readings.temperature_c,
                        "threshold_c": active_thresholds.high_temperature_c,
                    },
                )
            )

        # 5. WARNING — Elevated smoke: smoke_level >= threshold (demo calibration)
        if (
            readings.smoke_level is not None
            and readings.smoke_level >= active_thresholds.elevated_smoke
        ):
            violations.append(
                SafetyViolation(
                    rule_id=RULE_ELEVATED_SMOKE,
                    severity=SafetySeverity.WARNING,
                    message=(
                        f"Smoke concentration index ({readings.smoke_level}) exceeds warning threshold "
                        f"({active_thresholds.elevated_smoke}). (Demo threshold)."
                    ),
                    details={
                        "smoke_level": readings.smoke_level,
                        "threshold": active_thresholds.elevated_smoke,
                    },
                )
            )

        # 6. WARNING — Stale telemetry: device exceeds stale threshold
        if is_stale:
            violations.append(
                SafetyViolation(
                    rule_id=RULE_STALE_TELEMETRY,
                    severity=SafetySeverity.WARNING,
                    message=(
                        f"Telemetry is STALE: no packets received for {device_status.seconds_since_last_seen}s "
                        f"(threshold {active_thresholds.stale_threshold_seconds}s). Old data cannot be relied upon for safety."
                    ),
                    details={
                        "seconds_since_last_seen": device_status.seconds_since_last_seen,
                        "stale_threshold_seconds": active_thresholds.stale_threshold_seconds,
                    },
                )
            )

        # 7. CRITICAL — Coolant flow failure: water_flow_lpm < 1.0 L/min while machine_running == True
        if (
            readings.water_flow_lpm is not None
            and readings.machine_running is True
            and readings.water_flow_lpm < 1.0
        ):
            violations.append(
                SafetyViolation(
                    rule_id=RULE_COOLANT_FLOW_LOW,
                    severity=SafetySeverity.CRITICAL,
                    message=(
                        f"Coolant water flow rate ({readings.water_flow_lpm} L/min) is below safe operating threshold "
                        "(1.0 L/min) while laser is actively running. Laser tube thermal damage / fracture hazard."
                    ),
                    details={"water_flow_lpm": readings.water_flow_lpm, "min_flow_lpm": 1.0},
                )
            )

        # 8. CRITICAL/WARNING — Optical perimeter intrusion: camera_intrusion_detected == True
        if readings.camera_intrusion_detected is True:
            is_running = readings.machine_running is True
            violations.append(
                SafetyViolation(
                    rule_id=RULE_PERIMETER_INTRUSION,
                    severity=SafetySeverity.CRITICAL if is_running else SafetySeverity.WARNING,
                    message=(
                        "Optical exclusion zone breached by operator hand/body while laser is cutting."
                        if is_running
                        else "Optical perimeter boundary breached while machine is idle."
                    ),
                    details={
                        "camera_intrusion_detected": True,
                        "machine_running": is_running,
                    },
                )
            )

        # 9. FAIL-SAFE RECOMMENDATION: missing required readings / unknown status
        missing_fields = [
            f for f in CORE_SAFETY_FIELDS if getattr(readings, f) is None
        ]
        if missing_fields:
            violations.append(
                SafetyViolation(
                    rule_id=RULE_MISSING_READINGS,
                    severity=SafetySeverity.UNKNOWN,
                    message=(
                        f"Incomplete telemetry: missing required safety readings ({', '.join(missing_fields)}). "
                        f"Fail-safe assessment active."
                    ),
                    details={"missing_readings": missing_fields},
                )
            )

        # 8. Compute Overall Severity & Recommended Machine State
        if violations:
            overall_severity = max(
                (v.severity for v in violations),
                key=lambda s: SEVERITY_ORDER[s],
            )
        else:
            overall_severity = SafetySeverity.NORMAL

        # Recommended State Decision Tree:
        # - Any CRITICAL -> STOP_RECOMMENDED
        # - Stale telemetry -> STOP_RECOMMENDED (fail-safe override)
        # - Incomplete/missing readings -> STOP_RECOMMENDED (conservative fail-safe)
        # - Warnings (temp, smoke only) -> INVESTIGATION_RECOMMENDED
        # - Normal -> NORMAL_OPERATION
        if overall_severity == SafetySeverity.CRITICAL:
            recommended_state = RecommendedMachineState.STOP_RECOMMENDED
        elif is_stale or missing_fields:
            recommended_state = RecommendedMachineState.STOP_RECOMMENDED
        elif overall_severity == SafetySeverity.WARNING:
            recommended_state = RecommendedMachineState.INVESTIGATION_RECOMMENDED
        elif overall_severity == SafetySeverity.UNKNOWN:
            recommended_state = RecommendedMachineState.STOP_RECOMMENDED
        else:
            recommended_state = RecommendedMachineState.NORMAL_OPERATION

        return DeviceSafetyAssessment(
            device_id=device_status.device_id,
            source=device_status.source,
            overall_severity=overall_severity,
            recommended_state=recommended_state,
            violations=violations,
            stale=is_stale,
            evaluated_at=eval_time_str,
        )

    def evaluate_system(
        self,
        registry: DeviceRegistry,
        thresholds: Optional[SafetyThresholdsConfig] = None,
        filter_device_id: Optional[str] = None,
        now: Optional[datetime] = None,
    ) -> SystemSafetyResponse:
        """
        Evaluate safety for all currently registered devices.
        """
        active_thresholds = thresholds if thresholds is not None else self.thresholds
        if now is None:
            now = datetime.now(timezone.utc)

        eval_time_str = normalize_to_utc_iso(now)

        system_status = registry.get_system_status(
            now=now,
            threshold=active_thresholds.stale_threshold_seconds,
            filter_device_id=filter_device_id,
        )

        assessments: List[DeviceSafetyAssessment] = []
        for dev in system_status.devices:
            assessment = self.evaluate_device(
                device_status=dev,
                thresholds=active_thresholds,
                evaluated_at=now,
            )
            assessments.append(assessment)

        if assessments:
            overall_system_severity = max(
                (a.overall_severity for a in assessments),
                key=lambda s: SEVERITY_ORDER[s],
            )
        else:
            overall_system_severity = SafetySeverity.NORMAL

        return SystemSafetyResponse(
            status="ok",
            evaluated_at=eval_time_str,
            device_count=len(assessments),
            overall_system_severity=overall_system_severity,
            assessments=assessments,
            thresholds=active_thresholds,
        )


# Global singleton safety engine
default_safety_engine = SafetyEngine()


def get_safety_engine() -> SafetyEngine:
    """FastAPI dependency provider for SafetyEngine."""
    return default_safety_engine
