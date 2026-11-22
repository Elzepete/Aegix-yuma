import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Lock,
  Play,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { AppStateResponse, EvaluatedTransaction } from '../types';
import { LatencyConcurrencyChart } from './LatencyConcurrencyChart';

interface MonitorViewProps {
  state: AppStateResponse;
  selectedTx: EvaluatedTransaction | null;
  onSelectTx: (tx: EvaluatedTransaction) => void;
  onEvaluateScenario: (scenario: 'normal' | 'sim_swap' | 'phishing' | 'mule' | 'qr_fake', amountCop?: number) => Promise<void>;
  onInjectAnomaly: (kind: 'hash_mismatch' | 'replay_attack' | 'phishing_wave') => Promise<void>;
  busy: boolean;
}

const CHANNEL_LABELS: Record<string, string> = {
  transferencia_llave: 'Llave Inmediata',
  pago_qr: 'Pago QR',
  retiro_corresponsal: 'Corresponsal',
  vinculacion_digital: 'Vinculación',
};

export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

export function RiskLevelBadge({ level }: { level?: 'BAJO' | 'MEDIO' | 'ALTO' | string }) {
  const l = (level || 'BAJO').toUpperCase();
  if (l === 'ALTO') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap shadow-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
        Riesgo Alto
      </span>
    );
  }
  if (l === 'MEDIO') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap shadow-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Riesgo Medio
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap shadow-xs">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Riesgo Bajo
    </span>
  );
}

export function DecisionLabel({ decision }: { decision: EvaluatedTransaction['decision'] }) {
  if (decision === 'APROBADA') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        Aprobada
      </span>
    );
  }
  if (decision === 'DESAFIO_BIOMETRICO') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Fingerprint className="w-3.5 h-3.5 shrink-0" />
        Desafío Biométrico
      </span>
    );
  }
  if (decision === 'CUARENTENA_INTEGRIDAD') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
        Cuarentena SHA-256
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      Revisión Analista
    </span>
  );
}

export const MonitorView: React.FC<MonitorViewProps> = ({
  state,
  selectedTx,
  onSelectTx,
  onEvaluateScenario,
  onInjectAnomaly,
  busy,
}) => {
  const [filterDecision, setFilterDecision] = useState<string>('ALL');
  const [customAmount, setCustomAmount] = useState<string>('650000');

  const filtered = state.transactions.filter((tx) => {
    if (filterDecision === 'ALL') return true;
    if (filterDecision === 'BAJO') return tx.risk_level === 'BAJO';
    if (filterDecision === 'MEDIO') return tx.risk_level === 'MEDIO';
    if (filterDecision === 'ALTO') return tx.risk_level === 'ALTO';
    return tx.decision === filterDecision;
  });

  const activeTx = selectedTx || filtered[0] || state.transactions[0] || null;
  const { metrics } = state;
  const fpPercent = (metrics.current_fp_rate * 100).toFixed(1);

  const bajoCount = state.transactions.filter((t) => t.risk_level === 'BAJO').length;
  const medioCount = state.transactions.filter((t) => t.risk_level === 'MEDIO').length;
  const altoCount = state.transactions.filter((t) => t.risk_level === 'ALTO').length;

  return (
    <div className="space-y-6">
      {/* KPI Strip: 4-column flat hairline cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Latencia P95 Pre-Autorización</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-display font-semibold text-slate-900 tabular-nums font-mono">
              {metrics.p95_latency_ms.toFixed(1)} ms
            </span>
            <span className="text-xs text-emerald-700 font-medium whitespace-nowrap">
              Meta &lt; {metrics.sla_target_ms} ms
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500 tabular-nums">
            P50: {metrics.p50_latency_ms.toFixed(1)} ms · P99: {metrics.p99_latency_ms.toFixed(1)} ms
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Tasa de Falsos Positivos</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-display font-semibold text-slate-900 tabular-nums font-mono">
              {fpPercent}%
            </span>
            <span className="text-xs text-emerald-700 font-medium whitespace-nowrap">
              Antes: 92.0% · Meta &lt; 60%
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500 tabular-nums">
            Calibración continua activa en Python ML
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Integridad Centinela SHA-256</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-display font-semibold text-slate-900 tabular-nums font-mono">
              {metrics.total_evaluated} bloques
            </span>
            <span
              className={`text-xs font-medium whitespace-nowrap ${
                metrics.quarantined_count > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {metrics.quarantined_count} en cuarentena
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            Cadena HMAC-SHA256 y caché anti-replay
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Exposición Retenida en Ventana</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-display font-semibold text-slate-900 tabular-nums font-mono">
              {formatCOP(metrics.prevented_cop)}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {metrics.pending_analyst_count} alertas pendientes de analista
          </div>
        </div>
      </div>

      {/* Franja de Clasificación de Riesgo Aegix */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
              Clasificación Tripartita de Alertas y Riesgo · Aegix
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cada operación se clasifica en Riesgo Bajo, Medio o Alto antes de liberar o retener el dinero
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Total evaluadas: {state.transactions.length}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <button
            type="button"
            onClick={() => setFilterDecision(filterDecision === 'BAJO' ? 'ALL' : 'BAJO')}
            className={`text-left p-3.5 rounded-lg border transition-all ${
              filterDecision === 'BAJO'
                ? 'border-emerald-600 bg-emerald-50/70 ring-2 ring-emerald-500'
                : 'border-slate-200 hover:border-emerald-300 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Riesgo Bajo
              </span>
              <span className="text-[11px] font-mono text-emerald-700 font-medium">Score &lt; 0.35</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {bajoCount}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              Aprobación inmediata en tiempo real sin fricción
            </div>
          </button>

          <button
            type="button"
            onClick={() => setFilterDecision(filterDecision === 'MEDIO' ? 'ALL' : 'MEDIO')}
            className={`text-left p-3.5 rounded-lg border transition-all ${
              filterDecision === 'MEDIO'
                ? 'border-amber-600 bg-amber-50/70 ring-2 ring-amber-500'
                : 'border-slate-200 hover:border-amber-300 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Riesgo Medio
              </span>
              <span className="text-[11px] font-mono text-amber-700 font-medium">Score 0.35 – 0.70</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {medioCount}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              Desafío biométrico facial o TOTP 2FA requerido
            </div>
          </button>

          <button
            type="button"
            onClick={() => setFilterDecision(filterDecision === 'ALTO' ? 'ALL' : 'ALTO')}
            className={`text-left p-3.5 rounded-lg border transition-all ${
              filterDecision === 'ALTO'
                ? 'border-rose-600 bg-rose-50/70 ring-2 ring-rose-500'
                : 'border-slate-200 hover:border-rose-300 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-800">
                <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" />
                Riesgo Alto
              </span>
              <span className="text-[11px] font-mono text-rose-700 font-medium">Score &ge; 0.70</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {altoCount}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              Retención preventiva para analista SOC o cuarentena
            </div>
          </button>
        </div>
      </div>

      {/* Interactive Simulator & Integrity Test Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-600 mr-1">Simular evento en tiempo real:</span>
          <div className="flex items-center border border-slate-200 rounded-md overflow-hidden bg-slate-50">
            <span className="px-2.5 text-xs text-slate-500 border-r border-slate-200">COP</span>
            <input
              type="number"
              min={10000}
              step={10000}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              aria-label="Monto de prueba en COP"
              className="w-28 px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white focus:outline-none"
            />
          </div>
          <button
            disabled={busy}
            onClick={() => onEvaluateScenario('normal', Number(customAmount) || 120000)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Play className="w-3 h-3" />
            Cliente Legítimo
          </button>
          <button
            disabled={busy}
            onClick={() => onEvaluateScenario('sim_swap', Number(customAmount) || 1450000)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            SIM Swapping
          </button>
          <button
            disabled={busy}
            onClick={() => onEvaluateScenario('phishing', Number(customAmount) || 980000)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            Toma de Cuenta
          </button>
          <button
            disabled={busy}
            onClick={() => onEvaluateScenario('mule', Number(customAmount) || 1850000)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            Cuenta Mula
          </button>
          <button
            disabled={busy}
            onClick={() => onEvaluateScenario('qr_fake', Number(customAmount) || 640000)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            QR Falso
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            disabled={busy}
            onClick={() => onInjectAnomaly('hash_mismatch')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Alterar Hash SHA-256
          </button>
          <button
            disabled={busy}
            onClick={() => onInjectAnomaly('replay_attack')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Lock className="w-3.5 h-3.5" />
            Inyectar Replay
          </button>
        </div>
      </div>

      {/* Recharts: Historical Latency & Concurrency vs SHA-256 Integrity */}
      <LatencyConcurrencyChart
        latencyHistory={state.latency_history || []}
        concurrencySummary={state.concurrency_summary || []}
      />

      {/* Main Split: High-density transaction stream + Explainability & Hash Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                02. Flujo Pre-Autorización en Tiempo Real
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Verificación de integridad SHA-256 y calificación ML antes de liberar fondos
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'Todas' },
                { key: 'BAJO', label: '🟢 Riesgo Bajo' },
                { key: 'MEDIO', label: '🟡 Riesgo Medio' },
                { key: 'ALTO', label: '🔴 Riesgo Alto' },
                { key: 'CUARENTENA_INTEGRIDAD', label: 'Cuarentena SHA-256' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilterDecision(tab.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    filterDecision === tab.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Operación</th>
                  <th className="py-2.5 px-3">Canal</th>
                  <th className="py-2.5 px-3 text-right">Monto</th>
                  <th className="py-2.5 px-3">Nivel de Riesgo (Aegix)</th>
                  <th className="py-2.5 px-3 text-right">Score</th>
                  <th className="py-2.5 px-3 text-right">Latencia</th>
                  <th className="py-2.5 px-4">Decisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      No hay transacciones que coincidan con el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  filtered.slice(0, 16).map((tx) => {
                    const isSelected = activeTx?.tx_id === tx.tx_id;
                    return (
                      <tr
                        key={tx.tx_id}
                        onClick={() => onSelectTx(tx)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-mono text-slate-900 whitespace-nowrap">
                          {tx.tx_id}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                          {CHANNEL_LABELS[tx.channel] || tx.channel}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-900 tabular-nums whitespace-nowrap">
                          {formatCOP(tx.amount_cop)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <RiskLevelBadge level={tx.risk_level} />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={
                              tx.risk_score >= 0.70
                                ? 'text-red-700 font-semibold'
                                : tx.risk_score >= 0.35
                                ? 'text-amber-700 font-medium'
                                : 'text-emerald-700 font-medium'
                            }
                          >
                            {(tx.risk_score * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {tx.total_latency_ms.toFixed(1)} ms
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <DecisionLabel decision={tx.decision} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Panel: Cryptographic & ML Explainability Inspector */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          {activeTx ? (
            <>
              <div className="border-b border-slate-200 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-slate-500">{activeTx.tx_id}</span>
                  <div className="flex items-center gap-1.5">
                    <RiskLevelBadge level={activeTx.risk_level} />
                    <DecisionLabel decision={activeTx.decision} />
                  </div>
                </div>
                <h3 className="text-base font-semibold text-slate-900 mt-1.5">
                  {activeTx.modality}
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {activeTx.action_note}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-medium text-slate-700">Atribución Explicable (Python ML)</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    Score {(activeTx.risk_score * 100).toFixed(1)}%
                  </span>
                </div>
                {activeTx.explanations.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Sin señales anómalas relevantes; patrón consistente con el historial del usuario.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {activeTx.explanations.map((exp) => {
                      const pct = Math.min(100, Math.round((exp.contribution / 2.2) * 100));
                      return (
                        <div key={exp.feature} className="space-y-1">
                          <div className="flex items-center justify-between text-xs gap-2">
                            <span className="text-slate-700 truncate">{exp.label}</span>
                            <span className="font-mono text-slate-900 tabular-nums shrink-0">
                              +{exp.contribution.toFixed(2)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                activeTx.risk_score >= 0.72 ? 'bg-red-600' : 'bg-amber-600'
                              }`}
                              style={{ width: `${Math.max(10, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">Huella Centinela SHA-256</span>
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      activeTx.integrity_ok ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {activeTx.integrity_ok ? 'Cadena Íntegra' : 'Integridad Rota'}
                  </span>
                </div>
                <div className="bg-slate-900 text-slate-200 rounded-md p-3 font-mono text-[11px] space-y-1.5 overflow-x-auto">
                  <div>
                    <span className="text-slate-400">Bloque:</span> #{activeTx.sentinel_block.sequence} · Worker Go #{activeTx.sentinel_block.worker_id}
                  </div>
                  <div className="truncate">
                    <span className="text-slate-400">Payload:</span> {activeTx.sentinel_block.payload_hash}
                  </div>
                  <div className="truncate">
                    <span className="text-slate-400">PrevHash:</span> {activeTx.sentinel_block.prev_hash}
                  </div>
                  <div className="truncate">
                    <span className="text-slate-400">ChainHash:</span> {activeTx.sentinel_block.chain_hash}
                  </div>
                  <div className="truncate">
                    <span className="text-slate-400">HMAC:</span> {activeTx.sentinel_block.hmac}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                  <span>Inferencia Python: {activeTx.python_inference_ms.toFixed(2)} ms</span>
                  <span>Total E2E: {activeTx.total_latency_ms.toFixed(2)} ms</span>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500">
              Selecciona una transacción del flujo para inspeccionar su huella SHA-256 y explicación ML.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
