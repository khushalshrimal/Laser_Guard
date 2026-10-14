import React, { useState } from 'react';
import {
  Settings,
  Sliders,
  Play,
  Check,
  Code,
} from 'lucide-react';
import { TelemetrySource } from '../../types/telemetry';

interface SettingsSimulatorPageProps {
  systemSource: TelemetrySource;
  onTriggerScenario: (scenario: string) => Promise<void>;
}

export const SettingsSimulatorPage: React.FC<SettingsSimulatorPageProps> = ({
  systemSource,
  onTriggerScenario,
}) => {
  // Settings Form State
  const [activeTab, setActiveTab] = useState<'thresholds' | 'network' | 'general'>('thresholds');
  const [gasThreshold, setGasThreshold] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('laserguard_th_gas') : null;
    return saved ? Number(saved) : 50.0;
  });
  const [tempThreshold, setTempThreshold] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('laserguard_th_temp') : null;
    return saved ? Number(saved) : 60.0;
  });
  const [flowThreshold, setFlowThreshold] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('laserguard_th_flow') : null;
    return saved ? Number(saved) : 1.0;
  });
  const [staleThreshold, setStaleThreshold] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('laserguard_th_stale') : null;
    return saved ? Number(saved) : 10.0;
  });
  const [isSaved, setIsSaved] = useState<boolean>(false);

  // Simulator Controls State
  const [selectedScenario, setSelectedScenario] = useState<string>('nominal');
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [lastTriggerResult, setLastTriggerResult] = useState<string | null>(null);

  const handleSaveSettings = () => {
    try {
      localStorage.setItem('laserguard_th_gas', String(gasThreshold));
      localStorage.setItem('laserguard_th_temp', String(tempThreshold));
      localStorage.setItem('laserguard_th_flow', String(flowThreshold));
      localStorage.setItem('laserguard_th_stale', String(staleThreshold));
    } catch {
      // Ignore storage errors in restricted contexts
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleRunScenario = async (scenario: string) => {
    setSelectedScenario(scenario);
    setIsTriggering(true);
    setLastTriggerResult(null);
    try {
      await onTriggerScenario(scenario);
      setLastTriggerResult(`Scenario '${scenario.toUpperCase()}' dispatched successfully to POST /ingest!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to dispatch';
      setLastTriggerResult(`Error: ${msg}`);
    } finally {
      setIsTriggering(false);
    }
  };

  // Live JSON Preview generated based on selectedScenario
  const samplePayloads: Record<string, Record<string, unknown>> = {
    nominal: {
      source: 'SIMULATOR',
      device_id: 'laser-cutter-01',
      readings: {
        door_open: false,
        flame_detected: false,
        smoke_level: 12.0,
        temperature_c: 28.5,
        water_flow_lpm: 4.5,
        camera_intrusion_detected: false,
        machine_enabled: true,
        machine_running: true,
      },
    },
    fire: {
      source: 'SIMULATOR',
      device_id: 'laser-cutter-01',
      readings: {
        door_open: false,
        flame_detected: true,
        smoke_level: 68.0,
        temperature_c: 82.0,
        water_flow_lpm: 4.5,
        machine_enabled: true,
        machine_running: true,
      },
    },
    door_trip: {
      source: 'SIMULATOR',
      device_id: 'laser-cutter-01',
      readings: {
        door_open: true,
        flame_detected: false,
        smoke_level: 12.0,
        temperature_c: 28.5,
        water_flow_lpm: 4.5,
        machine_enabled: true,
        machine_running: true,
      },
    },
    coolant_fail: {
      source: 'SIMULATOR',
      device_id: 'laser-cutter-01',
      readings: {
        door_open: false,
        flame_detected: false,
        smoke_level: 12.0,
        temperature_c: 55.0,
        water_flow_lpm: 0.2,
        machine_enabled: true,
        machine_running: true,
      },
    },
    overheat: {
      source: 'SIMULATOR',
      device_id: 'laser-cutter-01',
      readings: {
        door_open: false,
        flame_detected: false,
        smoke_level: 25.0,
        temperature_c: 74.5,
        water_flow_lpm: 3.8,
        machine_enabled: true,
        machine_running: true,
      },
    },
    camera_intrusion: {
      source: 'SIMULATOR',
      device_id: 'laser-cutter-01',
      readings: {
        door_open: false,
        flame_detected: false,
        smoke_level: 12.0,
        temperature_c: 28.5,
        water_flow_lpm: 4.5,
        camera_intrusion_detected: true,
        machine_enabled: true,
        machine_running: true,
      },
    },
  };

  const previewJson = JSON.stringify(samplePayloads[selectedScenario] || samplePayloads.nominal, null, 2);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-cyan-400" />
          Settings & Digital Twin Telemetry Simulator
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Configure safety thresholds and trigger interactive simulator test scenarios directly against the FastAPI <code className="text-amber-400">POST /ingest</code> pipeline.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: System Settings (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Threshold Preferences</span>
              <span className="text-[10px] font-mono text-slate-500 font-normal lowercase">(browser-stored)</span>
            </h4>
            {isSaved && (
              <span className="text-xs font-mono text-emerald-400 font-bold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Saved!
              </span>
            )}
          </div>

          {/* Settings Tabs */}
          <div className="flex items-center rounded-lg bg-[#080b12] border border-slate-800 p-0.5 text-xs font-mono">
            {(['thresholds', 'network', 'general'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 rounded-md capitalize transition-colors ${
                  activeTab === tab ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Threshold Inputs */}
          {activeTab === 'thresholds' && (
            <div className="space-y-4 pt-1 font-mono text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 flex items-center justify-between">
                  <span>Gas Level Alarm Threshold (ppm)</span>
                  <span className="text-amber-400 font-bold">{gasThreshold} ppm</span>
                </label>
                <input
                  type="range"
                  min="10"
                  max="200"
                  value={gasThreshold}
                  onChange={(e) => setGasThreshold(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 flex items-center justify-between">
                  <span>Temperature Warning Threshold (°C)</span>
                  <span className="text-rose-400 font-bold">{tempThreshold} °C</span>
                </label>
                <input
                  type="range"
                  min="30"
                  max="120"
                  value={tempThreshold}
                  onChange={(e) => setTempThreshold(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 flex items-center justify-between">
                  <span>Coolant Minimum Flow Rate (L/min)</span>
                  <span className="text-cyan-400 font-bold">{flowThreshold} L/min</span>
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.1"
                  value={flowThreshold}
                  onChange={(e) => setFlowThreshold(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 flex items-center justify-between">
                  <span>Heartbeat Stale Timeout (seconds)</span>
                  <span className="text-purple-400 font-bold">{staleThreshold} s</span>
                </label>
                <input
                  type="range"
                  min="3"
                  max="60"
                  value={staleThreshold}
                  onChange={(e) => setStaleThreshold(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>

              <button
                onClick={handleSaveSettings}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-md shadow-blue-600/30"
              >
                Save Settings Configuration
              </button>
            </div>
          )}

          {activeTab === 'network' && (
            <div className="space-y-3 font-mono text-xs pt-2 text-slate-300">
              <div className="p-3 rounded-lg bg-[#080b12] border border-slate-800 space-y-1">
                <div className="text-slate-500">FastAPI Ingest Endpoint</div>
                <div className="text-cyan-400 font-bold">http://127.0.0.1:8000/ingest</div>
              </div>
              <div className="p-3 rounded-lg bg-[#080b12] border border-slate-800 space-y-1">
                <div className="text-slate-500">Live WebSocket Channel</div>
                <div className="text-amber-400 font-bold">ws://127.0.0.1:8000/ws/status</div>
              </div>
              <div className="p-3 rounded-lg bg-[#080b12] border border-slate-800 space-y-1">
                <div className="text-slate-500">Active Telemetry Source</div>
                <div className="text-emerald-400 font-bold">{systemSource}</div>
              </div>
              <div className="p-3 rounded-lg bg-[#080b12] border border-slate-800 space-y-1">
                <div className="text-slate-500">Protocol Policy</div>
                <div className="text-slate-200">Strict Direct HTTP/WS (No MQTT Broker)</div>
              </div>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="space-y-3 font-mono text-xs pt-2 text-slate-300">
              <div className="p-3 rounded-lg bg-[#080b12] border border-slate-800 space-y-1">
                <div className="text-slate-500">Hackathon Reference</div>
                <div className="text-white font-bold">SKIT014 - Smart Laser Guard</div>
              </div>
              <div className="p-3 rounded-lg bg-[#080b12] border border-slate-800 space-y-1">
                <div className="text-slate-500">Current App Version</div>
                <div className="text-white">v1.0.0 (Foundation through Live Dashboard)</div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Simulation Controls & Digital Twin Generator (7 cols) */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Play className="w-4 h-4 text-emerald-400" /> Digital Twin Scenario Simulator
            </h4>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              SIMULATOR ENFORCED
            </span>
          </div>

          <div className="p-3 rounded-xl bg-blue-950/20 border border-blue-800/30 text-xs font-mono text-blue-300">
            * Simulation mode dispatches synthetic packets directly to <code className="text-white">POST /ingest</code> with <code className="text-amber-400">source="SIMULATOR"</code>.
          </div>

          {/* Scenario Trigger Buttons */}
          <div className="space-y-2">
            <div className="text-xs font-mono text-slate-400 font-semibold uppercase">
              Select Test Hazard Scenario:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
              {[
                { id: 'nominal', label: 'Normal Operation', color: 'border-emerald-500/50 hover:bg-emerald-950/30 text-emerald-300' },
                { id: 'fire', label: 'Fire Hazard Trigger', color: 'border-rose-500/50 hover:bg-rose-950/30 text-rose-300' },
                { id: 'door_trip', label: 'Door Trip (Running)', color: 'border-amber-500/50 hover:bg-amber-950/30 text-amber-300' },
                { id: 'coolant_fail', label: 'Coolant Flow Failure', color: 'border-cyan-500/50 hover:bg-cyan-950/30 text-cyan-300' },
                { id: 'overheat', label: 'Overheat Spike (75°C)', color: 'border-orange-500/50 hover:bg-orange-950/30 text-orange-300' },
                { id: 'camera_intrusion', label: 'Optical Intrusion', color: 'border-purple-500/50 hover:bg-purple-950/30 text-purple-300' },
              ].map((sc) => (
                <button
                  key={sc.id}
                  onClick={() => handleRunScenario(sc.id)}
                  disabled={isTriggering}
                  className={`p-2.5 rounded-xl border bg-[#080b12] text-left transition-all ${sc.color} ${
                    selectedScenario === sc.id ? 'ring-2 ring-blue-500 font-bold' : ''
                  }`}
                >
                  <div className="font-bold truncate">{sc.label}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Dispatches scenario</div>
                </button>
              ))}
            </div>
          </div>

          {lastTriggerResult && (
            <div className="p-3 rounded-lg bg-[#080b12] border border-slate-800 text-xs font-mono text-emerald-400 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{lastTriggerResult}</span>
            </div>
          )}

          {/* Live JSON Payload Preview */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span className="flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-cyan-400" /> Ingestion JSON Payload Preview:
              </span>
              <span className="text-[10px] text-slate-500">Exact schema sent to /ingest</span>
            </div>
            <pre className="p-3 rounded-xl bg-[#080b12] border border-slate-800 text-[11px] font-mono text-cyan-300 overflow-x-auto max-h-48">
              {previewJson}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsSimulatorPage;
