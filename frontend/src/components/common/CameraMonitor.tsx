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
} from 'lucide-react';
import {
  CameraLifecycleState,
  CameraStatusResponse,
} from '../../types/telemetry';
import {
  fetchCameraStatus,
  startCamera,
  stopCamera,
  getCameraStreamUrl,
} from '../../services/api';

interface CameraMonitorProps {
  intrusionDetected?: boolean | null;
  className?: string;
  onSimulateIntrusion?: (intrude: boolean) => void;
}

export const CameraMonitor: React.FC<CameraMonitorProps> = ({
  intrusionDetected = null,
  className = '',
  onSimulateIntrusion,
}) => {
  // Remote camera service state
  const [cameraStatus, setCameraStatus] = useState<CameraStatusResponse | null>(null);
  const [cameraState, setCameraState] = useState<CameraLifecycleState>('STOPPED');
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<boolean>(false);
  const [streamKey, setStreamKey] = useState<number>(Date.now());

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
      if (status.state === 'RUNNING') {
        setStreamError(false);
      }
      setActionError(null);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Unable to query camera status';
      // Only show error if explicitly querying, not silent background poll failures
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

    // Poll status periodically (every 2.5s) to reflect live state & detection coordinates
    pollIntervalRef.current = window.setInterval(() => {
      loadStatus(false);
    }, 2500);

    return () => {
      isMountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [loadStatus]);

  // Start Camera handler
  const handleStartCamera = async () => {
    if (isActionLoading || cameraState === 'RUNNING' || cameraState === 'STARTING') return;
    setIsActionLoading(true);
    setActionError(null);
    setStreamError(false);
    try {
      setCameraState('STARTING');
      const resp = await startCamera();
      if (!isMountedRef.current) return;
      setCameraStatus(resp);
      setCameraState(resp.state);
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

  // Intrusion evaluation: Check telemetry prop first, or camera status latest_detection
  const detectionBreached = cameraStatus?.latest_detection?.danger_zone_breached ?? false;
  const isBreached = intrusionDetected !== null && intrusionDetected !== undefined
    ? intrusionDetected
    : detectionBreached;

  const handCount = cameraStatus?.latest_detection?.hand_count ?? 0;
  const actualFps = cameraStatus?.actual_fps ?? 0.0;
  const targetFps = cameraStatus?.target_fps ?? 10.0;
  const deviceIdx = cameraStatus?.device_index ?? 0;
  const roi = cameraStatus?.roi;

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

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {cameraState !== 'RUNNING' ? (
            <button
              onClick={handleStartCamera}
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

      {/* Main Viewport */}
      <div className="relative rounded-lg overflow-hidden bg-[#070a0f] border border-slate-800 aspect-video flex items-center justify-center">
        {/* State A: Running Live Video Stream */}
        {cameraState === 'RUNNING' && !streamError ? (
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            {/* Live MJPEG Stream Element */}
            <img
              key={streamKey}
              src={getCameraStreamUrl()}
              alt="Live Camera Feed with Danger Zone"
              className="w-full h-full object-contain"
              onError={() => {
                setStreamError(true);
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
        ) : cameraState === 'ERROR' || streamError ? (
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
              onClick={handleStartCamera}
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
              onClick={handleStartCamera}
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

      {/* Info Status Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono">
        {/* Perimeter Status */}
        <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[10px]">Perimeter Status:</span>
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

        {/* Vision Engine & FPS */}
        <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[10px]">Vision Pipeline:</span>
          <span className="text-cyan-400 font-bold mt-0.5">
            OpenCV + MediaPipe
          </span>
        </div>

        {/* Danger Zone ROI Coordinates */}
        <div className="col-span-2 sm:col-span-1 p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col justify-between">
          <span className="text-slate-400 text-[10px]">Danger Zone ROI:</span>
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
          Advisory monitoring aid only. Camera hand detection provides operator awareness and does not certify physical laser power interlock shutdown.
        </span>
      </div>
    </div>
  );
};

export default CameraMonitor;
