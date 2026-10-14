import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Server,
  Activity,
  Cpu,
  Radio,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Terminal,
  ZapOff,
  Flame,
  Layers
} from 'lucide-react';

interface BackendHealth {
  status: string;
  app: string;
  version: string;
  environment: string;
  hardware_connected: boolean;
  active_source: string;
  notice: string;
}

export const App: React.FC = () => {
  const [healthData, setHealthData] = useState<BackendHealth | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

  const checkHealth = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data: BackendHealth = await response.json();
      setHealthData(data);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown network failure';
      setErrorMsg(`Failed to reach backend at ${apiBaseUrl} (${message})`);
      setHealthData(null);
      setLastChecked(new Date().toLocaleTimeString());
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return (
    <div className="min-h-screen bg-[#0c0e12] text-slate-100 flex flex-col font-sans">
      {/* Top Industrial Safety Banner */}
      <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs font-mono text-amber-300 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>SAFETY PROTOCOL NOTICE:</strong> FOUNDATION PHASE ACTIVE — Physical hardware disconnected. Optical isolation & physical E-STOP not deployed.
          </span>
        </div>
        <div className="hidden md:flex items-center gap-3">
          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            HACKATHON: SKIT014
          </span>
          <span className="text-slate-400">NO MQTT ARCHITECTURE</span>
        </div>
      </div>

      {/* Main Header / Navigation */}
      <header className="border-b border-slate-800 bg-[#12161f]/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Flame className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">LaserGuard AI</h1>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                  v0.1.0 Foundation
                </span>
              </div>
              <p className="text-xs text-slate-400">Smart Laser-Cutting Machine Safety & Monitoring System</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#171c26] border border-slate-800 text-xs font-mono">
              <span className="text-slate-400">Backend API:</span>
              {isLoading ? (
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                  Checking...
                </span>
              ) : healthData ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  ONLINE (200 OK)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  OFFLINE
                </span>
              )}
            </div>

            <button
              onClick={checkHealth}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Ping GET /health"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Health</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard Foundation */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Intro Hero Box */}
        <section className="rounded-xl border border-slate-800 bg-gradient-to-b from-[#171c26] to-[#12161f] p-6 shadow-xl relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700 text-xs font-mono text-cyan-400">
                <Terminal className="w-3.5 h-3.5" />
                <span>MILESTONE 1: FOUNDATION RUNTIME</span>
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Industrial Safety Core Initialized
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                LaserGuard AI provides high-frequency telemetric monitoring, anomaly detection, and rapid interlocking
                for industrial CO₂ and fiber laser cutters. This foundation establishes the decoupled React + FastAPI pipeline.
              </p>
            </div>
            <div className="shrink-0 flex flex-col gap-2 w-full md:w-auto">
              <div className="px-4 py-3 rounded-lg bg-[#0c0e12] border border-slate-800 flex items-center gap-3">
                <ZapOff className="w-5 h-5 text-amber-400" />
                <div className="text-xs">
                  <div className="font-semibold text-slate-200">Hardware Interlock Status</div>
                  <div className="text-slate-400 font-mono">STANDBY / NO HARDWARE</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Data Ingestion Pipeline Architecture: Simulator vs Hardware */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              Dual-Source Telemetry Interface (Standardized Schema)
            </h3>
            <span className="text-xs font-mono text-slate-400">Direct HTTP POST Ingestion</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* SIMULATOR Card */}
            <div className="rounded-xl border border-slate-800 bg-[#171c26]/60 p-5 space-y-4 relative">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-white">Source: SIMULATOR</h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        SIMULATOR
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">Software laser cutter telemetric generator</p>
                  </div>
                </div>
                <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                  READY FOR NEXT PHASE
                </span>
              </div>

              <div className="text-xs text-slate-300 bg-[#0c0e12] p-3 rounded-lg border border-slate-800/80 font-mono space-y-1">
                <div className="text-slate-400">// Ingestion target</div>
                <div>POST /api/telemetry (Source: "SIMULATOR")</div>
                <div className="text-slate-500">Payload: temp, smoke, enclosure_open, beam_active</div>
              </div>

              <div className="text-xs text-slate-400">
                Allows testing overheat spikes, smoke anomalies, and door trips without firing a physical laser.
              </div>
            </div>

            {/* HARDWARE ESP32 Card */}
            <div className="rounded-xl border border-slate-800 bg-[#171c26]/60 p-5 space-y-4 relative">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-white">Source: HARDWARE</h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        HARDWARE
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">Physical ESP32 microcontroller over WiFi</p>
                  </div>
                </div>
                <span className="text-xs font-mono text-amber-400 bg-amber-950/40 px-2 py-1 rounded border border-amber-800/50">
                  DISCONNECTED
                </span>
              </div>

              <div className="text-xs text-slate-300 bg-[#0c0e12] p-3 rounded-lg border border-slate-800/80 font-mono space-y-1">
                <div className="text-slate-400">// Hardware communication</div>
                <div>Transport: HTTP POST (ESP32 WiFiClient)</div>
                <div className="text-slate-500">Protocol: Direct JSON (No MQTT Broker needed)</div>
              </div>

              <div className="text-xs text-slate-400">
                Identical JSON schema allows zero-friction transition between mock physics and true machine probes.
              </div>
            </div>
          </div>
        </section>

        {/* Backend Diagnostic & Health Verification Card */}
        <section className="rounded-xl border border-slate-800 bg-[#12161f] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-cyan-400" />
                Backend Health Check Verification
              </h3>
              <p className="text-xs text-slate-400">
                Live verification against FastAPI endpoint <code className="text-amber-400">GET {apiBaseUrl}/health</code>
              </p>
            </div>
            {lastChecked && (
              <span className="text-xs font-mono text-slate-400">
                Last checked: {lastChecked}
              </span>
            )}
          </div>

          {healthData ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-800/40 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-emerald-300">FastAPI Backend Responding Normally</div>
                  <div className="text-slate-300">{healthData.notice}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-[#0c0e12] border border-slate-800">
                  <div className="text-[11px] text-slate-400 uppercase font-mono">App Name</div>
                  <div className="font-bold text-white text-sm mt-0.5">{healthData.app}</div>
                </div>
                <div className="p-3 rounded-lg bg-[#0c0e12] border border-slate-800">
                  <div className="text-[11px] text-slate-400 uppercase font-mono">Health Status</div>
                  <div className="font-bold text-emerald-400 text-sm mt-0.5 uppercase">{healthData.status}</div>
                </div>
                <div className="p-3 rounded-lg bg-[#0c0e12] border border-slate-800">
                  <div className="text-[11px] text-slate-400 uppercase font-mono">Version</div>
                  <div className="font-mono text-white text-sm mt-0.5">{healthData.version}</div>
                </div>
                <div className="p-3 rounded-lg bg-[#0c0e12] border border-slate-800">
                  <div className="text-[11px] text-slate-400 uppercase font-mono">Hardware Linked</div>
                  <div className="font-mono text-amber-400 text-sm mt-0.5">
                    {healthData.hardware_connected ? 'YES' : 'NO (Intended)'}
                  </div>
                </div>
              </div>

              <div className="bg-[#0c0e12] p-4 rounded-lg border border-slate-800 font-mono text-xs">
                <div className="text-slate-400 mb-2">// Raw JSON Response Payload</div>
                <pre className="text-cyan-300 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(healthData, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-rose-950/20 border border-rose-800/40 flex items-start gap-3">
                <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-rose-300">Backend Server Unreachable</div>
                  <div className="text-slate-300">
                    {errorMsg || 'FastAPI backend service is not running or CORS is blocking the request.'}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-[#0c0e12] border border-slate-800 text-xs font-mono text-slate-300 space-y-2">
                <div className="text-amber-400 font-semibold">// How to start the backend on Windows:</div>
                <div className="text-slate-400">cd backend</div>
                <div className="text-slate-400">.\.venv\Scripts\Activate.ps1</div>
                <div className="text-slate-200">uvicorn app.main:app --reload --host 127.0.0.1 --port 8000</div>
              </div>
            </div>
          )}
        </section>

        {/* Technical Roadmap Cards */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
            <Radio className="w-4 h-4 text-amber-400" />
            Subsequent Milestones (Roadmap)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-800 bg-[#171c26]/40 space-y-2">
              <div className="text-xs font-mono text-amber-400">MILESTONE 2</div>
              <h4 className="font-bold text-sm text-white">ESP32 / Simulator Ingestion</h4>
              <p className="text-xs text-slate-400">
                Single unified POST endpoint accepting JSON payload with SOURCE validation (SIMULATOR vs HARDWARE).
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-[#171c26]/40 space-y-2">
              <div className="text-xs font-mono text-cyan-400">MILESTONE 3</div>
              <h4 className="font-bold text-sm text-white">Live WebSocket Stream</h4>
              <p className="text-xs text-slate-400">
                Low-latency pub-sub broadcasting machine telemetry to React dashboard without client polling.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-[#171c26]/40 space-y-2">
              <div className="text-xs font-mono text-emerald-400">MILESTONE 4</div>
              <h4 className="font-bold text-sm text-white">SQLite Safety Blackbox</h4>
              <p className="text-xs text-slate-400">
                Persistent event audit trail recording safety breaches, door trips, and e-stop alerts.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Industrial Footer */}
      <footer className="border-t border-slate-800 bg-[#0c0e12] py-4 text-xs font-mono text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>LaserGuard AI • Hackathon Project SKIT014 • Foundation Milestone</div>
          <div className="flex items-center gap-2 text-slate-400">
            <span>React + Vite</span>
            <span>•</span>
            <span>FastAPI</span>
            <span>•</span>
            <span>Python 3.14</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
