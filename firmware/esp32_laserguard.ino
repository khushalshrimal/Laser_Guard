/*
 * =====================================================================================
 * LaserGuard AI - ESP32 Hardware Telemetry & Sensor Firmware
 * =====================================================================================
 * Target Microcontroller: ESP32 Dev Module (WROOM-32 / NodeMCU-32S)
 * Framework: Arduino ESP32 Core
 * 
 * Architectural Policy:
 * - Protocol: Direct HTTP POST to /ingest (MQTT is NOT used in LaserGuard AI).
 * - Canonical Machine ID: "laser-cutter-01".
 * - Telemetry Source: "HARDWARE".
 * - Advisory only: Software decision-support; does NOT replace physical hardware E-Stop.
 * 
 * Hardware Wiring & Pinout Assumptions:
 * -------------------------------------------------------------------------------------
 * Sensor / Peripheral         | ESP32 Pin | Signal Type   | Electrical Description
 * ----------------------------|-----------|---------------|----------------------------
 * Enclosure Door Microswitch  | GPIO 19   | Digital Input | Normally-Closed to GND, INPUT_PULLUP.
 *                             |           |               | LOW = Door Closed / Secure
 *                             |           |               | HIGH = Door Open / Interlocked
 * ----------------------------|-----------|---------------|----------------------------
 * IR Flame Sensor (DO)        | GPIO 18   | Digital Input | Comparator output (LM393).
 *                             |           |               | Active LOW when fire detected.
 * ----------------------------|-----------|---------------|----------------------------
 * MQ-2 Smoke / Gas Sensor(AO) | GPIO 34   | Analog Input  | ADC1_CH6 (Input Only, 0-3.3V).
 *                             |           |               | Use voltage divider if powered by 5V.
 *                             |           |               | Raw 0-4095 mapped to 0.0-100.0 index.
 * ----------------------------|-----------|---------------|----------------------------
 * Temperature Sensor (NTC/DS) | GPIO 35   | Analog Input  | ADC1_CH7 (0-3.3V analog probe/thermistor)
 *                             |           |               | Scaled to -10.0°C to +150.0°C.
 *                             |           |               | (If using DS18B20 1-Wire, use GPIO 4).
 * ----------------------------|-----------|---------------|----------------------------
 * YF-S201 Water Flow Sensor   | GPIO 23   | Digital Pulse | Hall-effect turbine pulse output.
 *                             |           | (Interrupt)   | F = 7.5 * Q (L/min). 450 pulses/L.
 * ----------------------------|-----------|---------------|----------------------------
 * Laser Running Sense (Opto)  | GPIO 26   | Digital Input | Optocoupler from laser power supply.
 *                             |           |               | LOW = Laser Active / Cutting.
 * ----------------------------|-----------|---------------|----------------------------
 * Safety Enable Key / Arm     | GPIO 27   | Digital Input | Key switch with INPUT_PULLUP.
 *                             |           |               | LOW = Safety Armed / Enabled.
 * ----------------------------|-----------|---------------|----------------------------
 * Warning Buzzer Output       | GPIO 13   | Digital Out   | 2N2222 / MOSFET driver for 5V buzzer.
 * ----------------------------|-----------|---------------|----------------------------
 * Status LED (Onboard)        | GPIO 2    | Digital Out   | Blinks on Wi-Fi connect & TX.
 * -------------------------------------------------------------------------------------
 * 
 * Disclaimer:
 * This firmware is prepared for software integration and has NOT yet been physically
 * flashed or bench-tested against physical laser cutting hardware.
 * =====================================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>

// =====================================================================================
// USER CONFIGURATION (Modify for your local network and host machine)
// =====================================================================================
const char* WIFI_SSID     = "LaserGuard_AP";         // Your Wi-Fi network SSID
const char* WIFI_PASSWORD = "laserguard2026";        // Your Wi-Fi network password

// Backend FastAPI ingestion endpoint (replace with your server IP address)
const char* BACKEND_INGEST_URL = "http://192.168.1.100:8000/ingest";

// Canonical identity (must match LaserGuard AI canonical machine ID)
const char* CANONICAL_DEVICE_ID = "laser-cutter-01";
const char* TELEMETRY_SOURCE    = "HARDWARE";

// Telemetry submission cadence in milliseconds (1 Hz nominal)
const unsigned long TELEMETRY_INTERVAL_MS = 1000;

// HTTP client timeout in milliseconds
const int HTTP_TIMEOUT_MS = 3000;

// =====================================================================================
// GPIO PIN ASSIGNMENTS
// =====================================================================================
const int PIN_DOOR_SWITCH     = 19;  // Enclosure door switch (INPUT_PULLUP)
const int PIN_FLAME_DO        = 18;  // Optical flame sensor digital out
const int PIN_SMOKE_AO        = 34;  // MQ-2 gas/smoke analog input (ADC1)
const int PIN_TEMP_AO         = 35;  // Temperature analog probe (ADC1)
const int PIN_FLOW_PULSE      = 23;  // YF-S201 flow sensor pulse input (Interrupt)
const int PIN_MACHINE_RUNNING = 26;  // Laser firing optocoupler sense
const int PIN_MACHINE_ENABLED = 27;  // Safety enable / arm key switch
const int PIN_BUZZER_OUT      = 13;  // Active alarm buzzer output
const int PIN_STATUS_LED      = 2;   // Onboard status LED

// Sensor logic inversion flags (calibrate according to physical sensor modules)
const bool FLAME_ACTIVE_LOW    = true;  // LM393 flame comparator outputs LOW on fire
const bool DOOR_OPEN_ACTIVE_HIGH = true; // Switch opens circuit when door opens -> HIGH pullup
const bool RUNNING_ACTIVE_LOW  = true;  // Optocoupler pulls down when laser fires
const bool ENABLED_ACTIVE_LOW  = true;  // Key switch shorts to GND when armed

// =====================================================================================
// GLOBAL STATE & FLOW INTERRUPT COUNTER
// =====================================================================================
volatile unsigned long flowPulseCount = 0;
unsigned long lastTelemetryTime = 0;
unsigned long lastFlowCalcTime = 0;

// Interrupt Service Routine for flow sensor pulse counting
void IRAM_ATTR onFlowSensorPulse() {
    flowPulseCount++;
}

// =====================================================================================
// SENSOR READING HELPERS
// =====================================================================================

// Read enclosure safety door
bool readDoorOpen() {
    int val = digitalRead(PIN_DOOR_SWITCH);
    return DOOR_OPEN_ACTIVE_HIGH ? (val == HIGH) : (val == LOW);
}

// Read optical flame sensor
bool readFlameDetected() {
    int val = digitalRead(PIN_FLAME_DO);
    return FLAME_ACTIVE_LOW ? (val == LOW) : (val == HIGH);
}

// Read MQ-2 smoke/gas concentration index (normalized 0.0 - 100.0)
float readSmokeLevel() {
    int raw = analogRead(PIN_SMOKE_AO); // 12-bit ADC: 0 - 4095
    // Linear approximation: 0 to 100 obscuration index
    float normalized = (float)raw * (100.0f / 4095.0f);
    if (normalized < 0.0f) normalized = 0.0f;
    return normalized;
}

// Read ambient/lens temperature in degrees Celsius (°C)
float readTemperatureC() {
    int raw = analogRead(PIN_TEMP_AO); // 12-bit ADC: 0 - 4095
    // Calibration for 10k NTC voltage divider or 10mV/°C linear analog sensor (e.g., TMP36/LM35)
    // Formula for 3.3V ADC: Vout = raw * (3.3V / 4095)
    float voltage = ((float)raw / 4095.0f) * 3.3f;
    // Example TMP36: 10 mV/°C with 500 mV offset -> T = (V - 0.5) * 100
    float tempC = (voltage - 0.5f) * 100.0f;
    // Bound to realistic laser cutting environment [-10.0°C, 150.0°C]
    if (tempC < -10.0f) tempC = -10.0f;
    if (tempC > 150.0f) tempC = 150.0f;
    return tempC;
}

// Calculate water flow rate in Liters per minute (L/min)
float calculateWaterFlowLpm(unsigned long elapsedMs) {
    if (elapsedMs == 0) return 0.0f;
    // Detach interrupt briefly to read and reset pulse counter safely
    noInterrupts();
    unsigned long pulses = flowPulseCount;
    flowPulseCount = 0;
    interrupts();

    // Calibration: YF-S201 produces ~450 pulses per Liter.
    // Q (L/min) = (pulses / (450 * (elapsedMs / 1000.0))) * 60.0
    // Simplified: Q = (pulses * 1000.0f) / (7.5f * 60.0f * elapsedMs)
    float flowLpm = (float)pulses / (7.5f * (elapsedMs / 1000.0f));
    if (flowLpm < 0.0f) flowLpm = 0.0f;
    return flowLpm;
}

// Read machine running status
bool readMachineRunning() {
    int val = digitalRead(PIN_MACHINE_RUNNING);
    return RUNNING_ACTIVE_LOW ? (val == LOW) : (val == HIGH);
}

// Read safety enable authorization
bool readMachineEnabled() {
    int val = digitalRead(PIN_MACHINE_ENABLED);
    return ENABLED_ACTIVE_LOW ? (val == LOW) : (val == HIGH);
}

// =====================================================================================
// TELEMETRY TRANSMISSION (HTTP POST /ingest)
// =====================================================================================
void sendTelemetryFrame() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[LaserGuard] Wi-Fi disconnected. Skipping telemetry frame.");
        digitalWrite(PIN_STATUS_LED, LOW);
        return;
    }

    // 1. Calculate time delta for flow sensor
    unsigned long now = millis();
    unsigned long flowElapsedMs = now - lastFlowCalcTime;
    lastFlowCalcTime = now;

    // 2. Sample all physical sensors
    bool doorOpen = readDoorOpen();
    bool flameDetected = readFlameDetected();
    float smokeLevel = readSmokeLevel();
    float tempC = readTemperatureC();
    float flowLpm = calculateWaterFlowLpm(flowElapsedMs);
    bool machineRunning = readMachineRunning();
    bool machineEnabled = readMachineEnabled();

    // 3. Format JSON payload strictly adhering to Pydantic TelemetryPayload schema
    // Contract: source, device_id, readings (door_open, flame_detected, smoke_level, temperature_c, machine_enabled, machine_running, water_flow_lpm)
    char jsonPayload[512];
    snprintf(
        jsonPayload,
        sizeof(jsonPayload),
        "{\"source\":\"%s\","
        "\"device_id\":\"%s\","
        "\"readings\":{"
        "\"door_open\":%s,"
        "\"flame_detected\":%s,"
        "\"smoke_level\":%.1f,"
        "\"temperature_c\":%.1f,"
        "\"machine_enabled\":%s,"
        "\"machine_running\":%s,"
        "\"water_flow_lpm\":%.2f"
        "}}",
        TELEMETRY_SOURCE,
        CANONICAL_DEVICE_ID,
        doorOpen ? "true" : "false",
        flameDetected ? "true" : "false",
        smokeLevel,
        tempC,
        machineEnabled ? "true" : "false",
        machineRunning ? "true" : "false",
        flowLpm
    );

    // 4. Send HTTP POST to FastAPI backend
    HTTPClient http;
    http.begin(BACKEND_INGEST_URL);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(HTTP_TIMEOUT_MS);

    // Blink status LED during transmit
    digitalWrite(PIN_STATUS_LED, HIGH);
    int httpResponseCode = http.POST((uint8_t*)jsonPayload, strlen(jsonPayload));
    digitalWrite(PIN_STATUS_LED, LOW);

    if (httpResponseCode == 200) {
        String responseBody = http.getString();
        Serial.printf("[LaserGuard] Telemetry OK (HTTP 200): %s\n", jsonPayload);
        
        // Inspect response body for buzzer/safety alerts if present
        if (responseBody.indexOf("\"buzzer_recommended\":true") != -1 ||
            responseBody.indexOf("\"STOP_RECOMMENDED\"") != -1) {
            // Sound warning buzzer on severe safety hazard
            digitalWrite(PIN_BUZZER_OUT, HIGH);
        } else {
            digitalWrite(PIN_BUZZER_OUT, LOW);
        }
    } else if (httpResponseCode == 409) {
        Serial.println("[LaserGuard] Ingestion conflict (HTTP 409): Simulator lock active on backend.");
    } else {
        Serial.printf("[LaserGuard] Ingestion failed (HTTP %d). Error: %s\n",
                      httpResponseCode, http.errorToString(httpResponseCode).c_str());
    }

    http.end();
}

// =====================================================================================
// ARDUINO SETUP
// =====================================================================================
void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========================================================");
    Serial.println("LaserGuard AI - ESP32 Hardware Telemetry Initializing...");
    Serial.println("========================================================");

    // 1. Configure GPIO pin modes
    pinMode(PIN_DOOR_SWITCH, INPUT_PULLUP);
    pinMode(PIN_FLAME_DO, INPUT);
    pinMode(PIN_FLOW_PULSE, INPUT_PULLUP);
    pinMode(PIN_MACHINE_RUNNING, INPUT_PULLUP);
    pinMode(PIN_MACHINE_ENABLED, INPUT_PULLUP);
    
    // Analog input pins on ESP32 ADC1
    analogReadResolution(12); // 0 - 4095

    // Output indicators
    pinMode(PIN_BUZZER_OUT, OUTPUT);
    digitalWrite(PIN_BUZZER_OUT, LOW);
    pinMode(PIN_STATUS_LED, OUTPUT);
    digitalWrite(PIN_STATUS_LED, LOW);

    // 2. Attach flow sensor interrupt
    attachInterrupt(digitalPinToInterrupt(PIN_FLOW_PULSE), onFlowSensorPulse, FALLING);

    // 3. Connect to Wi-Fi network
    Serial.printf("[LaserGuard] Connecting to Wi-Fi: %s\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        digitalWrite(PIN_STATUS_LED, HIGH);
        Serial.println("\n[LaserGuard] Wi-Fi Connected!");
        Serial.printf("[LaserGuard] IP Address: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("[LaserGuard] Target Backend: %s\n", BACKEND_INGEST_URL);
    } else {
        digitalWrite(PIN_STATUS_LED, LOW);
        Serial.println("\n[LaserGuard] Wi-Fi Connection Failed. Will retry in main loop.");
    }

    lastTelemetryTime = millis();
    lastFlowCalcTime = millis();
}

// =====================================================================================
// ARDUINO MAIN LOOP
// =====================================================================================
void loop() {
    unsigned long currentMillis = millis();

    // 1. Reconnect Wi-Fi if connection was lost
    if (WiFi.status() != WL_CONNECTED) {
        static unsigned long lastWifiRetry = 0;
        if (currentMillis - lastWifiRetry > 10000) {
            lastWifiRetry = currentMillis;
            Serial.println("[LaserGuard] Attempting Wi-Fi reconnection...");
            WiFi.reconnect();
        }
    }

    // 2. Submit telemetry at regular interval (1 Hz)
    if (currentMillis - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
        lastTelemetryTime = currentMillis;
        sendTelemetryFrame();
    }

    // Short yield to allow ESP32 background Wi-Fi/TCP stack processing
    delay(10);
}
