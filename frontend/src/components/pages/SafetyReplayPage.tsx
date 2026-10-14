import React, { useState } from 'react';
import {
  RotateCcw,
  Clock,
  CheckCircle2,
  TrendingUp,
  HelpCircle,
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  ArrowRight,
} from 'lucide-react';
import { BlackboxEvent } from '../../types/telemetry';

interface SafetyReplayPageProps {
  events: BlackboxEvent[];
}

interface RuleDiagnostic {
  reason: string;
  affectedSensor: string;
  suggestedCheck: string;
}

function getIncidentDiagnostics(ruleId?: string | null, message?: string): RuleDiagnostic {
  switch (ruleId) {
    case 'FLAME_RUNNING_CRITICAL':
      return {
        reason: 'Optical IR phototransistor detected open flame or flare-up inside the cutting chamber while the laser was active.',
        affectedSensor: 'IR Flame Sensor (flame_detected = true)',
        suggestedCheck: 'Check the cutting bed for combusted material or flare-ups. Verify air-assist pressure, inspect exhaust, and ensure the workpiece is laser-rated.',
      };
    case 'DOOR_OPEN_RUNNING_CRITICAL':
      return {
        reason: 'Enclosure lid safety switch opened while the laser was firing, presenting a danger of scattered high-energy laser radiation.',
        affectedSensor: 'Door Interlock Limit Switch (door_open = true)',
        suggestedCheck: 'Inspect the door limit switch and magnetic interlock alignment. Ensure the protective enclosure lid is firmly closed and latched before cutting.',
      };
    case 'COOLANT_FAILURE_RUNNING_CRITICAL':
      return {
        reason: 'Coolant circulation rate dropped below the safe threshold (<1.0 LPM) during firing, creating an immediate risk of glass laser tube thermal shock or cracking.',
        affectedSensor: 'YF-S201 Water Flow Sensor (water_flow_lpm < 1.0)',
        suggestedCheck: 'Inspect chiller power, verify water reservoir level, check silicone tubing for kinks or airlocks, and ensure the water pump is running.',
      };
    case 'OVERHEAT_CRITICAL':
      return {
        reason: 'Coolant or laser tube temperature exceeded the absolute maximum safe limit (>65°C), risking tube rupture and permanent optics failure.',
        affectedSensor: 'DS18B20 Temperature Probe (temperature_c > 65.0°C)',
        suggestedCheck: 'Check chiller refrigeration compressor, inspect ambient room ventilation, verify thermal probe immersion, and allow water to cool down.',
      };
    case 'TEMP_HIGH_WARNING':
      return {
        reason: 'Laser operating temperature exceeded the pre-hazard caution limit (>45°C), approaching thermal danger threshold.',
        affectedSensor: 'DS18B20 Temperature Probe (temperature_c > 45.0°C)',
        suggestedCheck: 'Allow the machine to idle for cool-down, verify chiller radiator airflow, and check that ambient room temperature is within specifications.',
      };
    case 'SMOKE_DENSE_CRITICAL':
      return {
        reason: 'Combustion smoke density exceeded the critical threshold (>70%), indicating dense particulate buildup or smoldering debris.',
        affectedSensor: 'MQ-2 Gas & Smoke Sensor (smoke_level > 70.0)',
        suggestedCheck: 'Check exhaust extraction blower, inspect ventilation ducting for blockages, and ensure honeycomb bed is clean of smoldering debris.',
      };
    case 'SMOKE_HAZARD_WARNING':
      return {
        reason: 'Smoke concentration exceeded the caution limit (>40%), indicating poor extraction airflow in the cutting chamber.',
        affectedSensor: 'MQ-2 Gas & Smoke Sensor (smoke_level > 40.0)',
        suggestedCheck: 'Verify that the exhaust blower fan is powered on, clean ventilation duct filters, and check air-assist delivery nozzle.',
      };
    case 'CAMERA_INTRUSION_RUNNING_CRITICAL':
      return {
        reason: 'Computer vision optical safety perimeter detected a hand or foreign object entering the active laser hazard zone.',
        affectedSensor: 'Overhead Safety Camera & Intrusion AI (camera_intrusion_detected = true)',
        suggestedCheck: 'Ensure all personnel remain outside the yellow hazard perimeter. Verify overhead camera lens is clean and optical boundary is properly calibrated.',
      };
    case 'UNAUTHORIZED_RUNNING_CRITICAL':
      return {
        reason: 'Laser cutting operation commenced without verified In-Charge safety permission.',
        affectedSensor: 'Machine State & In-Charge Authorization Interlock',
        suggestedCheck: 'Engage safety key authorization with the lab in-charge before resuming laser cutting jobs.',
      };
    default:
      return {
        reason: message || 'Sensor telemetry exceeded calibrated safety threshold limit.',
        affectedSensor: 'Telemetry Sensor Input',
        suggestedCheck: 'Inspect sensor wiring, verify recent telemetry readings in the blackbox log, and check calibrated safety rule limits.',
      };
  }
}

export const SafetyReplayPage: React.FC<SafetyReplayPageProps> = ({ events }) => {
  // Filter for incidents (hazards / transitions)
  const incidents = events.filter((e) => e.severity === 'CRITICAL' || e.severity === 'WARNING');
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(
    incidents.length > 0 ? incidents[0].id : null
  );
  const [showExplanation, setShowExplanation] = useState<boolean>(false);
  const [showGlossary, setShowGlossary] = useState<boolean>(false);

  const activeIncident = incidents.find((e) => e.id === selectedIncidentId) || incidents[0] || null;
  const diagnostics = activeIncident ? getIncidentDiagnostics(activeIncident.rule_id, activeIncident.message) : null;

  // Mock synthetic curve around incident
  const replayPoints = [
    { offset: '-2m', val: 24, safeLimit: 60 },
    { offset: '-1m', val: 32, safeLimit: 60 },
    { offset: '0m (Breach)', val: activeIncident?.severity === 'CRITICAL' ? 88 : 65, safeLimit: 60 },
    { offset: '+30s', val: 72, safeLimit: 60 },
    { offset: '+1m', val: 45, safeLimit: 60 },
    { offset: '+2m', val: 28, safeLimit: 60 },
  ];

  const maxVal = 100;
  const getY = (val: number) => 130 - (val / maxVal) * 100;
  const pointsD = replayPoints
    .map((p, idx) => `${40 + idx * 70},${getY(p.val).toFixed(1)}`)
    .join(' L ');

  // Status explanation helper
  const getSeverityDescription = (severity?: string) => {
    switch (severity) {
      case 'CRITICAL':
        return {
          title: 'DANGER DETECTED',
          desc: 'A critical safety rule was violated. The automated safety interlock immediately triggered a stop response to halt laser operation (Software Simulation Only).',
          badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        };
      case 'WARNING':
        return {
          title: 'WARNING',
          desc: 'Sensor telemetry crossed a pre-hazard threshold. Operation continues under observation, but operator inspection is advised.',
          badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        };
      case 'NORMAL':
        return {
          title: 'NORMAL',
          desc: 'All monitored sensors are within safe calibrated limits. The safety interlock remains armed and operation is permitted.',
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        };
      default:
        return {
          title: 'UNKNOWN',
          desc: 'Awaiting sensor telemetry. The safety engine cannot determine interlock status without incoming data.',
          badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
        };
    }
  };

  const statusInfo = getSeverityDescription(activeIncident?.severity || (incidents.length === 0 ? 'NORMAL' : 'UNKNOWN'));

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-cyan-400" />
              Safety Incident Replay & Root-Cause Forensic Analysis
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Select any past safety transition or rule activation from the SQLite blackbox to inspect sensor signals, threshold crossings, and automated fail-safe responses.
            </p>
          </div>

          <button
            onClick={() => setShowExplanation(!showExplanation)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-300 text-xs font-mono font-semibold transition-all shrink-0 self-start sm:self-auto"
            title="Click to understand how safety relays and interlocks work"
          >
            <HelpCircle className="w-4 h-4 text-cyan-400" />
            <span>What is a Safety Relay & Interlock?</span>
            {showExplanation ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Expandable Beginner Explanation Drawer */}
        {showExplanation && (
          <div className="mt-3 p-4 rounded-xl border border-cyan-500/30 bg-[#0b1322] space-y-3 text-xs leading-relaxed">
            <div className="flex items-center gap-2 text-cyan-300 font-bold font-mono">
              <Info className="w-4 h-4" />
              <span>Beginner Guide: Understanding Industrial Safety Relays & Interlocks</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-300 font-sans">
              <div className="p-3 rounded-lg bg-[#080d18] border border-slate-800 space-y-1">
                <span className="font-bold text-white font-mono text-[11px] block text-cyan-400">
                  1. What is a Safety Relay?
                </span>
                <p className="text-slate-400 text-[11px]">
                  A <strong>safety relay</strong> is an electromechanical switch designed to fail safely. When a hazard (fire, open door, coolant loss) is detected, the relay de-energizes its coils to mechanically cut electrical power to high-voltage laser tubes and motion drives within milliseconds.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-[#080d18] border border-slate-800 space-y-1">
                <span className="font-bold text-white font-mono text-[11px] block text-cyan-400">
                  2. Why Machines Use Safety Interlocks
                </span>
                <p className="text-slate-400 text-[11px]">
                  Unlike normal software switches that might crash or hang, an <strong>interlock loop</strong> guarantees that the machine cannot fire unless all safety barriers are satisfied (lid latched, coolant flowing, no fire, authorized user).
                </p>
              </div>
            </div>

            {/* 4-Step Flow Explanation */}
            <div className="p-3 rounded-lg bg-[#080d18] border border-slate-800 space-y-2">
              <span className="font-bold text-white font-mono text-[11px] block text-cyan-300">
                The 4-Step Safety Interlock Flow:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[10px] font-mono">
                <div className="p-2 rounded bg-[#0f172a] border border-slate-800 text-slate-300 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">1</span>
                  <span><strong>Sensor Detects:</strong> Physical hazard reading</span>
                </div>
                <div className="p-2 rounded bg-[#0f172a] border border-slate-800 text-slate-300 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">2</span>
                  <span><strong>Rules Engine:</strong> Evaluates threshold limits</span>
                </div>
                <div className="p-2 rounded bg-[#0f172a] border border-slate-800 text-slate-300 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold">3</span>
                  <span><strong>Alert Raised:</strong> Logged to SQLite blackbox</span>
                </div>
                <div className="p-2 rounded bg-[#0f172a] border border-slate-800 text-slate-300 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">4</span>
                  <span><strong>Fail-Safe Trip:</strong> Power cut command issued</span>
                </div>
              </div>
            </div>

            {/* Hardware vs Simulation Notice */}
            <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/30 flex items-center gap-2 text-[11px] text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Hardware Status Note:</strong> In this software-first integration phase, all relay trip actions are evaluated and simulated by the software engine. Physical high-voltage 220V mains contactors are not yet physically wired. Always labeled <strong>SOFTWARE SIMULATION ONLY</strong>.
              </span>
            </div>
          </div>
        )}
      </div>

      {incidents.length === 0 ? (
        <div className="p-10 rounded-2xl border border-dashed border-slate-800 bg-[#0d121c] text-center space-y-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
          <div className="space-y-1">
            <div className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              STATUS: NORMAL — INTERLOCK ARMED
            </div>
            <h4 className="text-sm font-bold text-white">No Safety Hazards Recorded</h4>
            <p className="text-xs text-slate-400 max-w-lg mx-auto">
              All sensors are operating within normal limits. The safety interlock remains armed and operating safely. Trigger a simulated fire, door trip, coolant failure, or overheat scenario in the simulator to generate a forensic incident!
            </p>
          </div>

          {/* 4-Step Flow Reference for Beginners */}
          <div className="max-w-2xl mx-auto pt-3 border-t border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-400 block mb-2 uppercase tracking-wider">
              Standard Safety Interlock Flow
            </span>
            <div className="flex flex-wrap sm:flex-nowrap items-center justify-center gap-2 text-xs font-mono">
              <div className="p-2 rounded bg-[#101522] border border-slate-800 text-slate-300">
                1. Sensor Detects Danger
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden sm:block" />
              <div className="p-2 rounded bg-[#101522] border border-slate-800 text-slate-300">
                2. Safety Rules Check It
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden sm:block" />
              <div className="p-2 rounded bg-[#101522] border border-slate-800 text-slate-300">
                3. Alert Appears
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden sm:block" />
              <div className="p-2 rounded bg-[#101522] border border-slate-800 text-rose-300">
                4. Safety Response (Simulated)
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Select Incident List (4 cols) */}
          <div className="lg:col-span-4 rounded-2xl border border-slate-800 bg-[#101522] p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Select Past Incident
              </h4>
              <span className="text-[10px] font-mono text-slate-400">{incidents.length} recorded</span>
            </div>

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {incidents.map((inc) => {
                const isSelected = inc.id === (activeIncident?.id ?? null);
                return (
                  <button
                    key={inc.id}
                    onClick={() => setSelectedIncidentId(inc.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all space-y-1.5 ${
                      isSelected
                        ? 'border-blue-500 bg-blue-950/30 shadow-md shadow-blue-950/40'
                        : 'border-slate-800 bg-[#090d15] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-cyan-400" />
                        {inc.timestamp.slice(11, 19)} UTC
                      </span>
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded ${
                          inc.severity === 'CRITICAL'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {inc.severity}
                      </span>
                    </div>

                    <div className="text-xs font-bold text-white truncate">{inc.message}</div>

                    <div className="text-[10px] font-mono text-slate-500 flex items-center justify-between">
                      <span>Device: {inc.device_id}</span>
                      <span className="text-cyan-400">{inc.rule_id || 'SAFETY_EVENT'}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Beginner Quick Glossary Trigger */}
            <div className="pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowGlossary(!showGlossary)}
                className="w-full text-left flex items-center justify-between text-[11px] font-mono text-slate-400 hover:text-cyan-300 py-1 transition-colors"
              >
                <span className="flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-cyan-400" /> What do these terms mean?
                </span>
                {showGlossary ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {showGlossary && (
                <div className="mt-2 p-2.5 rounded-lg bg-[#080d18] border border-slate-800 space-y-2 text-[10px] font-mono text-slate-400">
                  <div>
                    <strong className="text-white">Rule ID:</strong> Deterministic safety condition evaluated by the backend engine against real-time sensor limits.
                  </div>
                  <div>
                    <strong className="text-white">Blackbox:</strong> Persistent SQLite audit log recording transitions with microsecond timestamps.
                  </div>
                  <div>
                    <strong className="text-white">STOP_RECOMMENDED:</strong> Software trip state signaling that machine power should be severed.
                  </div>
                  <div>
                    <strong className="text-amber-400">Simulation Only:</strong> Digital emulation of relay behavior without physical 220V wiring connected.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Center & Right: Incident Details & Sensor Replay (8 cols) */}
          <div className="lg:col-span-8 space-y-5">
            {activeIncident && (
              <>
                {/* Details Card */}
                <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
                  {/* Status Banner */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400">Incident Forensic Record</span>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${statusInfo.badgeClass}`}>
                          {statusInfo.title}
                        </span>
                      </div>
                      <h4 className="text-base font-bold text-white mt-0.5">{activeIncident.message}</h4>
                    </div>

                    <span
                      className={`text-xs font-mono font-bold px-2.5 py-1 rounded-md border shrink-0 ${
                        activeIncident.severity === 'CRITICAL'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      }`}
                      title={statusInfo.desc}
                    >
                      {activeIncident.severity}
                    </span>
                  </div>

                  {/* Status Simple Language Explanation */}
                  <div className="p-3 rounded-lg bg-[#090d15] border border-slate-800 text-xs flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                    <div className="text-slate-300 leading-relaxed">
                      <strong className="text-white">Current Status Meaning: </strong>
                      {statusInfo.desc}
                    </div>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-2.5 rounded-lg bg-[#080b12] border border-slate-800" title="Timestamp when the safety rule was triggered">
                      <div className="text-[10px] text-slate-500 uppercase">Timestamp</div>
                      <div className="text-white font-bold mt-0.5">
                        {activeIncident.timestamp.replace('T', ' ').slice(0, 19)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#080b12] border border-slate-800" title="Safety rule ID evaluated by the backend engine">
                      <div className="text-[10px] text-slate-500 uppercase">Triggered Rule</div>
                      <div className="text-cyan-300 font-bold mt-0.5 truncate">
                        {activeIncident.rule_id || 'N/A'}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#080b12] border border-slate-800" title="Source origin of the event telemetry">
                      <div className="text-[10px] text-slate-500 uppercase">Source Origin</div>
                      <div className="text-emerald-400 font-bold mt-0.5 text-[11px] truncate">
                        {activeIncident.source === 'SIMULATOR' ? 'SIMULATOR (SOFTWARE ONLY)' : 'REAL HARDWARE'}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#080b12] border border-slate-800" title="Fail-safe interlock state recommended by the rules engine">
                      <div className="text-[10px] text-slate-500 uppercase">Recommended State</div>
                      <div className="text-rose-400 font-bold mt-0.5 truncate">
                        {activeIncident.recommended_state || 'STOP_RECOMMENDED'}
                      </div>
                    </div>
                  </div>

                  {/* Active Incident Diagnostics & Suggested Next Check */}
                  {diagnostics && (
                    <div className="p-3.5 rounded-xl bg-[#0b1220] border border-blue-900/40 space-y-2">
                      <div className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5 uppercase">
                        <Info className="w-3.5 h-3.5 text-cyan-400" /> Root-Cause Analysis & Action Plan
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="text-slate-300">
                          <strong className="text-white font-mono text-[11px]">Why it triggered: </strong>
                          {diagnostics.reason}
                        </div>
                        <div className="text-slate-400 font-mono text-[11px]">
                          <strong className="text-slate-300">Affected Sensor: </strong>
                          <span className="text-cyan-400">{diagnostics.affectedSensor}</span>
                        </div>
                        <div className="p-2 rounded bg-[#070b14] border border-slate-800 text-slate-300">
                          <strong className="text-amber-400 font-mono text-[11px]">Suggested Next Check: </strong>
                          {diagnostics.suggestedCheck}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Incident Step-by-Step 4-Stage Flow Timeline */}
                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <div className="text-xs font-mono font-bold text-slate-300 uppercase flex items-center justify-between">
                      <span>4-Step Safety Interlock Chronology</span>
                      <span className="text-[10px] text-amber-400 font-normal">SOFTWARE SIMULATION ONLY</span>
                    </div>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex items-start gap-2.5 p-2 rounded bg-[#090d15] border border-slate-800">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                        <div>
                          <span className="text-cyan-400 font-bold">Step 1: Sensor Detects Danger:</span>{' '}
                          Sensor telemetry breached calibrated safety threshold limits.
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5 p-2 rounded bg-[#090d15] border border-slate-800">
                        <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                        <div>
                          <span className="text-amber-400 font-bold">Step 2: Safety Rules Check It:</span>{' '}
                          Safety engine evaluated against 8 deterministic rules (Matched: {activeIncident.rule_id || 'HAZARD_RULE'}).
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5 p-2 rounded bg-[#090d15] border border-slate-800">
                        <span className="w-2 h-2 rounded-full bg-rose-400 mt-1.5 shrink-0" />
                        <div>
                          <span className="text-rose-400 font-bold">Step 3: Alert Appears:</span>{' '}
                          Severity escalated to {activeIncident.severity}, recorded into SQLite blackbox (Event #{activeIncident.id}), and broadcast via WebSocket.
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5 p-2 rounded bg-[#090d15] border border-slate-800">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                        <div>
                          <span className="text-emerald-400 font-bold">Step 4: Safety Response (Software Simulation Only):</span>{' '}
                          Safety engine issued `{activeIncident.recommended_state || 'STOP_RECOMMENDED'}` command. Note: Physical 220V mains relay is not wired; power cut is simulated in software.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sensor Readings Around Incident Graph Card */}
                <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-amber-400" /> Sensor Readings Around Incident Time
                    </h4>
                    <span className="text-[10px] font-mono text-slate-400" title="Visualizing signal values before and after safety trip">
                      Forensic Curve Analysis
                    </span>
                  </div>

                  <div className="bg-[#090d15] p-3 rounded-xl border border-slate-800">
                    <svg viewBox="0 0 420 150" className="w-full h-auto overflow-visible">
                      {/* Grid lines */}
                      {[30, 60, 90, 120].map((y) => (
                        <line key={y} x1="30" y1={y} x2="400" y2={y} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="0.8" />
                      ))}

                      {/* Threshold Line */}
                      <line x1="30" y1="70" x2="400" y2="70" stroke="#ef4444" strokeDasharray="4 2" strokeWidth="1.2" />
                      <text x="395" y="65" textAnchor="end" fill="#f87171" fontSize="9" fontFamily="monospace">
                        Threshold Limit
                      </text>

                      {/* Incident Signal Path */}
                      <path d={`M ${pointsD}`} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />

                      {/* Nodes */}
                      {replayPoints.map((p, idx) => (
                        <g key={idx}>
                          <circle
                            cx={40 + idx * 70}
                            cy={getY(p.val)}
                            r={p.offset.includes('Breach') ? 5 : 3.5}
                            fill={p.offset.includes('Breach') ? '#ef4444' : '#f59e0b'}
                            stroke="#ffffff"
                            strokeWidth="1.5"
                          />
                          <text x={40 + idx * 70} y="145" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">
                            {p.offset}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SafetyReplayPage;
