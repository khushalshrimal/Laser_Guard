import React from 'react';

export interface DataPoint {
  time: string;
  temperature: number;
  gas: number;
  waterFlow: number;
}

interface SensorChartProps {
  data: DataPoint[];
  height?: number;
  thresholdTemp?: number;
  showWaterFlow?: boolean;
}

export const SensorChart: React.FC<SensorChartProps> = ({
  data,
  height = 180,
  thresholdTemp = 60,
  showWaterFlow = true,
}) => {
  if (!data || data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs font-mono text-slate-500 bg-[#0c1017] rounded-lg border border-slate-800">
        Awaiting live sensor stream...
      </div>
    );
  }

  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 25;
  const totalWidth = 600;

  const plotWidth = totalWidth - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(100, ...data.map((d) => Math.max(d.temperature, d.gas, (d.waterFlow || 0) * 10)));
  const minVal = 0;
  const valRange = maxVal - minVal || 1;

  const getX = (idx: number) => paddingLeft + (idx / Math.max(1, data.length - 1)) * plotWidth;
  const getY = (val: number) => paddingTop + plotHeight - ((val - minVal) / valRange) * plotHeight;

  // Paths
  const tempPath = data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.temperature).toFixed(1)}`).join(' L ');
  const gasPath = data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.gas).toFixed(1)}`).join(' L ');
  const flowPath = showWaterFlow
    ? data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.waterFlow * 10).toFixed(1)}`).join(' L ')
    : '';

  const thresholdY = getY(thresholdTemp);

  return (
    <div className="w-full bg-[#0d121c] p-3 rounded-lg border border-slate-800/80">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-amber-400">
            <span className="w-2.5 h-1 rounded bg-amber-400 inline-block" /> Temperature (°C)
          </span>
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2.5 h-1 rounded bg-emerald-400 inline-block" /> Gas / Smoke (ppm)
          </span>
          {showWaterFlow && (
            <span className="flex items-center gap-1.5 text-cyan-400">
              <span className="w-2.5 h-1 rounded bg-cyan-400 inline-block" /> Water Flow (x10 L/min)
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500">Real-time Telemetry Stream</div>
      </div>

      <svg viewBox={`0 0 ${totalWidth} ${height}`} className="w-full h-auto overflow-visible">
        {/* Horizontal grid lines */}
        {[0, 25, 50, 75, 100].map((v) => {
          const y = getY((v / 100) * maxVal);
          return (
            <g key={v}>
              <line x1={paddingLeft} y1={y} x2={totalWidth - paddingRight} y2={y} stroke="#1f293d" strokeDasharray="3 3" strokeWidth="0.8" />
              <text x={paddingLeft - 6} y={y + 3} textAnchor="end" fill="#64748b" fontSize="9" fontFamily="monospace">
                {Math.round((v / 100) * maxVal)}
              </text>
            </g>
          );
        })}

        {/* Warning Threshold line for temperature */}
        <line
          x1={paddingLeft}
          y1={thresholdY}
          x2={totalWidth - paddingRight}
          y2={thresholdY}
          stroke="#ef4444"
          strokeDasharray="4 2"
          strokeWidth="1.2"
          opacity="0.75"
        />
        <text x={totalWidth - paddingRight} y={thresholdY - 4} textAnchor="end" fill="#f87171" fontSize="8" fontFamily="monospace">
          Temp Limit: {thresholdTemp}°C
        </text>

        {/* Lines */}
        <path d={`M ${gasPath}`} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
        <path d={`M ${tempPath}`} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
        {showWaterFlow && <path d={`M ${flowPath}`} fill="none" stroke="#06b6d4" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="3 1" />}

        {/* X Axis Timestamps */}
        {data.map((d, i) => {
          if (i === 0 || i === Math.floor(data.length / 2) || i === data.length - 1) {
            return (
              <text key={i} x={getX(i)} y={height - 6} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">
                {d.time}
              </text>
            );
          }
          return null;
        })}
      </svg>
    </div>
  );
};

export default SensorChart;
