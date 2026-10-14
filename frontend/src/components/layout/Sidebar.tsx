import React from 'react';
import {
  LayoutDashboard,
  Activity,
  History,
  RotateCcw,
  Cpu,
  Settings,
  Flame,
  Layers,
} from 'lucide-react';
import { TelemetrySource } from '../../types/telemetry';

export type PageId =
  | 'dashboard'
  | 'live-readings'
  | 'event-history'
  | 'safety-replay'
  | 'device-health'
  | 'settings-simulator';

interface SidebarProps {
  activePage: PageId;
  onPageChange: (page: PageId) => void;
  systemSource: TelemetrySource;
  onToggleSource: () => void;
  alertCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onPageChange,
  systemSource,
  onToggleSource,
  alertCount = 0,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'live-readings', label: 'Live Readings', icon: Activity },
    { id: 'event-history', label: 'Event History', icon: History, badge: alertCount > 0 ? alertCount : undefined },
    { id: 'safety-replay', label: 'Safety Replay', icon: RotateCcw },
    { id: 'device-health', label: 'Sensor & Device Health', icon: Cpu },
    { id: 'settings-simulator', label: 'Settings & Simulator', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-[#0a0e17] border-r border-slate-800/80 flex flex-col shrink-0 min-h-screen text-slate-300 select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800/80 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/25 shrink-0">
          <Flame className="w-6 h-6 text-white stroke-[2.2]" />
        </div>
        <div className="overflow-hidden">
          <div className="flex items-center gap-1.5">
            <h1 className="text-base font-extrabold tracking-wider text-white uppercase font-sans">
              LASERGUARD
            </h1>
          </div>
          <p className="text-[10px] text-slate-400 truncate">
            Safety & Monitoring System
          </p>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 p-3 space-y-1.5">
        <div className="text-[10px] font-mono uppercase text-slate-500 px-3 py-1 font-semibold">
          Platform Navigation
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id as PageId)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-rose-500 text-white">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* System Source Indicator & Switch (Bottom of Sidebar) */}
      <div className="p-3 border-t border-slate-800/80 space-y-3 bg-[#080b12]">
        <div className="p-3 rounded-xl border border-slate-800 bg-[#0d121c] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase text-slate-400 font-semibold flex items-center gap-1">
              <Layers className="w-3 h-3 text-cyan-400" /> System Source
            </span>
            <button
              onClick={onToggleSource}
              className="text-[10px] font-mono text-cyan-400 hover:underline"
              title="Toggle target telemetry source"
            >
              Switch
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  systemSource === 'HARDWARE' ? 'bg-emerald-500 animate-pulse' : 'bg-blue-400 animate-pulse'
                }`}
              />
              <span className="text-xs font-mono font-bold text-white">{systemSource}</span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                systemSource === 'HARDWARE'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
              }`}
            >
              {systemSource === 'HARDWARE' ? 'ESP32 Wi-Fi' : 'Digital Twin'}
            </span>
          </div>

          <div className="text-[10px] font-mono text-slate-500">
            {systemSource === 'HARDWARE' ? 'IP: 192.168.1.42 • HTTP' : 'Synthetic Physics Simulation'}
          </div>
        </div>

        {/* Footer Hackathon Info */}
        <div className="px-2 text-[10px] font-mono text-slate-600 flex items-center justify-between">
          <span>LaserGuard v1.0.0</span>
          <span>SKIT Hackathon 2025</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
