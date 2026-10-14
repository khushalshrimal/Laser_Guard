"""
LaserGuard AI - Modular Camera Service
Uses OpenCV and MediaPipe Hands (Tasks API / Solutions API) for real-time advisory
hand tracking and danger-zone intrusion detection.
"""

import logging
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
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    mp = None
    MEDIAPIPE_AVAILABLE = False


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


class HandLandmark(BaseModel):
    """Normalized 3D landmark coordinate for a detected hand keypoint."""
    x: float
    y: float
    z: Optional[float] = None


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


class CameraDetectionResult(BaseModel):
    """Aggregated detection result from processing a camera frame."""
    status: str = DetectionStatus.NO_HANDS.value
    hand_count: int = 0
    hands: List[HandDetection] = Field(default_factory=list)
    danger_zone_breached: bool = False
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
    error_message: Optional[str] = None
    latest_detection: Optional[CameraDetectionResult] = None
    available: bool = True


class CameraStartRequest(BaseModel):
    """Request payload to start the camera service with optional configuration overrides."""
    device_index: Optional[int] = Field(default=None, ge=0, description="Webcam device index")
    target_fps: Optional[float] = Field(default=None, gt=0.0, le=60.0, description="Target capture FPS")
    roi: Optional[RoiConfig] = Field(default=None, description="Danger zone ROI configuration")


def check_point_in_roi(x: float, y: float, roi: RoiConfig) -> bool:
    """Check if a normalized (x, y) point lies inside the danger zone ROI."""
    return roi.x_min <= x <= roi.x_max and roi.y_min <= y <= roi.y_max


def check_bbox_intersects_roi(bbox: HandBBox, roi: RoiConfig) -> bool:
    """Check if a normalized hand bounding box intersects with the danger zone ROI."""
    overlap_x = max(0.0, min(bbox.x_max, roi.x_max) - max(bbox.x_min, roi.x_min))
    overlap_y = max(0.0, min(bbox.y_max, roi.y_max) - max(bbox.y_min, roi.y_min))
    return (overlap_x > 0.0) and (overlap_y > 0.0)


class CameraService:
    """
    Modular thread-safe Camera Service.
    Runs a non-blocking background capture thread, processes frames with MediaPipe Hands,
    evaluates danger-zone intersection, and maintains thread-safe detection status.
    """

    def __init__(
        self,
        device_index: int = 0,
        target_fps: float = 10.0,
        roi: Optional[RoiConfig] = None,
        model_path: Optional[str] = None,
    ):
        self._device_index = device_index
        self._target_fps = target_fps
        self._roi = roi or RoiConfig()
        self._model_path = model_path or self._resolve_default_model_path()

        self._state = CameraLifecycleState.STOPPED
        self._error_message: Optional[str] = None
        self._actual_fps: float = 0.0
        self._latest_detection: Optional[CameraDetectionResult] = None

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._detection_callbacks: List[Callable[[Optional[CameraDetectionResult]], None]] = []

    @staticmethod
    def _resolve_default_model_path() -> Optional[str]:
        """Attempt to locate the hand_landmarker.task model file in standard locations."""
        candidates = [
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "hand_landmarker.task"),
            os.path.join(os.getcwd(), "models", "hand_landmarker.task"),
            os.path.join(os.getcwd(), "backend", "models", "hand_landmarker.task"),
        ]
        for p in candidates:
            if os.path.exists(p):
                return p
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
            status_resp = self._get_status_unlocked()

        # Notify callbacks that camera has stopped / offline
        self._notify_callbacks(None)
        return status_resp

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

    def _get_status_unlocked(self) -> CameraStatusResponse:
        """Internal helper to construct status while caller already holds self._lock."""
        return CameraStatusResponse(
            state=self._state.value,
            device_index=self._device_index,
            target_fps=self._target_fps,
            actual_fps=round(self._actual_fps, 2),
            roi=self._roi,
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

        # Check for MediaPipe Tasks API
        if hasattr(mp, "tasks") and hasattr(mp.tasks, "python") and hasattr(mp.tasks.python, "vision"):
            vision = mp.tasks.python.vision
            if hasattr(vision, "HandLandmarker"):
                if not self._model_path or not os.path.exists(self._model_path):
                    raise FileNotFoundError(
                        f"MediaPipe Hand Landmarker model file not found at '{self._model_path}'. "
                        "Please provide hand_landmarker.task model file."
                    )
                base_options = mp.tasks.python.BaseOptions(model_asset_path=self._model_path)
                options = vision.HandLandmarkerOptions(
                    base_options=base_options,
                    running_mode=vision.RunningMode.IMAGE,
                    num_hands=2,
                    min_hand_detection_confidence=0.5,
                    min_tracking_confidence=0.5,
                )
                detector = vision.HandLandmarker.create_from_options(options)
                return detector, "tasks"

        # Check for legacy MediaPipe Solutions API
        if hasattr(mp, "solutions") and hasattr(mp.solutions, "hands"):
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
    ) -> CameraDetectionResult:
        """
        Transform detection results from either Tasks or Solutions API into structured
        CameraDetectionResult and evaluate danger-zone ROI intersections.
        """
        hands_list: List[HandDetection] = []
        danger_zone_breached = False

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
                        landmarks.append(HandLandmark(x=lm.x, y=lm.y, z=getattr(lm, "z", None)))
                        x_coords.append(lm.x)
                        y_coords.append(lm.y)
                        if check_point_in_roi(lm.x, lm.y, roi):
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

                    if is_hand_in_danger:
                        danger_zone_breached = True

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
                        landmarks.append(HandLandmark(x=lm.x, y=lm.y, z=getattr(lm, "z", None)))
                        x_coords.append(lm.x)
                        y_coords.append(lm.y)
                        if check_point_in_roi(lm.x, lm.y, roi):
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

                    if is_hand_in_danger:
                        danger_zone_breached = True

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

            # 2. Open OpenCV video capture
            try:
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
                        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                        raw_results = detector.detect(mp_image)
                    else:
                        raw_results = detector.process(rgb_frame)

                    with self._lock:
                        current_roi = self._roi

                    detection_result = self._process_frame_detections(raw_results, detector_type, current_roi)

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

                    with self._lock:
                        self._latest_detection = detection_result
                        self._actual_fps = actual_fps

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
