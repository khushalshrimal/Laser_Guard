# LaserGuard AI — Smart Laser-Cutting Machine Safety & Monitoring System

> **Hackathon Reference:** SKIT014  
> **Milestone:** Foundation (Decoupled React + FastAPI Pipeline)

LaserGuard AI is a real-time safety and telemetric monitoring application designed for industrial CO₂ and fiber laser cutters. It monitors enclosure switches, thermal sensors, optical flame/smoke detectors, and machine state to trigger rapid warnings, visual telemetry, and interlock control.

---

## ⚠️ Important Safety Protocol Notice
- **Foundation Milestone Only:** This repository currently houses the foundational architecture.
- **Hardware Disconnected:** No real laser cutting machinery or physical actuators are currently attached.
- **No Physical E-Stop Actuation:** Physical emergency-stop and optical beam isolation relays have NOT been energized or triggered.
- **Architectural Policy:** Communication with both the **SIMULATOR** and the physical **HARDWARE** (ESP32) is designed using direct HTTP POST and WebSockets. **MQTT is not used.**

---

## Project Architecture

```
Laser_Guard/
├── backend/                      # Python + FastAPI Backend
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI entry point, CORS, /health, /ingest, /api/status, /ws/status
│   │   ├── registry.py          # In-memory device registry & stale-data detection
│   │   ├── schemas.py           # Pydantic telemetry contract & WebSocket models
│   │   └── websocket_manager.py # WebSocket client pool, initial snapshot, live broadcast
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── test_health.py       # Automated unit tests for /health & /
│   │   ├── test_ingest.py       # Automated unit tests for POST /ingest validation
│   │   ├── test_status.py       # Automated unit tests for device status & stale detection
│   │   └── test_websocket.py    # Automated unit tests for WebSocket live stream & stale broadcast
│   ├── .env.example             # Example environment configuration (includes STALE_THRESHOLD_SECONDS)
│   ├── requirements.txt         # Pinned backend dependencies
│   └── .venv/                   # Python virtual environment (ignored by git)
│
├── frontend/                     # React + TypeScript + Vite Frontend
│   ├── src/
│   │   ├── App.tsx              # Industrial dark dashboard foundation
│   │   ├── main.tsx             # React entry point
│   │   ├── index.css            # Tailwind CSS directives
│   │   └── vite-env.d.ts        # Vite environment type declarations
│   ├── .env.example             # Frontend environment variables
│   ├── index.html               # Industrial dark HTML shell
│   ├── package.json             # Frontend dependencies & build scripts
│   ├── postcss.config.js        # PostCSS configuration
│   ├── tailwind.config.js       # Industrial color palette & typography
│   ├── tsconfig.json            # TypeScript configuration
│   └── tsconfig.node.json       # Vite TypeScript configuration
│
├── .gitignore                   # Multi-language ignore rules
└── README.md                    # Setup and run instructions
```

---

## Prerequisites

Ensure the following tools are installed on your Windows machine:
- **Node.js** (v18+ recommended; tested on v24)
- **npm** (v9+ recommended; tested on v11)
- **Python** (v3.10+ recommended; tested on v3.14)
- **Git**

---

## Windows PowerShell Setup & Run Instructions

Open two separate Windows PowerShell windows to run the frontend and backend independently.

### Terminal 1: Backend (FastAPI)

1. Open PowerShell and navigate to the `backend` directory:
   ```powershell
   cd c:\Users\khush\OneDrive\Desktop\Laser_Guard\backend
   ```

2. (Optional) Create a virtual environment if not already present:
   ```powershell
   python -m venv .venv
   ```

3. Activate the virtual environment:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```
   > *Note:* If PowerShell reports execution policy restrictions, allow local scripts by running:
   > ```powershell
   > Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
   > ```

4. Install backend dependencies:
   ```powershell
   python -m pip install -r requirements.txt
   ```

5. (Optional) Run automated health tests:
   ```powershell
   python -m unittest tests/test_health.py
   ```

6. Start the FastAPI development server:
   ```powershell
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

The backend is now live at:
- **Health Check:** [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
- **Interactive Swagger Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

### Terminal 2: Frontend (React + Vite + Tailwind CSS)

1. Open a second PowerShell window and navigate to the `frontend` directory:
   ```powershell
   cd c:\Users\khush\OneDrive\Desktop\Laser_Guard\frontend
   ```

2. Install dependencies:
   ```powershell
   npm install
   ```

3. (Optional) Verify production build:
   ```powershell
   npm run build
   ```

4. Start the Vite development server:
   ```powershell
   npm run dev
   ```

The frontend dashboard is now accessible at:
- **Web UI:** [http://127.0.0.1:5173](http://127.0.0.1:5173)

---

## Configuration

Both frontend and backend include safe `.env.example` templates. Never commit `.env` files with secret keys.

- `backend/.env.example`: Configures `HOST`, `PORT`, `CORS_ORIGINS`, and `LOG_LEVEL`.
- `frontend/.env.example`: Configures `VITE_API_BASE_URL` and `VITE_WS_BASE_URL`.

---

## Telemetry Ingestion Contract (`POST /ingest`)

Both the physical ESP32 (`HARDWARE`) and the simulator (`SIMULATOR`) submit JSON payloads to `POST /ingest` using an identical contract. **MQTT is not used.**

### Field Specifications & Sensor Units

| Field Path | Type | Required? | Units / Scale | Description |
|---|---|---|---|---|
| `source` | `string` | **Yes** | `"HARDWARE"` \| `"SIMULATOR"` | Origin of the telemetry frame. Arbitrary strings or lowercase are rejected (HTTP 422). |
| `device_id` | `string` | **Yes** | Non-empty string | Unique device identifier (e.g. `"esp32-cutter-01"`). Blank whitespace is rejected. |
| `timestamp` | `string` | Optional | ISO 8601 string | Client timestamp. If omitted, server generates current UTC timestamp. If provided, normalized to standard UTC ISO 8601 (`...Z`). |
| `readings` | `object` | Optional | Nested object | Dictionary of available sensor readings. Extra unknown fields are forbidden (`extra="forbid"`). |
| `readings.door_open` | `boolean` | Optional | `true` \| `false` | Strict boolean. True if protective enclosure door is open, False if closed. Coercion from strings (`"true"`, `"yes"`) is rejected. |
| `readings.flame_detected` | `boolean` | Optional | `true` \| `false` | Strict boolean. True if optical flame sensor detects flame, False if nominal. |
| `readings.smoke_level` | `float` | Optional | Obscuration index (`>= 0.0`) | Non-negative numeric concentration index (0.0 = clean, >300 = dense smoke). Negative values are rejected. |
| `readings.temperature_c` | `float` | Optional | Degrees Celsius (°C) | Laser chamber or workpiece temperature (`-40.0` to `500.0` °C). Non-numeric values are rejected. |
| `readings.machine_enabled` | `boolean` | Optional | `true` \| `false` | Strict boolean. Machine safety permission/interlock armed state. |
| `readings.machine_running` | `boolean` | Optional | `true` \| `false` | Strict boolean. True if laser beam is actively cutting/firing, False if idle. |
| `readings.radiation_level` | `float` | Optional | Optical / scatter index (`>= 0.0`) | Optional reserved reading for future compatible sensors. Does not imply real radiation hardware is currently installed. |

---

### Example Ingestion Request & Response

#### Request (`POST http://127.0.0.1:8000/ingest`)
```json
{
  "source": "HARDWARE",
  "device_id": "esp32-cutter-01",
  "timestamp": "2026-10-14T10:45:00Z",
  "readings": {
    "door_open": false,
    "flame_detected": false,
    "smoke_level": 8.5,
    "temperature_c": 27.3,
    "machine_enabled": true,
    "machine_running": true,
    "radiation_level": 0.02
  }
}
```

#### Successful Response (`200 OK`)
```json
{
  "status": "accepted",
  "message": "Telemetry frame ingested and normalized successfully",
  "ingested_at": "2026-10-14T10:45:00.123456Z",
  "data": {
    "source": "HARDWARE",
    "device_id": "esp32-cutter-01",
    "timestamp": "2026-10-14T10:45:00.000000Z",
    "readings": {
      "door_open": false,
      "flame_detected": false,
      "smoke_level": 8.5,
      "temperature_c": 27.3,
      "machine_enabled": true,
      "machine_running": true,
      "radiation_level": 0.02
    }
  }
}
```

#### Example Validation Error Response (`422 Unprocessable Entity`)
When invalid types, string booleans, or negative sensor values are sent:
```json
{
  "detail": [
    {
      "type": "greater_than_equal",
      "loc": ["body", "readings", "smoke_level"],
      "msg": "Input should be greater than or equal to 0",
      "input": -5.0,
      "ctx": {"ge": 0.0}
    }
  ]
}
```

---

### Testing `/ingest` in Windows PowerShell

#### 1. Run Automated Ingestion Tests
```powershell
cd c:\Users\khush\OneDrive\Desktop\Laser_Guard\backend
.\.venv\Scripts\python -m unittest discover tests
```

#### 2. Test Live Endpoint Using PowerShell (`Invoke-RestMethod`)
With the backend server running (`uvicorn app.main:app --reload`), run:

```powershell
# Send valid HARDWARE frame
$body = @{
    source = "HARDWARE"
    device_id = "esp32-cutter-01"
    readings = @{
        door_open = $false
        flame_detected = $false
        smoke_level = 14.2
        temperature_c = 26.8
        machine_enabled = $true
        machine_running = $true
    }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://127.0.0.1:8000/ingest" -Method Post -ContentType "application/json" -Body $body
```

---

## Device Health & Stale-Data Detection (`GET /api/status`)

LaserGuard AI maintains a thread-safe, in-memory device registry that monitors the connectivity health of each reporting device.

### How Stale Detection Operates
1. **Server-Side Timestamping:** Connectivity is computed relative to the server's UTC reception time (`last_seen`), completely decoupled from untrusted client clocks.
2. **Threshold Window:** When `(now - last_seen) <= STALE_THRESHOLD_SECONDS`, the device is marked **`ONLINE`**. Once elapsed time exceeds the threshold, it automatically transitions to **`STALE`**.
3. **No False Positives:** Devices that have never sent telemetry are not present in the registry and will never be reported as online.
4. **Independent Tracking:** Multiple devices (`HARDWARE` and `SIMULATOR`) maintain strictly isolated state.
5. **In-Memory Limitations:** The registry resets whenever the FastAPI backend process restarts. Permanent event history belongs to a later SQLite blackbox milestone.
6. **Safety Disclaimer:** The `ONLINE` state reflects network communication health only; it does **not** certify physical sensor calibration or hardware emergency-stop actuation.

### Configuration
Set the stale threshold via environment variable or `.env`:
```env
STALE_THRESHOLD_SECONDS=10.0
```
Clients may also provide an ad-hoc query parameter for diagnostics: `GET /api/status?stale_threshold=5.0` or query a specific device: `GET /api/status?device_id=esp32-cutter-01`.

### Example `GET /api/status` Response (`200 OK`)
```json
{
  "status": "ok",
  "server_time": "2026-10-14T10:55:00.123456Z",
  "stale_threshold_seconds": 10.0,
  "device_count": 2,
  "devices": [
    {
      "device_id": "esp32-cutter-01",
      "source": "HARDWARE",
      "connectivity_state": "ONLINE",
      "last_seen": "2026-10-14T10:54:58.200000Z",
      "seconds_since_last_seen": 1.92,
      "stale_threshold_seconds": 10.0,
      "latest_readings": {
        "door_open": false,
        "flame_detected": false,
        "smoke_level": 8.5,
        "temperature_c": 27.3,
        "machine_enabled": true,
        "machine_running": true,
        "radiation_level": 0.02
      }
    },
    {
      "device_id": "sim-cutter-backup",
      "source": "SIMULATOR",
      "connectivity_state": "STALE",
      "last_seen": "2026-10-14T10:50:10.000000Z",
      "seconds_since_last_seen": 290.12,
      "stale_threshold_seconds": 10.0,
      "latest_readings": {
        "door_open": true,
        "flame_detected": false,
        "smoke_level": 0.0,
        "temperature_c": 21.0,
        "machine_enabled": false,
        "machine_running": false,
        "radiation_level": null
      }
    }
  ],
  "disclaimer": "Software connectivity state only. Does not guarantee physical sensor health or hardware interlock engagement."
}
```

### PowerShell Query Commands
```powershell
# Retrieve all registered devices and connectivity state
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/status" -Method Get

# Filter by a specific device ID
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/status?device_id=esp32-cutter-01" -Method Get
```

---

## Live Telemetry Streaming with WebSockets (`/ws/status`)

LaserGuard AI provides a real-time pub-sub stream via FastAPI WebSockets at `/ws/status`.

### Architecture & Pipeline
1. **Unified Ingestion:** Sensors (`HARDWARE` ESP32 or `SIMULATOR`) send JSON via `POST /ingest`.
2. **Atomic Registry Update:** Payload is strictly validated and recorded in the in-memory registry.
3. **Instant Push Distribution:** An updated status snapshot is asynchronously broadcast to all connected WebSocket clients without client polling.
4. **Resilient Client Management:** Slow, disconnected, or closed sockets are automatically detected and pruned without interrupting broadcasts or crashing HTTP ingestion.
5. **Accurate Stale Notifications:** The backend includes a background monitor that checks device states against `STALE_THRESHOLD_SECONDS`. If a device goes offline without new packets arriving, an automatic `stale_transition` event is pushed to connected clients.
6. **No MQTT Broker Required:** Zero external broker overhead.

### WebSocket JSON Message Specification

Every message published by `/ws/status` uses a standardized envelope:
```json
{
  "event": "status_snapshot | telemetry_update | stale_transition | pong",
  "data": { ... SystemStatusResponse ... }
}
```

| Event Type | Trigger | Purpose |
|---|---|---|
| `status_snapshot` | Client connects or sends `"refresh"` | Immediate full system state synchronization |
| `telemetry_update` | Valid frame accepted at `POST /ingest` | Live push of new sensor readings and updated last-seen time |
| `stale_transition` | Device exceeds `STALE_THRESHOLD_SECONDS` | Instant notification that a device has gone offline |
| `pong` | Client sends `"ping"` | Keep-alive heartbeat response |

### Example WebSocket Message (`telemetry_update`)
```json
{
  "event": "telemetry_update",
  "data": {
    "status": "ok",
    "server_time": "2026-10-14T11:06:00.123456Z",
    "stale_threshold_seconds": 10.0,
    "device_count": 1,
    "devices": [
      {
        "device_id": "esp32-cutter-01",
        "source": "HARDWARE",
        "connectivity_state": "ONLINE",
        "last_seen": "2026-10-14T11:05:59.800000Z",
        "seconds_since_last_seen": 0.32,
        "stale_threshold_seconds": 10.0,
        "latest_readings": {
          "door_open": false,
          "flame_detected": false,
          "smoke_level": 8.5,
          "temperature_c": 27.3,
          "machine_enabled": true,
          "machine_running": true,
          "radiation_level": 0.02
        }
      }
    ],
    "disclaimer": "Software connectivity state only. Does not guarantee physical sensor health or hardware interlock engagement."
  }
}
```

### Testing the WebSocket Stream in Windows PowerShell
Using Python one-liner in the active virtual environment:
```powershell
cd c:\Users\khush\OneDrive\Desktop\Laser_Guard\backend
.\.venv\Scripts\python -c "import asyncio, websockets, json;
async def listen():
    async with websockets.connect('ws://127.0.0.1:8000/ws/status') as ws:
        print('Connected! Waiting for events...')
        while True:
            msg = await ws.recv()
            print('Received event:', json.loads(msg).get('event'))
asyncio.run(listen())
"
```

---

## License & Team
LaserGuard AI is created for Hackathon SKIT014.

