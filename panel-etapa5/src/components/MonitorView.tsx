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
    return tx.decision === filterDecision;
  });

  const activeTx = selectedTx || filtered[0] || state.transactions[0] || null;
  const { metrics } = state;
  const fpPercent = (metrics.current_fp_rate * 100).toFixed(1);

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

      {/* Main Split: High-density transaction stream + Explainability & Hash Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                01. Flujo Pre-Autorización en Tiempo Real
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Verificación de integridad SHA-256 y calificación ML antes de liberar fondos
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'Todas' },
                { key: 'APROBADA', label: 'Aprobadas' },
                { key: 'DESAFIO_BIOMETRICO', label: 'Biometría' },
                { key: 'REVISION_ANALISTA', label: 'Revisión' },
                { key: 'CUARENTENA_INTEGRIDAD', label: 'Cuarentena' },
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
                  <th className="py-2.5 px-3">Hash Payload</th>
                  <th className="py-2.5 px-3 text-right">Riesgo</th>
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
                        <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                          {tx.sentinel_block.payload_hash.slice(0, 10)}…
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={
                              tx.risk_score >= 0.72
                                ? 'text-red-700 font-semibold'
                                : tx.risk_score >= 0.42
                                ? 'text-amber-700 font-medium'
                                : 'text-slate-700'
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
                  <DecisionLabel decision={activeTx.decision} />
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
