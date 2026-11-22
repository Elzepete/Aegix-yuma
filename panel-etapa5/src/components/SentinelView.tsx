import React from 'react';
import { AlertOctagon, CheckCircle2, Lock, ShieldAlert, Zap } from 'lucide-react';
import { AppStateResponse } from '../types';

interface SentinelViewProps {
  state: AppStateResponse;
  onInjectAnomaly: (kind: 'hash_mismatch' | 'replay_attack' | 'phishing_wave') => Promise<void>;
  busy: boolean;
}

export const SentinelView: React.FC<SentinelViewProps> = ({ state, onInjectAnomaly, busy }) => {
  return (
    <div className="space-y-6">
      {/* Header & Attack Simulation Controls */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Centinela Concurrente de Integridad SHA-256 (Arquitectura Go)
          </h2>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl">
            Cada transacción entrante es sellada en un eslabón encadenado SHA-256 + HMAC antes de entrar al modelo Python.
            Detecta alteraciones de payload en tránsito, ataques replay por reutilización de nonce y oleadas anómalas mediante goroutines concurrentes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            disabled={busy}
            onClick={() => onInjectAnomaly('hash_mismatch')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Probar Tampering
          </button>
          <button
            disabled={busy}
            onClick={() => onInjectAnomaly('replay_attack')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Lock className="w-3.5 h-3.5" />
            Probar Replay Nonce
          </button>
          <button
            disabled={busy}
            onClick={() => onInjectAnomaly('phishing_wave')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            Simular Oleada Phishing
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Cryptographic Hash Chain Ledger */}
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                01. Libro Criptográfico Encadenado (Hash-Chain Ledger)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Eslabones verificados secuencialmente: ChainHash = SHA256(Seq | PrevHash | PayloadHash | Timestamp)
              </p>
            </div>
            <span className="text-xs font-mono text-slate-600 tabular-nums">
              {state.sentinel_ledger.length} bloques recientes
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Bloque</th>
                  <th className="py-2.5 px-3">Operación</th>
                  <th className="py-2.5 px-3">Worker Go</th>
                  <th className="py-2.5 px-3">Prev Hash</th>
                  <th className="py-2.5 px-3">Chain Hash</th>
                  <th className="py-2.5 px-4">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-mono">
                {state.sentinel_ledger.slice(0, 18).map((blk) => (
                  <tr key={`${blk.sequence}-${blk.tx_id}`} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 text-slate-900 tabular-nums">#{blk.sequence}</td>
                    <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{blk.tx_id}</td>
                    <td className="py-2.5 px-3 text-slate-500 tabular-nums">goroutine-{blk.worker_id}</td>
                    <td className="py-2.5 px-3 text-slate-500">{blk.prev_hash.slice(0, 12)}…</td>
                    <td className="py-2.5 px-3 text-slate-800">{blk.chain_hash.slice(0, 14)}…</td>
                    <td className="py-2.5 px-4 font-sans whitespace-nowrap">
                      {blk.verified ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Verificado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
                          <AlertOctagon className="w-3.5 h-3.5" />
                          {blk.anomaly_type || 'Anomalía'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Anomaly Detection Log */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-lg p-5">
          <div className="border-b border-slate-200 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-slate-900">
              02. Eventos de Anomalía e Integridad
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Divergencias de hash, nonces duplicados y picos de tráfico
            </p>
          </div>
          {state.anomaly_logs.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              No se han detectado rupturas de integridad ni ataques replay en la sesión actual.
              Usa los botones superiores para probar la detección en vivo.
            </div>
          ) : (
            <div className="space-y-4">
              {state.anomaly_logs.slice(0, 8).map((anom) => (
                <div key={anom.id} className="border border-slate-200 rounded-md p-3.5 bg-slate-50/50 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-red-700">{anom.type}</span>
                    <span className="text-[11px] font-mono text-slate-500">{anom.tx_id}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{anom.detail}</p>
                  {anom.expected_hash && anom.received_hash && (
                    <div className="mt-2 bg-slate-900 text-slate-200 rounded p-2 font-mono text-[10px] space-y-1">
                      <div className="truncate">
                        <span className="text-emerald-400">Esperado:</span> {anom.expected_hash}
                      </div>
                      <div className="truncate">
                        <span className="text-red-400">Recibido:</span> {anom.received_hash}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
