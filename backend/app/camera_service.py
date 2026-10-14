"""
LaserGuard AI - Modular Camera Service
Uses OpenCV and MediaPipe Hands (Tasks API / Solutions API) for real-time advisory
hand tracking and danger-zone intrusion detection.
"""

import logging
import math
import os
import threading
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any, Callable
from pydantic import BaseModel, Field, model_validator

logger = logging.getLogger(__name__)

# Optional / Graceful import of OpenCV and MediaPipe
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    cv2 = None
    CV2_AVAILABLE = False

try:
    import mediapipe as mp
    try:
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python import vision
        MP_TASKS_AVAILABLE = True
    except (ImportError, AttributeError):
        BaseOptions = None
        vision = None
        MP_TASKS_AVAILABLE = False
    try:
        from mediapipe import Image, ImageFormat
    except (ImportError, AttributeError):
        Image = getattr(mp, "Image", None)
        ImageFormat = getattr(mp, "ImageFormat", None)
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    mp = None
    BaseOptions = None
    vision = None
    MP_TASKS_AVAILABLE = False
    Image = None
    ImageFormat = None
    MEDIAPIPE_AVAILABLE = False


HAND_SKELETON_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),        # Thumb
    (0, 5), (5, 6), (6, 7), (7, 8),        # Index
    (5, 9), (9, 10), (10, 11), (11, 12),   # Middle
    (9, 13), (13, 14), (14, 15), (15, 16), # Ring
    (13, 17), (17, 18), (18, 19), (19, 20),# Pinky
    (0, 17),                               # Wrist to pinky base
]


class CameraLifecycleState(str, Enum):
    """Lifecycle states of the camera service."""
    STOPPED = "STOPPED"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    ERROR = "ERROR"


class DetectionStatus(str, Enum):
    """Status flags for the latest hand detection frame."""
    NO_HANDS = "NO_HANDS"
    HAND_DETECTED = "HAND_DETECTED"
    DANGER_ZONE_BREACH = "DANGER_ZONE_BREACH"
    CAMERA_OFFLINE = "CAMERA_OFFLINE"


def sanitize_coord(val: Any, default: float = 0.0) -> float:
    """Safely convert coordinate to finite float, fallback on non-finite/invalid."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return round(f, 5)
    except (TypeError, ValueError):
        return default


def sanitize_opt_coord(val: Any) -> Optional[float]:
    """Safely convert optional coordinate to finite float or None."""
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 5)
    except (TypeError, ValueError):
        return None


class RoiConfig(BaseModel):
    """
    Normalized region of interest (danger zone) bounding box in coordinates [0.0, 1.0].
    """
    x_min: float = Field(default=0.2, ge=0.0, le=1.0, description="Left boundary of danger zone")
    y_min: float = Field(default=0.2, ge=0.0, le=1.0, description="Top boundary of danger zone")
    x_max: float = Field(default=0.8, ge=0.0, le=1.0, description="Right boundary of danger zone")
    y_max: float = Field(default=0.8, ge=0.0, le=1.0, description="Bottom boundary of danger zone")

    @model_validator(mode="after")
    def validate_bounds(self) -> "RoiConfig":
        if self.x_min >= self.x_max:
            raise ValueError(f"x_min ({self.x_min}) must be strictly less than x_max ({self.x_max})")
        if self.y_min >= self.y_max:
            raise ValueError(f"y_min ({self.y_min}) must be strictly less than y_max ({self.y_max})")
        return self


class Zone3dConfig(BaseModel):
    """
    Configurable 3D monitoring zone with normalized X/Y and estimated relative Z depth.
    Notice: Estimated relative depth from a single webcam is not calibrated physical measurement (mm/cm).
    """
    enabled: bool = Field(default=True, description="Enable 3D monitoring zone")
    x_min: float = Field(default=0.2, ge=0.0, le=1.0, description="Left boundary [0.0, 1.0]")
    x_max: float = Field(default=0.8, ge=0.0, le=1.0, description="Right boundary [0.0, 1.0]")
    y_min: float = Field(default=0.2, ge=0.0, le=1.0, description="Top boundary [0.0, 1.0]")
    y_max: float = Field(default=0.8, ge=0.0, le=1.0, description="Bottom boundary [0.0, 1.0]")
    z_min: float = Field(default=-0.3, ge=-1.0, le=1.0, description="Estimated relative depth min [-1.0, 1.0]")
    z_max: float = Field(default=0.3, ge=-1.0, le=1.0, description="Estimated relative depth max [-1.0, 1.0]")

    @model_validator(mode="after")
    def validate_bounds(self) -> "Zone3dConfig":
        if self.x_min >= self.x_max:
            raise ValueError(f"x_min ({self.x_min}) must be strictly less than x_max ({self.x_max})")
        if self.y_min >= self.y_max:
            raise ValueError(f"y_min ({self.y_min}) must be strictly less than y_max ({self.y_max})")
        if self.z_min >= self.z_max:
            raise ValueError(f"z_min ({self.z_min}) must be strictly less than z_max ({self.z_max})")
        return self


class HandLandmark(BaseModel):
    """Normalized 3D landmark coordinate for a detected hand keypoint."""
    x: float
    y: float
    z: Optional[float] = None

    @model_validator(mode="before")
    @classmethod
    def sanitize_coordinates(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {
                "x": sanitize_coord(data.get("x", 0.0)),
                "y": sanitize_coord(data.get("y", 0.0)),
                "z": sanitize_opt_coord(data.get("z")),
            }
        return data


class HandBBox(BaseModel):
    """Normalized bounding box enclosing a detected hand."""
    x_min: float
    y_min: float
    x_max: float
    y_max: float


class HandDetection(BaseModel):
    """Individual hand detection detail with landmarks, bounding box, and danger assessment."""
    label: Optional[str] = None
    score: Optional[float] = None
    landmarks: List[HandLandmark] = Field(default_factory=list)
    bbox: HandBBox
    in_danger_zone: bool = False
    in_danger_zone_3d: bool = False
    tracking_status: str = "TRACKED"


class CameraDetectionResult(BaseModel):
    """Aggregated detection result from processing a camera frame."""
    status: str = DetectionStatus.NO_HANDS.value
    hand_count: int = 0
    hands: List[HandDetection] = Field(default_factory=list)
    danger_zone_breached: bool = False
    danger_zone_3d_breached: bool = False
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class CameraStatusResponse(BaseModel):
    """API response model reporting the complete camera service status."""
    state: str = CameraLifecycleState.STOPPED.value
    device_index: int = 0
    target_fps: float = 10.0
    actual_fps: float = 0.0
    roi: RoiConfig = Field(default_factory=RoiConfig)
    zone_3d: Zone3dConfig = Field(default_factory=Zone3dConfig)
    error_message: Optional[str] = None
    latest_detection: Optional[CameraDetectionResult] = None
    available: bool = True


class CameraStartRequest(BaseModel):
    """Request payload to start the camera service with optional configuration overrides."""
    device_index: Optional[int] = Field(default=None, ge=0, description="Webcam device index")
    target_fps: Optional[float] = Field(default=None, gt=0.0, le=60.0, description="Target capture FPS")
    roi: Optional[RoiConfig] = Field(default=None, description="Danger zone ROI configuration")
    zone_3d: Optional[Zone3dConfig] = Field(default=None, description="Configurable 3D monitoring zone")


def check_point_in_roi(x: float, y: float, roi: RoiConfig) -> bool:
    """Check if a normalized (x, y) point lies inside the danger zone ROI."""
    return roi.x_min <= x <= roi.x_max and roi.y_min <= y <= roi.y_max


def check_bbox_intersects_roi(bbox: HandBBox, roi: RoiConfig) -> bool:
    """Check if a normalized hand bounding box intersects with the danger zone ROI."""
    overlap_x = max(0.0, min(bbox.x_max, roi.x_max) - max(bbox.x_min, roi.x_min))
    overlap_y = max(0.0, min(bbox.y_max, roi.y_max) - max(bbox.y_min, roi.y_min))
    return (overlap_x > 0.0) and (overlap_y > 0.0)


def check_point_in_zone_3d(x: float, y: float, z: Optional[float], zone: Zone3dConfig) -> bool:
    """Check if normalized 3D point lies inside the 3D monitoring zone."""
    if not zone.enabled:
        return False
    in_xy = (zone.x_min <= x <= zone.x_max) and (zone.y_min <= y <= zone.y_max)
    if not in_xy:
        return False
    if z is None:
        return in_xy
    return zone.z_min <= z <= zone.z_max


def check_hand_in_zone_3d(landmarks: List[HandLandmark], zone: Zone3dConfig) -> bool:
    """Check if any landmark of the hand falls inside the 3D monitoring zone."""
    if not zone.enabled or not landmarks:
        return False
    return any(check_point_in_zone_3d(lm.x, lm.y, lm.z, zone) for lm in landmarks)


def get_default_camera_index() -> int:
    """
    Retrieve default camera device index.
    Defaults to 1 (external USB webcam, e.g. Logitech Webcam C170),
    with override via CAMERA_DEVICE_INDEX environment variable.
    """
    raw = os.getenv("CAMERA_DEVICE_INDEX", "1")
    try:
        val = int(raw)
        return val if val >= 0 else 1
    except (ValueError, TypeError):
        logger.warning("Invalid CAMERA_DEVICE_INDEX '%s'. Falling back to default index 1.", raw)
        return 1


class CameraService:
    """
    Modular thread-safe Camera Service.
    Runs a non-blocking background capture thread, processes frames with MediaPipe Hands,
    evaluates danger-zone intersection, and maintains thread-safe detection status.
    """

    def __init__(
        self,
        device_index: Optional[int] = None,
        target_fps: float = 10.0,
        roi: Optional[RoiConfig] = None,
        zone_3d: Optional[Zone3dConfig] = None,
        model_path: Optional[str] = None,
    ):
        self._device_index = (
            device_index if device_index is not None else get_default_camera_index()
        )
        self._target_fps = target_fps
        self._roi = roi or RoiConfig()
        self._zone_3d = zone_3d or Zone3dConfig()
        self._model_path = model_path or self._resolve_default_model_path()

        self._state = CameraLifecycleState.STOPPED
        self._error_message: Optional[str] = None
        self._actual_fps: float = 0.0
        self._latest_detection: Optional[CameraDetectionResult] = None

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._detection_callbacks: List[Callable[[Optional[CameraDetectionResult]], None]] = []
        self._latest_frame_jpeg: Optional[bytes] = None

    @staticmethod
    def _resolve_default_model_path() -> Optional[str]:
        """Attempt to locate the hand_landmarker.task model file in standard locations."""
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates = [
            os.path.join(backend_dir, "models", "hand_landmarker.task"),
            os.path.join(os.getcwd(), "backend", "models", "hand_landmarker.task"),
            os.path.join(os.getcwd(), "models", "hand_landmarker.task"),
        ]
        for p in candidates:
            if os.path.exists(p):
                return os.path.abspath(p)
        return None

    @property
    def is_available(self) -> bool:
        """Returns True if OpenCV and MediaPipe dependencies are importable."""
        return CV2_AVAILABLE and MEDIAPIPE_AVAILABLE

    def get_status(self) -> CameraStatusResponse:
        """Retrieve thread-safe status snapshot of the camera service."""
        with self._lock:
            return self._get_status_unlocked()

    def start(
        self,
        device_index: Optional[int] = None,
        target_fps: Optional[float] = None,
        roi: Optional[RoiConfig] = None,
        zone_3d: Optional[Zone3dConfig] = None,
    ) -> CameraStatusResponse:
        """
        Start the background camera capture thread.
        Gracefully handles missing dependencies and device initialization failures.
        """
        with self._lock:
            if self._state == CameraLifecycleState.RUNNING:
                logger.info("Camera service is already running.")
                return self._get_status_unlocked()

            if not self.is_available:
                self._state = CameraLifecycleState.ERROR
                self._error_message = (
                    "Required vision libraries (opencv-python or mediapipe) are not available."
                )
                logger.error(self._error_message)
                return self._get_status_unlocked()

            if device_index is not None:
                self._device_index = device_index
            if target_fps is not None:
                self._target_fps = target_fps
            if roi is not None:
                self._roi = roi
            if zone_3d is not None:
                self._zone_3d = zone_3d

            self._state = CameraLifecycleState.STARTING
            self._error_message = None
            self._stop_event.clear()

        # Launch background worker
        self._thread = threading.Thread(
            target=self._capture_worker,
            daemon=True,
            name="CameraCaptureWorker",
        )
        self._thread.start()

        # Brief spin to allow initialization to transition to RUNNING or ERROR
        time.sleep(0.08)
        return self.get_status()

    def stop(self) -> CameraStatusResponse:
        """
        Gracefully stop the background capture thread and release hardware resources.
        """
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
            self._thread = None

        with self._lock:
            self._state = CameraLifecycleState.STOPPED
            self._actual_fps = 0.0
            self._latest_frame_jpeg = None
            status_resp = self._get_status_unlocked()

        # Notify callbacks that camera has stopped / offline
        self._notify_callbacks(None)
        return status_resp

    @property
    def is_running(self) -> bool:
        """Return True if camera capture worker is actively running."""
        with self._lock:
            return self._state == CameraLifecycleState.RUNNING

    def get_latest_frame_jpeg(self) -> Optional[bytes]:
        """Thread-safe retrieval of the latest encoded JPEG frame bytes."""
        with self._lock:
            return self._latest_frame_jpeg

    def stream_frames(self):
        """
        Generator yielding MJPEG multipart frames for streaming HTTP responses.
        Exits gracefully when camera stops or stop event is set.
        """
        while not self._stop_event.is_set():
            with self._lock:
                if self._state != CameraLifecycleState.RUNNING:
                    break
                frame_bytes = self._latest_frame_jpeg

            if frame_bytes:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
                )
            time.sleep(0.06)  # ~16 FPS max stream rate

    def add_detection_callback(self, callback: Callable[[Optional[CameraDetectionResult]], None]) -> None:
        """Register a callback invoked whenever a frame is processed or camera stops."""
        with self._lock:
            if callback not in self._detection_callbacks:
                self._detection_callbacks.append(callback)

    def remove_detection_callback(self, callback: Callable[[Optional[CameraDetectionResult]], None]) -> None:
        """Unregister a detection callback."""
        with self._lock:
            if callback in self._detection_callbacks:
                self._detection_callbacks.remove(callback)

    def clear_detection_callbacks(self) -> None:
        """Clear all registered detection callbacks."""
        with self._lock:
            self._detection_callbacks.clear()

    def _notify_callbacks(self, result: Optional[CameraDetectionResult]) -> None:
        """Notify registered callbacks outside of internal locks."""
        with self._lock:
            callbacks = list(self._detection_callbacks)
        for cb in callbacks:
            try:
                cb(result)
            except Exception as exc:
                logger.error(f"Error in camera detection callback: {exc}")

    def update_roi(self, roi: RoiConfig) -> CameraStatusResponse:
        """Update danger zone ROI coordinates at runtime."""
        with self._lock:
            self._roi = roi
            return self._get_status_unlocked()

    def update_zone_3d(self, zone_3d: Zone3dConfig) -> CameraStatusResponse:
        """Update 3D monitoring zone configuration at runtime."""
        with self._lock:
            self._zone_3d = zone_3d
            return self._get_status_unlocked()

    def reset_zone_3d(self) -> CameraStatusResponse:
        """Reset 3D monitoring zone configuration to default values."""
        with self._lock:
            self._zone_3d = Zone3dConfig()
            return self._get_status_unlocked()

    def _get_status_unlocked(self) -> CameraStatusResponse:
        """Internal helper to construct status while caller already holds self._lock."""
        return CameraStatusResponse(
            state=self._state.value,
            device_index=self._device_index,
            target_fps=self._target_fps,
            actual_fps=round(self._actual_fps, 2),
            roi=self._roi,
            zone_3d=self._zone_3d,
            error_message=self._error_message,
            latest_detection=self._latest_detection,
            available=self.is_available,
        )

    def _init_detector(self) -> Tuple[Any, str]:
        """
        Initialize hand detector based on available MediaPipe API:
        1. MediaPipe Tasks API (vision.HandLandmarker) - used in MediaPipe 1.x
        2. MediaPipe Solutions API (solutions.hands.Hands) - used in legacy or test mocks
        Returns (detector_instance, detector_type).
        """
        if not self._model_path:
            self._model_path = self._resolve_default_model_path()

        # Check for MediaPipe Tasks API (explicit module imports or dynamically available)
        tasks_vision = vision
        tasks_base_options = BaseOptions
        if tasks_vision is None and mp is not None and hasattr(mp, "tasks") and hasattr(mp.tasks, "python") and hasattr(mp.tasks.python, "vision"):
            tasks_vision = mp.tasks.python.vision
            tasks_base_options = getattr(mp.tasks.python, "BaseOptions", None)

        if tasks_vision is not None and hasattr(tasks_vision, "HandLandmarker"):
            if not self._model_path or not os.path.exists(self._model_path):
                raise FileNotFoundError(
                    f"MediaPipe Hand Landmarker model file not found at '{self._model_path}'. "
                    "Please provide hand_landmarker.task model file."
                )
            if tasks_base_options is None:
                raise RuntimeError("MediaPipe Tasks BaseOptions is not available.")
            base_options = tasks_base_options(model_asset_path=self._model_path)
            options = tasks_vision.HandLandmarkerOptions(
                base_options=base_options,
                running_mode=tasks_vision.RunningMode.IMAGE,
                num_hands=2,
                min_hand_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            detector = tasks_vision.HandLandmarker.create_from_options(options)
            return detector, "tasks"

        # Check for legacy MediaPipe Solutions API (or test mocks)
        if mp is not None and hasattr(mp, "solutions") and hasattr(mp.solutions, "hands"):
            detector = mp.solutions.hands.Hands(
                static_image_mode=False,
                max_num_hands=2,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            return detector, "solutions"

        raise RuntimeError("Neither MediaPipe Tasks HandLandmarker nor Solutions Hands API is available.")

    def _process_frame_detections(
        self,
        raw_results: Any,
        detector_type: str,
        roi: RoiConfig,
        zone_3d: Optional[Zone3dConfig] = None,
    ) -> CameraDetectionResult:
        """
        Transform detection results from either Tasks or Solutions API into structured
        CameraDetectionResult, evaluate 2D danger-zone ROI intersections and 3D monitoring zone.
        """
        zone_3d = zone_3d or Zone3dConfig()
        hands_list: List[HandDetection] = []
        danger_zone_breached = False
        danger_zone_3d_breached = False

        if raw_results is not None:
            # 1. MediaPipe Tasks API format (HandLandmarkerResult)
            if detector_type == "tasks" or hasattr(raw_results, "hand_landmarks"):
                task_landmarks = getattr(raw_results, "hand_landmarks", []) or []
                handedness_list = getattr(raw_results, "handedness", []) or []

                for idx, hand_lms in enumerate(task_landmarks):
                    landmarks: List[HandLandmark] = []
                    x_coords: List[float] = []
                    y_coords: List[float] = []
                    landmark_in_danger = False

                    for lm in hand_lms:
                        raw_x = getattr(lm, "x", 0.0)
                        raw_y = getattr(lm, "y", 0.0)
                        raw_z = getattr(lm, "z", None)
                        clean_x = sanitize_coord(raw_x)
                        clean_y = sanitize_coord(raw_y)
                        clean_z = sanitize_opt_coord(raw_z)
                        landmarks.append(HandLandmark(x=clean_x, y=clean_y, z=clean_z))
                        x_coords.append(clean_x)
                        y_coords.append(clean_y)
                        if check_point_in_roi(clean_x, clean_y, roi):
                            landmark_in_danger = True

                    hx_min = min(x_coords) if x_coords else 0.0
                    hx_max = max(x_coords) if x_coords else 0.0
                    hy_min = min(y_coords) if y_coords else 0.0
                    hy_max = max(y_coords) if y_coords else 0.0

                    bbox = HandBBox(
                        x_min=round(hx_min, 4),
                        y_min=round(hy_min, 4),
                        x_max=round(hx_max, 4),
                        y_max=round(hy_max, 4),
                    )

                    bbox_in_danger = check_bbox_intersects_roi(bbox, roi)
                    is_hand_in_danger = landmark_in_danger or bbox_in_danger
                    is_hand_in_zone_3d = check_hand_in_zone_3d(landmarks, zone_3d)

                    if is_hand_in_danger:
                        danger_zone_breached = True
                    if is_hand_in_zone_3d:
                        danger_zone_3d_breached = True

                    label = None
                    score = None
                    if idx < len(handedness_list) and handedness_list[idx]:
                        try:
                            first_cat = handedness_list[idx][0]
                            label = getattr(first_cat, "category_name", None) or getattr(first_cat, "display_name", None)
                            score = round(float(getattr(first_cat, "score", 0.0)), 4)
                        except (IndexError, TypeError, AttributeError):
                            pass

                    hands_list.append(
                        HandDetection(
                            label=label,
                            score=score,
                            landmarks=landmarks,
                            bbox=bbox,
                            in_danger_zone=is_hand_in_danger,
                            in_danger_zone_3d=is_hand_in_zone_3d,
                            tracking_status="TRACKED" if landmarks else "NO_LANDMARKS",
                        )
                    )

            # 2. MediaPipe Solutions API format (legacy / mock)
            elif detector_type == "solutions" or hasattr(raw_results, "multi_hand_landmarks"):
                sol_landmarks = getattr(raw_results, "multi_hand_landmarks", []) or []
                handedness_list = getattr(raw_results, "multi_handedness", []) or []

                for idx, hand_landmarks in enumerate(sol_landmarks):
                    landmarks = []
                    x_coords = []
                    y_coords = []
                    landmark_in_danger = False

                    landmark_iterable = getattr(hand_landmarks, "landmark", hand_landmarks)
                    for lm in landmark_iterable:
                        raw_x = getattr(lm, "x", 0.0)
                        raw_y = getattr(lm, "y", 0.0)
                        raw_z = getattr(lm, "z", None)
                        clean_x = sanitize_coord(raw_x)
                        clean_y = sanitize_coord(raw_y)
                        clean_z = sanitize_opt_coord(raw_z)
                        landmarks.append(HandLandmark(x=clean_x, y=clean_y, z=clean_z))
                        x_coords.append(clean_x)
                        y_coords.append(clean_y)
                        if check_point_in_roi(clean_x, clean_y, roi):
                            landmark_in_danger = True

                    hx_min = min(x_coords) if x_coords else 0.0
                    hx_max = max(x_coords) if x_coords else 0.0
                    hy_min = min(y_coords) if y_coords else 0.0
                    hy_max = max(y_coords) if y_coords else 0.0

                    bbox = HandBBox(
                        x_min=round(hx_min, 4),
                        y_min=round(hy_min, 4),
                        x_max=round(hx_max, 4),
                        y_max=round(hy_max, 4),
                    )

                    bbox_in_danger = check_bbox_intersects_roi(bbox, roi)
                    is_hand_in_danger = landmark_in_danger or bbox_in_danger
                    is_hand_in_zone_3d = check_hand_in_zone_3d(landmarks, zone_3d)

                    if is_hand_in_danger:
                        danger_zone_breached = True
                    if is_hand_in_zone_3d:
                        danger_zone_3d_breached = True

                    label = None
                    score = None
                    if idx < len(handedness_list):
                        try:
                            classification = handedness_list[idx].classification[0]
                            label = classification.label
                            score = round(float(classification.score), 4)
                        except (AttributeError, IndexError):
                            pass

                    hands_list.append(
                        HandDetection(
                            label=label,
                            score=score,
                            landmarks=landmarks,
                            bbox=bbox,
                            in_danger_zone=is_hand_in_danger,
                            in_danger_zone_3d=is_hand_in_zone_3d,
                            tracking_status="TRACKED" if landmarks else "NO_LANDMARKS",
                        )
                    )

        hand_count = len(hands_list)
        if danger_zone_breached:
            status = DetectionStatus.DANGER_ZONE_BREACH.value
        elif hand_count > 0:
            status = DetectionStatus.HAND_DETECTED.value
        else:
            status = DetectionStatus.NO_HANDS.value

        return CameraDetectionResult(
            status=status,
            hand_count=hand_count,
            hands=hands_list,
            danger_zone_breached=danger_zone_breached,
            danger_zone_3d_breached=danger_zone_3d_breached,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def _capture_worker(self) -> None:
        """Background thread worker for capturing video and detecting hands."""
        cap = None
        detector = None
        detector_type = "unknown"

        try:
            # 1. Initialize detector
            try:
                detector, detector_type = self._init_detector()
            except Exception as exc:
                with self._lock:
                    self._state = CameraLifecycleState.ERROR
                    self._error_message = f"Detector initialization failure: {str(exc)}"
                logger.error(self._error_message)
                return

            # 2. Open OpenCV video capture (prefer DSHOW on Windows for fast startup)
            try:
                cap = None
                if os.name == "nt" and cv2 is not None and hasattr(cv2, "CAP_DSHOW"):
                    try:
                        cap = cv2.VideoCapture(self._device_index, cv2.CAP_DSHOW)
                        if not cap or not cap.isOpened():
                            cap = None
                    except Exception:
                        cap = None
                if cap is None:
                    cap = cv2.VideoCapture(self._device_index)

                if not cap or not cap.isOpened():
                    with self._lock:
                        self._state = CameraLifecycleState.ERROR
                        self._error_message = f"Failed to open video capture device index {self._device_index}"
                    logger.warning(self._error_message)
                    return
            except Exception as exc:
                with self._lock:
                    self._state = CameraLifecycleState.ERROR
                    self._error_message = f"Camera device open error: {str(exc)}"
                logger.error(self._error_message)
                return

            with self._lock:
                self._state = CameraLifecycleState.RUNNING
                self._error_message = None

            frame_interval = 1.0 / max(1.0, self._target_fps)
            frame_times: List[float] = []

            # 3. Capture loop
            while not self._stop_event.is_set():
                t_start = time.time()
                try:
                    ret, frame = cap.read()
                except Exception as exc:
                    logger.warning(f"Frame capture read exception: {exc}")
                    ret = False
                    frame = None

                if not ret or frame is None:
                    time.sleep(0.02)
                    continue

                try:
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    if detector_type == "tasks":
                        img_cls = Image if Image is not None else getattr(mp, "Image", None)
                        img_fmt = ImageFormat if ImageFormat is not None else getattr(mp, "ImageFormat", None)
                        srgb_fmt = getattr(img_fmt, "SRGB", 1) if img_fmt is not None else 1
                        mp_image = img_cls(image_format=srgb_fmt, data=rgb_frame)
                        raw_results = detector.detect(mp_image)
                    else:
                        raw_results = detector.process(rgb_frame)

                    with self._lock:
                        current_roi = self._roi
                        current_zone_3d = self._zone_3d

                    detection_result = self._process_frame_detections(
                        raw_results, detector_type, current_roi, current_zone_3d
                    )

                    # Update rolling FPS
                    t_end = time.time()
                    frame_times.append(t_end)
                    if len(frame_times) > 20:
                        frame_times.pop(0)

                    actual_fps = 0.0
                    if len(frame_times) >= 2:
                        dt = frame_times[-1] - frame_times[0]
                        if dt > 0:
                            actual_fps = (len(frame_times) - 1) / dt

                    # Generate annotated display frame for MJPEG live stream
                    display_frame = frame.copy()
                    h, w = display_frame.shape[:2]

                    # 1. Draw danger zone ROI boundary
                    rx1 = int(current_roi.x_min * w)
                    ry1 = int(current_roi.y_min * h)
                    rx2 = int(current_roi.x_max * w)
                    ry2 = int(current_roi.y_max * h)

                    roi_color = (0, 0, 240) if detection_result.danger_zone_breached else (240, 200, 0)
                    cv2.rectangle(display_frame, (rx1, ry1), (rx2, ry2), roi_color, 2)
                    roi_label = "DANGER ZONE: BREACHED" if detection_result.danger_zone_breached else "EXCLUSION ZONE: CLEAR"
                    cv2.putText(display_frame, roi_label, (rx1 + 6, max(20, ry1 + 22)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, roi_color, 2)

                    # 2. Draw detected hand skeleton lines, joints, and bounding boxes
                    for hand in detection_result.hands:
                        hx1 = int(hand.bbox.x_min * w)
                        hy1 = int(hand.bbox.y_min * h)
                        hx2 = int(hand.bbox.x_max * w)
                        hy2 = int(hand.bbox.y_max * h)
                        hand_color = (0, 0, 255) if hand.in_danger_zone else (0, 255, 0)
                        cv2.rectangle(display_frame, (hx1, hy1), (hx2, hy2), hand_color, 1)

                        hand_tag = f"{hand.label or 'Hand'} {int((hand.score or 0.0) * 100)}%"
                        cv2.putText(display_frame, hand_tag, (hx1, max(15, hy1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, hand_color, 1)

                        pts = [(int(lm.x * w), int(lm.y * h)) for lm in hand.landmarks]

                        # Draw connecting bones
                        bone_color = (0, 0, 255) if hand.in_danger_zone else (255, 200, 0)  # Cyan-blue BGR
                        for j1, j2 in HAND_SKELETON_CONNECTIONS:
                            if j1 < len(pts) and j2 < len(pts):
                                cv2.line(display_frame, pts[j1], pts[j2], bone_color, 2, cv2.LINE_AA)

                        # Draw joint markers
                        for pt in pts:
                            joint_color = (0, 0, 255) if hand.in_danger_zone else (0, 255, 255)
                            cv2.circle(display_frame, pt, 4, joint_color, -1, cv2.LINE_AA)
                            cv2.circle(display_frame, pt, 5, (255, 255, 255), 1, cv2.LINE_AA)

                    ret_enc, jpeg = cv2.imencode('.jpg', display_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                    jpeg_bytes = jpeg.tobytes() if ret_enc else None

                    with self._lock:
                        self._latest_detection = detection_result
                        self._actual_fps = actual_fps
                        self._latest_frame_jpeg = jpeg_bytes

                    self._notify_callbacks(detection_result)

                except Exception as exc:
                    logger.error(f"Frame processing exception: {exc}")

                # Rate limiting to match target FPS
                elapsed = time.time() - t_start
                sleep_time = max(0.001, frame_interval - elapsed)
                self._stop_event.wait(timeout=sleep_time)

        except Exception as exc:
            logger.exception("Unexpected error in camera capture worker: %s", exc)
            with self._lock:
                self._state = CameraLifecycleState.ERROR
                self._error_message = f"Camera runtime error: {str(exc)}"
        finally:
            if detector and hasattr(detector, "close"):
                try:
                    detector.close()
                except Exception:
                    pass
            if cap:
                try:
                    cap.release()
                except Exception:
                    pass

            with self._lock:
                if self._state != CameraLifecycleState.ERROR:
                    self._state = CameraLifecycleState.STOPPED
                self._actual_fps = 0.0


# Module-level singleton instance
_camera_service: Optional[CameraService] = None


def get_camera_service() -> CameraService:
    """FastAPI dependency provider returning the global CameraService instance."""
    global _camera_service
    if _camera_service is None:
        _camera_service = CameraService()
    return _camera_service


def reset_camera_service() -> None:
    """Helper for testing to cleanly reset singleton instance."""
    global _camera_service
    if _camera_service is not None:
        _camera_service.stop()
        _camera_service = None
