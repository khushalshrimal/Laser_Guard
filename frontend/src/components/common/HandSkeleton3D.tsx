import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Layers,
  ShieldCheck,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import {
  HandDetection,
  HandLandmark,
  Zone3dConfig,
  CameraLifecycleState,
} from '../../types/telemetry';

// Standard MediaPipe Hand Landmark connections
const HAND_CONNECTIONS: [number, number][] = [
  // Palm base
  [0, 1],
  [0, 5],
  [5, 9],
  [9, 13],
  [13, 17],
  [0, 17],
  // Thumb
  [1, 2],
  [2, 3],
  [3, 4],
  // Index
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [17, 18],
  [18, 19],
  [19, 20],
];

// Color mapping per finger group
function getJointColor(idx: number, inBreach: boolean): string {
  if (inBreach) return '#f43f5e'; // Bright rose-red when in breach
  if (idx === 0) return '#38bdf8'; // Wrist: Cyan
  if (idx >= 1 && idx <= 4) return '#f59e0b'; // Thumb: Amber
  if (idx >= 5 && idx <= 8) return '#10b981'; // Index: Emerald
  if (idx >= 9 && idx <= 12) return '#60a5fa'; // Middle: Blue
  if (idx >= 13 && idx <= 16) return '#a855f7'; // Ring: Purple
  return '#ec4899'; // Pinky: Pink
}

interface HandSkeleton3DProps {
  hands: HandDetection[];
  zone3d?: Zone3dConfig | null;
  cameraState: CameraLifecycleState;
  errorMessage?: string | null;
  breached3d?: boolean;
  deviceIndex?: number;
  className?: string;
}

export const HandSkeleton3D: React.FC<HandSkeleton3DProps> = ({
  hands = [],
  zone3d = null,
  cameraState,
  errorMessage = null,
  breached3d = false,
  deviceIndex = 1,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Camera Orbit Controls
  const [yaw, setYaw] = useState<number>(-0.35); // Horizontal rotation in radians
  const [pitch, setPitch] = useState<number>(0.25); // Vertical rotation in radians
  const [zoom, setZoom] = useState<number>(1.1); // Camera zoom multiplier
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; yaw: number; pitch: number }>({
    x: 0,
    y: 0,
    yaw: -0.35,
    pitch: 0.25,
  });

  const resetView = () => {
    setYaw(-0.35);
    setPitch(0.25);
    setZoom(1.1);
  };

  // Drag listeners
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      yaw,
      pitch,
    };
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setYaw(dragStartRef.current.yaw + dx * 0.008);
      // Clamp pitch to avoid gimbal flipping
      const newPitch = Math.max(-1.2, Math.min(1.2, dragStartRef.current.pitch + dy * 0.008));
      setPitch(newPitch);
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Wheel zoom listener
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.6, Math.min(2.5, prev - e.deltaY * 0.0015)));
  };

  // Render 3D scene on HTML5 canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI displays
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#060910';
    ctx.fillRect(0, 0, w, h);

    // 3D Projection math:
    // World space: Normalized coordinates where
    // x in [-1, 1], y in [-1, 1], z in [-1, 1]
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) * 0.42 * zoom;

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    // Transform 3D point (world coords) to 2D canvas screen coords
    const project = (
      wx: number,
      wy: number,
      wz: number
    ): { u: number; v: number; depth: number } => {
      // 1. Rotate around Y axis (yaw)
      const x1 = wx * cosY - wz * sinY;
      const z1 = wx * sinY + wz * cosY;

      // 2. Rotate around X axis (pitch)
      const y2 = wy * cosP - z1 * sinP;
      const z2 = wy * sinP + z1 * cosP;

      // 3. Perspective projection
      const cameraDistance = 3.2;
      const pDepth = z2 + cameraDistance;
      const fov = 2.4;
      const factor = pDepth > 0.1 ? (fov / pDepth) * scale : scale;

      const u = cx + x1 * factor;
      const v = cy + y2 * factor;

      return { u, v, depth: z2 };
    };

    // 1. Draw floor grid at bottom (Y = 1.0)
    ctx.strokeStyle = '#151d2d';
    ctx.lineWidth = 1;
    const gridSteps = 6;
    for (let i = -gridSteps; i <= gridSteps; i += 2) {
      const step = i / gridSteps;
      // Lines along Z
      const pA = project(step, 0.95, -1.0);
      const pB = project(step, 0.95, 1.0);
      ctx.beginPath();
      ctx.moveTo(pA.u, pA.v);
      ctx.lineTo(pB.u, pB.v);
      ctx.stroke();

      // Lines along X
      const pC = project(-1.0, 0.95, step);
      const pD = project(1.0, 0.95, step);
      ctx.beginPath();
      ctx.moveTo(pC.u, pC.v);
      ctx.lineTo(pD.u, pD.v);
      ctx.stroke();
    }

    // 2. Draw 3D Monitoring Zone Bounding Cuboid (ALWAYS VISIBLE)
    const activeZone = zone3d || {
      enabled: true,
      x_min: 0.2,
      x_max: 0.8,
      y_min: 0.2,
      y_max: 0.8,
      z_min: -0.3,
      z_max: 0.3,
    };

    // Convert normalized zone [x_min, x_max] [0..1] to world space [-1..1]
    const zx1 = (activeZone.x_min - 0.5) * 2;
    const zx2 = (activeZone.x_max - 0.5) * 2;
    const zy1 = (activeZone.y_min - 0.5) * 2;
    const zy2 = (activeZone.y_max - 0.5) * 2;
    // Convert relative depth [-1..1] to world space [-1..1]
    const zz1 = Math.max(-1, Math.min(1, activeZone.z_min * 2));
    const zz2 = Math.max(-1, Math.min(1, activeZone.z_max * 2));

    // 8 vertices of the 3D monitoring zone cuboid
    const cubeVerts = [
      project(zx1, zy1, zz1), // 0: top-left-front
      project(zx2, zy1, zz1), // 1: top-right-front
      project(zx2, zy2, zz1), // 2: bottom-right-front
      project(zx1, zy2, zz1), // 3: bottom-left-front
      project(zx1, zy1, zz2), // 4: top-left-back
      project(zx2, zy1, zz2), // 5: top-right-back
      project(zx2, zy2, zz2), // 6: bottom-right-back
      project(zx1, zy2, zz2), // 7: bottom-left-back
    ];

    const cubeEdges: [number, number][] = [
      // Front face
      [0, 1], [1, 2], [2, 3], [3, 0],
      // Back face
      [4, 5], [5, 6], [6, 7], [7, 4],
      // Connecting edges
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    const isBreached = Boolean(activeZone.enabled && (breached3d || (hands && hands.some((h) => h.in_danger_zone_3d))));

    ctx.save();
    if (!activeZone.enabled) {
      // Safety logic disabled, but visualization remains clearly visible with bright cyan styling and DISABLED tag
      ctx.strokeStyle = '#38bdf8';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2.0;
      ctx.shadowColor = 'rgba(56, 189, 248, 0.6)';
      ctx.shadowBlur = 8;
    } else if (isBreached) {
      // Active breach: Neon Rose/Red
      ctx.strokeStyle = '#f43f5e';
      ctx.setLineDash([]);
      ctx.lineWidth = 2.8;
      ctx.shadowColor = 'rgba(244, 63, 94, 0.9)';
      ctx.shadowBlur = 12;
    } else {
      // Active monitoring: Bright Neon Cyan
      ctx.strokeStyle = '#06b6d4';
      ctx.setLineDash([]);
      ctx.lineWidth = 2.4;
      ctx.shadowColor = 'rgba(6, 182, 212, 0.8)';
      ctx.shadowBlur = 10;
    }

    // Draw 12 wireframe edges
    for (const [v1, v2] of cubeEdges) {
      ctx.beginPath();
      ctx.moveTo(cubeVerts[v1].u, cubeVerts[v1].v);
      ctx.lineTo(cubeVerts[v2].u, cubeVerts[v2].v);
      ctx.stroke();
    }

    // Draw visible corner markers on all 8 vertices
    for (let i = 0; i < cubeVerts.length; i++) {
      const vert = cubeVerts[i];
      ctx.beginPath();
      ctx.arc(vert.u, vert.v, 4.0, 0, Math.PI * 2);
      ctx.fillStyle = isBreached ? '#f43f5e' : activeZone.enabled ? '#22d3ee' : '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 3D Cuboid Label
    const topCenter = project((zx1 + zx2) / 2, zy1, (zz1 + zz2) / 2);
    ctx.fillStyle = isBreached ? '#f43f5e' : activeZone.enabled ? '#22d3ee' : '#94a3b8';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    const label = !activeZone.enabled
      ? '🛡️ 3D CUBOID (SAFETY DISABLED)'
      : isBreached
      ? '⚠️ 3D ZONE: BREACHED'
      : '🛡️ 3D ZONE: MONITORING';
    ctx.fillText(label, topCenter.u, topCenter.v - 8);

    ctx.restore();

    // 3. Draw Hand Landmarks & Skeleton Connections
    if (cameraState === 'RUNNING' && hands && hands.length > 0) {
      for (const hand of hands) {
        const rawLandmarks = hand.landmarks || [];
        if (rawLandmarks.length === 0) continue;

        // Project all landmarks to screen coords
        const projected = rawLandmarks.map((lm: HandLandmark) => {
          // Map x, y from [0, 1] to [-1, 1]
          const wx = (lm.x - 0.5) * 2;
          const wy = (lm.y - 0.5) * 2;
          // MediaPipe z is estimated relative depth roughly centered near 0
          const rz = typeof lm.z === 'number' ? lm.z : 0.0;
          const wz = rz * 2.2;
          return project(wx, wy, wz);
        });

        // A. Draw Bone Connections
        for (const [j1, j2] of HAND_CONNECTIONS) {
          if (j1 < projected.length && j2 < projected.length) {
            const p1 = projected[j1];
            const p2 = projected[j2];

            // Shading by depth
            const avgDepth = (p1.depth + p2.depth) / 2;
            const alpha = Math.max(0.3, Math.min(1.0, 1.0 - avgDepth * 0.3));

            ctx.beginPath();
            ctx.moveTo(p1.u, p1.v);
            ctx.lineTo(p2.u, p2.v);
            ctx.strokeStyle = hand.in_danger_zone_3d
              ? `rgba(244, 63, 94, ${alpha})`
              : `rgba(148, 163, 184, ${alpha})`;
            ctx.lineWidth = 2.2;
            ctx.stroke();
          }
        }

        // B. Draw Joints (Landmarks)
        for (let i = 0; i < projected.length; i++) {
          const pt = projected[i];
          const radius = Math.max(2.5, Math.min(6, 4.2 - pt.depth * 0.8));
          const color = getJointColor(i, Boolean(hand.in_danger_zone_3d));

          ctx.beginPath();
          ctx.arc(pt.u, pt.v, radius, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();

          // Joint ring
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // C. Hand Label at Wrist (index 0)
        if (projected[0]) {
          const wrist = projected[0];
          ctx.font = '10px monospace';
          ctx.fillStyle = hand.in_danger_zone_3d ? '#fda4af' : '#cbd5e1';
          ctx.textAlign = 'center';
          const label = `${hand.label || 'Hand'} (${Math.round((hand.score || 0) * 100)}%)`;
          ctx.fillText(label, wrist.u, wrist.v + 16);
        }
      }
    }
  }, [hands, zone3d, cameraState, breached3d, yaw, pitch, zoom]);

  const hasHands = cameraState === 'RUNNING' && hands && hands.length > 0;

  return (
    <div className={`relative w-full h-full flex flex-col items-center justify-center bg-[#070a0f] overflow-hidden ${className}`}>
      {/* Interactive 3D Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
        style={{ touchAction: 'none' }}
      />

      {/* Top Left: 3D Tracking Header & Estimated Depth Notice */}
      <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-900/90 text-cyan-300 border border-slate-700 backdrop-blur-xs">
          <Layers className="w-3 h-3 text-cyan-400" />
          <span>3D Hand Skeleton View (Estimated Depth)</span>
        </div>
        <div className="px-2 py-0.5 rounded text-[9px] font-mono bg-black/60 text-slate-400 border border-slate-800/80 backdrop-blur-xs max-w-xs">
          Relative depth from single webcam — not calibrated physical machine distance.
        </div>
      </div>

      {/* Top Right: Status Badge & Controls */}
      <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
        {hasHands ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 backdrop-blur-xs">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            21 Landmarks Tracked
          </span>
        ) : cameraState === 'RUNNING' ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-900/80 border border-slate-800 backdrop-blur-xs">
            <Eye className="w-3 h-3" />
            No Hands in Frame
          </span>
        ) : null}

        {/* Orbit View Reset & Zoom Buttons */}
        <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-800 rounded p-0.5 backdrop-blur-xs">
          <button
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
            className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
            className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <button
            onClick={resetView}
            className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title="Reset 3D Perspective"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Bottom Floating Stats Bar */}
      <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between px-2.5 py-1 rounded text-[10px] font-mono bg-black/75 text-slate-300 border border-slate-800 backdrop-blur-xs pointer-events-none">
        <span>
          Orbit: <strong className="text-white">{Math.round((yaw * 180) / Math.PI)}°</strong> /{' '}
          <strong className="text-white">{Math.round((pitch * 180) / Math.PI)}°</strong>
        </span>
        <span>Drag to rotate • Scroll to zoom</span>
        <span>
          Depth (Z): <strong className="text-cyan-300">[-1.0, 1.0] rel</strong>
        </span>
      </div>

      {/* Floating Status: Running but No Hand Detected (Non-blocking, cuboid remains 100% visible) */}
      {cameraState === 'RUNNING' && !hasHands && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-15 px-3 py-1 rounded-full text-[10px] font-mono font-medium bg-slate-900/90 text-cyan-300 border border-cyan-500/30 backdrop-blur-sm shadow-md flex items-center gap-1.5 pointer-events-none">
          <Eye className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span>No hand detected in Cam #{deviceIndex} — present hand to track skeleton</span>
        </div>
      )}

      {/* Floating Status: Error State */}
      {cameraState === 'ERROR' && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-15 px-3 py-1 rounded-full text-[10px] font-mono font-medium bg-rose-950/90 text-rose-300 border border-rose-800 backdrop-blur-sm shadow-md flex items-center gap-1.5 pointer-events-none">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          <span>{errorMessage || 'Camera or vision pipeline offline'}</span>
        </div>
      )}

      {/* Floating Status: Standby / Stopped State */}
      {cameraState !== 'RUNNING' && cameraState !== 'ERROR' && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-15 px-3 py-1 rounded-full text-[10px] font-mono font-medium bg-slate-900/90 text-slate-300 border border-slate-700/60 backdrop-blur-sm shadow-md flex items-center gap-1.5 pointer-events-none">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span>Camera Standby — Click Start Camera to initialize live hand tracking</span>
        </div>
      )}
    </div>
  );
};

export default HandSkeleton3D;
