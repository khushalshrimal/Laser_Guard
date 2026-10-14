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
│   │   ├── main.py              # FastAPI entry point, CORS, /health, /ingest, /api/status, /api/safety, /api/events, /ws/status
│   │   ├── event_store.py       # SQLite blackbox event store, transition auditing, retention pruning
│   │   ├── registry.py          # In-memory device registry & stale-data detection
│   │   ├── safety_engine.py     # Safety rules engine & fail-safe evaluation
│   │   ├── schemas.py           # Pydantic telemetry contract, safety models, blackbox event schemas
│   │   └── websocket_manager.py # WebSocket client pool, initial snapshot, live broadcast
│   ├── data/                    # Git-ignored local SQLite runtime directory
│   │   └── laserguard_blackbox.db
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── test_event_store.py  # Automated unit & integration tests for blackbox SQLite store
│   │   ├── test_health.py       # Automated unit tests for /health & /
│   │   ├── test_ingest.py       # Automated unit tests for POST /ingest validation
│   │   ├── test_safety.py       # Automated unit tests for safety rules engine & severity precedence
│   │   ├── test_status.py       # Automated unit tests for device status & stale detection
│   │   └── test_websocket.py    # Automated unit tests for WebSocket live stream & stale broadcast
│   ├── .env.example             # Example configuration (STALE_THRESHOLD, DATABASE_PATH, MAX_EVENTS_RETAINED)
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

## Safety Rules Engine & Fail-Safe Evaluation (`GET /api/safety`)

LaserGuard AI includes a decoupled backend safety rules engine (`backend/app/safety_engine.py`) that evaluates incoming telemetry and produces structured safety assessments.

> [!WARNING]
> **Safety & Demonstration Notice:** This software engine provides decision-support analysis for monitoring industrial laser cutters. It is **not** a certified hardware safety controller and does **not** actuate physical relays, optical isolators, or emergency-stop circuits. Never use live laser machinery, open active laser chambers, or generate actual smoke/fire to test this system.

### Evaluated Safety Rules

| Rule ID | Severity | Trigger Condition | Recommended Machine State | Description |
|---|---|---|---|---|
| `RULE_UNAUTHORIZED_RUNNING` | **CRITICAL** | `machine_running == True` while `machine_enabled == False` | `STOP_RECOMMENDED` | Laser head is actively cutting/firing while interlock authorization is disabled. |
| `RULE_DOOR_OPEN_WHILE_RUNNING` | **CRITICAL** | `door_open == True` while `machine_running == True` | `STOP_RECOMMENDED` | Laser protective enclosure opened during active beam cutting. |
| `RULE_FIRE_DETECTED` | **CRITICAL** | `flame_detected == True` | `STOP_RECOMMENDED` | Optical flame sensor detects active combustion or flame flicker. |
| `RULE_HIGH_TEMPERATURE` | **WARNING** | `temperature_c >= HIGH_TEMP_THRESHOLD_C` (default 60°C) | `INVESTIGATION_RECOMMENDED` | Elevated chamber/nozzle temperature (demo setting). |
| `RULE_ELEVATED_SMOKE` | **WARNING** | `smoke_level >= ELEVATED_SMOKE_THRESHOLD` (default 50.0) | `INVESTIGATION_RECOMMENDED` | Elevated particulate/obscuration index (demo setting). |
| `RULE_STALE_TELEMETRY` | **WARNING** | `connectivity_state == STALE` | `STOP_RECOMMENDED` | Telemetry packets stopped arriving. Fail-safe dictates old data cannot prove safety. |
| `RULE_MISSING_READINGS` | **UNKNOWN** | Any core safety reading is `None` / omitted | `STOP_RECOMMENDED` | Incomplete telemetry; fail-safe defaults to stop recommendation. |
| `NORMAL` | **NORMAL** | All sensors nominal, fresh, and complete | `NORMAL_OPERATION` | Clear operating state. |

### Severity Precedence
$$\text{CRITICAL} > \text{WARNING} > \text{UNKNOWN} > \text{NORMAL}$$
If multiple hazards occur concurrently, all violations are reported in `violations`, and the overall severity takes the highest precedence severity.

### Threshold Configuration
Set custom thresholds in `.env`:
```env
HIGH_TEMP_THRESHOLD_C=60.0
ELEVATED_SMOKE_THRESHOLD=50.0
STALE_THRESHOLD_SECONDS=10.0
```

### Example `GET /api/safety` Response (`200 OK`)
```json
{
  "status": "ok",
  "evaluated_at": "2026-10-14T11:20:00.123456Z",
  "device_count": 1,
  "overall_system_severity": "CRITICAL",
  "assessments": [
    {
      "device_id": "esp32-cutter-01",
      "source": "HARDWARE",
      "overall_severity": "CRITICAL",
      "recommended_state": "STOP_RECOMMENDED",
      "violations": [
        {
          "rule_id": "RULE_DOOR_OPEN_WHILE_RUNNING",
          "severity": "CRITICAL",
          "message": "Enclosure safety door opened while laser cutter is actively running.",
          "details": {
            "door_open": true,
            "machine_running": true
          }
        }
      ],
      "stale": false,
      "evaluated_at": "2026-10-14T11:20:00.123456Z",
      "disclaimer": "Software decision-support assessment only. Not a certified hardware safety controller. No physical e-stop actuation performed."
    }
  ],
  "thresholds": {
    "high_temperature_c": 60.0,
    "elevated_smoke": 50.0,
    "stale_threshold_seconds": 10.0
  },
  "disclaimer": "Software decision-support assessment only. Not a certified hardware safety controller. No physical e-stop actuation performed."
}
```

### PowerShell Query Commands
```powershell
# Query safety assessment for all registered devices
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/safety" -Method Get

# Query safety assessment for a specific device
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/safety?device_id=esp32-cutter-01" -Method Get
```

---

## SQLite Blackbox Event Logging (`GET /api/events`)

LaserGuard AI records an immutable audit history of safety-critical events in a local SQLite blackbox store (`backend/data/laserguard_blackbox.db`), surviving application restarts.

### Logged Event Categories
1. **`SAFETY_TRANSITION`**: Overall device severity changes (e.g., `NORMAL -> WARNING`, `WARNING -> CRITICAL`).
2. **`RULE_ACTIVATION`**: Specific safety rule violation activated (e.g., `RULE_FIRE_DETECTED`, `RULE_UNAUTHORIZED_RUNNING`).
3. **`RULE_CLEARANCE`**: Safety condition cleared back to nominal (e.g., hazard resolved).
4. **`CONNECTIVITY_TRANSITION`**: Telemetry heartbeat timeouts (`ONLINE -> STALE`) and recovery (`STALE -> ONLINE`).

### Noise & Deduplication Protection
- Continuous identical telemetry frames do **not** generate repetitive event spam.
- In-memory transition trackers ensure events are only appended to SQLite when a genuine state change occurs.

### Storage & Retention Configuration
- **Database Engine**: Python built-in `sqlite3` using Write-Ahead Logging (`PRAGMA journal_mode=WAL`) and `PRAGMA synchronous=NORMAL`.
- **Database Path**: Defaults to `backend/data/laserguard_blackbox.db` (configurable via `DATABASE_PATH`). Excluded from Git via `.gitignore`.
- **Retention Pruning**: Automatically prunes oldest records beyond `MAX_EVENTS_RETAINED` (default: 10,000; range: 100 to 1,000,000).

### Query Parameters & Pagination
`GET /api/events` supports:
- `device_id`: Filter by specific device string.
- `severity`: Filter by `CRITICAL`, `WARNING`, `NORMAL`, or `UNKNOWN`.
- `event_type`: Filter by event category (`SAFETY_TRANSITION`, `RULE_ACTIVATION`, `RULE_CLEARANCE`, `CONNECTIVITY_TRANSITION`).
- `limit`: Number of records to return (1–200, default 50).
- `before_id`: Cursor pagination ID (returns events with `id < before_id`, ordered newest-first).

> **Authentication Notice**: For local hackathon demonstration and testing purposes, `GET /api/events` is currently unauthenticated and read-only. Authentication and role-based access control should be added prior to production industrial deployment.

### Example `GET /api/events` Response (`200 OK`)
```json
{
  "status": "ok",
  "count": 2,
  "total_count": 2,
  "limit": 50,
  "before_id": null,
  "events": [
    {
      "id": 2,
      "timestamp": "2026-10-14T11:20:00.123456Z",
      "event_type": "RULE_ACTIVATION",
      "device_id": "esp32-cutter-01",
      "source": "HARDWARE",
      "severity": "CRITICAL",
      "rule_id": "RULE_FIRE_DETECTED",
      "recommended_state": "STOP_RECOMMENDED",
      "message": "Safety rule activated: Optical flame sensor active: fire hazard detected.",
      "details": {
        "flame_detected": true
      }
    },
    {
      "id": 1,
      "timestamp": "2026-10-14T11:20:00.123456Z",
      "event_type": "SAFETY_TRANSITION",
      "device_id": "esp32-cutter-01",
      "source": "HARDWARE",
      "severity": "CRITICAL",
      "rule_id": null,
      "recommended_state": "STOP_RECOMMENDED",
      "message": "Safety assessment transitioned from NORMAL to CRITICAL.",
      "details": {
        "previous_severity": "NORMAL",
        "new_severity": "CRITICAL",
        "recommended_state": "STOP_RECOMMENDED",
        "violation_count": 1
      }
    }
  ]
}
```

### PowerShell Query Commands
```powershell
# Retrieve latest 50 blackbox events
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/events" -Method Get

# Filter by device and severity
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/events?device_id=esp32-cutter-01&severity=CRITICAL" -Method Get

# Paginate with limit and before_id
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/events?limit=10&before_id=45" -Method Get
```

---

## License & Team
LaserGuard AI is created for Hackathon SKIT014.



