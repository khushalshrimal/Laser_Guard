"""
LaserGuard AI - SQLite Blackbox Event Store & Safety Audit History
Persists safety state transitions, rule activations, clearances, and connectivity events
using Python's built-in sqlite3. Survives application restarts.
"""

import os
import json
import sqlite3
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Set
from datetime import datetime, timezone
from contextlib import contextmanager

from app.schemas import (
    TelemetrySource,
    SafetySeverity,
    RecommendedMachineState,
    BlackboxEvent,
    EventHistoryResponse,
    DeviceSafetyAssessment,
    ConnectivityState,
    normalize_to_utc_iso,
)

logger = logging.getLogger("laserguard.blackbox")


def get_default_database_path() -> str:
    """
    Resolve local database path:
    Respects DATABASE_PATH environment variable if provided,
    otherwise defaults to backend/data/laserguard_blackbox.db.
    """
    env_path = os.getenv("DATABASE_PATH")
    if env_path:
        db_path = Path(env_path)
    else:
        # Default to backend/data directory
        backend_dir = Path(__file__).resolve().parent.parent
        data_dir = backend_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        db_path = data_dir / "laserguard_blackbox.db"

    # Ensure parent directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return str(db_path)


def get_max_events_retained() -> int:
    """Read MAX_EVENTS_RETAINED from environment with bounds [100, 1000000]."""
    raw = os.getenv("MAX_EVENTS_RETAINED", "10000")
    try:
        val = int(raw)
        return max(100, min(1000000, val))
    except (ValueError, TypeError):
        return 10000


class EventStore:
    """
    Thread-safe SQLite blackbox event store for LaserGuard AI.
    Handles schema initialization, transition-based event insertion,
    retention pruning, and structured querying.
    """

    def __init__(self, db_path: Optional[str] = None):
        self._db_path = db_path or get_default_database_path()
        # In-memory transition tracking to prevent duplicate spamming
        self._last_severities: Dict[str, SafetySeverity] = {}
        self._last_active_rules: Dict[str, Set[str]] = {}
        self._last_connectivity: Dict[str, ConnectivityState] = {}
        self._last_machine_running: Dict[str, Optional[bool]] = {}
        self._last_machine_enabled: Dict[str, Optional[bool]] = {}
        self.init_db()

    @property
    def db_path(self) -> str:
        return self._db_path

    @contextmanager
    def _get_connection(self):
        """Context manager providing an isolated, WAL-enabled sqlite3 connection."""
        conn = sqlite3.connect(self._db_path, timeout=10.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error on {self._db_path}: {e}")
            raise
        finally:
            conn.close()

    def init_db(self) -> None:
        """Initialize the blackbox database schema and indexes."""
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS blackbox_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    severity TEXT,
                    rule_id TEXT,
                    recommended_state TEXT,
                    message TEXT NOT NULL,
                    details_json TEXT NOT NULL
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_events_device_id ON blackbox_events(device_id);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_events_severity ON blackbox_events(severity);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_events_event_type ON blackbox_events(event_type);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_events_id ON blackbox_events(id DESC);"
            )

    def log_event(
        self,
        event_type: str,
        device_id: str,
        source: TelemetrySource,
        message: str,
        severity: Optional[SafetySeverity] = None,
        rule_id: Optional[str] = None,
        recommended_state: Optional[RecommendedMachineState] = None,
        details: Optional[Dict[str, Any]] = None,
        timestamp: Optional[datetime] = None,
    ) -> BlackboxEvent:
        """Insert a single structured audit event with automatic retention pruning."""
        if timestamp is None:
            timestamp = datetime.now(timezone.utc)
        ts_str = normalize_to_utc_iso(timestamp)
        details_json = json.dumps(details or {})
        severity_val = severity.value if severity else None
        source_val = source.value if isinstance(source, TelemetrySource) else str(source)
        rec_state_val = recommended_state.value if recommended_state else None

        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO blackbox_events
                (timestamp, event_type, device_id, source, severity, rule_id, recommended_state, message, details_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    ts_str,
                    event_type,
                    device_id,
                    source_val,
                    severity_val,
                    rule_id,
                    rec_state_val,
                    message,
                    details_json,
                ),
            )
            event_id = cursor.lastrowid

            # Enforce retention policy
            max_retained = get_max_events_retained()
            count_row = conn.execute("SELECT COUNT(*) FROM blackbox_events;").fetchone()
            if count_row and count_row[0] > max_retained:
                # Prune oldest records beyond max_retained
                cutoff_row = conn.execute(
                    "SELECT id FROM blackbox_events ORDER BY id DESC LIMIT 1 OFFSET ?;",
                    (max_retained,),
                ).fetchone()
                if cutoff_row:
                    conn.execute("DELETE FROM blackbox_events WHERE id <= ?;", (cutoff_row[0],))

        return BlackboxEvent(
            id=event_id,
            timestamp=ts_str,
            event_type=event_type,
            device_id=device_id,
            source=source,
            severity=severity,
            rule_id=rule_id,
            recommended_state=recommended_state,
            message=message,
            details=details or {},
        )

    def process_assessment_transition(
        self,
        assessment: DeviceSafetyAssessment,
        connectivity_state: ConnectivityState,
        timestamp: Optional[datetime] = None,
        device_status: Optional[Any] = None,
    ) -> List[BlackboxEvent]:
        """
        Evaluate transitions for a device and record audit events only when state changes.
        Prevents identical telemetry packets from flooding the event log.
        """
        device_id = assessment.device_id
        source = assessment.source
        new_events: List[BlackboxEvent] = []

        # 1. Connectivity State Transition (ONLINE <-> STALE)
        prev_conn = self._last_connectivity.get(device_id)
        if prev_conn != connectivity_state:
            self._last_connectivity[device_id] = connectivity_state
            if prev_conn is not None:
                if connectivity_state == ConnectivityState.STALE:
                    e = self.log_event(
                        event_type="CONNECTIVITY_TRANSITION",
                        device_id=device_id,
                        source=source,
                        severity=SafetySeverity.WARNING,
                        rule_id="RULE_STALE_TELEMETRY",
                        recommended_state=RecommendedMachineState.STOP_RECOMMENDED,
                        message=f"Device {device_id} connectivity transitioned from ONLINE to STALE (packet timeout).",
                        details={"previous_state": "ONLINE", "new_state": "STALE"},
                        timestamp=timestamp,
                    )
                    new_events.append(e)
                elif connectivity_state == ConnectivityState.ONLINE:
                    e = self.log_event(
                        event_type="CONNECTIVITY_TRANSITION",
                        device_id=device_id,
                        source=source,
                        severity=SafetySeverity.NORMAL,
                        rule_id="CONNECTIVITY_RESTORED",
                        recommended_state=assessment.recommended_state,
                        message=f"Device {device_id} connectivity restored from STALE to ONLINE.",
                        details={"previous_state": "STALE", "new_state": "ONLINE"},
                        timestamp=timestamp,
                    )
                    new_events.append(e)

        # 2. Safety Severity Transition (e.g. NORMAL -> WARNING, WARNING -> CRITICAL)
        prev_severity = self._last_severities.get(device_id)
        if prev_severity != assessment.overall_severity:
            self._last_severities[device_id] = assessment.overall_severity
            if prev_severity is not None or assessment.overall_severity != SafetySeverity.NORMAL:
                prev_name = prev_severity.value if prev_severity else "INITIAL"
                e = self.log_event(
                    event_type="SAFETY_TRANSITION",
                    device_id=device_id,
                    source=source,
                    severity=assessment.overall_severity,
                    recommended_state=assessment.recommended_state,
                    message=f"Safety assessment transitioned from {prev_name} to {assessment.overall_severity.value}.",
                    details={
                        "previous_severity": prev_name,
                        "new_severity": assessment.overall_severity.value,
                        "recommended_state": assessment.recommended_state.value,
                        "violation_count": len(assessment.violations),
                    },
                    timestamp=timestamp,
                )
                new_events.append(e)

        # 3. Individual Rule Activations and Clearances
        curr_rules = {v.rule_id: v for v in assessment.violations}
        curr_rule_ids = set(curr_rules.keys())
        prev_rule_ids = self._last_active_rules.get(device_id, set())

        # Activated rules (present now, not present previously)
        newly_activated = curr_rule_ids - prev_rule_ids
        for r_id in sorted(newly_activated):
            violation = curr_rules[r_id]
            e = self.log_event(
                event_type="RULE_ACTIVATION",
                device_id=device_id,
                source=source,
                severity=violation.severity,
                rule_id=r_id,
                recommended_state=assessment.recommended_state,
                message=f"Safety rule activated: {violation.message}",
                details=violation.details,
                timestamp=timestamp,
            )
            new_events.append(e)

        # Cleared rules (present previously, resolved now)
        newly_cleared = prev_rule_ids - curr_rule_ids
        for r_id in sorted(newly_cleared):
            e = self.log_event(
                event_type="RULE_CLEARANCE",
                device_id=device_id,
                source=source,
                severity=SafetySeverity.NORMAL,
                rule_id=r_id,
                recommended_state=assessment.recommended_state,
                message=f"Safety hazard cleared: rule {r_id} is no longer triggered.",
                details={"cleared_rule_id": r_id},
                timestamp=timestamp,
            )
            new_events.append(e)

        self._last_active_rules[device_id] = curr_rule_ids

        # 4. Operational & Interlock State Transitions (Laser start/stop, permission changes)
        if device_status is not None:
            readings = getattr(device_status, "latest_readings", None)
            if readings is not None:
                cur_running = getattr(readings, "machine_running", None)
                prev_running = self._last_machine_running.get(device_id)
                if prev_running is not None and cur_running is not None and prev_running != cur_running:
                    self._last_machine_running[device_id] = cur_running
                    if cur_running:
                        e = self.log_event(
                            event_type="OPERATIONAL_STATE",
                            device_id=device_id,
                            source=source,
                            severity=SafetySeverity.NORMAL,
                            rule_id="MACHINE_STARTED",
                            recommended_state=assessment.recommended_state,
                            message="Laser cutter cutting cycle initiated (machine_running: true).",
                            details={"machine_running": True, "machine_enabled": getattr(readings, "machine_enabled", None)},
                            timestamp=timestamp,
                        )
                        new_events.append(e)
                    else:
                        e = self.log_event(
                            event_type="OPERATIONAL_STATE",
                            device_id=device_id,
                            source=source,
                            severity=SafetySeverity.NORMAL,
                            rule_id="MACHINE_STOPPED",
                            recommended_state=assessment.recommended_state,
                            message="Laser cutter stopped / entered idle standby (machine_running: false).",
                            details={"machine_running": False, "machine_enabled": getattr(readings, "machine_enabled", None)},
                            timestamp=timestamp,
                        )
                        new_events.append(e)
                elif prev_running is None and cur_running is not None:
                    self._last_machine_running[device_id] = cur_running

                cur_enabled = getattr(readings, "machine_enabled", None)
                prev_enabled = self._last_machine_enabled.get(device_id)
                if prev_enabled is not None and cur_enabled is not None and prev_enabled != cur_enabled:
                    self._last_machine_enabled[device_id] = cur_enabled
                    if cur_enabled:
                        e = self.log_event(
                            event_type="INTERLOCK_STATE",
                            device_id=device_id,
                            source=source,
                            severity=SafetySeverity.NORMAL,
                            rule_id="PERMISSION_GRANTED",
                            recommended_state=assessment.recommended_state,
                            message="In-Charge safety permission ARMED (machine_enabled: true). Authorized cutting allowed.",
                            details={"machine_enabled": True},
                            timestamp=timestamp,
                        )
                        new_events.append(e)
                    else:
                        e = self.log_event(
                            event_type="INTERLOCK_STATE",
                            device_id=device_id,
                            source=source,
                            severity=SafetySeverity.WARNING,
                            rule_id="PERMISSION_REVOKED",
                            recommended_state=RecommendedMachineState.STOP_RECOMMENDED if cur_running else RecommendedMachineState.NORMAL_OPERATION,
                            message="In-Charge safety permission DISARMED / LOCKED (machine_enabled: false). Machine interlock engaged.",
                            details={"machine_enabled": False, "machine_running": cur_running},
                            timestamp=timestamp,
                        )
                        new_events.append(e)
                elif prev_enabled is None and cur_enabled is not None:
                    self._last_machine_enabled[device_id] = cur_enabled

        return new_events

    def query_events(
        self,
        device_id: Optional[str] = None,
        severity: Optional[str] = None,
        event_type: Optional[str] = None,
        limit: int = 50,
        before_id: Optional[int] = None,
    ) -> EventHistoryResponse:
        """
        Query persistent blackbox event log with deterministic newest-first ordering and cursor pagination.
        """
        effective_limit = max(1, min(200, limit))

        query_conditions = ["1=1"]
        params: List[Any] = []

        if device_id:
            query_conditions.append("device_id = ?")
            params.append(device_id)

        if severity:
            query_conditions.append("severity = ?")
            params.append(severity.upper())

        if event_type:
            query_conditions.append("event_type = ?")
            params.append(event_type.upper())

        # For total_count calculation matching the filter criteria
        count_sql = f"SELECT COUNT(*) FROM blackbox_events WHERE {' AND '.join(query_conditions)};"

        if before_id is not None:
            query_conditions.append("id < ?")
            params.append(before_id)

        select_sql = f"""
            SELECT id, timestamp, event_type, device_id, source, severity, rule_id, recommended_state, message, details_json
            FROM blackbox_events
            WHERE {' AND '.join(query_conditions)}
            ORDER BY id DESC
            LIMIT ?;
        """
        select_params = params.copy()
        select_params.append(effective_limit)

        with self._get_connection() as conn:
            # Get total matching count
            count_params = [p for i, p in enumerate(params) if not (before_id is not None and i == len(params) - 1)]
            total_count = conn.execute(count_sql, count_params).fetchone()[0]

            rows = conn.execute(select_sql, select_params).fetchall()
            events: List[BlackboxEvent] = []
            for r in rows:
                try:
                    details_obj = json.loads(r["details_json"])
                except Exception:
                    details_obj = {}

                events.append(
                    BlackboxEvent(
                        id=r["id"],
                        timestamp=r["timestamp"],
                        event_type=r["event_type"],
                        device_id=r["device_id"],
                        source=TelemetrySource(r["source"])
                        if r["source"] in [s.value for s in TelemetrySource]
                        else TelemetrySource.HARDWARE,
                        severity=SafetySeverity(r["severity"])
                        if r["severity"] in [s.value for s in SafetySeverity]
                        else None,
                        rule_id=r["rule_id"],
                        recommended_state=RecommendedMachineState(r["recommended_state"])
                        if r["recommended_state"] in [s.value for s in RecommendedMachineState]
                        else None,
                        message=r["message"],
                        details=details_obj,
                    )
                )

        return EventHistoryResponse(
            status="ok",
            count=len(events),
            total_count=total_count,
            limit=effective_limit,
            before_id=before_id,
            events=events,
        )

    def reset_transitions(self) -> None:
        """Reset in-memory transition cache (useful for test isolation)."""
        self._last_severities.clear()
        self._last_active_rules.clear()
        self._last_connectivity.clear()

    def clear_all_events(self) -> None:
        """Delete all events from the database (test cleanup)."""
        self.reset_transitions()
        with self._get_connection() as conn:
            conn.execute("DELETE FROM blackbox_events;")


# Global singleton event store instance
default_event_store = EventStore()


def get_event_store() -> EventStore:
    """FastAPI dependency provider for EventStore."""
    return default_event_store
