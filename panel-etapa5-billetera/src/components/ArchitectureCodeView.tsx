import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const TABS = [
  { key: 'sentinel-go/main.go', label: 'Centinela Go (main.go)' },
  { key: 'python_engine/risk_engine.py', label: 'Motor ML Python (risk_engine.py)' },
  { key: 'sentinel-go/sentinel_test.go', label: 'Pruebas Concurrencia Go' },
  { key: 'docker-compose.yml', label: 'Despliegue Contenedores' },
];

export const ArchitectureCodeView: React.FC = () => {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>(TABS[0].key);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((data) => setFiles(data.files || {}))
      .catch(() => setFiles({}));
  }, []);

  const currentCode = files[activeTab] || 'Cargando archivo fuente…';

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-6">
      {/* Architecture Pipeline Summary */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Arquitectura Híbrida Go + Python para Yuma Pay (&lt; 300 ms · 150+ TPS)
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Separación de responsabilidades: Go gestiona concurrencia masiva, canales, caché anti-replay y cadena SHA-256/HMAC; Python ejecuta scoring ML, análisis de grafos y explicabilidad.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div className="border border-slate-200 rounded-md p-4">
            <div className="font-semibold text-slate-900">1. Canal Digital &amp; API</div>
            <p className="text-slate-600 mt-1">
              Envía evento anonimizado (sin PII) con nonce único y hash SHA-256 del payload vía HTTPS/TLS.
            </p>
          </div>
          <div className="border border-slate-200 rounded-md p-4">
            <div className="font-semibold text-slate-900">2. Centinela Go (Goroutines)</div>
            <p className="text-slate-600 mt-1">
              Pool de workers concurrentes verifica SHA-256, encadena bloques HMAC y frena ataques replay o ráfagas en &lt; 2 ms.
            </p>
          </div>
          <div className="border border-slate-200 rounded-md p-4">
            <div className="font-semibold text-slate-900">3. Motor Python 3.11 ML</div>
            <p className="text-slate-600 mt-1">
              Calcula riesgo conductual, grafo fan-in de cuentas mula y atribución explicable en &lt; 10 ms con timeout estricto de 250 ms.
            </p>
          </div>
          <div className="border border-slate-200 rounded-md p-4">
            <div className="font-semibold text-slate-900">4. Decisión y Feedback</div>
            <p className="text-slate-600 mt-1">
              Aprueba, solicita biometría o retiene para revisión humana. El veredicto del analista recalibra Python automáticamente.
            </p>
          </div>
        </div>
      </div>

      {/* Real Inspectable Source Code Viewer */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
          <div className="flex flex-wrap items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === t.key
                    ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado' : 'Copiar código'}
          </button>
        </div>

        <pre className="p-5 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto max-h-[540px]">
          <code>{currentCode}</code>
        </pre>
      </div>
    </div>
  );
};
