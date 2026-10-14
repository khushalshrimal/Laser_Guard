import React, { useState } from 'react';
import {
  Activity,
  Wind,
  Flame,
  Thermometer,
  Droplets,
  Sliders,
} from 'lucide-react';
import { DeviceStatus, TelemetrySource } from '../../types/telemetry';
import { SensorChart, DataPoint } from '../common/SensorChart';

interface LiveReadingsPageProps {
  device: DeviceStatus | null;
  chartHistory: DataPoint[];
  systemSource: TelemetrySource;
}

export const LiveReadingsPage: React.FC<LiveReadingsPageProps> = ({
  device,
  chartHistory,
  systemSource,
}) => {
  const [timeRange, setTimeRange] = useState<'10m' | '1h' | '24h'>('10m');

  const readings = device?.latest_readings || {};
  const isStale = device?.connectivity_state === 'STALE';

  const gas = readings.smoke_level ?? 18.0;
  const temp = readings.temperature_c ?? 28.5;
  const flow = readings.water_flow_lpm ?? 4.5;
  const flame = readings.flame_detected ?? false;

  return (
    <div className="space-y-6">
      {/* Top Header Summary Pills */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gas Pill */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Wind className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-mono">Gas / Smoke (MQ-2)</div>
              <div className="text-lg font-bold font-mono text-white mt-0.5">{gas.toFixed(1)} ppm</div>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
            {gas >= 50 ? 'WARNING' : 'NORMAL'}
          </span>
        </div>

        {/* Flame Pill */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-mono">Flame Sensor</div>
              <div className="text-lg font-bold font-mono text-white mt-0.5">{flame ? 'FIRE 1' : '0 (CLEAR)'}</div>
            </div>
          </div>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
              flame
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30 animate-pulse'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            }`}
          >
            {flame ? 'ALERT' : 'SECURE'}
          </span>
        </div>

        {/* Temperature Pill */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400">
              <Thermometer className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-mono">Temperature</div>
              <div className="text-lg font-bold font-mono text-white mt-0.5">{temp.toFixed(1)} °C</div>
            </div>
          </div>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
              temp >= 60
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
            }`}
          >
            {temp >= 60 ? 'HIGH' : 'NORMAL'}
          </span>
        </div>

        {/* Water Flow Pill */}
        <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Droplets className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-mono">Coolant Flow</div>
              <div className="text-lg font-bold font-mono text-white mt-0.5">{flow.toFixed(1)} L/min</div>
            </div>
          </div>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
              flow < 1.0 && readings.machine_running
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30 animate-pulse'
                : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
            }`}
          >
            {flow < 1.0 && readings.machine_running ? 'LOW FLOW' : 'NOMINAL'}
          </span>
        </div>
      </div>

      {/* Main Sensor Trends Section with Time Range Filter */}
      <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Sensor Trends & Historical Signal Analysis
            </h3>
            <p className="text-xs text-slate-400">
              Real-time stream with multi-channel temperature, gas obscuration, and coolant flow telemetry
            </p>
          </div>

          {/* Time range selector tabs */}
          <div className="flex items-center rounded-lg bg-[#090d15] border border-slate-800 p-0.5 text-xs font-mono">
            {(['10m', '1h', '24h'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1 rounded-md transition-colors ${
                  timeRange === r ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r === '10m' ? 'Last 10 Min' : r === '1h' ? 'Last 1 Hour' : 'Last 24 Hours'}
              </button>
            ))}
          </div>
        </div>

        {/* Large Chart */}
        <SensorChart data={chartHistory} height={240} />
      </div>

      {/* Two Column Layout: Current Readings Table & Threshold Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Current Readings Deep-Dive (7 cols) */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Current Live Readings Breakdown
            </h4>
            <span className="text-[10px] font-mono text-slate-400">
              Source: {systemSource} {isStale ? '(STALE)' : '(FRESH)'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                  <th className="py-2">Sensor</th>
                  <th className="py-2">Current Value</th>
                  <th className="py-2">Operating Limit</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                <tr>
                  <td className="py-2.5 font-bold text-white">Chamber Temperature</td>
                  <td className="py-2.5 text-amber-400">{temp.toFixed(1)} °C</td>
                  <td className="py-2.5 text-slate-500">&lt; 60.0 °C</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${temp >= 60 ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {temp >= 60 ? 'OVERHEAT' : 'NORMAL'}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 font-bold text-white">MQ-2 Gas / Smoke</td>
                  <td className="py-2.5 text-emerald-400">{gas.toFixed(1)} ppm</td>
                  <td className="py-2.5 text-slate-500">&lt; 50.0 ppm</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${gas >= 50 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {gas >= 50 ? 'ELEVATED' : 'SAFE'}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 font-bold text-white">YF-S201 Water Flow</td>
                  <td className="py-2.5 text-cyan-400">{flow.toFixed(1)} L/min</td>
                  <td className="py-2.5 text-slate-500">&ge; 1.0 L/min</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${flow < 1.0 && readings.machine_running ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {flow < 1.0 && readings.machine_running ? 'FLOW FAILURE' : 'OPTIMAL'}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 font-bold text-white">IR Flame Sensor</td>
                  <td className="py-2.5">{flame ? 'Active Flame' : 'No Flame'}</td>
                  <td className="py-2.5 text-slate-500">0 (Nominal)</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${flame ? 'bg-rose-500/20 text-rose-300 animate-pulse' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {flame ? 'FIRE HAZARD' : 'CLEAR'}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Threshold Settings Cards (Display Only) (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Threshold Rules (Active)
            </h4>
            <span className="text-[10px] font-mono text-slate-500">FastAPI Calibrated</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3 rounded-xl bg-[#090d15] border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-500">Gas Alarm Trigger</div>
              <div className="text-amber-400 font-bold">&gt; 50 ppm</div>
              <div className="text-[9px] text-slate-600">MQ-2 Obscuration</div>
            </div>

            <div className="p-3 rounded-xl bg-[#090d15] border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-500">Temp Alarm Trigger</div>
              <div className="text-rose-400 font-bold">&gt; 60 °C</div>
              <div className="text-[9px] text-slate-600">DS18B20 1-Wire</div>
            </div>

            <div className="p-3 rounded-xl bg-[#090d15] border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-500">Flow Minimum</div>
              <div className="text-cyan-400 font-bold">&lt; 1.0 L/min</div>
              <div className="text-[9px] text-slate-600">YF-S201 Chiller</div>
            </div>

            <div className="p-3 rounded-xl bg-[#090d15] border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-500">Heartbeat Timeout</div>
              <div className="text-purple-400 font-bold">&gt; 10.0 sec</div>
              <div className="text-[9px] text-slate-600">Stale Flag Trigger</div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-blue-950/20 border border-blue-900/30 text-[10px] font-mono text-blue-300">
            * Thresholds are configured in backend environment variables and can be fine-tuned in Settings & Simulator.
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveReadingsPage;
