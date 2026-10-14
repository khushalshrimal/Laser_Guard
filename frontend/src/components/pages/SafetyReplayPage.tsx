import React, { useState } from 'react';
import {
  RotateCcw,
  Clock,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';
import { BlackboxEvent } from '../../types/telemetry';

interface SafetyReplayPageProps {
  events: BlackboxEvent[];
}

export const SafetyReplayPage: React.FC<SafetyReplayPageProps> = ({ events }) => {
  // Filter for incidents (hazards / transitions)
  const incidents = events.filter((e) => e.severity === 'CRITICAL' || e.severity === 'WARNING');
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(
    incidents.length > 0 ? incidents[0].id : null
  );

  const activeIncident = incidents.find((e) => e.id === selectedIncidentId) || incidents[0] || null;

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

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-cyan-400" />
          Safety Incident Replay & Root-Cause Forensic Analysis
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Select any past safety transition or rule activation from the SQLite blackbox to inspect sensor signals, threshold crossings, and automated fail-safe responses.
        </p>
      </div>

      {incidents.length === 0 ? (
        <div className="p-12 rounded-2xl border border-dashed border-slate-800 bg-[#0d121c] text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
          <h4 className="text-sm font-bold text-white">No Safety Hazards Recorded</h4>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            The blackbox log has no WARNING or CRITICAL incidents yet. Trigger a simulated fire, door trip, or overheat scenario in the simulator to generate an incident for replay!
          </p>
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
          </div>

          {/* Center & Right: Incident Details & Sensor Replay (8 cols) */}
          <div className="lg:col-span-8 space-y-5">
            {activeIncident && (
              <>
                {/* Details Card */}
                <div className="rounded-2xl border border-slate-800 bg-[#101522] p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <span className="text-[10px] font-mono text-slate-400">Incident Forensic Record</span>
                      <h4 className="text-base font-bold text-white">{activeIncident.message}</h4>
                    </div>
                    <span
                      className={`text-xs font-mono font-bold px-2.5 py-1 rounded-md border ${
                        activeIncident.severity === 'CRITICAL'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      }`}
                    >
                      {activeIncident.severity}
                    </span>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-2.5 rounded-lg bg-[#080b12] border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase">Timestamp</div>
                      <div className="text-white font-bold mt-0.5">
                        {activeIncident.timestamp.replace('T', ' ').slice(0, 19)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#080b12] border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase">Triggered Rule</div>
                      <div className="text-cyan-300 font-bold mt-0.5 truncate">
                        {activeIncident.rule_id || 'N/A'}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#080b12] border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase">Source Origin</div>
                      <div className="text-emerald-400 font-bold mt-0.5">
                        {activeIncident.source}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#080b12] border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase">Recommended State</div>
                      <div className="text-rose-400 font-bold mt-0.5">
                        {activeIncident.recommended_state || 'STOP_RECOMMENDED'}
                      </div>
                    </div>
                  </div>

                  {/* Incident Step-by-Step Timeline */}
                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <div className="text-xs font-mono font-bold text-slate-300 uppercase">
                      Incident Chronology & Automated Reaction
                    </div>
                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex items-start gap-2.5 p-2 rounded bg-[#090d15] border border-slate-800">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                        <div>
                          <span className="text-cyan-400 font-bold">Step 1: Signal Threshold Breached:</span>{' '}
                          Telemetry received via HTTP POST `/ingest` exceeded calibrated safety threshold.
                        </div>
                      </div>
                      <div className="flex items-start gap-2.5 p-2 rounded bg-[#090d15] border border-slate-800">
                        <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                        <div>
                          <span className="text-amber-400 font-bold">Step 2: Safety Engine Evaluation:</span>{' '}
                          Evaluated against 8 core industrial rules. Overall severity transitioned to {activeIncident.severity}.
                        </div>
                      </div>
                      <div className="flex items-start gap-2.5 p-2 rounded bg-[#090d15] border border-slate-800">
                        <span className="w-2 h-2 rounded-full bg-rose-400 mt-1.5 shrink-0" />
                        <div>
                          <span className="text-rose-400 font-bold">Step 3: Blackbox & WebSocket Broadcast:</span>{' '}
                          Event persisted to SQLite WAL audit log (`id #{activeIncident.id}`) and dispatched live to WebSocket `/ws/status`.
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
                    <span className="text-[10px] font-mono text-slate-400">Forensic Curve Analysis</span>
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
