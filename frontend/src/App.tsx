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

  // Update chart history when fresh telemetry arrives
  const devices: DeviceStatus[] = systemStatus?.devices || [];
  const primaryDevice = devices.length > 0 ? devices[0] : null;

  useEffect(() => {
    if (primaryDevice?.latest_readings) {
      const r = primaryDevice.latest_readings;
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
  }, [primaryDevice?.last_seen, primaryDevice?.latest_readings]);

  // Overall system severity calculation
  const hasCritical = devices.some((d) => d.safety?.overall_severity === 'CRITICAL');
  const hasWarning = devices.some(
    (d) => d.safety?.overall_severity === 'WARNING' || d.connectivity_state === 'STALE'
  );
  const systemSeverity: SafetySeverity = hasCritical
    ? 'CRITICAL'
    : hasWarning
    ? 'WARNING'
    : devices.length > 0
    ? 'NORMAL'
    : 'NORMAL';

  // Triggering a scenario via POST /ingest
  const handleTriggerScenario = async (scenario: string) => {
    const isRunning = scenario !== 'idle';
    const isFire = scenario === 'fire';
    const isDoorTrip = scenario === 'door_trip';
    const isCoolantFail = scenario === 'coolant_fail';
    const isOverheat = scenario === 'overheat';
    const isSmoke = scenario === 'smoke';
    const isCamIntrusion = scenario === 'camera_intrusion';
    const isUnauthorized = scenario === 'unauthorized_running';

    const payload = {
      source: systemSource,
      device_id: primaryDevice?.device_id || 'sim-cutter-01',
      readings: {
        door_open: isDoorTrip,
        flame_detected: isFire,
        smoke_level: isSmoke ? 68.0 : isFire ? 75.0 : 18.0,
        temperature_c: isOverheat ? 74.5 : isFire ? 88.0 : 28.5,
        water_flow_lpm: isCoolantFail ? 0.3 : 4.5,
        camera_intrusion_detected: isCamIntrusion,
        machine_enabled: !isUnauthorized,
        machine_running: isRunning,
      },
    };

    await ingestTelemetryPayload(payload);
    await refreshStatus();
    await refreshEvents();
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
              device={primaryDevice}
              events={events}
              systemSource={systemSource}
              onTriggerScenario={handleTriggerScenario}
              chartHistory={chartHistory}
            />
          )}

          {activePage === 'live-readings' && (
            <LiveReadingsPage
              device={primaryDevice}
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
              device={primaryDevice}
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
