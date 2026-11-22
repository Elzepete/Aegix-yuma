import React, { useMemo, useState } from 'react';
import { ConcurrencyBucketSummary, LatencyHistoryPoint } from '../types';

interface LatencyConcurrencyChartProps {
  latencyHistory: LatencyHistoryPoint[];
  concurrencySummary: ConcurrencyBucketSummary[];
}

export const LatencyConcurrencyChart: React.FC<LatencyConcurrencyChartProps> = ({
  latencyHistory,
  concurrencySummary,
}) => {
  const [chartMode, setChartMode] = useState<'timeline' | 'comparison'>('timeline');
  const [showSlaCeiling, setShowSlaCeiling] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverBucket, setHoverBucket] = useState<number | null>(null);

  const anomalyPoints = latencyHistory.filter((p) => !p.integrity_ok).length;

  // Parámetros del viewport SVG
  const width = 800;
  const height = 240;
  const padLeft = 45;
  const padRight = 45;
  const padTop = 20;
  const padBottom = 30;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Cálculo de escalas para Timeline
  const { maxMs, maxConc, points } = useMemo(() => {
    if (!latencyHistory.length) {
      return { maxMs: 10, maxConc: 8, points: [] };
    }
    const highestMs = Math.max(...latencyHistory.map((d) => d.total_ms), 1);
    const ceilingMs = showSlaCeiling ? Math.max(highestMs, 320) : Math.max(highestMs * 1.15, 10);
    const highestConc = Math.max(...latencyHistory.map((d) => d.concurrency), 4);

    const stepX = latencyHistory.length > 1 ? chartW / (latencyHistory.length - 1) : chartW / 2;
    const computedPoints = latencyHistory.map((d, i) => {
      const x = padLeft + (latencyHistory.length === 1 ? chartW / 2 : i * stepX);
      const yTotal = padTop + chartH - (d.total_ms / ceilingMs) * chartH;
      const ySentinel = padTop + chartH - (d.sentinel_ms / ceilingMs) * chartH;
      const barH = (d.concurrency / highestConc) * (chartH * 0.45);
      const yBar = padTop + chartH - barH;
      return { ...d, x, yTotal, ySentinel, yBar, barH };
    });

    return { maxMs: ceilingMs, maxConc: highestConc, points: computedPoints };
  }, [latencyHistory, showSlaCeiling, chartW, chartH, padLeft, padTop]);

  // Generador de paths SVG suaves para Timeline
  const { lineTotalPath, areaTotalPath, lineSentinelPath } = useMemo(() => {
    if (points.length === 0) return { lineTotalPath: '', areaTotalPath: '', lineSentinelPath: '' };
    if (points.length === 1) {
      const p = points[0];
      return {
        lineTotalPath: `M ${p.x - 20} ${p.yTotal} L ${p.x + 20} ${p.yTotal}`,
        areaTotalPath: `M ${p.x - 20} ${padTop + chartH} L ${p.x - 20} ${p.yTotal} L ${p.x + 20} ${p.yTotal} L ${p.x + 20} ${padTop + chartH} Z`,
        lineSentinelPath: `M ${p.x - 20} ${p.ySentinel} L ${p.x + 20} ${p.ySentinel}`,
      };
    }
    let totalD = `M ${points[0].x} ${points[0].yTotal}`;
    let sentinelD = `M ${points[0].x} ${points[0].ySentinel}`;
    for (let i = 1; i < points.length; i++) {
      totalD += ` L ${points[i].x} ${points[i].yTotal}`;
      sentinelD += ` L ${points[i].x} ${points[i].ySentinel}`;
    }
    const areaD = `${totalD} L ${points[points.length - 1].x} ${padTop + chartH} L ${points[0].x} ${padTop + chartH} Z`;
    return { lineTotalPath: totalD, areaTotalPath: areaD, lineSentinelPath: sentinelD };
  }, [points, padTop, chartH]);

  // Posición Y de la línea SLA 300ms
  const slaY = showSlaCeiling ? padTop + chartH - (300 / maxMs) * chartH : null;

  // Cálculo de escalas para Comparison (agrupado por concurrencia)
  const compData = useMemo(() => {
    if (!concurrencySummary.length) return { maxVal: 10, items: [] };
    const maxVal = Math.max(
      ...concurrencySummary.map((b) => Math.max(b.avg_total_ms, b.p95_ms, b.avg_sentinel_ms)),
      10
    ) * 1.2;
    const groupW = chartW / concurrencySummary.length;
    const barW = Math.min(22, (groupW - 20) / 3);

    const items = concurrencySummary.map((b, i) => {
      const groupX = padLeft + i * groupW + (groupW - barW * 3 - 8) / 2;
      const hTotal = (b.avg_total_ms / maxVal) * chartH;
      const hP95 = (b.p95_ms / maxVal) * chartH;
      const hSentinel = (b.avg_sentinel_ms / maxVal) * chartH;
      return {
        ...b,
        groupCenterX: padLeft + i * groupW + groupW / 2,
        x1: groupX,
        y1: padTop + chartH - hTotal,
        h1: Math.max(2, hTotal),
        x2: groupX + barW + 4,
        y2: padTop + chartH - hP95,
        h2: Math.max(2, hP95),
        x3: groupX + (barW + 4) * 2,
        y3: padTop + chartH - hSentinel,
        h3: Math.max(2, hSentinel),
        barW,
      };
    });
    return { maxVal, items };
  }, [concurrencySummary, chartW, chartH, padLeft, padTop]);

  const activeHoverItem = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;
  const activeHoverBucket = hoverBucket !== null && compData.items[hoverBucket] ? compData.items[hoverBucket] : null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-xs">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
            <h2 className="text-sm font-semibold text-slate-900 tracking-tight">
              01. Latencia Histórica y Concurrencia frente a Integridad SHA-256
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Compara la latencia E2E (ms) y el costo de verificación SHA-256 bajo cargas secuenciales frente a ráfagas concurrentes
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {chartMode === 'timeline' && (
            <button
              type="button"
              onClick={() => setShowSlaCeiling((v) => !v)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                showSlaCeiling
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {showSlaCeiling ? 'Escala: Techo SLA 300 ms' : 'Escala: Detalle ms'}
            </button>
          )}

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => {
                setChartMode('timeline');
                setHoverBucket(null);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'timeline'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Serie Histórica
            </button>
            <button
              type="button"
              onClick={() => {
                setChartMode('comparison');
                setHoverIndex(null);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'comparison'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Impacto Concurrencia
            </button>
          </div>
        </div>
      </div>

      {/* Legend Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        {chartMode === 'timeline' ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-blue-700 inline-block rounded-xs" />
              Latencia Total E2E (ms)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-emerald-600 inline-block" />
              Verificación SHA-256 (ms)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-slate-300 inline-block rounded-xs" />
              Concurrencia (tx simultáneas)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-red-600 inline-block rounded-full" />
              Anomalía SHA-256 ({anomalyPoints})
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-blue-700 inline-block rounded-xs" />
              Latencia Promedio Total (ms)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-slate-800 inline-block rounded-xs" />
              Latencia P95 (ms)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-emerald-600 inline-block rounded-xs" />
              Overhead SHA-256 (ms)
            </span>
          </div>
        )}
        <span className="font-mono text-slate-500 tabular-nums">
          {latencyHistory.length} muestras activas
        </span>
      </div>

      {/* Chart Viewport */}
      <div className="relative h-72 w-full bg-slate-50/50 rounded-md border border-slate-100 overflow-hidden">
        {latencyHistory.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            Sin muestras históricas todavía. Ejecuta una simulación para poblar la serie.
          </div>
        ) : chartMode === 'timeline' ? (
          <div className="relative w-full h-full">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-full select-none"
              preserveAspectRatio="none"
              onMouseLeave={() => setHoverIndex(null)}
            >
              <defs>
                <linearGradient id="aegixLatencyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1D4ED8" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#1D4ED8" stopOpacity={0.01} />
                </linearGradient>
              </defs>

              {/* Grid Horizontal */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                const y = padTop + chartH * (1 - pct);
                const val = (maxMs * pct).toFixed(0);
                return (
                  <g key={`grid-${pct}`}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke="#E2E8F0"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={padLeft - 6}
                      y={y + 3}
                      textAnchor="end"
                      className="text-[10px] fill-slate-400 font-mono"
                    >
                      {val}ms
                    </text>
                  </g>
                );
              })}

              {/* Concurrency Right Axis Labels */}
              {[0, 0.5, 1].map((pct) => {
                const y = padTop + chartH * (1 - pct);
                const val = (maxConc * pct).toFixed(0);
                return (
                  <text
                    key={`r-axis-${pct}`}
                    x={width - padRight + 8}
                    y={y + 3}
                    textAnchor="start"
                    className="text-[10px] fill-slate-400 font-mono"
                  >
                    {val} tx
                  </text>
                );
              })}

              {/* SLA Line at 300ms */}
              {slaY !== null && slaY >= padTop && slaY <= padTop + chartH && (
                <g>
                  <line
                    x1={padLeft}
                    y1={slaY}
                    x2={width - padRight}
                    y2={slaY}
                    stroke="#DC2626"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={width - padRight - 6}
                    y={slaY - 4}
                    textAnchor="end"
                    className="text-[10px] font-semibold fill-red-600 font-mono"
                  >
                    SLA Máximo 300 ms
                  </text>
                </g>
              )}

              {/* Concurrency Bars */}
              {points.map((p, i) => (
                <rect
                  key={`c-bar-${p.sequence}`}
                  x={p.x - 4}
                  y={p.yBar}
                  width={8}
                  height={p.barH}
                  rx={2}
                  fill={p.integrity_ok ? '#CBD5E1' : '#FCA5A5'}
                  opacity={hoverIndex === i ? 0.9 : 0.65}
                />
              ))}

              {/* Area & Line for Total Latency */}
              <path d={areaTotalPath} fill="url(#aegixLatencyGrad)" />
              <path d={lineTotalPath} fill="none" stroke="#1D4ED8" strokeWidth={2} strokeLinecap="round" />

              {/* Line for Sentinel SHA-256 Latency */}
              <path d={lineSentinelPath} fill="none" stroke="#16A34A" strokeWidth={1.75} strokeDasharray="2 1" />

              {/* Points for Anomalies & Hovers */}
              {points.map((p, i) => {
                const isHovered = hoverIndex === i;
                if (!p.integrity_ok) {
                  return (
                    <circle
                      key={`ano-dot-${p.sequence}`}
                      cx={p.x}
                      cy={p.yTotal}
                      r={isHovered ? 6 : 4.5}
                      fill="#DC2626"
                      stroke="#FFFFFF"
                      strokeWidth={1.5}
                    />
                  );
                }
                if (isHovered) {
                  return (
                    <circle
                      key={`hov-dot-${p.sequence}`}
                      cx={p.x}
                      cy={p.yTotal}
                      r={5}
                      fill="#1D4ED8"
                      stroke="#FFFFFF"
                      strokeWidth={1.5}
                    />
                  );
                }
                return null;
              })}

              {/* Crosshair on Hover */}
              {activeHoverItem && (
                <line
                  x1={activeHoverItem.x}
                  y1={padTop}
                  x2={activeHoverItem.x}
                  y2={padTop + chartH}
                  stroke="#94A3B8"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              )}

              {/* Interactive Slices for Mouse Movement */}
              {points.map((p, i) => {
                const sliceW = points.length > 1 ? chartW / points.length : chartW;
                return (
                  <rect
                    key={`slice-${p.sequence}`}
                    x={p.x - sliceW / 2}
                    y={padTop}
                    width={sliceW}
                    height={chartH}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                );
              })}
            </svg>

            {/* Hover Tooltip Overlay */}
            {activeHoverItem && (
              <div
                className="absolute z-20 pointer-events-none bg-white border border-slate-200 rounded-md p-3 shadow-md text-xs space-y-1.5 min-w-[210px]"
                style={{
                  left: Math.min(
                    Math.max(10, (activeHoverItem.x / width) * 100),
                    75
                  ) + '%',
                  top: '12px',
                }}
              >
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1.5">
                  <span className="font-mono font-semibold text-slate-900">
                    Bloque #{activeHoverItem.sequence}
                  </span>
                  <span className="font-mono text-slate-500">{activeHoverItem.tx_id}</span>
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="text-slate-600">Latencia Total E2E</span>
                  <span className="font-mono font-semibold text-blue-700">
                    {activeHoverItem.total_ms.toFixed(2)} ms
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="text-slate-600">Centinela SHA-256</span>
                  <span className="font-mono font-medium text-emerald-700">
                    {activeHoverItem.sentinel_ms.toFixed(2)} ms
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="text-slate-600">Inferencia Python ML</span>
                  <span className="font-mono text-slate-800">
                    {activeHoverItem.python_ms.toFixed(2)} ms
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="text-slate-600">Concurrencia</span>
                  <span className="font-mono text-slate-800">
                    {activeHoverItem.concurrency} tx · Worker #{activeHoverItem.worker_id}
                  </span>
                </div>
                <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-slate-500">Integridad</span>
                  <span
                    className={`font-medium ${
                      activeHoverItem.integrity_ok ? 'text-emerald-700' : 'text-red-700 font-semibold'
                    }`}
                  >
                    {activeHoverItem.integrity_ok
                      ? 'SHA-256 Verificada'
                      : activeHoverItem.anomaly_type || 'Anomalía Detectada'}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="relative w-full h-full">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-full select-none"
              preserveAspectRatio="none"
              onMouseLeave={() => setHoverBucket(null)}
            >
              {/* Grid Horizontal */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                const y = padTop + chartH * (1 - pct);
                const val = (compData.maxVal * pct).toFixed(0);
                return (
                  <g key={`comp-grid-${pct}`}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke="#E2E8F0"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={padLeft - 6}
                      y={y + 3}
                      textAnchor="end"
                      className="text-[10px] fill-slate-400 font-mono"
                    >
                      {val}ms
                    </text>
                  </g>
                );
              })}

              {/* Grouped Bars */}
              {compData.items.map((b, i) => (
                <g
                  key={`bucket-g-${b.bucket}`}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverBucket(i)}
                >
                  <rect
                    x={b.x1}
                    y={b.y1}
                    width={b.barW}
                    height={b.h1}
                    rx={3}
                    fill="#1D4ED8"
                    opacity={hoverBucket === i ? 1 : 0.85}
                  />
                  <rect
                    x={b.x2}
                    y={b.y2}
                    width={b.barW}
                    height={b.h2}
                    rx={3}
                    fill="#0F172A"
                    opacity={hoverBucket === i ? 1 : 0.85}
                  />
                  <rect
                    x={b.x3}
                    y={b.y3}
                    width={b.barW}
                    height={b.h3}
                    rx={3}
                    fill="#16A34A"
                    opacity={hoverBucket === i ? 1 : 0.85}
                  />
                  {/* Bucket Label */}
                  <text
                    x={b.groupCenterX}
                    y={padTop + chartH + 16}
                    textAnchor="middle"
                    className="text-[11px] font-medium fill-slate-700 font-mono"
                  >
                    {b.bucket}
                  </text>
                </g>
              ))}
            </svg>

            {/* Hover Tooltip Overlay for Comparison */}
            {activeHoverBucket && (
              <div
                className="absolute z-20 pointer-events-none bg-white border border-slate-200 rounded-md p-3 shadow-md text-xs space-y-1.5 min-w-[205px]"
                style={{
                  left: Math.min(
                    Math.max(10, (activeHoverBucket.groupCenterX / width) * 100),
                    75
                  ) + '%',
                  top: '12px',
                }}
              >
                <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1.5">
                  {activeHoverBucket.bucket}
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="text-slate-600">Operaciones medidas</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {activeHoverBucket.count}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="text-slate-600">Promedio Total</span>
                  <span className="font-mono text-blue-700">
                    {activeHoverBucket.avg_total_ms.toFixed(2)} ms
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="text-slate-600">Latencia P95</span>
                  <span className="font-mono text-slate-900">
                    {activeHoverBucket.p95_ms.toFixed(2)} ms
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="text-slate-600">Overhead SHA-256</span>
                  <span className="font-mono text-emerald-700">
                    {activeHoverBucket.avg_sentinel_ms.toFixed(2)} ms
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 tabular-nums pt-1 border-t border-slate-100">
                  <span className="text-slate-500">Integridad válida</span>
                  <span className="font-mono font-medium text-slate-900">
                    {activeHoverBucket.integrity_rate.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
