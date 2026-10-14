"""
LaserGuard AI - 3D Hand Tracking & Configurable Danger Zone Tests
Tests 21 landmark extraction, safe coordinate handling, 3D zone validation,
spatial intersection with estimated relative depth, API endpoints, and 2D safety regression.
"""

import math
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
    Zone3dConfig,
    HandBBox,
    HandLandmark,
    HandDetection,
    check_point_in_zone_3d,
    check_hand_in_zone_3d,
    sanitize_coord,
    sanitize_opt_coord,
    get_camera_service,
    reset_camera_service,
)


class TestZone3dConfigAndMath(unittest.TestCase):
    """Test 3D monitoring zone schema, validation, and estimated depth math."""

    def test_default_zone_3d_valid(self):
        zone = Zone3dConfig()
        self.assertTrue(zone.enabled)
        self.assertEqual(zone.x_min, 0.2)
        self.assertEqual(zone.x_max, 0.8)
        self.assertEqual(zone.y_min, 0.2)
        self.assertEqual(zone.y_max, 0.8)
        self.assertEqual(zone.z_min, -0.3)
        self.assertEqual(zone.z_max, 0.3)

    def test_custom_valid_zone_3d(self):
        zone = Zone3dConfig(
            enabled=True,
            x_min=0.1,
            x_max=0.9,
            y_min=0.15,
            y_max=0.85,
            z_min=-0.5,
            z_max=0.4,
        )
        self.assertTrue(zone.enabled)
        self.assertEqual(zone.x_min, 0.1)
        self.assertEqual(zone.z_max, 0.4)

    def test_invalid_zone_3d_inverted_bounds(self):
        # x_min >= x_max
        with self.assertRaises(ValueError):
            Zone3dConfig(x_min=0.8, x_max=0.2)
        # y_min >= y_max
        with self.assertRaises(ValueError):
            Zone3dConfig(y_min=0.8, y_max=0.2)
        # z_min >= z_max
        with self.assertRaises(ValueError):
            Zone3dConfig(z_min=0.4, z_max=-0.1)

    def test_invalid_zone_3d_out_of_bounds(self):
        # x out of [0.0, 1.0]
        with self.assertRaises(ValidationError):
            Zone3dConfig(x_min=-0.1)
        with self.assertRaises(ValidationError):
            Zone3dConfig(x_max=1.5)
        # z out of [-1.0, 1.0]
        with self.assertRaises(ValidationError):
            Zone3dConfig(z_min=-1.5)
        with self.assertRaises(ValidationError):
            Zone3dConfig(z_max=1.5)

    def test_check_point_in_zone_3d_disabled_always_false(self):
        zone = Zone3dConfig(enabled=False, x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8, z_min=-0.3, z_max=0.3)
        self.assertFalse(check_point_in_zone_3d(0.5, 0.5, 0.0, zone))

    def test_check_point_in_zone_3d_enabled(self):
        zone = Zone3dConfig(enabled=True, x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8, z_min=-0.3, z_max=0.3)
        # Inside
        self.assertTrue(check_point_in_zone_3d(0.5, 0.5, 0.0, zone))
        self.assertTrue(check_point_in_zone_3d(0.2, 0.2, -0.3, zone))
        self.assertTrue(check_point_in_zone_3d(0.8, 0.8, 0.3, zone))
        # Outside X
        self.assertFalse(check_point_in_zone_3d(0.1, 0.5, 0.0, zone))
        # Outside Y
        self.assertFalse(check_point_in_zone_3d(0.5, 0.9, 0.0, zone))
        # Outside estimated Z (too close or too far)
        self.assertFalse(check_point_in_zone_3d(0.5, 0.5, -0.4, zone))
        self.assertFalse(check_point_in_zone_3d(0.5, 0.5, 0.5, zone))
        # Missing Z depth falls back to XY containment
        self.assertTrue(check_point_in_zone_3d(0.5, 0.5, None, zone))
        self.assertFalse(check_point_in_zone_3d(0.1, 0.5, None, zone))

    def test_check_hand_in_zone_3d(self):
        zone = Zone3dConfig(enabled=True, x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8, z_min=-0.3, z_max=0.3)
        landmarks_outside = [
            HandLandmark(x=0.1, y=0.1, z=0.0),
            HandLandmark(x=0.15, y=0.15, z=-0.1),
        ]
        self.assertFalse(check_hand_in_zone_3d(landmarks_outside, zone))

        landmarks_one_inside = [
            HandLandmark(x=0.1, y=0.1, z=0.0),
            HandLandmark(x=0.5, y=0.5, z=0.0),  # In zone
        ]
        self.assertTrue(check_hand_in_zone_3d(landmarks_one_inside, zone))


class TestLandmarkSanitizationAndExtraction(unittest.TestCase):
    """Test 21 landmark extraction, non-finite coordinate sanitization, and multi-hand detection."""

    def test_sanitize_coord(self):
        self.assertEqual(sanitize_coord(0.5), 0.5)
        self.assertEqual(sanitize_coord("0.25"), 0.25)
        self.assertEqual(sanitize_coord(float("nan"), default=0.0), 0.0)
        self.assertEqual(sanitize_coord(float("inf"), default=1.0), 1.0)
        self.assertEqual(sanitize_coord(float("-inf"), default=0.0), 0.0)
        self.assertEqual(sanitize_coord("invalid_str", default=0.3), 0.3)

    def test_sanitize_opt_coord(self):
        self.assertIsNone(sanitize_opt_coord(None))
        self.assertEqual(sanitize_opt_coord(0.12), 0.12)
        self.assertIsNone(sanitize_opt_coord(float("nan")))
        self.assertIsNone(sanitize_opt_coord(float("inf")))
        self.assertIsNone(sanitize_opt_coord("bad_val"))

    def test_hand_landmark_model_sanitization(self):
        # Non-finite values automatically sanitized
        lm = HandLandmark(x=float("nan"), y=float("inf"), z=float("-inf"))
        self.assertEqual(lm.x, 0.0)
        self.assertEqual(lm.y, 0.0)
        self.assertIsNone(lm.z)

    def test_21_landmarks_extracted_from_tasks_result(self):
        service = CameraService()
        # Mock 21 hand landmarks (standard MediaPipe skeleton)
        raw_lms = []
        for i in range(21):
            lm_mock = MagicMock()
            lm_mock.x = 0.3 + (i * 0.01)
            lm_mock.y = 0.4 + (i * 0.01)
            lm_mock.z = -0.1 + (i * 0.005)
            raw_lms.append(lm_mock)

        mock_result = MagicMock()
        mock_result.hand_landmarks = [raw_lms]
        mock_cat = MagicMock(category_name="Right", score=0.96)
        mock_result.handedness = [[mock_cat]]

        roi = RoiConfig(x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8)
        zone_3d = Zone3dConfig(enabled=True, x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8, z_min=-0.3, z_max=0.3)

        detection = service._process_frame_detections(mock_result, "tasks", roi, zone_3d)

        self.assertEqual(detection.hand_count, 1)
        self.assertEqual(len(detection.hands), 1)
        hand = detection.hands[0]
        self.assertEqual(len(hand.landmarks), 21)
        self.assertEqual(hand.label, "Right")
        self.assertEqual(hand.score, 0.96)
        self.assertEqual(hand.tracking_status, "TRACKED")
        self.assertTrue(hand.in_danger_zone)
        self.assertTrue(hand.in_danger_zone_3d)
        self.assertTrue(detection.danger_zone_breached)
        self.assertTrue(detection.danger_zone_3d_breached)

    def test_multiple_hands_detection(self):
        service = CameraService()
        # Hand 1: Inside danger zone
        h1_lms = [MagicMock(x=0.5, y=0.5, z=0.0) for _ in range(21)]
        # Hand 2: Outside danger zone
        h2_lms = [MagicMock(x=0.05, y=0.05, z=0.0) for _ in range(21)]

        mock_result = MagicMock()
        mock_result.hand_landmarks = [h1_lms, h2_lms]
        mock_result.handedness = [
            [MagicMock(category_name="Left", score=0.91)],
            [MagicMock(category_name="Right", score=0.88)],
        ]

        roi = RoiConfig(x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8)
        zone_3d = Zone3dConfig(enabled=True, x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8, z_min=-0.3, z_max=0.3)

        detection = service._process_frame_detections(mock_result, "tasks", roi, zone_3d)
        self.assertEqual(detection.hand_count, 2)
        self.assertEqual(len(detection.hands), 2)
        self.assertTrue(detection.hands[0].in_danger_zone)
        self.assertTrue(detection.hands[0].in_danger_zone_3d)
        self.assertFalse(detection.hands[1].in_danger_zone)
        self.assertFalse(detection.hands[1].in_danger_zone_3d)
        self.assertTrue(detection.danger_zone_breached)


class TestCamera3dApiEndpoints(unittest.TestCase):
    """Test 3D zone FastAPI endpoints."""

    def setUp(self):
        reset_camera_service()
        self.client = TestClient(app)

    def tearDown(self):
        reset_camera_service()

    def test_get_camera_status_includes_zone_3d(self):
        res = self.client.get("/api/camera/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("zone_3d", data)
        self.assertTrue(data["zone_3d"]["enabled"])
        self.assertEqual(data["zone_3d"]["x_min"], 0.2)
        self.assertEqual(data["zone_3d"]["z_max"], 0.3)

    def test_post_camera_zone_3d_update(self):
        payload = {
            "enabled": True,
            "x_min": 0.15,
            "x_max": 0.85,
            "y_min": 0.25,
            "y_max": 0.75,
            "z_min": -0.4,
            "z_max": 0.2,
        }
        res = self.client.post("/api/camera/zone3d", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["zone_3d"]["enabled"])
        self.assertEqual(data["zone_3d"]["x_min"], 0.15)
        self.assertEqual(data["zone_3d"]["z_min"], -0.4)

    def test_post_camera_zone_3d_invalid_returns_422(self):
        # Inverted x bounds
        payload = {
            "enabled": True,
            "x_min": 0.9,
            "x_max": 0.2,
            "y_min": 0.2,
            "y_max": 0.8,
            "z_min": -0.3,
            "z_max": 0.3,
        }
        res = self.client.post("/api/camera/zone3d", json=payload)
        self.assertEqual(res.status_code, 422)

    def test_post_camera_zone_3d_reset(self):
        # First update to custom
        self.client.post("/api/camera/zone3d", json={"enabled": True, "x_min": 0.1, "x_max": 0.9, "y_min": 0.1, "y_max": 0.9, "z_min": -0.5, "z_max": 0.5})
        # Reset to defaults
        res_reset = self.client.post("/api/camera/zone3d/reset")
        self.assertEqual(res_reset.status_code, 200)
        data = res_reset.json()
        self.assertTrue(data["zone_3d"]["enabled"])
        self.assertEqual(data["zone_3d"]["x_min"], 0.2)
        self.assertEqual(data["zone_3d"]["z_max"], 0.3)


class TestCamera3dRegressionWith2dSafety(unittest.TestCase):
    """Ensure experimental 3D logic never weakens or replaces 2D safety decisions."""

    def test_2d_intrusion_independent_of_3d_enabled(self):
        service = CameraService()
        # Hand inside 2D ROI [0.2, 0.8]
        raw_lms = [MagicMock(x=0.5, y=0.5, z=0.0) for _ in range(21)]
        mock_result = MagicMock()
        mock_result.hand_landmarks = [raw_lms]
        mock_result.handedness = [[MagicMock(category_name="Right", score=0.95)]]

        roi = RoiConfig(x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8)

        # Case 1: 3D Zone disabled
        zone_disabled = Zone3dConfig(enabled=False)
        det_disabled = service._process_frame_detections(mock_result, "tasks", roi, zone_disabled)
        self.assertTrue(det_disabled.danger_zone_breached)  # 2D still triggered!
        self.assertFalse(det_disabled.danger_zone_3d_breached)

        # Case 2: 3D Zone enabled with strict Z where hand is outside Z range
        zone_narrow_z = Zone3dConfig(enabled=True, x_min=0.2, x_max=0.8, y_min=0.2, y_max=0.8, z_min=0.5, z_max=0.9)
        det_narrow = service._process_frame_detections(mock_result, "tasks", roi, zone_narrow_z)
        # Even though 3D z is not breached, 2D safety MUST remain breached!
        self.assertTrue(det_narrow.danger_zone_breached)
        self.assertFalse(det_narrow.danger_zone_3d_breached)


if __name__ == "__main__":
    unittest.main()
