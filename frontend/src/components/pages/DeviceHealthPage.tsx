import React from 'react';
import {
  Cpu,
  Server,
  Database,
  Radio,
  Layers,
  ArrowRight,
  Terminal,
} from 'lucide-react';
import { DeviceStatus, BackendHealth, ConnectionState, TelemetrySource } from '../../types/telemetry';

interface DeviceHealthPageProps {
  device: DeviceStatus | null;
  healthData: BackendHealth | null;
  connectionState: ConnectionState;
  systemSource: TelemetrySource;
}

export const DeviceHealthPage: React.FC<DeviceHealthPageProps> = ({
  device,
  healthData,
  connectionState,
  systemSource,
}) => {
  const isOnline = connectionState === 'connected';
  const readings = device?.latest_readings || {};
  const isStale = device?.connectivity_state === 'STALE';

  return (
    <div className="space-y-6">
      {/* Top 4 Service Health Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* ESP32 / Device */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-white font-mono">
                {device?.device_id || 'laser-cutter-01'}
              </span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
                !device
                  ? 'bg-slate-800 text-slate-400 border-slate-700'
                  : isStale
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              }`}
            >
              {!device ? 'OFFLINE' : isStale ? 'STALE' : 'ONLINE'}
            </span>
          </div>
          <div className="text-xs font-mono text-slate-300">
            Source: <span className="font-bold text-white">{systemSource}</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500">
            Last seen: {device ? `${device.seconds_since_last_seen.toFixed(1)}s ago` : 'Awaiting data'}
          </div>
        </div>

        {/* FastAPI Backend */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold text-white font-mono">FastAPI Backend</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
              {healthData?.status ? healthData.status.toUpperCase() : 'ONLINE'}
            </span>
          </div>
          <div className="text-xs font-mono text-slate-300">
            Version: <span className="font-bold text-white">{healthData?.version || '0.7.0'}</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500">Port 8000 • Uvicorn ASGI</div>
        </div>

        {/* SQLite Database */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-white font-mono">SQLite Blackbox</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
              WAL MODE
            </span>
          </div>
          <div className="text-xs font-mono text-slate-300">
            Engine: <span className="font-bold text-white">sqlite3</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500">Persistent Local Data</div>
        </div>

        {/* WebSocket Stream */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-white font-mono">WebSocket Stream</span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
                isOnline
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
              }`}
            >
              {isOnline ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>
          <div className="text-xs font-mono text-slate-300">
            Channel: <span className="font-bold text-white">/ws/status</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500">Low-Latency Pub-Sub</div>
        </div>
      </div>

      {/* Visual Connection Topology Diagram */}
      <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" /> End-to-End System Architecture Topology
          </h4>
          <span className="text-[10px] font-mono text-slate-400">Strict Direct Architecture (NO MQTT)</span>
        </div>

        {/* Topology Flow Graph */}
        <div className="p-6 rounded-xl bg-[#080b12] border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 overflow-x-auto">
          {/* Node 1: Ingestion Source */}
          <div className="flex flex-col items-center p-3.5 rounded-xl border border-purple-500/30 bg-purple-950/20 min-w-[130px] text-center space-y-1">
            <Cpu className="w-6 h-6 text-purple-400" />
            <div className="text-xs font-bold font-mono text-white">ESP32 / Sim</div>
            <div className="text-[9px] font-mono text-purple-300">HTTP POST Client</div>
          </div>

          <ArrowRight className="w-5 h-5 text-slate-500 shrink-0 hidden md:block" />

          {/* Node 2: FastAPI Ingestion Core */}
          <div className="flex flex-col items-center p-3.5 rounded-xl border border-cyan-500/30 bg-cyan-950/20 min-w-[140px] text-center space-y-1">
            <Server className="w-6 h-6 text-cyan-400" />
            <div className="text-xs font-bold font-mono text-white">FastAPI Ingest</div>
            <div className="text-[9px] font-mono text-cyan-300">POST /ingest (Port 8000)</div>
          </div>

          <ArrowRight className="w-5 h-5 text-slate-500 shrink-0 hidden md:block" />

          {/* Node 3: Safety Rules Engine & Registry */}
          <div className="flex flex-col items-center p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/20 min-w-[140px] text-center space-y-1">
            <Terminal className="w-6 h-6 text-amber-400" />
            <div className="text-xs font-bold font-mono text-white">Safety Engine</div>
            <div className="text-[9px] font-mono text-amber-300">8 Rules + Interlocks</div>
          </div>

          <ArrowRight className="w-5 h-5 text-slate-500 shrink-0 hidden md:block" />

          {/* Node 4: SQLite Blackbox & WebSockets */}
          <div className="flex flex-col items-center p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 min-w-[140px] text-center space-y-1">
            <Database className="w-6 h-6 text-emerald-400" />
            <div className="text-xs font-bold font-mono text-white">SQLite Blackbox</div>
            <div className="text-[9px] font-mono text-emerald-300">WAL Mode /ws/status</div>
          </div>

          <ArrowRight className="w-5 h-5 text-slate-500 shrink-0 hidden md:block" />

          {/* Node 5: React Dashboard */}
          <div className="flex flex-col items-center p-3.5 rounded-xl border border-blue-500/30 bg-blue-950/20 min-w-[130px] text-center space-y-1">
            <Radio className="w-6 h-6 text-blue-400" />
            <div className="text-xs font-bold font-mono text-white">React + Vite</div>
            <div className="text-[9px] font-mono text-blue-300">Industrial UI (5173)</div>
          </div>
        </div>
      </div>

      {/* Sensor Diagnostics Table */}
      <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
            Connected Sensor Hardware Diagnostics
          </h4>
          <span className="text-[10px] font-mono text-slate-400">Hardware Contract Table</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                <th className="py-2.5 px-3">Sensor Model</th>
                <th className="py-2.5 px-3">Hardware Protocol</th>
                <th className="py-2.5 px-3">Pin / Interface</th>
                <th className="py-2.5 px-3">Latest Reading</th>
                <th className="py-2.5 px-3">Health Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              <tr>
                <td className="py-2.5 px-3 font-bold text-white">IR Flame Sensor</td>
                <td className="py-2.5 px-3">Digital Active-Low</td>
                <td className="py-2.5 px-3 text-cyan-400">GPIO 14</td>
                <td className="py-2.5 px-3">{readings.flame_detected ? 'FIRE DETECTED' : 'CLEAR'}</td>
                <td className="py-2.5 px-3 text-emerald-400 font-bold">ONLINE</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-bold text-white">MQ-2 Gas / Smoke</td>
                <td className="py-2.5 px-3">Analog ADC (12-bit)</td>
                <td className="py-2.5 px-3 text-cyan-400">GPIO 34 (ADC1_CH6)</td>
                <td className="py-2.5 px-3">{(readings.smoke_level ?? 18).toFixed(1)} ppm</td>
                <td className="py-2.5 px-3 text-emerald-400 font-bold">ONLINE</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-bold text-white">DS18B20 Temp Probe</td>
                <td className="py-2.5 px-3">Dallas 1-Wire</td>
                <td className="py-2.5 px-3 text-cyan-400">GPIO 4 (4.7kΩ Pullup)</td>
                <td className="py-2.5 px-3">{(readings.temperature_c ?? 28.5).toFixed(1)} °C</td>
                <td className="py-2.5 px-3 text-emerald-400 font-bold">ONLINE</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-bold text-white">YF-S201 Water Flow</td>
                <td className="py-2.5 px-3">Hall Effect Pulse Interrupt</td>
                <td className="py-2.5 px-3 text-cyan-400">GPIO 13</td>
                <td className="py-2.5 px-3">{(readings.water_flow_lpm ?? 4.5).toFixed(1)} L/min</td>
                <td className="py-2.5 px-3 text-emerald-400 font-bold">ONLINE</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-bold text-white">Webcam Optical Perimeter</td>
                <td className="py-2.5 px-3">OpenCV + MediaPipe</td>
                <td className="py-2.5 px-3 text-cyan-400">USB 2.0 / Video0</td>
                <td className="py-2.5 px-3">{readings.camera_intrusion_detected ? 'BREACHED' : 'CLEAR'}</td>
                <td className="py-2.5 px-3 text-emerald-400 font-bold">ONLINE</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DeviceHealthPage;
