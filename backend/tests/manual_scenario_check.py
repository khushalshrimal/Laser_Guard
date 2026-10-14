import sys
import os
import urllib.request
import json

sys.path.insert(0, os.path.abspath('.'))
from simulator.simulate_telemetry import generate_telemetry_payload, send_telemetry

scenarios = [
    ('nominal', 'NORMAL', 'NORMAL_OPERATION', None),
    ('fire', 'CRITICAL', 'STOP_RECOMMENDED', 'RULE_FIRE_DETECTED'),
    ('door_trip', 'CRITICAL', 'STOP_RECOMMENDED', 'RULE_DOOR_OPEN_WHILE_RUNNING'),
    ('overheat', 'WARNING', 'INVESTIGATION_RECOMMENDED', 'RULE_HIGH_TEMPERATURE'),
    ('smoke', 'WARNING', 'INVESTIGATION_RECOMMENDED', 'RULE_ELEVATED_SMOKE'),
    ('coolant_fail', 'CRITICAL', 'STOP_RECOMMENDED', 'RULE_COOLANT_FLOW_LOW'),
    ('camera_intrusion', 'CRITICAL', 'STOP_RECOMMENDED', 'RULE_PERIMETER_INTRUSION'),
    ('idle', 'NORMAL', 'NORMAL_OPERATION', None),
    ('unauthorized_running', 'CRITICAL', 'STOP_RECOMMENDED', 'RULE_UNAUTHORIZED_RUNNING'),
]

results = []
print("=" * 80)
print("LASERGUARD AI - AUTOMATED SCENARIO INTEGRATION CHECK")
print("=" * 80)

for mode, exp_sev, exp_state, exp_rule in scenarios:
    dev_id = f"qa-{mode}-01"
    payload = generate_telemetry_payload(mode=mode, device_id=dev_id)
    send_res = send_telemetry(payload, url="http://127.0.0.1:8000/ingest")
    
    # Query status
    status_req = urllib.request.Request("http://127.0.0.1:8000/api/status")
    with urllib.request.urlopen(status_req) as resp:
        status_data = json.loads(resp.read().decode("utf-8"))
    
    device_status = next((d for d in status_data["devices"] if d["device_id"] == dev_id), None)
    actual_sev = device_status["safety"]["overall_severity"] if device_status else "MISSING"
    actual_state = device_status["safety"]["recommended_state"] if device_status else "MISSING"
    violations = [v["rule_id"] for v in device_status["safety"].get("violations", [])] if device_status else []
    
    rule_matched = (exp_rule in violations) if exp_rule else (len(violations) == 0)
    sev_matched = (actual_sev == exp_sev)
    state_matched = (actual_state == exp_state)
    passed = rule_matched and sev_matched and state_matched
    
    rule_str = str(violations) if violations else "None"
    print(f"[{'PASS' if passed else 'FAIL'}] Scenario: {mode:<22} HTTP={send_res['status_code']} | Sev={actual_sev:<8} (exp {exp_sev:<8}) | State={actual_state:<18} | Rule={rule_str}")
    results.append(passed)

# Query events
events_req = urllib.request.Request("http://127.0.0.1:8000/api/events?limit=50")
with urllib.request.urlopen(events_req) as resp:
    events_data = json.loads(resp.read().decode("utf-8"))
print("-" * 80)
print(f"SQLite Blackbox Events logged: total={events_data['total_count']}, fetched={len(events_data['events'])}")

print("=" * 80)
print(f"RESULT: {sum(results)} of {len(results)} scenarios PASSED.")
print("=" * 80)
