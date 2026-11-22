import React from 'react';
import { CheckCircle2, ShieldAlert, UserCheck } from 'lucide-react';
import { AppStateResponse } from '../types';
import { formatCOP } from './MonitorView';

interface AnalystQueueViewProps {
  state: AppStateResponse;
  onAnalystFeedback: (txId: string, verdict: 'confirmed_fraud' | 'false_positive') => Promise<void>;
  busy: boolean;
}

export const AnalystQueueView: React.FC<AnalystQueueViewProps> = ({
  state,
  onAnalystFeedback,
  busy,
}) => {
  const pending = state.transactions.filter(
    (tx) => tx.decision === 'REVISION_ANALISTA' && !tx.analyst_resolution
  );

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Cola Priorizada de Analistas y Retroalimentación Automática
          </h2>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl">
            Cumplimiento operativo de Yuma Pay: ningún bloqueo definitivo de cuenta se ejecuta sin aprobación de un analista.
            Cada veredicto recalibra en línea los pesos del motor Python para bajar falsos positivos del 92% a menos del 60%.
          </p>
        </div>
        <div className="flex items-center gap-6 text-xs shrink-0 tabular-nums">
          <div>
            <div className="text-slate-500">Pendientes</div>
            <div className="text-lg font-mono font-semibold text-slate-900">{pending.length}</div>
          </div>
          <div>
            <div className="text-slate-500">Tasa FP Actual</div>
            <div className="text-lg font-mono font-semibold text-emerald-700">
              {(state.metrics.current_fp_rate * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Pending cases list */}
        <div className="xl:col-span-7 space-y-4">
          {pending.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-2">
              <UserCheck className="w-6 h-6 text-emerald-700 mx-auto" />
              <div className="text-sm font-medium text-slate-900">Cola de revisión al día</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Todas las alertas críticas han sido resueltas. Puedes simular escenarios de fraude desde el Monitor en Tiempo Real para generar nuevos casos.
              </p>
            </div>
          ) : (
            pending.map((tx) => (
              <div key={tx.tx_id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono text-slate-900 font-medium">{tx.tx_id}</span>
                      <span aria-hidden="true">·</span>
                      <span>{tx.channel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{tx.total_latency_ms.toFixed(1)} ms</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 mt-1">{tx.modality}</h3>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCOP(tx.amount_cop)}
                    </div>
                    <div className="text-xs font-mono text-red-700 tabular-nums">
                      Riesgo {(tx.risk_score * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-700">Factores explicativos principales:</div>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {tx.explanations.map((ex) => (
                      <li key={ex.feature} className="flex items-center justify-between gap-2">
                        <span>{ex.label}</span>
                        <span className="font-mono text-slate-800 tabular-nums">+{ex.contribution.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                  <span className="text-xs font-mono text-slate-500">
                    SHA-256: {tx.sentinel_block.payload_hash.slice(0, 16)}…
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={busy}
                      onClick={() => onAnalystFeedback(tx.tx_id, 'false_positive')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                      Falso Positivo (Liberar)
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => onAnalystFeedback(tx.tx_id, 'confirmed_fraud')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Confirmar Fraude (Bloquear)
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Auditable SARLAFT / Superfinanciera Log */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <div className="border-b border-slate-200 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Bitácora Auditable (SARLAFT / Superfinanciera)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Registro inmutable de decisiones humanas y recalibración del modelo Python
            </p>
          </div>
          {state.audit_trail.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              Aún no se han registrado resoluciones manuales en esta sesión.
              Resuelve un caso de la izquierda para observar la recalibración en vivo.
            </div>
          ) : (
            <div className="space-y-3">
              {state.audit_trail.map((entry) => (
                <div key={entry.id} className="border border-slate-200 rounded-md p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-900">{entry.verdict}</span>
                    <span className="font-mono text-slate-500">{entry.tx_id}</span>
                  </div>
                  <p className="text-xs text-slate-600">{entry.note}</p>
                  <div className="text-[11px] text-slate-400">
                    {entry.actor} · {new Date(entry.timestamp_ms).toLocaleTimeString('es-CO')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
