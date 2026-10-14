"""
LaserGuard AI - Camera Service Automated Tests
Tests camera lifecycle, danger zone ROI validation, mock hand detection,
error handling, and FastAPI endpoints without requiring physical hardware.
"""

import time
import unittest
from unittest.mock import MagicMock, patch
from pydantic import ValidationError
from fastapi.testclient import TestClient

from app.main import app
from app.camera_service import (
    CameraService,
    CameraLifecycleState,
    DetectionStatus,
    RoiConfig,
    HandBBox,
    HandLandmark,
    check_point_in_roi,
    check_bbox_intersects_roi,
    get_camera_service,
    reset_camera_service,
)


class TestRoiAndIntersectionMath(unittest.TestCase):
    """Test ROI configuration schema, validation, and spatial intersection math."""

    def test_default_roi_valid(self):
        roi = RoiConfig()
        self.assertEqual(roi.x_min, 0.2)
        self.assertEqual(roi.y_min, 0.2)
        self.assertEqual(roi.x_max, 0.8)
        self.assertEqual(roi.y_max, 0.8)

    def test_custom_valid_roi(self):
        roi = RoiConfig(x_min=0.1, y_min=0.15, x_max=0.85, y_max=0.9)
        self.assertEqual(roi.x_min, 0.1)
        self.assertEqual(roi.x_max, 0.85)

    def test_invalid_roi_inverted_bounds(self):
        with self.assertRaises(ValueError):
            RoiConfig(x_min=0.8, x_max=0.2)
        with self.assertRaises(ValueError):
            RoiConfig(y_min=0.9, y_max=0.1)
        with self.assertRaises(ValueError):
            RoiConfig(x_min=0.5, x_max=0.5)

    def test_invalid_roi_out_of_bounds(self):
        with self.assertRaises(ValidationError):
            RoiConfig(x_min=-0.1)
        with self.assertRaises(ValidationError):
            RoiConfig(x_max=1.5)

    def test_check_point_in_roi(self):
        roi = RoiConfig(x_min=0.2, y_min=0.2, x_max=0.8, y_max=0.8)
        # Inside
        self.assertTrue(check_point_in_roi(0.5, 0.5, roi))
        self.assertTrue(check_point_in_roi(0.2, 0.2, roi))
        self.assertTrue(check_point_in_roi(0.8, 0.8, roi))
        # Outside
        self.assertFalse(check_point_in_roi(0.1, 0.5, roi))
        self.assertFalse(check_point_in_roi(0.5, 0.9, roi))
        self.assertFalse(check_point_in_roi(0.0, 0.0, roi))

    def test_check_bbox_intersects_roi(self):
        roi = RoiConfig(x_min=0.2, y_min=0.2, x_max=0.8, y_max=0.8)
        # Overlapping bbox
        bbox_overlapping = HandBBox(x_min=0.1, y_min=0.1, x_max=0.3, y_max=0.3)
        self.assertTrue(check_bbox_intersects_roi(bbox_overlapping, roi))

        # Enclosed bbox
        bbox_enclosed = HandBBox(x_min=0.3, y_min=0.3, x_max=0.5, y_max=0.5)
        self.assertTrue(check_bbox_intersects_roi(bbox_enclosed, roi))

        # Disjoint bbox (outside completely)
        bbox_disjoint = HandBBox(x_min=0.85, y_min=0.85, x_max=0.95, y_max=0.95)
        self.assertFalse(check_bbox_intersects_roi(bbox_disjoint, roi))


class TestCameraServiceUnit(unittest.TestCase):
    """Test CameraService lifecycle, error handling, mock detection, and threads."""

    def setUp(self):
        reset_camera_service()
        self.service = CameraService(device_index=0, target_fps=10.0)

    def tearDown(self):
        self.service.stop()
        reset_camera_service()

    def test_initial_state(self):
        status = self.service.get_status()
        self.assertEqual(status.state, CameraLifecycleState.STOPPED.value)
        self.assertEqual(status.device_index, 0)
        self.assertEqual(status.actual_fps, 0.0)
        self.assertIsNone(status.latest_detection)
        self.assertIsNone(status.error_message)

    def test_graceful_missing_dependencies(self):
        with patch.object(CameraService, "is_available", False):
            status = self.service.start()
            self.assertEqual(status.state, CameraLifecycleState.ERROR.value)
            self.assertIn("not available", status.error_message)

    @patch("app.camera_service.cv2.VideoCapture")
    def test_webcam_open_failure(self, mock_cv2_capture):
        # Setup mock capture that fails to open
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = False
        mock_cv2_capture.return_value = mock_cap

        # Mock detector initialization so it succeeds
        mock_detector = MagicMock()
        with patch.object(self.service, "_init_detector", return_value=(mock_detector, "solutions")):
            status = self.service.start()
            time.sleep(0.12)
            status = self.service.get_status()
            self.assertEqual(status.state, CameraLifecycleState.ERROR.value)
            self.assertIn("Failed to open video capture", status.error_message)

    def test_detector_init_failure(self):
        with patch.object(
            self.service,
            "_init_detector",
            side_effect=RuntimeError("Model file corrupted or not found"),
        ):
            self.service.start()
            time.sleep(0.12)
            status = self.service.get_status()
            self.assertEqual(status.state, CameraLifecycleState.ERROR.value)
            self.assertIn("Detector initialization failure", status.error_message)

    @patch("app.camera_service.cv2.VideoCapture")
    def test_successful_start_stop_lifecycle(self, mock_cv2_capture):
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.read.return_value = (False, None)  # No frame but loop runs safely
        mock_cv2_capture.return_value = mock_cap

        mock_detector = MagicMock()
        with patch.object(self.service, "_init_detector", return_value=(mock_detector, "solutions")):
            status_start = self.service.start()
            time.sleep(0.1)
            self.assertEqual(self.service.get_status().state, CameraLifecycleState.RUNNING.value)

            # Idempotent start: calling start again should not raise or recreate thread
            status_restart = self.service.start()
            self.assertEqual(status_restart.state, CameraLifecycleState.RUNNING.value)

            # Stop camera
            status_stop = self.service.stop()
            self.assertEqual(status_stop.state, CameraLifecycleState.STOPPED.value)
            mock_cap.release.assert_called()

            # Idempotent stop
            status_stop2 = self.service.stop()
            self.assertEqual(status_stop2.state, CameraLifecycleState.STOPPED.value)

    def test_detection_results_no_hands(self):
        # Empty mock result (no hands)
        mock_result = MagicMock()
        mock_result.hand_landmarks = []
        mock_result.handedness = []

        roi = RoiConfig(x_min=0.2, y_min=0.2, x_max=0.8, y_max=0.8)
        detection = self.service._process_frame_detections(mock_result, "tasks", roi)

        self.assertEqual(detection.status, DetectionStatus.NO_HANDS.value)
        self.assertEqual(detection.hand_count, 0)
        self.assertFalse(detection.danger_zone_breached)
        self.assertEqual(len(detection.hands), 0)

    def test_detection_results_hand_outside_danger(self):
        # Hand at top-left corner outside danger zone (roi is [0.2, 0.8])
        mock_landmark = MagicMock(x=0.05, y=0.05, z=0.0)
        mock_result = MagicMock()
        mock_result.hand_landmarks = [[mock_landmark]]
        mock_cat = MagicMock(category_name="Right", score=0.95)
        mock_result.handedness = [[mock_cat]]

        roi = RoiConfig(x_min=0.2, y_min=0.2, x_max=0.8, y_max=0.8)
        detection = self.service._process_frame_detections(mock_result, "tasks", roi)

        self.assertEqual(detection.status, DetectionStatus.HAND_DETECTED.value)
        self.assertEqual(detection.hand_count, 1)
        self.assertFalse(detection.danger_zone_breached)
        self.assertFalse(detection.hands[0].in_danger_zone)
        self.assertEqual(detection.hands[0].label, "Right")

    def test_detection_results_hand_inside_danger(self):
        # Hand inside danger zone (x=0.5, y=0.5)
        mock_landmark = MagicMock(x=0.5, y=0.5, z=0.0)
        mock_result = MagicMock()
        mock_result.hand_landmarks = [[mock_landmark]]
        mock_cat = MagicMock(category_name="Left", score=0.92)
        mock_result.handedness = [[mock_cat]]

        roi = RoiConfig(x_min=0.2, y_min=0.2, x_max=0.8, y_max=0.8)
        detection = self.service._process_frame_detections(mock_result, "tasks", roi)

        self.assertEqual(detection.status, DetectionStatus.DANGER_ZONE_BREACH.value)
        self.assertEqual(detection.hand_count, 1)
        self.assertTrue(detection.danger_zone_breached)
        self.assertTrue(detection.hands[0].in_danger_zone)
        self.assertEqual(detection.hands[0].label, "Left")


class TestCameraApiEndpoints(unittest.TestCase):
    """Test FastAPI camera endpoints with TestClient."""

    def setUp(self):
        reset_camera_service()
        self.client = TestClient(app)

    def tearDown(self):
        reset_camera_service()

    def test_get_camera_status_endpoint(self):
        response = self.client.get("/api/camera/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("state", data)
        self.assertIn("device_index", data)
        self.assertIn("target_fps", data)
        self.assertIn("actual_fps", data)
        self.assertIn("roi", data)
        self.assertIn("available", data)

    @patch("app.camera_service.cv2.VideoCapture")
    def test_start_and_stop_camera_endpoints(self, mock_cv2_capture):
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.read.return_value = (False, None)
        mock_cv2_capture.return_value = mock_cap

        camera_svc = get_camera_service()
        mock_detector = MagicMock()

        with patch.object(camera_svc, "_init_detector", return_value=(mock_detector, "solutions")):
            # Start camera via POST /api/camera/start
            start_payload = {
                "device_index": 0,
                "target_fps": 15.0,
                "roi": {
                    "x_min": 0.25,
                    "y_min": 0.25,
                    "x_max": 0.75,
                    "y_max": 0.75,
                },
            }
            res_start = self.client.post("/api/camera/start", json=start_payload)
            self.assertEqual(res_start.status_code, 200)
            data_start = res_start.json()
            self.assertEqual(data_start["target_fps"], 15.0)
            self.assertEqual(data_start["roi"]["x_min"], 0.25)

            # Stop camera via POST /api/camera/stop
            res_stop = self.client.post("/api/camera/stop")
            self.assertEqual(res_stop.status_code, 200)
            data_stop = res_stop.json()
            self.assertEqual(data_stop["state"], CameraLifecycleState.STOPPED.value)

    def test_root_endpoint_includes_camera_urls(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("camera_status_endpoint", data)
        self.assertEqual(data["camera_status_endpoint"], "/api/camera/status")
        self.assertIn("camera_start_endpoint", data)
        self.assertIn("camera_stop_endpoint", data)
        self.assertIn("camera_stream_endpoint", data)
        self.assertEqual(data["camera_stream_endpoint"], "/api/camera/stream")

    def test_camera_stream_stopped_returns_503(self):
        # Camera is stopped
        response = self.client.get("/api/camera/stream")
        self.assertEqual(response.status_code, 503)
        self.assertIn("Camera service is not currently running", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
