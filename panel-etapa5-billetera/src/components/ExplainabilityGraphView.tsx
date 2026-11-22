import React from 'react';
import { AppStateResponse } from '../types';

interface ExplainabilityGraphViewProps {
  state: AppStateResponse;
}

const FEATURE_LABELS: Record<string, string> = {
  sim_swap_reciente: 'Cambio reciente de SIM (<24h)',
  dispositivo_nuevo: 'Dispositivo nuevo no reconocido',
  cambio_clave_reciente: 'Cambio de clave previo',
  monto_anomalo_z: 'Z-Score de monto atípico',
  velocidad_tx_10m: 'Velocidad de operaciones (10m)',
  riesgo_grafo_mula: 'Centralidad en red de cuentas mula',
  horario_nocturno_atipico: 'Franja nocturna atípica',
  qr_comercio_no_verificado: 'Comercio QR sin verificación',
  primer_contacto_destino: 'Primer contacto hacia destino',
};

export const ExplainabilityGraphView: React.FC<ExplainabilityGraphViewProps> = ({ state }) => {
  const weights = state.python_health?.weights || {};
  const weightEntries = Object.entries(weights).sort((a, b) => b[1] - a[1]);

  const muleTransactions = state.transactions.filter(
    (t) => t.modality.includes('Mula') || t.risk_score >= 0.72
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Live Python Model Weights */}
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              01. Pesos Activos del Motor Python ML ({state.python_health?.model_version || 'yuma-gbdt'})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Variables estrictamente conductuales y de red. Excluye región, edad y nivel de ingresos (Ley 1581/2012).
            </p>
          </div>

          <div className="space-y-3">
            {weightEntries.map(([key, val]) => {
              const widthPct = Math.min(100, Math.round((val / 3.0) * 100));
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700">{FEATURE_LABELS[key] || key}</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {val.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-700 rounded-full transition-all duration-200"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-200 grid grid-cols-2 gap-4 text-xs tabular-nums">
            <div>
              <div className="text-slate-500">Umbral Desafío Biométrico</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5">
                {((state.python_health?.thresholds.step_up_biometrico ?? 0.42) * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-slate-500">Umbral Revisión Analista</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5">
                {((state.python_health?.thresholds.revision_analista ?? 0.72) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* Account Graph Fan-In Visualizer */}
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              02. Grafo de Detección de Cuentas Mula (Fan-In)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Correlación topológica de múltiples orígenes cifrados drenando hacia un mismo nodo receptor antes de retiro en corresponsal.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-4">
            <svg viewBox="0 0 520 250" className="w-full h-56" role="img" aria-label="Grafo de red de cuentas mula">
              {/* Edges from multiple source wallets to central mule node */}
              {[
                { x: 75, y: 40, label: 'usr-104' },
                { x: 75, y: 95, label: 'usr-218' },
                { x: 75, y: 150, label: 'usr-392' },
                { x: 75, y: 205, label: 'usr-511' },
              ].map((src, idx) => (
                <g key={src.label}>
                  <line
                    x1={src.x + 42}
                    y1={src.y}
                    x2={250}
                    y2={125}
                    stroke={idx < 3 ? '#DC2626' : '#D97706'}
                    strokeWidth={idx < 3 ? '2' : '1.5'}
                    strokeDasharray={idx === 3 ? '4 4' : undefined}
                  />
                  <rect x={25} y={src.y - 14} width={92} height={28} rx={6} fill="#FFFFFF" stroke="#CBD5E1" />
                  <text x={71} y={src.y + 4} textAnchor="middle" className="fill-slate-700 text-[11px] font-mono">
                    {src.label}
                  </text>
                </g>
              ))}

              {/* Central Mule Account */}
              <circle cx={280} cy={125} r={34} fill="#FEF2F2" stroke="#DC2626" strokeWidth={2} />
              <text x={280} y={122} textAnchor="middle" className="fill-red-800 text-[11px] font-semibold">
                Nodo Mula
              </text>
              <text x={280} y={136} textAnchor="middle" className="fill-red-700 text-[10px] font-mono">
                fan-in &ge; 4
              </text>

              {/* Cash-out edge */}
              <line x1={314} y1={125} x2={398} y2={125} stroke="#0F172A" strokeWidth={2} />
              <rect x={398} y={103} width={104} height={44} rx={6} fill="#0F172A" />
              <text x={450} y={122} textAnchor="middle" className="fill-white text-[11px] font-medium">
                Corresponsal
              </text>
              <text x={450} y={137} textAnchor="middle" className="fill-slate-300 text-[10px]">
                Retiro bloqueado
              </text>
            </svg>
          </div>

          <div className="text-xs text-slate-600">
            Operaciones recientes con señales de red o alto riesgo detectadas:{' '}
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {muleTransactions.length}
            </span>
          </div>
        </div>
      </div>

      {/* Modalities & Regulatory Compliance Matrix */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">
          03. Cobertura de Modalidades Críticas y Cumplimiento Normativo
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-xs">
          <div className="border border-slate-200 rounded-md p-4 space-y-1.5">
            <div className="font-semibold text-slate-900">Toma de Cuenta (Phishing)</div>
            <p className="text-slate-600 leading-relaxed">
              Correlaciona dispositivo nuevo + cambio de clave reciente + velocidad anómala en &lt; 10 min.
            </p>
          </div>
          <div className="border border-slate-200 rounded-md p-4 space-y-1.5">
            <div className="font-semibold text-slate-900">SIM Swapping (OTP)</div>
            <p className="text-slate-600 leading-relaxed">
              Detecta cambio de SIM (&lt;24h) combinado con transferencia inmediata nocturna o nuevo beneficiario.
            </p>
          </div>
          <div className="border border-slate-200 rounded-md p-4 space-y-1.5">
            <div className="font-semibold text-slate-900">Cuentas Mula (SARLAFT)</div>
            <p className="text-slate-600 leading-relaxed">
              Analiza grado de entrada (fan-in) en Python sobre cuentas destino cifradas antes de retiro en efectivo.
            </p>
          </div>
          <div className="border border-slate-200 rounded-md p-4 space-y-1.5">
            <div className="font-semibold text-slate-900">QR y Comprobantes Falsos</div>
            <p className="text-slate-600 leading-relaxed">
              Valida firma SHA-256 en el Centinela Go y verifica historial de comercio receptor en tiempo real.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
