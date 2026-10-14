import React, { useState, useEffect } from 'react';
import {
  Bell,
  Wifi,
  AlertOctagon,
  RefreshCw,
} from 'lucide-react';
import { ConnectionState, SafetySeverity, TelemetrySource } from '../../types/telemetry';

interface HeaderProps {
  pageTitle: string;
  connectionState: ConnectionState;
  systemSeverity: SafetySeverity;
  systemSource: TelemetrySource;
  onToggleSource: () => void;
  onEmergencyStop: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  alertCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  pageTitle,
  connectionState,
  systemSeverity,
  systemSource,
  onToggleSource,
  onEmergencyStop,
  onRefresh,
  isRefreshing = false,
  alertCount = 0,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-16 bg-[#0c101a] border-b border-slate-800/80 px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Left: Page Title & Mode Indicator */}
      <div className="flex items-center gap-4">
        <div>
          <h2 className="text-base font-bold text-white tracking-wide">{pageTitle}</h2>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <span>Laser-Cutter Safety & Monitoring</span>
            <span>•</span>
            <span className={systemSource === 'SIMULATOR' ? 'text-blue-400' : 'text-emerald-400'}>
              {systemSource === 'SIMULATOR' ? 'Digital Twin Simulation' : 'Physical ESP32 Wi-Fi'}
            </span>
          </div>
        </div>
      </div>

      {/* Center: System Status Pill */}
      <div className="hidden lg:flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#111624] border border-slate-800 text-xs font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              connectionState === 'connected'
                ? systemSeverity === 'CRITICAL'
                  ? 'bg-rose-500 animate-ping'
                  : 'bg-emerald-500 animate-pulse'
                : 'bg-amber-500'
            }`}
          />
          <span className="text-slate-300 font-semibold">
            {connectionState === 'connected'
              ? systemSeverity === 'CRITICAL'
                ? 'SYSTEM HAZARD ALERT'
                : 'System Online'
              : 'Reconnecting...'}
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400 text-[11px]">{currentTime || 'Live'}</span>
        </div>

        {/* Source Toggle Pill */}
        <button
          onClick={onToggleSource}
          className={`px-3 py-1 rounded-full text-xs font-mono font-bold border transition-colors flex items-center gap-1.5 ${
            systemSource === 'SIMULATOR'
              ? 'bg-blue-500/15 text-blue-300 border-blue-500/40 hover:bg-blue-500/25'
              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
          }`}
          title="Click to switch between Simulator and Physical Hardware mode"
        >
          {systemSource === 'SIMULATOR' ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-blue-400" />
              <span>Simulation Mode</span>
            </>
          ) : (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>Hardware Mode</span>
            </>
          )}
        </button>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-3">
        {/* Manual Refresh */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors disabled:opacity-50"
          title="Refresh telemetry & events"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            title="System alerts"
          >
            <Bell className="w-4 h-4" />
          </button>
          {alertCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-[9px] font-mono font-bold text-white flex items-center justify-center">
              {alertCount}
            </span>
          )}
        </div>

        {/* Emergency Stop Button */}
        <button
          onClick={onEmergencyStop}
          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow-md shadow-rose-600/30 transition-colors"
          title="Simulate Immediate Emergency E-STOP"
        >
          <AlertOctagon className="w-4 h-4" />
          <span className="hidden sm:inline">Emergency Stop</span>
        </button>

        {/* User Profile */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow">
            KS
          </div>
          <div className="hidden xl:block text-left">
            <div className="text-xs font-bold text-white leading-tight">Khushal</div>
            <div className="text-[10px] text-slate-400 leading-tight">In-Charge Admin</div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
