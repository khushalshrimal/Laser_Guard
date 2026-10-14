import React, { useState, useEffect, useCallback } from 'react';
import { useLaserGuardLive } from './hooks/useLaserGuardLive';
import { fetchBackendHealth, ingestTelemetryPayload } from './services/api';
import {
  BackendHealth,
  DeviceStatus,
  SafetySeverity,
  TelemetrySource,
} from './types/telemetry';
import { Sidebar, PageId } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { DashboardPage } from './components/pages/DashboardPage';
import { LiveReadingsPage } from './components/pages/LiveReadingsPage';
import { EventHistoryPage } from './components/pages/EventHistoryPage';
import { SafetyReplayPage } from './components/pages/SafetyReplayPage';
import { DeviceHealthPage } from './components/pages/DeviceHealthPage';
import { SettingsSimulatorPage } from './components/pages/SettingsSimulatorPage';
import { DataPoint } from './components/common/SensorChart';

export const App: React.FC = () => {
  const {
    connectionState,
    systemStatus,
    events,
    eventsLoading,
    eventsTotalCount,
    refreshStatus,
    refreshEvents,
  } = useLaserGuardLive();

  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [systemSource, setSystemSource] = useState<TelemetrySource>('SIMULATOR');
  const [healthData, setHealthData] = useState<BackendHealth | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Rolling real-time telemetry buffer for charts
  const [chartHistory, setChartHistory] = useState<DataPoint[]>([
    { time: '12:00', temperature: 26.0, gas: 14.0, waterFlow: 4.2 },
    { time: '12:05', temperature: 27.2, gas: 15.0, waterFlow: 4.4 },
    { time: '12:10', temperature: 28.5, gas: 18.0, waterFlow: 4.5 },
  ]);

  const loadHealth = useCallback(async () => {
    try {
      const data = await fetchBackendHealth();
      setHealthData(data);
    } catch {
      setHealthData(null);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  // Single authoritative machine state
  const machine: DeviceStatus | null = systemStatus?.devices?.[0] || null;

  useEffect(() => {
    if (machine?.latest_readings) {
      const r = machine.latest_readings;
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      setChartHistory((prev) => {
        const next = [
          ...prev,
          {
            time: timeStr,
            temperature: r.temperature_c ?? 28.5,
            gas: r.smoke_level ?? 18.0,
            waterFlow: r.water_flow_lpm ?? 4.5,
          },
        ];
        return next.slice(-25); // retain last 25 ticks
      });
    }
  }, [machine?.last_seen, machine?.latest_readings]);

  // Authoritative machine safety severity
  const systemSeverity: SafetySeverity =
    machine?.safety?.overall_severity ||
    (machine?.connectivity_state === 'STALE' ? 'WARNING' : 'NORMAL');

  // Track In-Charge Permission (defaults to true; synced with authoritative machine readings)
  const [inChargePermission, setInChargePermission] = useState<boolean>(true);

  useEffect(() => {
    if (machine?.latest_readings?.machine_enabled !== undefined && machine.latest_readings.machine_enabled !== null) {
      setInChargePermission(machine.latest_readings.machine_enabled);
    }
  }, [machine?.latest_readings?.machine_enabled]);

  // Triggering a scenario via POST /ingest for the canonical single machine
  const handleTriggerScenario = async (
    scenario: string,
    overrides?: { machine_enabled?: boolean; machine_running?: boolean }
  ) => {
    const isFire = scenario === 'fire';
    const isDoorTrip = scenario === 'door_trip';
    const isCoolantFail = scenario === 'coolant_fail';
    const isOverheat = scenario === 'overheat';
    const isSmoke = scenario === 'smoke';
    const isCamIntrusion = scenario === 'camera_intrusion';
    const isUnauthorized = scenario === 'unauthorized_running';
    const isDisarmInterlock = scenario === 'disarm_interlock';

    let isRunning = scenario !== 'idle' && scenario !== 'disarm_interlock';
    let machineEnabled = !isUnauthorized && !isDisarmInterlock;

    if (overrides) {
      if (overrides.machine_running !== undefined) isRunning = overrides.machine_running;
      if (overrides.machine_enabled !== undefined) machineEnabled = overrides.machine_enabled;
    }

    if (isUnauthorized || isDisarmInterlock || overrides?.machine_enabled === false) {
      setInChargePermission(false);
    } else if (scenario === 'nominal' || overrides?.machine_enabled === true) {
      setInChargePermission(true);
    }

    const payload = {
      source: systemSource,
      device_id: 'laser-cutter-01',
      readings: {
        door_open: isDoorTrip,
        flame_detected: isFire,
        smoke_level: isSmoke ? 68.0 : isFire ? 75.0 : 18.0,
        temperature_c: isOverheat ? 74.5 : isFire ? 88.0 : 28.5,
        water_flow_lpm: isCoolantFail ? 0.3 : 4.5,
        camera_intrusion_detected: isCamIntrusion,
        machine_enabled: machineEnabled,
        machine_running: isRunning,
      },
    };

    await ingestTelemetryPayload(payload);
    await refreshStatus();
    await refreshEvents(undefined, true);
  };

  const handleTogglePermission = async (enabled: boolean) => {
    setInChargePermission(enabled);
    const isCurrentlyRunning = machine?.latest_readings?.machine_running || false;
    if (!enabled) {
      // In-charge permission revoked
      if (isCurrentlyRunning) {
        await handleTriggerScenario('unauthorized_running', { machine_enabled: false, machine_running: true });
      } else {
        await handleTriggerScenario('disarm_interlock', { machine_enabled: false, machine_running: false });
      }
    } else {
      // In-charge permission granted
      if (isCurrentlyRunning) {
        await handleTriggerScenario('nominal', { machine_enabled: true, machine_running: true });
      } else {
        await handleTriggerScenario('idle', { machine_enabled: true, machine_running: false });
      }
    }
  };

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    await Promise.allSettled([refreshStatus(), refreshEvents(), loadHealth()]);
    setIsRefreshing(false);
  };

  const handleToggleSource = () => {
    setSystemSource((prev) => (prev === 'SIMULATOR' ? 'HARDWARE' : 'SIMULATOR'));
  };

  const pageTitles: Record<PageId, string> = {
    dashboard: 'Industrial Laser Safety Dashboard',
    'live-readings': 'Live Sensor Telemetry Readings',
    'event-history': 'Safety Incident Event History',
    'safety-replay': 'Forensic Safety Incident Replay',
    'device-health': 'Sensor & System Device Health',
    'settings-simulator': 'Settings & Telemetry Simulator',
  };

  return (
    <div className="min-h-screen bg-[#080b11] text-slate-100 flex font-sans antialiased">
      {/* Fixed Left Sidebar */}
      <Sidebar
        activePage={activePage}
        onPageChange={setActivePage}
        systemSource={systemSource}
        onToggleSource={handleToggleSource}
        alertCount={events.filter((e) => e.severity === 'CRITICAL' || e.severity === 'WARNING').length}
      />

      {/* Main App Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <Header
          pageTitle={pageTitles[activePage]}
          connectionState={connectionState}
          systemSeverity={systemSeverity}
          systemSource={systemSource}
          onToggleSource={handleToggleSource}
          onEmergencyStop={() => handleTriggerScenario('door_trip')}
          onRefresh={handleRefreshAll}
          isRefreshing={isRefreshing}
          alertCount={events.filter((e) => e.severity === 'CRITICAL' || e.severity === 'WARNING').length}
        />

        {/* Page Content View */}
        <main className="flex-1 p-6 overflow-y-auto">
          {activePage === 'dashboard' && (
            <DashboardPage
              device={machine}
              events={events}
              systemSource={systemSource}
              onTriggerScenario={handleTriggerScenario}
              chartHistory={chartHistory}
              inChargePermission={inChargePermission}
              onTogglePermission={handleTogglePermission}
            />
          )}

          {activePage === 'live-readings' && (
            <LiveReadingsPage
              device={machine}
              chartHistory={chartHistory}
              systemSource={systemSource}
            />
          )}

          {activePage === 'event-history' && (
            <EventHistoryPage
              events={events}
              isLoading={eventsLoading}
              totalCount={eventsTotalCount}
              onRefresh={refreshEvents}
            />
          )}

          {activePage === 'safety-replay' && (
            <SafetyReplayPage events={events} />
          )}

          {activePage === 'device-health' && (
            <DeviceHealthPage
              device={machine}
              healthData={healthData}
              connectionState={connectionState}
              systemSource={systemSource}
            />
          )}

          {activePage === 'settings-simulator' && (
            <SettingsSimulatorPage
              systemSource={systemSource}
              onTriggerScenario={handleTriggerScenario}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
