import React, { useState } from 'react';
import { Camera, ShieldAlert, CheckCircle2, Video } from 'lucide-react';

interface CameraMonitorProps {
  intrusionDetected?: boolean | null;
  className?: string;
  onSimulateIntrusion?: (intrude: boolean) => void;
}

export const CameraMonitor: React.FC<CameraMonitorProps> = ({
  intrusionDetected = false,
  className = '',
  onSimulateIntrusion,
}) => {
  const [activeView, setActiveView] = useState<'inside' | 'top' | 'side'>('inside');
  const [localIntrude, setLocalIntrude] = useState<boolean>(Boolean(intrusionDetected));

  const isBreached = intrusionDetected !== null && intrusionDetected !== undefined ? intrusionDetected : localIntrude;

  const toggleIntrude = () => {
    const next = !isBreached;
    setLocalIntrude(next);
    if (onSimulateIntrusion) {
      onSimulateIntrusion(next);
    }
  };

  return (
    <div className={`rounded-xl border border-slate-800 bg-[#111622] p-4 space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-cyan-400" />
          <h4 className="text-sm font-bold text-white tracking-wide">Camera Safety Monitor</h4>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            SIMULATED FEED
          </span>
        </div>

        {/* View Tabs */}
        <div className="flex items-center rounded bg-[#0b0e14] border border-slate-800 p-0.5 text-[10px] font-mono">
          {(['inside', 'top', 'side'] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`px-2 py-0.5 rounded capitalize transition-colors ${
                activeView === view ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {view} View
            </button>
          ))}
        </div>
      </div>

      {/* Main View Area with Danger Zone Overlay */}
      <div className="relative rounded-lg overflow-hidden bg-[#070a0f] border border-slate-800 aspect-video flex items-center justify-center group">
        {/* Synthetic Cutting Bed Background Grid */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle, #38bdf8 1px, transparent 1px), linear-gradient(to right, #1e293b 1px, transparent 1px), linear-gradient(to bottom, #1e293b 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Laser Head & Beam Representation */}
        <div className="relative flex flex-col items-center justify-center z-10 space-y-1">
          <div className="w-16 h-8 rounded-t bg-slate-700 border border-slate-500 flex items-center justify-center shadow-lg">
            <span className="text-[9px] font-mono text-cyan-300 font-bold">LASER HEAD</span>
          </div>
          <div className="w-1 h-12 bg-gradient-to-b from-amber-400 via-rose-500 to-transparent animate-pulse" />
          <div className="w-3 h-3 rounded-full bg-amber-400/80 blur-xs shadow-lg shadow-amber-500" />
        </div>

        {/* Bounding Box Danger Zone Overlay */}
        <div
          className={`absolute inset-8 rounded border-2 transition-all duration-300 flex flex-col justify-between p-2.5 ${
            isBreached
              ? 'border-rose-500 bg-rose-950/30 shadow-lg shadow-rose-950/50'
              : 'border-cyan-500/50 bg-cyan-950/10'
          }`}
        >
          {/* Top Label */}
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span
              className={`px-1.5 py-0.5 rounded font-bold ${
                isBreached ? 'bg-rose-600 text-white animate-pulse' : 'bg-cyan-500/20 text-cyan-300'
              }`}
            >
              {isBreached ? 'DANGER ZONE: BREACHED' : 'EXCLUSION ZONE: CLEAR'}
            </span>
            <span className="text-slate-400">MediaPipe Perimeter</span>
          </div>

          {/* Hand Intrusion Bounding Box if Breached */}
          {isBreached && (
            <div className="self-center p-2 rounded border border-rose-500 bg-rose-900/60 text-white font-mono text-center animate-bounce">
              <div className="text-[11px] font-bold text-rose-300">HAND INTRUSION DETECTED</div>
              <div className="text-[9px] text-rose-200">Confidence: 96.4% • STOP Triggered</div>
            </div>
          )}

          {/* Bottom Stream Readout */}
          <div className="flex items-center justify-between text-[9px] font-mono text-slate-400">
            <span className="flex items-center gap-1 text-rose-400">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> REC (Simulated Feed)
            </span>
            <span>640x480 @ 12 FPS</span>
          </div>
        </div>

        {/* Interactive Intrusion Test Button Overlay */}
        <div className="absolute bottom-2 right-2 z-20">
          <button
            onClick={toggleIntrude}
            className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold transition-colors shadow ${
              isBreached ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
          >
            {isBreached ? 'Clear Intrusion' : 'Simulate Intrusion'}
          </button>
        </div>
      </div>

      {/* Info Status Footer */}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400">Perimeter Status:</span>
          {isBreached ? (
            <span className="text-rose-400 font-bold flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" /> BREACHED
            </span>
          ) : (
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> SECURE
            </span>
          )}
        </div>
        <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400">Vision Engine:</span>
          <span className="text-cyan-400 font-bold flex items-center gap-1">
            <Video className="w-3 h-3" /> OpenCV + MediaPipe
          </span>
        </div>
      </div>
    </div>
  );
};

export default CameraMonitor;
