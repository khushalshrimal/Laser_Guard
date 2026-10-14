import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Server,
  Activity,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Flame,
  Layers,
  Wifi,
  WifiOff,
  Clock,
  Database,
  AlertOctagon,
  Info,
} from 'lucide-react';
import { useLaserGuardLive } from './hooks/useLaserGuardLive';
import { fetchBackendHealth, getApiBaseUrl } from './services/api';
import {
  BackendHealth,
  DeviceStatus,
  SafetySeverity,
  BlackboxEvent,
} from './types/telemetry';

export const App: React.FC = () => {
  const {
    connectionState,
    systemStatus,
    events,
    eventsLoading,
    eventsTotalCount,
    lastUpdated,
    lastError,
    wsUrl,
    refreshStatus,
    refreshEvents,
  } = useLaserGuardLive();

  const [healthData, setHealthData] = useState<BackendHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [selectedSeverityFilter, setSelectedSeverityFilter] = useState<string>('ALL');
  const [isRefreshingAll, setIsRefreshingAll] = useState<boolean>(false);

  const apiBaseUrl = getApiBaseUrl();

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const data = await fetchBackendHealth();
      setHealthData(data);
    } catch {
      setHealthData(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const handleRefreshAll = async () => {
    setIsRefreshingAll(true);
    await Promise.allSettled([
      refreshStatus(),
      refreshEvents(selectedSeverityFilter === 'ALL' ? { limit: 20 } : { severity: selectedSeverityFilter, limit: 20 }),
      loadHealth(),
    ]);
    setIsRefreshingAll(false);
  };

  const handleSeverityFilterChange = (sev: string) => {
    setSelectedSeverityFilter(sev);
    if (sev === 'ALL') {
      refreshEvents({ limit: 20 });
    } else {
      refreshEvents({ severity: sev, limit: 20 });
    }
  };

  // Derive highest severity across all devices
  const systemDevices: DeviceStatus[] = systemStatus?.devices || [];
  const hasCritical = systemDevices.some(
    (d) => d.safety?.overall_severity === 'CRITICAL'
  );
  const hasWarning = systemDevices.some(
    (d) => d.safety?.overall_severity === 'WARNING' || d.connectivity_state === 'STALE'
  );
  const systemSeverity: SafetySeverity = hasCritical
    ? 'CRITICAL'
    : hasWarning
    ? 'WARNING'
    : systemDevices.length > 0
    ? 'NORMAL'
    : 'NORMAL';

  return (
    <div className="min-h-screen bg-[#0c0e12] text-slate-100 flex flex-col font-sans">
      {/* Top Industrial Safety Protocol Banner */}
      <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs font-mono text-amber-300 flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>SAFETY PROTOCOL NOTICE:</strong> Software telemetry monitoring active. Physical safety E-STOP and optical beam relays are software advisories only — no physical trip actuation deployed.
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]">
            HACKATHON: SKIT014
          </span>
          <span className="text-slate-400 text-[10px]">DIRECT HTTP/WS (NO MQTT)</span>
        </div>
      </div>

      {/* Main Header */}
      <header className="border-b border-slate-800 bg-[#12161f]/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Flame className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">LaserGuard AI</h1>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                  v0.7.0 Live
                </span>
              </div>
              <p className="text-xs text-slate-400">Smart Laser-Cutting Machine Safety & Monitoring System</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Connection Pill */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#171c26] border border-slate-800 text-xs font-mono">
              <span className="text-slate-400">Live Stream:</span>
              {connectionState === 'connected' ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold" title={`WebSocket connected to ${wsUrl}`}>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <Wifi className="w-3.5 h-3.5" />
                  LIVE
                </span>
              ) : connectionState === 'reconnecting' ? (
                <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold" title="Attempting exponential backoff reconnect...">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  RECONNECTING
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold" title={lastError || 'WebSocket disconnected; using REST fallback'}>
                  <WifiOff className="w-3.5 h-3.5" />
                  DISCONNECTED
                </span>
              )}
            </div>

            {/* Manual Refresh Button */}
            <button
              onClick={handleRefreshAll}
              disabled={isRefreshingAll}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Refresh REST state and blackbox events"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingAll ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Data</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* System Overview Hero Section */}
        <section
          className={`rounded-xl border p-6 shadow-xl relative overflow-hidden transition-colors ${
            systemSeverity === 'CRITICAL'
              ? 'border-rose-600/70 bg-gradient-to-b from-rose-950/40 via-[#171c26] to-[#12161f]'
              : systemSeverity === 'WARNING'
              ? 'border-amber-600/60 bg-gradient-to-b from-amber-950/30 via-[#171c26] to-[#12161f]'
              : 'border-slate-800 bg-gradient-to-b from-[#171c26] to-[#12161f]'
          }`}
        >
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="space-y-2 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-1 rounded text-xs font-mono font-bold flex items-center gap-1.5 ${
                    systemSeverity === 'CRITICAL'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                      : systemSeverity === 'WARNING'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}
                >
                  {systemSeverity === 'CRITICAL' ? (
                    <AlertOctagon className="w-4 h-4 text-rose-400" />
                  ) : systemSeverity === 'WARNING' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                  OVERALL SYSTEM STATUS: {systemSeverity}
                </span>

                <span className="text-xs font-mono text-slate-400 px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                  Tracked Devices: {systemDevices.length}
                </span>
                {lastUpdated && (
                  <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-cyan-400" /> Last updated: {lastUpdated}
                  </span>
                )}
              </div>

              <h2 className="text-2xl font-bold text-white tracking-tight">
                {systemSeverity === 'CRITICAL'
                  ? 'CRITICAL SAFETY INTERLOCK ADVISORY'
                  : systemSeverity === 'WARNING'
                  ? 'SAFETY SYSTEM WARNING DETECTED'
                  : 'Laser Safety Monitoring Core Active'}
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                LaserGuard AI evaluates live telemetry from industrial laser cutters, comparing temperature, smoke,
                enclosure interlocks, and flame sensors against safety rules.
              </p>
            </div>

            {/* Distinction between Reported Physical State vs Software Recommendation */}
            <div className="shrink-0 flex flex-col gap-3 w-full lg:w-auto">
              <div className="px-4 py-3 rounded-lg bg-[#0c0e12] border border-slate-800 space-y-1">
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-slate-400 font-mono">Reported Machine State:</span>
                  <span className="font-bold text-white font-mono">
                    {systemDevices.some((d) => d.latest_readings.machine_running)
                      ? 'RUNNING'
                      : systemDevices.length > 0
                      ? 'IDLE / STOPPED'
                      : 'NO TELEMETRY'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-slate-400 font-mono">Recommended Action:</span>
                  <span
                    className={`font-bold font-mono ${
                      hasCritical
                        ? 'text-rose-400'
                        : hasWarning
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {hasCritical
                      ? 'STOP_RECOMMENDED'
                      : hasWarning
                      ? 'MAINTENANCE_REQUIRED'
                      : 'NORMAL_OPERATION'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-1 mt-1">
                  * Advisory only. Physical circuit cutoff requires certified safety relay.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Dual-Source Live Device Telemetry Grid */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Live Registered Device Telemetry
              </h3>
              <p className="text-xs text-slate-400">
                Single unified contract populated via HTTP POST <code className="text-amber-400">/ingest</code> and streamed via WebSocket
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
              Active Stale Threshold: {systemStatus?.stale_threshold_seconds ?? 10.0}s
            </span>
          </div>

          {systemDevices.length === 0 ? (
            /* Empty State when no devices have ingested telemetry yet */
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#12161f]/50 p-8 text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-400">
                <Cpu className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white">No Telemetry Ingested Yet</h4>
                <p className="text-xs text-slate-400 max-w-lg mx-auto">
                  The backend device registry is currently empty. Telemetry sent to <code className="text-cyan-400">POST /ingest</code> from physical ESP32 (<code className="text-emerald-400">HARDWARE</code>) or synthetic test script (<code className="text-blue-400">SIMULATOR</code>) will immediately appear here live via WebSocket.
                </p>
              </div>
              <div className="text-xs font-mono bg-[#0c0e12] p-4 rounded-lg border border-slate-800 text-left max-w-xl mx-auto space-y-1 text-slate-300 overflow-x-auto">
                <div className="text-amber-400 font-semibold">// Example PowerShell Telemetry Ingestion:</div>
                <div className="text-slate-400">$body = @&#123; source="SIMULATOR"; device_id="laser-cutter-01"; readings=@&#123; temperature_c=42.5; smoke_level=12; door_open=$false; machine_running=$true; machine_enabled=$true &#125; &#125; | ConvertTo-Json</div>
                <div className="text-cyan-300">Invoke-RestMethod -Uri "http://127.0.0.1:8000/ingest" -Method Post -Body $body -ContentType "application/json"</div>
              </div>
            </div>
          ) : (
            /* Device Cards Grid */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {systemDevices.map((device) => {
                const isSimulator = device.source === 'SIMULATOR';
                const isStale = device.connectivity_state === 'STALE';
                const devSeverity = device.safety?.overall_severity || 'NORMAL';
                const devRecState = device.safety?.recommended_state || 'NORMAL_OPERATION';
                const violations = device.safety?.violations || [];

                return (
                  <div
                    key={device.device_id}
                    className={`rounded-xl border p-5 space-y-5 bg-[#171c26]/70 transition-all ${
                      devSeverity === 'CRITICAL'
                        ? 'border-rose-600/80 shadow-lg shadow-rose-950/20'
                        : devSeverity === 'WARNING' || isStale
                        ? 'border-amber-500/60'
                        : 'border-slate-800'
                    }`}
                  >
                    {/* Device Header */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-base text-white font-mono">{device.device_id}</h4>
                          {/* Source Label */}
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
                              isSimulator
                                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            }`}
                          >
                            SOURCE: {device.source}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Last seen: {new Date(device.last_seen).toLocaleTimeString()} ({device.seconds_since_last_seen.toFixed(1)}s ago)
                        </p>
                      </div>

                      {/* Connectivity State Pill */}
                      <div>
                        {isStale ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold"
                            title="No telemetry packet received within stale threshold"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                            STALE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            ONLINE
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Stale / Simulator Warning Banners */}
                    {isStale && (
                      <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/50 flex items-start gap-2 text-xs text-amber-300">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                        <div>
                          <strong>TELEMETRY STALE WARNING:</strong> Device heartbeat exceeded {device.stale_threshold_seconds}s threshold. Displayed readings may be obsolete. Machine fail-safe recommends halting cutting operation.
                        </div>
                      </div>
                    )}

                    {isSimulator && (
                      <div className="p-2.5 rounded-lg bg-blue-950/20 border border-blue-800/30 flex items-center gap-2 text-xs text-blue-300">
                        <Info className="w-4 h-4 shrink-0 text-blue-400" />
                        <span>
                          <strong>SIMULATOR ACTIVE:</strong> Telemetry is synthetically simulated. Physics values do not represent real-world laser hardware.
                        </span>
                      </div>
                    )}

                    {/* Sensor Readings Grid */}
                    <div className="space-y-2">
                      <div className="text-xs font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Activity className="w-3 h-3 text-cyan-400" />
                        Reported Sensor Readings
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {/* Enclosure Door */}
                        <div className="p-2.5 rounded-lg bg-[#0c0e12] border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 font-mono">Enclosure Door</div>
                          <div
                            className={`text-xs font-bold font-mono mt-1 ${
                              device.latest_readings.door_open
                                ? 'text-rose-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {device.latest_readings.door_open === undefined || device.latest_readings.door_open === null
                              ? 'UNREPORTED'
                              : device.latest_readings.door_open
                              ? 'OPEN (TRIPPED)'
                              : 'CLOSED (SAFE)'}
                          </div>
                        </div>

                        {/* Optical Flame */}
                        <div className="p-2.5 rounded-lg bg-[#0c0e12] border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 font-mono">Optical Flame Sensor</div>
                          <div
                            className={`text-xs font-bold font-mono mt-1 ${
                              device.latest_readings.flame_detected
                                ? 'text-rose-400 animate-pulse'
                                : 'text-emerald-400'
                            }`}
                          >
                            {device.latest_readings.flame_detected === undefined || device.latest_readings.flame_detected === null
                              ? 'UNREPORTED'
                              : device.latest_readings.flame_detected
                              ? 'FIRE DETECTED'
                              : 'NOMINAL'}
                          </div>
                        </div>

                        {/* Smoke Level */}
                        <div className="p-2.5 rounded-lg bg-[#0c0e12] border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 font-mono">Smoke Index</div>
                          <div
                            className={`text-xs font-bold font-mono mt-1 ${
                              (device.latest_readings.smoke_level ?? 0) >= 50
                                ? 'text-amber-400'
                                : 'text-slate-200'
                            }`}
                          >
                            {device.latest_readings.smoke_level !== null && device.latest_readings.smoke_level !== undefined
                              ? `${device.latest_readings.smoke_level.toFixed(1)} / 50.0`
                              : 'UNREPORTED'}
                          </div>
                        </div>

                        {/* Temperature */}
                        <div className="p-2.5 rounded-lg bg-[#0c0e12] border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 font-mono">Workpiece Temp</div>
                          <div
                            className={`text-xs font-bold font-mono mt-1 ${
                              (device.latest_readings.temperature_c ?? 0) >= 60
                                ? 'text-rose-400 font-bold'
                                : 'text-cyan-300'
                            }`}
                          >
                            {device.latest_readings.temperature_c !== null && device.latest_readings.temperature_c !== undefined
                              ? `${device.latest_readings.temperature_c.toFixed(1)} °C`
                              : 'UNREPORTED'}
                          </div>
                        </div>

                        {/* Machine Interlock Permission */}
                        <div className="p-2.5 rounded-lg bg-[#0c0e12] border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 font-mono">Laser Permission</div>
                          <div
                            className={`text-xs font-bold font-mono mt-1 ${
                              device.latest_readings.machine_enabled
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {device.latest_readings.machine_enabled === undefined || device.latest_readings.machine_enabled === null
                              ? 'UNREPORTED'
                              : device.latest_readings.machine_enabled
                              ? 'ENABLED'
                              : 'LOCKED / DISABLED'}
                          </div>
                        </div>

                        {/* Machine Running */}
                        <div className="p-2.5 rounded-lg bg-[#0c0e12] border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 font-mono">Laser Beam / Motor</div>
                          <div
                            className={`text-xs font-bold font-mono mt-1 ${
                              device.latest_readings.machine_running
                                ? 'text-amber-300'
                                : 'text-slate-400'
                            }`}
                          >
                            {device.latest_readings.machine_running === undefined || device.latest_readings.machine_running === null
                              ? 'UNREPORTED'
                              : device.latest_readings.machine_running
                              ? 'ACTIVELY RUNNING'
                              : 'IDLE'}
                          </div>
                        </div>

                        {/* Coolant Water Flow (YF-S201) */}
                        <div className="p-2.5 rounded-lg bg-[#0c0e12] border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 font-mono">Coolant Flow (YF-S201)</div>
                          <div
                            className={`text-xs font-bold font-mono mt-1 ${
                              device.latest_readings.water_flow_lpm !== null &&
                              device.latest_readings.water_flow_lpm !== undefined &&
                              device.latest_readings.water_flow_lpm < 1.0 &&
                              device.latest_readings.machine_running
                                ? 'text-rose-400 font-bold animate-pulse'
                                : device.latest_readings.water_flow_lpm !== null &&
                                  device.latest_readings.water_flow_lpm !== undefined
                                ? 'text-cyan-300'
                                : 'text-slate-400'
                            }`}
                          >
                            {device.latest_readings.water_flow_lpm !== null && device.latest_readings.water_flow_lpm !== undefined
                              ? `${device.latest_readings.water_flow_lpm.toFixed(1)} L/min`
                              : 'UNREPORTED'}
                          </div>
                        </div>

                        {/* Optical Perimeter (Webcam) */}
                        <div className="p-2.5 rounded-lg bg-[#0c0e12] border border-slate-800/80">
                          <div className="text-[10px] text-slate-400 font-mono">Optical Boundary (Cam)</div>
                          <div
                            className={`text-xs font-bold font-mono mt-1 ${
                              device.latest_readings.camera_intrusion_detected
                                ? 'text-rose-400 font-bold animate-pulse'
                                : device.latest_readings.camera_intrusion_detected === false
                                ? 'text-emerald-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {device.latest_readings.camera_intrusion_detected === undefined || device.latest_readings.camera_intrusion_detected === null
                              ? 'OFFLINE / UNREPORTED'
                              : device.latest_readings.camera_intrusion_detected
                              ? 'INTRUSION DETECTED'
                              : 'PERIMETER CLEAR'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Safety Assessment & Decision Support Box */}
                    <div className="rounded-lg bg-[#0c0e12] p-3 border border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 font-mono">Safety Severity:</span>
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                            devSeverity === 'CRITICAL'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : devSeverity === 'WARNING'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          }`}
                        >
                          {devSeverity}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 font-mono">Recommended State:</span>
                        <span
                          className={`font-mono font-bold text-xs ${
                            devRecState === 'STOP_RECOMMENDED' || devRecState === 'SHUTDOWN_RECOMMENDED'
                              ? 'text-rose-400'
                              : devRecState === 'MAINTENANCE_REQUIRED'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {devRecState}
                        </span>
                      </div>

                      {/* Triggered Violations */}
                      {violations.length > 0 && (
                        <div className="border-t border-slate-800/80 pt-2 space-y-1">
                          <div className="text-[10px] font-mono text-rose-400 font-semibold uppercase">
                            Triggered Violations ({violations.length}):
                          </div>
                          {violations.map((v, idx) => (
                            <div
                              key={idx}
                              className="text-xs text-rose-300 bg-rose-950/20 p-2 rounded border border-rose-900/30 space-y-0.5"
                            >
                              <div className="font-mono text-[10px] text-rose-400 font-bold">{v.rule_id}</div>
                              <div>{v.message}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* SQLite Blackbox Safety Event History Section */}
        <section className="rounded-xl border border-slate-800 bg-[#12161f] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-400" />
                Persistent SQLite Blackbox Event History
              </h3>
              <p className="text-xs text-slate-400">
                Immutable audit trail persisted in SQLite (<code className="text-amber-400">GET /api/events</code>). Survives application restarts.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Severity Filter Buttons */}
              <div className="flex items-center rounded-md bg-[#171c26] border border-slate-800 p-0.5 text-xs font-mono">
                {['ALL', 'CRITICAL', 'WARNING', 'NORMAL'].map((sev) => (
                  <button
                    key={sev}
                    onClick={() => handleSeverityFilterChange(sev)}
                    className={`px-2 py-1 rounded text-[11px] transition-colors ${
                      selectedSeverityFilter === sev
                        ? 'bg-slate-700 text-white font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>

              <button
                onClick={() => handleSeverityFilterChange(selectedSeverityFilter)}
                disabled={eventsLoading}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1 transition-colors disabled:opacity-50"
                title="Reload blackbox audit records"
              >
                <RefreshCw className={`w-3 h-3 ${eventsLoading ? 'animate-spin' : ''}`} />
                <span>Reload</span>
              </button>
            </div>
          </div>

          {eventsLoading ? (
            <div className="py-8 text-center text-xs font-mono text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
              Loading persistent blackbox events from SQLite...
            </div>
          ) : events.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">No Events Recorded</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                No safety transitions or rule activations have occurred yet matching the filter. Events are automatically logged to the blackbox when hazard conditions or connectivity timeouts occur.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs font-mono text-slate-400 flex items-center justify-between">
                <span>Showing {events.length} of {eventsTotalCount} recorded events (Newest First)</span>
                <span className="text-slate-500">Ordered by event ID DESC</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[11px] uppercase">
                      <th className="py-2.5 px-3">ID</th>
                      <th className="py-2.5 px-3">Timestamp (UTC)</th>
                      <th className="py-2.5 px-3">Severity</th>
                      <th className="py-2.5 px-3">Event Type</th>
                      <th className="py-2.5 px-3">Device / Source</th>
                      <th className="py-2.5 px-3">Description & Rule</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {events.map((ev: BlackboxEvent) => {
                      const sev = ev.severity || 'UNKNOWN';
                      return (
                        <tr key={ev.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 px-3 text-slate-500 font-bold">#{ev.id}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">
                            {ev.timestamp.replace('T', ' ').slice(0, 19)}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                sev === 'CRITICAL'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : sev === 'WARNING'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              }`}
                            >
                              {sev}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-cyan-300">{ev.event_type}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="text-white font-bold">{ev.device_id}</span>
                            <span
                              className={`ml-1.5 px-1 py-0.2 rounded text-[9px] ${
                                ev.source === 'SIMULATOR'
                                  ? 'bg-blue-500/20 text-blue-300'
                                  : 'bg-emerald-500/20 text-emerald-300'
                              }`}
                            >
                              {ev.source}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 max-w-md">
                            <div className="text-slate-200">{ev.message}</div>
                            {ev.rule_id && (
                              <div className="text-[10px] text-slate-500">Rule: {ev.rule_id}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Backend Diagnostics & Endpoints Verification */}
        <section className="rounded-xl border border-slate-800 bg-[#12161f] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" />
              API Diagnostics & Pipeline Connectivity
            </h3>
            <span className="text-xs font-mono text-slate-400">FastAPI + Uvicorn</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-[#0c0e12] border border-slate-800 font-mono text-xs">
              <div className="text-[11px] text-slate-500 uppercase">Backend API Base</div>
              <div className="text-cyan-400 font-bold mt-0.5 truncate">{apiBaseUrl}</div>
            </div>
            <div className="p-3 rounded-lg bg-[#0c0e12] border border-slate-800 font-mono text-xs">
              <div className="text-[11px] text-slate-500 uppercase">WebSocket Stream URL</div>
              <div className="text-amber-400 font-bold mt-0.5 truncate">{wsUrl}</div>
            </div>
            <div className="p-3 rounded-lg bg-[#0c0e12] border border-slate-800 font-mono text-xs">
              <div className="text-[11px] text-slate-500 uppercase">Server Status</div>
              <div className="text-emerald-400 font-bold mt-0.5 uppercase">
                {healthLoading ? 'CHECKING...' : healthData?.status || 'ONLINE'}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#0c0e12] border border-slate-800 font-mono text-xs">
              <div className="text-[11px] text-slate-500 uppercase">Architecture Policy</div>
              <div className="text-slate-300 font-bold mt-0.5">DIRECT HTTP/WS (NO MQTT)</div>
            </div>
          </div>
        </section>
      </main>

      {/* Industrial Dark Footer */}
      <footer className="border-t border-slate-800 bg-[#0c0e12] py-4 text-xs font-mono text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>LaserGuard AI • Hackathon Project SKIT014 • Milestone 7: Live Dashboard</div>
          <div className="flex items-center gap-2 text-slate-400">
            <span>React + Vite</span>
            <span>•</span>
            <span>FastAPI</span>
            <span>•</span>
            <span>SQLite Blackbox</span>
            <span>•</span>
            <span>WebSockets</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
