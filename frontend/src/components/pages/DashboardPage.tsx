import React, { useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  Play,
  Square,
  AlertOctagon,
  Flame,
  Wind,
  Thermometer,
  Droplets,
  Cpu,
  Volume2,
  RotateCcw,
  Check,
} from 'lucide-react';
import { DeviceStatus, BlackboxEvent, TelemetrySource } from '../../types/telemetry';
import { Sparkline } from '../common/Sparkline';
import { SensorChart, DataPoint } from '../common/SensorChart';
import { CameraMonitor } from '../common/CameraMonitor';

interface DashboardPageProps {
  device: DeviceStatus | null;
  events: BlackboxEvent[];
  systemSource: TelemetrySource;
  onTriggerScenario: (scenario: string) => Promise<void>;
  chartHistory: DataPoint[];
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  device,
  events,
  systemSource,
  onTriggerScenario,
  chartHistory,
}) => {
  const [inChargePermission, setInChargePermission] = useState<boolean>(true);
  const [buzzerActive, setBuzzerActive] = useState<boolean>(false);

  const readings = device?.latest_readings || {};
  const safety = device?.safety;
  const isRunning = readings.machine_running || false;
  const isStale = device?.connectivity_state === 'STALE';
  const severity = safety?.overall_severity || 'NORMAL';

  // Toggle in-charge permission
  const handleTogglePermission = async () => {
    const next = !inChargePermission;
    setInChargePermission(next);
    await onTriggerScenario(next ? 'nominal' : 'unauthorized_running');
  };

  const handleStartCutting = async () => {
    await onTriggerScenario('nominal');
  };

  const handleStopCutting = async () => {
    await onTriggerScenario('idle');
  };

  const handleEmergencyStop = async () => {
    await onTriggerScenario('door_trip');
  };

  const handleTestBuzzer = () => {
    setBuzzerActive(true);
    setTimeout(() => setBuzzerActive(false), 2000);
  };

  // Sparkline historical mocks
  const tempHistory = chartHistory.map((d) => d.temperature);
  const gasHistory = chartHistory.map((d) => d.gas);
  const flowHistory = chartHistory.map((d) => d.waterFlow);

  return (
    <div className="space-y-6">
      {/* Top Row: Machine Status, In-Charge Permission, Machine Control */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Machine Status Card (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#101522] p-5 flex flex-col sm:flex-row items-center gap-4 relative overflow-hidden">
          {/* Machine Graphic Box */}
          <div className="w-full sm:w-44 h-32 rounded-xl bg-[#090d15] border border-slate-800 flex flex-col items-center justify-center p-3 relative group shrink-0">
            <div className="absolute inset-0 bg-blue-500/5 rounded-xl" />
            <div className="w-20 h-14 rounded-lg border-2 border-slate-600 bg-slate-900/90 flex flex-col items-center justify-center relative shadow-inner">
              <div className="w-14 h-6 border border-cyan-500/40 rounded bg-cyan-950/30 flex items-center justify-center">
                <span className="text-[8px] font-mono text-cyan-400 font-bold">LASER BED</span>
              </div>
              {isRunning && (
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping absolute bottom-1" />
              )}
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-2">
              CO₂ Laser Cutter #1
            </div>
          </div>

          {/* Machine Details */}
          <div className="space-y-2.5 flex-1 w-full">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white tracking-wide">Machine Status</h3>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold flex items-center gap-1 ${
                  isStale
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                {isStale ? 'STALE' : 'ONLINE'}
              </span>
            </div>

            <p className="text-xs text-slate-400">
              {isRunning
                ? 'Laser cutting actively in progress'
                : 'Laser Cutter ready for operation'}
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/15 text-blue-300 border border-blue-500/30 flex items-center gap-1">
                <Check className="w-2.5 h-2.5" />
                {inChargePermission ? 'Permission Granted' : 'Interlock Locked'}
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                  isRunning
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {isRunning ? 'Machine Running' : 'Machine Idle'}
              </span>
            </div>
          </div>
        </div>

        {/* In-Charge Permission Switch Card (3 cols) */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-[#101522] p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white font-sans uppercase tracking-wider">
              In-Charge Permission
            </span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>

          <div className="py-2 flex items-center gap-2">
            <button
              onClick={handleTogglePermission}
              className={`flex-1 py-2 rounded-lg font-mono text-xs font-bold transition-all ${
                inChargePermission
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              ON
            </button>
            <button
              onClick={handleTogglePermission}
              className={`flex-1 py-2 rounded-lg font-mono text-xs font-bold transition-all ${
                !inChargePermission
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              OFF
            </button>
          </div>

          <p className="text-[11px] text-slate-400 font-mono">
            {inChargePermission ? 'Authorized operation allowed' : 'Emergency interlock disarmed'}
          </p>
        </div>

        {/* Machine Control Card (4 cols) */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-800 bg-[#101522] p-5 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Machine Control
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              Direct Ingestion
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleStartCutting}
              className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/25 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start (Sim)</span>
            </button>

            <button
              onClick={handleStopCutting}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold flex items-center justify-center gap-1.5 border border-slate-700 transition-all"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop (Sim)</span>
            </button>
          </div>

          <button
            onClick={handleEmergencyStop}
            className="w-full py-2 px-3 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-mono font-bold flex items-center justify-center gap-2 shadow-md shadow-rose-600/20 transition-all"
          >
            <AlertOctagon className="w-4 h-4" />
            <span>Emergency Stop</span>
          </button>
        </div>
      </div>

      {/* Row 2: 5 Sensor Metric Cards with Sparklines */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Flame Sensor Card */}
        <div className="rounded-2xl border border-slate-800 bg-[#101522] p-4 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                <Flame className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Flame Sensor</span>
            </div>
            <span
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                readings.flame_detected
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {readings.flame_detected ? 'FIRE DETECTED' : 'ONLINE'}
            </span>
          </div>

          <div className="pt-1">
            <div
              className={`text-sm font-extrabold font-mono ${
                readings.flame_detected ? 'text-rose-400 animate-pulse' : 'text-slate-200'
              }`}
            >
              {readings.flame_detected ? 'ACTIVE FLAME' : 'No Flame Detected'}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">Optical IR Sensor</div>
          </div>

          <Sparkline
            data={readings.flame_detected ? [0, 0, 10, 80, 95] : [0, 0, 0, 0, 0]}
            color={readings.flame_detected ? '#ef4444' : '#10b981'}
            width={160}
            height={32}
          />
        </div>

        {/* MQ-2 Gas Sensor */}
        <div className="rounded-2xl border border-slate-800 bg-[#101522] p-4 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Wind className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">MQ-2 Smoke/Gas</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
              ONLINE
            </span>
          </div>

          <div className="pt-1">
            <div className="text-sm font-extrabold font-mono text-white">
              {readings.smoke_level !== null && readings.smoke_level !== undefined
                ? `${readings.smoke_level.toFixed(1)} ppm`
                : '18.0 ppm'}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {(readings.smoke_level ?? 0) >= 50 ? 'ELEVATED' : 'Safe (< 50 ppm)'}
            </div>
          </div>

          <Sparkline data={gasHistory.length > 1 ? gasHistory : [12, 14, 13, 16, 18]} color="#10b981" width={160} height={32} />
        </div>

        {/* DS18B20 Temperature */}
        <div className="rounded-2xl border border-slate-800 bg-[#101522] p-4 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                <Thermometer className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Temperature</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold">
              DS18B20
            </span>
          </div>

          <div className="pt-1">
            <div
              className={`text-sm font-extrabold font-mono ${
                (readings.temperature_c ?? 0) >= 60 ? 'text-rose-400' : 'text-white'
              }`}
            >
              {readings.temperature_c !== null && readings.temperature_c !== undefined
                ? `${readings.temperature_c.toFixed(1)} °C`
                : '28.5 °C'}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {(readings.temperature_c ?? 0) >= 60 ? 'OVERHEAT LIMIT' : 'Normal (20-60°C)'}
            </div>
          </div>

          <Sparkline data={tempHistory.length > 1 ? tempHistory : [25, 26, 27, 28, 28.5]} color="#0ea5e9" width={160} height={32} />
        </div>

        {/* YF-S201 Water Flow */}
        <div className="rounded-2xl border border-slate-800 bg-[#101522] p-4 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                <Droplets className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Water Flow</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
              YF-S201
            </span>
          </div>

          <div className="pt-1">
            <div
              className={`text-sm font-extrabold font-mono ${
                (readings.water_flow_lpm ?? 5) < 1.0 && isRunning ? 'text-rose-400' : 'text-white'
              }`}
            >
              {readings.water_flow_lpm !== null && readings.water_flow_lpm !== undefined
                ? `${readings.water_flow_lpm.toFixed(1)} L/min`
                : '4.5 L/min'}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {(readings.water_flow_lpm ?? 5) < 1.0 && isRunning ? 'FLOW CRITICAL' : 'Normal (1-10 L/m)'}
            </div>
          </div>

          <Sparkline data={flowHistory.length > 1 ? flowHistory : [4.2, 4.3, 4.5, 4.4, 4.5]} color="#06b6d4" width={160} height={32} />
        </div>

        {/* ESP32 Controller Health */}
        <div className="rounded-2xl border border-slate-800 bg-[#101522] p-4 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                <Cpu className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">ESP32 Core</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
              {systemSource}
            </span>
          </div>

          <div className="pt-1">
            <div className="text-sm font-extrabold font-mono text-white">
              {systemSource === 'HARDWARE' ? 'Wi-Fi 100%' : 'Digital Twin'}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">Direct HTTP / WS</div>
          </div>

          <Sparkline data={[98, 99, 100, 99, 100]} color="#a855f7" width={160} height={32} />
        </div>
      </div>

      {/* Row 3: Camera Monitor (6 cols), Overall System Health (3 cols), Recent Alerts (3 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Camera Monitor (6 cols) */}
        <div className="lg:col-span-6">
          <CameraMonitor
            intrusionDetected={readings.camera_intrusion_detected}
            onSimulateIntrusion={async (intrude) => {
              await onTriggerScenario(intrude ? 'camera_intrusion' : 'nominal');
            }}
          />
        </div>

        {/* Overall System Health Donut (3 cols) */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-[#101522] p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Overall System Health
            </h4>
            <span className="text-[10px] font-mono text-emerald-400 font-bold">100% OK</span>
          </div>

          {/* Donut Gauge Visual */}
          <div className="py-4 flex flex-col items-center justify-center relative">
            <svg viewBox="0 0 100 100" className="w-28 h-28 transform -rotate-90">
              <circle cx="50" cy="50" r="40" stroke="#1e293b" strokeWidth="8" fill="none" />
              <circle
                cx="50"
                cy="50"
                r="40"
                stroke={severity === 'CRITICAL' ? '#ef4444' : severity === 'WARNING' ? '#f59e0b' : '#10b981'}
                strokeWidth="8"
                strokeDasharray="251.2"
                strokeDashoffset={severity === 'CRITICAL' ? '120' : '20'}
                strokeLinecap="round"
                fill="none"
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center">
              <span className="text-xl font-bold font-mono text-white">5/5</span>
              <span className="text-[9px] font-mono text-slate-400">Sensors Online</span>
            </div>
          </div>

          {/* Status Breakdown Legend */}
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Online: 5
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" /> Offline: 0
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Faults: {severity === 'CRITICAL' ? 1 : 0}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-500" /> Warming: 0
            </div>
          </div>
        </div>

        {/* Recent Alerts (3 cols) */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-[#101522] p-5 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Recent Alerts</h4>
            <span className="text-[10px] font-mono text-slate-400">Live Queue</span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-56 pr-1">
            {events.slice(0, 4).map((ev) => (
              <div
                key={ev.id}
                className="p-2 rounded-lg bg-[#0a0e17] border border-slate-800 text-xs font-mono space-y-0.5"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span
                    className={`font-bold px-1 rounded ${
                      ev.severity === 'CRITICAL'
                        ? 'bg-rose-500/20 text-rose-300'
                        : ev.severity === 'WARNING'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {ev.severity || 'INFO'}
                  </span>
                  <span className="text-slate-500">{ev.timestamp.slice(11, 19)}</span>
                </div>
                <div className="text-[11px] text-slate-200 truncate">{ev.message}</div>
              </div>
            ))}
            {events.length === 0 && (
              <div className="py-6 text-center text-xs font-mono text-slate-500">
                No active hazard alerts
              </div>
            )}
          </div>

          <div className="text-[10px] text-slate-500 font-mono text-center pt-1 border-t border-slate-800">
            Total Logged Incidents: {events.length}
          </div>
        </div>
      </div>

      {/* Row 4: Sensor Readings Graph & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Sensor Chart (8 cols) */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Live Sensor Readings Graph
            </h4>
            <span className="text-[10px] font-mono text-slate-400">Multi-Channel Telemetry</span>
          </div>

          <SensorChart data={chartHistory} height={170} />
        </div>

        {/* Quick Actions (4 cols) */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-3 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Quick Actions</h4>
            <span className="text-[10px] font-mono text-slate-400">Controls</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={handleTestBuzzer}
              className={`p-3 rounded-xl border text-xs font-mono font-bold flex flex-col items-center justify-center gap-1.5 transition-all ${
                buzzerActive
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                  : 'bg-[#0a0e17] hover:bg-slate-800 text-slate-300 border-slate-800'
              }`}
            >
              <Volume2 className="w-4 h-4 text-amber-400" />
              <span>{buzzerActive ? 'Buzzer Active!' : 'Test Buzzer'}</span>
            </button>

            <button
              onClick={() => onTriggerScenario('nominal')}
              className="p-3 rounded-xl bg-[#0a0e17] hover:bg-slate-800 border border-slate-800 text-xs font-mono font-bold text-slate-300 flex flex-col items-center justify-center gap-1.5 transition-all"
            >
              <RotateCcw className="w-4 h-4 text-cyan-400" />
              <span>Reset System</span>
            </button>

            <button
              onClick={() => onTriggerScenario('fire')}
              className="p-3 rounded-xl bg-[#0a0e17] hover:bg-rose-950/40 border border-slate-800 text-xs font-mono font-bold text-slate-300 flex flex-col items-center justify-center gap-1.5 transition-all"
            >
              <Flame className="w-4 h-4 text-rose-400" />
              <span>Test Fire Alert</span>
            </button>

            <button
              onClick={() => onTriggerScenario('coolant_fail')}
              className="p-3 rounded-xl bg-[#0a0e17] hover:bg-cyan-950/40 border border-slate-800 text-xs font-mono font-bold text-slate-300 flex flex-col items-center justify-center gap-1.5 transition-all"
            >
              <Droplets className="w-4 h-4 text-cyan-400" />
              <span>Test Flow Fail</span>
            </button>
          </div>

          <div className="p-2.5 rounded-xl bg-[#0a0e17] border border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span>Interlock Controller Status:</span>
            <span className="text-emerald-400 font-bold">READY</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
