import unittest
from fastapi.testclient import TestClient
from app.main import app

class TestLaserGuardHealth(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_root_endpoint(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["app"], "LaserGuard AI")
        self.assertEqual(data["status"], "online")

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["app"], "LaserGuard AI")
        self.assertFalse(data["hardware_connected"])
        self.assertEqual(data["active_source"], "NONE")
        self.assertIn("notice", data)

if __name__ == "__main__":
    unittest.main()
