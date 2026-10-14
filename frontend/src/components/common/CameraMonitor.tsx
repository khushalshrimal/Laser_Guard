import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Play,
  Square,
  Loader2,
  RefreshCw,
  Eye,
  Info,
  Box,
  Layers,
  Sliders,
  Check,
  RotateCcw,
} from 'lucide-react';
import {
  CameraLifecycleState,
  CameraStatusResponse,
  Zone3dConfig,
} from '../../types/telemetry';
import {
  fetchCameraStatus,
  startCamera,
  stopCamera,
  getCameraStreamUrl,
  updateCameraZone3d,
  resetCameraZone3d,
} from '../../services/api';
import HandSkeleton3D from './HandSkeleton3D';

interface CameraMonitorProps {
  intrusionDetected?: boolean | null;
  className?: string;
  onSimulateIntrusion?: (intrude: boolean) => void;
  onViewModeChange?: (view: '2d' | '3d') => void;
}

const DEFAULT_ZONE_3D: Zone3dConfig = {
  enabled: true, // Default to true for visualization so 3D cuboid is immediately active & visible
  x_min: 0.2,
  x_max: 0.8,
  y_min: 0.2,
  y_max: 0.8,
  z_min: -0.3,
  z_max: 0.3,
};

export const CameraMonitor: React.FC<CameraMonitorProps> = ({
  intrusionDetected = null,
  className = '',
  onSimulateIntrusion,
  onViewModeChange,
}) => {
  // Remote camera service state
  const [cameraStatus, setCameraStatus] = useState<CameraStatusResponse | null>(null);
  const [cameraState, setCameraState] = useState<CameraLifecycleState>('STOPPED');
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<boolean>(false);
  const [streamKey, setStreamKey] = useState<number>(Date.now());

  // Milestone 2: View Switch (2D Video Feed vs 3D Skeleton Visualizer)
  const [activeView, setActiveView] = useState<'2d' | '3d'>('2d');
  const [showZoneConfig, setShowZoneConfig] = useState<boolean>(false);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState<number>(1);

  // 3D Zone Configuration State
  const [zone3dConfig, setZone3dConfig] = useState<Zone3dConfig>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('laserguard_zone3d');
        if (saved) return JSON.parse(saved);
      } catch {
        // Fallback to default
      }
    }
    return DEFAULT_ZONE_3D;
  });

  const [isUpdatingZone, setIsUpdatingZone] = useState<boolean>(false);
  const [zoneSuccessMsg, setZoneSuccessMsg] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const pollIntervalRef = useRef<number | null>(null);

  // Poll camera status
  const loadStatus = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setIsLoadingStatus(true);
      const status = await fetchCameraStatus();
      if (!isMountedRef.current) return;
      setCameraStatus(status);
      setCameraState(status.state);
      if (typeof status.device_index === 'number') {
        setSelectedDeviceIndex(status.device_index);
      }
      if (status.zone_3d) {
        setZone3dConfig(status.zone_3d);
      }
      if (status.state === 'RUNNING') {
        setStreamError(false);
      }
      setActionError(null);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Unable to query camera status';
      if (isInitial) {
        setActionError(msg);
      }
    } finally {
      if (isMountedRef.current && isInitial) {
        setIsLoadingStatus(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    loadStatus(true);

    // Dynamic polling: High-frequency (~120ms / ~8 FPS) when running for real-time 3D skeleton tracking,
    // or idle polling (2500ms) when stopped.
    const pollInterval = cameraState === 'RUNNING' ? 120 : 2500;
    pollIntervalRef.current = window.setInterval(() => {
      loadStatus(false);
    }, pollInterval);

    return () => {
      isMountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [loadStatus, cameraState]);

  // Start Camera handler
  const handleStartCamera = async (deviceIdxOverride?: number) => {
    if (isActionLoading || cameraState === 'STARTING') return;
    setIsActionLoading(true);
    setActionError(null);
    setStreamError(false);
    try {
      setCameraState('STARTING');
      const targetIdx = deviceIdxOverride !== undefined ? deviceIdxOverride : selectedDeviceIndex;
      const resp = await startCamera({ device_index: targetIdx });
      if (!isMountedRef.current) return;
      setCameraStatus(resp);
      setCameraState(resp.state);
      setSelectedDeviceIndex(resp.device_index);
      setStreamKey(Date.now());
      if (resp.state === 'ERROR' && resp.error_message) {
        setActionError(resp.error_message);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to start camera service';
      setActionError(msg);
      setCameraState('ERROR');
    } finally {
      if (isMountedRef.current) {
        setIsActionLoading(false);
      }
    }
  };

  // Switch camera device index handler
  const handleSwitchDevice = async (newIdx: number) => {
    if (newIdx === selectedDeviceIndex && cameraState === 'RUNNING') return;
    setSelectedDeviceIndex(newIdx);
    if (cameraState === 'RUNNING') {
      setIsActionLoading(true);
      setActionError(null);
      try {
        await stopCamera();
        await handleStartCamera(newIdx);
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Failed to switch camera device';
        setActionError(msg);
      } finally {
        if (isMountedRef.current) setIsActionLoading(false);
      }
    }
  };

  // Stop Camera handler
  const handleStopCamera = async () => {
    if (isActionLoading || cameraState === 'STOPPED') return;
    setIsActionLoading(true);
    setActionError(null);
    try {
      const resp = await stopCamera();
      if (!isMountedRef.current) return;
      setCameraStatus(resp);
      setCameraState('STOPPED');
      setStreamError(false);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to stop camera service';
      setActionError(msg);
    } finally {
      if (isMountedRef.current) {
        setIsActionLoading(false);
      }
    }
  };

  // Apply 3D Zone configuration to backend and persist to localStorage
  const handleSave3dZone = async () => {
    setIsUpdatingZone(true);
    setZoneSuccessMsg(null);
    setActionError(null);
    try {
      const resp = await updateCameraZone3d(zone3dConfig);
      if (!isMountedRef.current) return;
      setCameraStatus(resp);
      if (resp.zone_3d) {
        setZone3dConfig(resp.zone_3d);
      }
      try {
        localStorage.setItem('laserguard_zone3d', JSON.stringify(zone3dConfig));
      } catch {
        // Ignore localStorage error
      }
      setZoneSuccessMsg('3D Monitoring Zone updated successfully');
      setTimeout(() => {
        if (isMountedRef.current) setZoneSuccessMsg(null);
      }, 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update 3D zone';
      setActionError(msg);
    } finally {
      if (isMountedRef.current) setIsUpdatingZone(false);
    }
  };

  // Reset 3D Zone configuration to defaults
  const handleReset3dZone = async () => {
    setIsUpdatingZone(true);
    setZoneSuccessMsg(null);
    setActionError(null);
    try {
      const resp = await resetCameraZone3d();
      if (!isMountedRef.current) return;
      setCameraStatus(resp);
      const restored = resp.zone_3d || DEFAULT_ZONE_3D;
      setZone3dConfig(restored);
      try {
        localStorage.setItem('laserguard_zone3d', JSON.stringify(restored));
      } catch {
        // Ignore localStorage error
      }
      setZoneSuccessMsg('3D Zone reset to factory defaults');
      setTimeout(() => {
        if (isMountedRef.current) setZoneSuccessMsg(null);
      }, 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset 3D zone';
      setActionError(msg);
    } finally {
      if (isMountedRef.current) setIsUpdatingZone(false);
    }
  };

  // Switch active view mode (2d vs 3d)
  const handleSelectView = (newView: '2d' | '3d') => {
    setActiveView(newView);
    if (onViewModeChange) {
      onViewModeChange(newView);
    }
  };

  // Intrusion evaluation: Check telemetry prop first, or camera status latest_detection
  const detectionBreached = cameraStatus?.latest_detection?.danger_zone_breached ?? false;
  const isBreached = intrusionDetected !== null && intrusionDetected !== undefined
    ? intrusionDetected
    : detectionBreached;

  const breached3d = cameraStatus?.latest_detection?.danger_zone_3d_breached ?? false;
  const handCount = cameraStatus?.latest_detection?.hand_count ?? 0;
  const actualFps = cameraStatus?.actual_fps ?? 0.0;
  const targetFps = cameraStatus?.target_fps ?? 10.0;
  const deviceIdx = cameraStatus?.device_index ?? 0;
  const roi = cameraStatus?.roi;
  const hands = cameraStatus?.latest_detection?.hands || [];

  return (
    <div className={`rounded-xl border border-slate-800 bg-[#111622] p-4 space-y-3 ${className}`}>
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-cyan-400" />
          <h4 className="text-sm font-bold text-white tracking-wide">Camera Safety Monitor</h4>

          {/* Lifecycle state badge */}
          {cameraState === 'RUNNING' && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              RUNNING
            </span>
          )}
          {cameraState === 'STARTING' && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Loader2 className="w-3 h-3 animate-spin" />
              STARTING
            </span>
          )}
          {cameraState === 'STOPPED' && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700">
              STOPPED
            </span>
          )}
          {cameraState === 'ERROR' && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
              <AlertTriangle className="w-3 h-3 text-rose-400" />
              ERROR
            </span>
          )}
        </div>

        {/* View Switch & Action Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Milestone 2: 2D vs 3D View Switch */}
          <div className="flex items-center bg-[#070a0f] p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => handleSelectView('2d')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                activeView === '2d'
                  ? 'bg-cyan-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Standard 2D camera feed with video overlay"
            >
              <Camera className="w-3 h-3" />
              <span>2D View</span>
            </button>
            <button
              onClick={() => handleSelectView('3d')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                activeView === '3d'
                  ? 'bg-cyan-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="3D hand skeleton & depth visualization"
            >
              <Layers className="w-3 h-3" />
              <span>3D Skeleton</span>
            </button>
          </div>

          {/* Camera Device Index Switcher */}
          <div className="flex items-center bg-[#070a0f] p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => handleSwitchDevice(1)}
              disabled={isActionLoading}
              className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-colors ${
                selectedDeviceIndex === 1
                  ? 'bg-emerald-600/30 text-emerald-300 font-bold border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Switch to External USB Webcam (Device 1)"
            >
              Cam 1 (USB)
            </button>
            <button
              onClick={() => handleSwitchDevice(0)}
              disabled={isActionLoading}
              className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-colors ${
                selectedDeviceIndex === 0
                  ? 'bg-emerald-600/30 text-emerald-300 font-bold border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Switch to Integrated Laptop Webcam (Device 0)"
            >
              Cam 0 (Built-in)
            </button>
          </div>

          {/* Toggle 3D Zone Settings Panel */}
          <button
            onClick={() => setShowZoneConfig((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono font-bold border transition-colors ${
              showZoneConfig
                ? 'bg-slate-700 text-white border-slate-600'
                : 'bg-slate-900/80 text-slate-300 hover:text-white border-slate-800'
            }`}
            title="Configure 3D monitoring zone boundaries"
          >
            <Sliders className="w-3 h-3" />
            <span>3D Zone</span>
          </button>

          {/* Camera Start / Stop Controls */}
          {cameraState !== 'RUNNING' ? (
            <button
              onClick={() => handleStartCamera(selectedDeviceIndex)}
              disabled={isActionLoading || cameraState === 'STARTING'}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title="Start background camera capture"
            >
              {isActionLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3 fill-current" />
              )}
              Start Camera
            </button>
          ) : (
            <button
              onClick={handleStopCamera}
              disabled={isActionLoading}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono font-bold bg-rose-600/80 hover:bg-rose-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title="Stop camera capture and release device"
            >
              {isActionLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Square className="w-3 h-3 fill-current" />
              )}
              Stop Camera
            </button>
          )}

          <button
            onClick={() => loadStatus(true)}
            disabled={isLoadingStatus}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Refresh camera status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error alert message banner */}
      {actionError && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs font-mono">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold">Camera Notice: </span>
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-rose-400 hover:text-rose-200 text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Success notification banner */}
      {zoneSuccessMsg && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs font-mono">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{zoneSuccessMsg}</span>
        </div>
      )}

      {/* Milestone 2: Configurable 3D Monitoring Zone Drawer */}
      {showZoneConfig && (
        <div className="p-3.5 rounded-lg bg-[#0a0e17] border border-cyan-900/60 space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-1.5 text-cyan-300 font-bold">
              <Box className="w-4 h-4 text-cyan-400" />
              <span>Configurable 3D Monitoring Zone (Estimated Depth)</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={zone3dConfig.enabled}
                onChange={(e) =>
                  setZone3dConfig((prev) => ({ ...prev, enabled: e.target.checked }))
                }
                className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-cyan-500 h-4 w-4"
              />
              <span className={`text-[11px] font-bold ${zone3dConfig.enabled ? 'text-emerald-400' : 'text-slate-400'}`}>
                {zone3dConfig.enabled ? 'ENABLED' : 'DISABLED'}
              </span>
            </label>
          </div>

          {/* Sliders Grid: X, Y, and Estimated Z Bounds */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* X Horizontal Bounds */}
            <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Width (X-Span):</span>
                <span className="text-cyan-300 font-bold">
                  [{zone3dConfig.x_min.toFixed(2)}, {zone3dConfig.x_max.toFixed(2)}]
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Min X</span>
                  <span>{zone3dConfig.x_min.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="0.45"
                  step="0.05"
                  value={zone3dConfig.x_min}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setZone3dConfig((prev) => ({
                      ...prev,
                      x_min: val,
                      x_max: Math.max(val + 0.1, prev.x_max),
                    }));
                  }}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Max X</span>
                  <span>{zone3dConfig.x_max.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.55"
                  max="1.0"
                  step="0.05"
                  value={zone3dConfig.x_max}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setZone3dConfig((prev) => ({
                      ...prev,
                      x_max: val,
                      x_min: Math.min(val - 0.1, prev.x_min),
                    }));
                  }}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Y Vertical Bounds */}
            <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Height (Y-Span):</span>
                <span className="text-cyan-300 font-bold">
                  [{zone3dConfig.y_min.toFixed(2)}, {zone3dConfig.y_max.toFixed(2)}]
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Min Y</span>
                  <span>{zone3dConfig.y_min.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="0.45"
                  step="0.05"
                  value={zone3dConfig.y_min}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setZone3dConfig((prev) => ({
                      ...prev,
                      y_min: val,
                      y_max: Math.max(val + 0.1, prev.y_max),
                    }));
                  }}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Max Y</span>
                  <span>{zone3dConfig.y_max.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.55"
                  max="1.0"
                  step="0.05"
                  value={zone3dConfig.y_max}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setZone3dConfig((prev) => ({
                      ...prev,
                      y_max: val,
                      y_min: Math.min(val - 0.1, prev.y_min),
                    }));
                  }}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Estimated Relative Z Depth Bounds */}
            <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Estimated Depth (Z):</span>
                <span className="text-cyan-300 font-bold">
                  [{zone3dConfig.z_min.toFixed(2)}, {zone3dConfig.z_max.toFixed(2)}]
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Min Z (Closer)</span>
                  <span>{zone3dConfig.z_min.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="-0.8"
                  max="-0.05"
                  step="0.05"
                  value={zone3dConfig.z_min}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setZone3dConfig((prev) => ({
                      ...prev,
                      z_min: val,
                      z_max: Math.max(val + 0.1, prev.z_max),
                    }));
                  }}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Max Z (Farther)</span>
                  <span>{zone3dConfig.z_max.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.8"
                  step="0.05"
                  value={zone3dConfig.z_max}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setZone3dConfig((prev) => ({
                      ...prev,
                      z_max: val,
                      z_min: Math.min(val - 0.1, prev.z_min),
                    }));
                  }}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons & Advisory Disclaimer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave3dZone}
                disabled={isUpdatingZone}
                className="flex items-center gap-1 px-3 py-1.5 rounded font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50"
              >
                {isUpdatingZone ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Apply & Save 3D Zone
              </button>
              <button
                onClick={handleReset3dZone}
                disabled={isUpdatingZone}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Defaults
              </button>
            </div>

            <span className="text-[10px] text-slate-500">
              * Relative depth heuristics — not calibrated physical distance (mm/cm).
            </span>
          </div>
        </div>
      )}

      {/* Viewport Area: 1 column in 2D mode; 2-column grid on desktop (stacked on mobile) in 3D mode */}
      <div
        className={`grid gap-3 ${
          activeView === '3d'
            ? 'grid-cols-1 lg:grid-cols-2'
            : 'grid-cols-1'
        }`}
      >
        {/* Panel 1 (Primary / Left in 3D): Persistent Live Camera Feed */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex items-center justify-between px-1 text-[11px] font-mono text-slate-300">
            <span className="flex items-center gap-1.5 font-bold text-white">
              <Camera className="w-3.5 h-3.5 text-cyan-400" />
              Live Camera Feed (Cam #{selectedDeviceIndex})
            </span>
            <span className="text-[10px] text-slate-400">
              {activeView === '3d' ? '2D Perimeter & Landmarks' : 'Live MJPEG Stream'}
            </span>
          </div>
          <div className="relative rounded-lg overflow-hidden bg-[#070a0f] border border-slate-800 aspect-video min-h-[260px] md:min-h-[320px] flex items-center justify-center shadow-inner">
            {/* State A: Running Live Video Stream */}
            {cameraState === 'RUNNING' && !streamError ? (
              <div className="relative w-full h-full flex items-center justify-center bg-black">
                {/* Live MJPEG Stream Element */}
                <img
                  key={`mjpeg-stream-${streamKey}`}
                  src={`${getCameraStreamUrl()}?t=${streamKey}`}
                  alt="Live Camera Feed with Danger Zone"
                  className="w-full h-full object-contain"
                  onLoad={() => {
                    setStreamError(false);
                  }}
                  onError={() => {
                    console.warn('[CameraMonitor] Stream connection drop detected on <img> element');
                    if (cameraState === 'RUNNING') {
                      setTimeout(() => {
                        if (isMountedRef.current && cameraState === 'RUNNING') {
                          setStreamKey(Date.now());
                        }
                      }, 1000);
                    } else {
                      setStreamError(true);
                    }
                  }}
                />

                {/* Live Overlay: Danger Zone Status Tag */}
                <div className="absolute top-2 left-2 z-10 pointer-events-none">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ${
                      isBreached
                        ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/60 animate-pulse'
                        : 'bg-cyan-900/80 text-cyan-200 border border-cyan-500/40 backdrop-blur-xs'
                    }`}
                  >
                    {isBreached ? '⚠️ DANGER ZONE: BREACHED' : '🛡️ EXCLUSION ZONE: CLEAR'}
                  </span>
                </div>

                {/* Live Overlay: Top Right Feed Badge */}
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono bg-black/70 text-slate-300 border border-slate-700/60 backdrop-blur-xs pointer-events-none">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  <span>LIVE CAM #{deviceIdx}</span>
                </div>

                {/* Live Overlay: Bottom Stats Bar */}
                <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between px-2.5 py-1 rounded text-[10px] font-mono bg-black/75 text-slate-300 border border-slate-800/80 backdrop-blur-xs pointer-events-none">
                  <span>
                    FPS: <strong className="text-white">{actualFps.toFixed(1)}</strong> / {targetFps.toFixed(0)}
                  </span>
                  <span>
                    Hands: <strong className={handCount > 0 ? 'text-amber-300' : 'text-slate-400'}>{handCount}</strong>
                  </span>
                  <span>MediaPipe Vision</span>
                </div>
              </div>
            ) : cameraState === 'STARTING' ? (
              /* State B: Starting Loader */
              <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                <div className="text-xs font-mono font-bold text-white">Starting Video Capture...</div>
                <div className="text-[11px] font-mono text-slate-400">
                  Initializing OpenCV camera #{deviceIdx} and MediaPipe Hand Landmarker
                </div>
              </div>
            ) : cameraState === 'ERROR' || (streamError && cameraState !== 'RUNNING') ? (
              /* State C: Error State */
              <div className="flex flex-col items-center justify-center gap-2.5 p-6 text-center">
                <div className="w-10 h-10 rounded-full bg-rose-950/60 border border-rose-800 flex items-center justify-center text-rose-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="text-xs font-mono font-bold text-white">
                  {streamError ? 'Video Stream Offline' : 'Camera Unavailable'}
                </div>
                <div className="text-[11px] font-mono text-slate-400 max-w-sm">
                  {cameraStatus?.error_message ||
                    'Ensure webcam is connected and permission is granted to the backend.'}
                </div>
                <button
                  onClick={() => handleStartCamera(selectedDeviceIndex)}
                  className="mt-1 flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Retry Start
                </button>
              </div>
            ) : (
              /* State D: Stopped / Standby State */
              <div className="flex flex-col items-center justify-center gap-2.5 p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                  <Camera className="w-6 h-6" />
                </div>
                <div className="text-xs font-mono font-bold text-white">Camera Capture Stopped</div>
                <div className="text-[11px] font-mono text-slate-400 max-w-xs">
                  Live hand detection is standby. Click Start Camera to initialize advisory monitoring.
                </div>
                <button
                  onClick={() => handleStartCamera(selectedDeviceIndex)}
                  disabled={isActionLoading}
                  className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors shadow"
                >
                  <Play className="w-3 h-3 fill-current" /> Start Camera
                </button>
              </div>
            )}

            {/* Optional Simulator Test Trigger */}
            {onSimulateIntrusion && (
              <div className="absolute bottom-2 right-2 z-20">
                <button
                  onClick={() => onSimulateIntrusion(!isBreached)}
                  className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold transition-colors shadow ${
                    isBreached
                      ? 'bg-rose-700 hover:bg-rose-600 text-white'
                      : 'bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700'
                  }`}
                  title="Test safety rule via synthetic simulator frame"
                >
                  {isBreached ? 'Reset Test' : 'Test Intrusion'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Panel 2 (Right in 3D): 3D Hand Skeleton & Depth Tracking */}
        {activeView === '3d' && (
          <div className="flex flex-col space-y-1.5">
            <div className="flex items-center justify-between px-1 text-[11px] font-mono text-slate-300">
              <span className="flex items-center gap-1.5 font-bold text-white">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                3D Hand Skeleton & Depth Tracking
              </span>
              <span className="text-[10px] text-slate-400">21 3D Landmarks & Depth Zone</span>
            </div>
            <div className="relative rounded-lg overflow-hidden bg-[#070a0f] border border-slate-800 aspect-video min-h-[260px] md:min-h-[320px] flex items-center justify-center shadow-inner">
              <HandSkeleton3D
                hands={hands}
                zone3d={cameraStatus?.zone_3d || zone3dConfig}
                cameraState={cameraState}
                errorMessage={cameraStatus?.error_message || actionError}
                breached3d={breached3d}
                deviceIndex={selectedDeviceIndex}
                className="w-full h-full"
              />
            </div>
          </div>
        )}
      </div>

      {/* Info Status Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
        {/* 2D Perimeter Status */}
        <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[10px]">2D Perimeter Status:</span>
          {cameraState !== 'RUNNING' && intrusionDetected === null ? (
            <span className="text-slate-500 font-bold flex items-center gap-1 mt-0.5">
              <Eye className="w-3 h-3" /> STANDBY
            </span>
          ) : isBreached ? (
            <span className="text-rose-400 font-bold flex items-center gap-1 mt-0.5 animate-pulse">
              <ShieldAlert className="w-3.5 h-3.5" /> BREACHED
            </span>
          ) : (
            <span className="text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> SECURE
            </span>
          )}
        </div>

        {/* 3D Zone Status */}
        <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[10px]">3D Zone Status:</span>
          {!zone3dConfig.enabled ? (
            <span className="text-slate-500 font-bold flex items-center gap-1 mt-0.5">
              <Box className="w-3 h-3" /> DISABLED
            </span>
          ) : breached3d ? (
            <span className="text-rose-400 font-bold flex items-center gap-1 mt-0.5 animate-pulse">
              <ShieldAlert className="w-3.5 h-3.5" /> INTERSECTING
            </span>
          ) : (
            <span className="text-cyan-400 font-bold flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> CLEAR
            </span>
          )}
        </div>

        {/* Vision Engine & Model */}
        <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[10px]">Vision Pipeline:</span>
          <span className="text-cyan-400 font-bold mt-0.5">
            OpenCV + MediaPipe
          </span>
        </div>

        {/* Danger Zone ROI Coordinates */}
        <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[10px]">2D ROI Coordinates:</span>
          <span className="text-slate-300 font-bold mt-0.5 text-[10px]">
            {roi
              ? `[${roi.x_min}, ${roi.y_min}] - [${roi.x_max}, ${roi.y_max}]`
              : '[0.20, 0.20] - [0.80, 0.80]'}
          </span>
        </div>
      </div>

      {/* Advisory Notice */}
      <div className="flex items-start gap-1.5 pt-1 text-[10px] font-mono text-slate-500">
        <Info className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
        <span>
          Advisory monitoring aid only. 3D hand tracking and estimated relative depth do not represent certified physical measurements (mm/cm) or guarantee physical laser isolation.
        </span>
      </div>
    </div>
  );
};

export default CameraMonitor;
