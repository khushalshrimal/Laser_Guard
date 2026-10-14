"""
LaserGuard AI - WebSocket Connection & Broadcast Manager
Handles client lifecycle, connection resilience, broadcast distribution,
and automatic stale-transition notifications for /ws/status.
"""

import asyncio
import logging
from typing import Set, Dict, Optional, List, Any
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect

from app.schemas import (
    WebSocketMessage,
    SystemStatusResponse,
    ConnectivityState,
)
from app.registry import DeviceRegistry

logger = logging.getLogger("laserguard.websocket")


class WebSocketManager:
    """
    Manages active WebSocket client connections, initial state synchronization,
    and live status broadcasting.
    """

    def __init__(self):
        self._active_connections: Set[WebSocket] = set()
        self._last_known_states: Dict[str, ConnectivityState] = {}
        self._monitor_task: Optional[asyncio.Task] = None
        self._is_monitoring: bool = False

    @property
    def active_connection_count(self) -> int:
        """Return the count of currently connected WebSocket clients."""
        return len(self._active_connections)

    async def connect(
        self,
        websocket: WebSocket,
        registry: DeviceRegistry,
        safety_engine: Optional[Any] = None,
    ) -> None:
        """
        Accept a new client connection, record it, and immediately deliver
        an initial system status snapshot with safety assessment.
        """
        await websocket.accept()
        self._active_connections.add(websocket)

        # Generate current snapshot from the single source of truth (registry)
        snapshot: SystemStatusResponse = registry.get_system_status()
        if safety_engine:
            for dev in snapshot.devices:
                dev.safety = safety_engine.evaluate_device(dev)

        # Update last known states
        for dev in snapshot.devices:
            self._last_known_states[dev.device_id] = dev.connectivity_state

        initial_msg = WebSocketMessage(event="status_snapshot", data=snapshot)
        try:
            await websocket.send_json(initial_msg.model_dump())
        except Exception as e:
            logger.warning(f"Failed to deliver initial snapshot: {e}")
            self._active_connections.discard(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        """Safely remove a disconnected client from the active pool."""
        self._active_connections.discard(websocket)

    async def broadcast(self, message: WebSocketMessage) -> None:
        """
        Send a JSON message to all connected clients.
        Resilient: Slow or disconnected clients are removed without impacting others
        or raising errors during telemetry ingestion.
        """
        if not self._active_connections:
            return

        payload = message.model_dump()
        dead_connections: List[WebSocket] = []

        # Iterate over a snapshot of active connections
        for connection in list(self._active_connections):
            try:
                await connection.send_json(payload)
            except (WebSocketDisconnect, RuntimeError, Exception) as e:
                logger.debug(f"Client disconnected during broadcast: {e}")
                dead_connections.append(connection)

        # Clean up any dropped connections
        for dead in dead_connections:
            self._active_connections.discard(dead)

    async def broadcast_status(
        self,
        registry: DeviceRegistry,
        safety_engine: Optional[Any] = None,
        event: str = "telemetry_update",
    ) -> None:
        """
        Build an updated status snapshot from the registry, enrich with safety,
        and broadcast to clients.
        """
        if not self._active_connections:
            return

        snapshot: SystemStatusResponse = registry.get_system_status()
        if safety_engine:
            for dev in snapshot.devices:
                dev.safety = safety_engine.evaluate_device(dev)

        # Update cached states
        for dev in snapshot.devices:
            self._last_known_states[dev.device_id] = dev.connectivity_state

        msg = WebSocketMessage(event=event, data=snapshot)
        await self.broadcast(msg)

    async def check_and_broadcast_stale(
        self,
        registry: DeviceRegistry,
        safety_engine: Optional[Any] = None,
        event_store: Optional[Any] = None,
        now: Optional[datetime] = None,
    ) -> bool:
        """
        Check if any registered device transitioned from ONLINE to STALE.
        If a transition is detected, record event in blackbox store and broadcast 'stale_transition'.
        Returns True if a transition broadcast was dispatched, False otherwise.
        """
        if not self._active_connections and event_store is None:
            return False

        snapshot: SystemStatusResponse = registry.get_system_status(now=now)
        if safety_engine:
            for dev in snapshot.devices:
                dev.safety = safety_engine.evaluate_device(dev)

        state_changed = False

        for dev in snapshot.devices:
            prev_state = self._last_known_states.get(dev.device_id)
            if prev_state != dev.connectivity_state:
                state_changed = True
                self._last_known_states[dev.device_id] = dev.connectivity_state
                if event_store and dev.safety:
                    event_store.process_assessment_transition(
                        assessment=dev.safety,
                        connectivity_state=dev.connectivity_state,
                        timestamp=now,
                    )

        if state_changed and self._active_connections:
            msg = WebSocketMessage(event="stale_transition", data=snapshot)
            await self.broadcast(msg)
            return True

        return state_changed

    def start_stale_monitor(
        self,
        registry: DeviceRegistry,
        safety_engine: Optional[Any] = None,
        event_store: Optional[Any] = None,
        interval: float = 2.0,
    ) -> None:
        """Start a background task to periodically detect stale transitions."""
        if self._is_monitoring:
            return
        self._is_monitoring = True
        try:
            loop = asyncio.get_running_loop()
            self._monitor_task = loop.create_task(
                self._stale_monitor_loop(registry, safety_engine, event_store, interval)
            )
        except RuntimeError:
            # No running event loop yet (e.g. before uvicorn/fastapi starts)
            pass

    async def _stale_monitor_loop(
        self,
        registry: DeviceRegistry,
        safety_engine: Optional[Any],
        event_store: Optional[Any],
        interval: float,
    ) -> None:
        """Periodic background loop checking for stale transitions."""
        while self._is_monitoring:
            try:
                await asyncio.sleep(interval)
                await self.check_and_broadcast_stale(
                    registry, safety_engine=safety_engine, event_store=event_store
                )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in stale monitor loop: {e}")

    async def stop_stale_monitor(self) -> None:
        """Stop the background stale monitor task."""
        self._is_monitoring = False
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        self._monitor_task = None

    def clear(self) -> None:
        """Clear active connections and cached states (test isolation)."""
        self._active_connections.clear()
        self._last_known_states.clear()


# Global singleton WebSocket manager instance
default_ws_manager = WebSocketManager()


def get_ws_manager() -> WebSocketManager:
    """FastAPI dependency provider for WebSocketManager."""
    return default_ws_manager
