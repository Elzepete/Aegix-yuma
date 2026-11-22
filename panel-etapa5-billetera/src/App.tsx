import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Code2,
  Menu,
  Network,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { AnalystQueueView } from './components/AnalystQueueView';
import { ArchitectureCodeView } from './components/ArchitectureCodeView';
import { ExplainabilityGraphView } from './components/ExplainabilityGraphView';
import { MonitorView } from './components/MonitorView';
import { SentinelView } from './components/SentinelView';
import { WalletView } from './components/WalletView';
import { PruebaTransacciones } from './components/PruebaTransacciones';
import { AppStateResponse, EvaluatedTransaction } from './types';

type NavKey = 'wallet' | 'monitor' | 'sentinel' | 'analysts' | 'explainability' | 'architecture';

const USER_NAV_ITEMS: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'wallet', label: 'Billetera Usuario (2FA)', icon: Wallet },
];

const SOC_NAV_ITEMS: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'monitor', label: 'Monitor en Tiempo Real', icon: Activity },
  { key: 'sentinel', label: 'Centinela SHA-256', icon: ShieldCheck },
  { key: 'analysts', label: 'Cola de Analistas', icon: UserCheck },
  { key: 'explainability', label: 'Explicabilidad y Red', icon: Network },
  { key: 'architecture', label: 'Arquitectura Go + Python', icon: Code2 },
];

const NAV_ITEMS = [...USER_NAV_ITEMS, ...SOC_NAV_ITEMS];

export default function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('monitor');
  const [state, setState] = useState<AppStateResponse | null>(null);
  const [selectedTx, setSelectedTx] = useState<EvaluatedTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [burstBanner, setBurstBanner] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const data: AppStateResponse = await res.json();
      setState(data);
    } catch {
      // Ignorar errores transitorios de red
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const handleEvaluateScenario = async (
    scenario: 'normal' | 'sim_swap' | 'phishing' | 'mule' | 'qr_fake',
    amountCop?: number
  ) => {
    setBusy(true);
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, amount_cop: amountCop }),
      });
      if (res.ok) {
        const evaluated: EvaluatedTransaction = await res.json();
        setSelectedTx(evaluated);
        await fetchState();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleInjectAnomaly = async (kind: 'hash_mismatch' | 'replay_attack' | 'phishing_wave') => {
    setBusy(true);
    try {
      const res = await fetch('/api/inject-anomaly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tx_id) {
          setSelectedTx(data);
        }
        await fetchState();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSimulateBurst = async () => {
    setBusy(true);
    setBurstBanner(null);
    try {
      const res = await fetch('/api/simulate-burst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 48 }),
      });
      if (res.ok) {
        const report = await res.json();
        setBurstBanner(
          `Ráfaga concurrente de ${report.count} operaciones completada en ${report.wall_time_ms} ms (${report.effective_tps} TPS efectivos · P95 ${report.p95_latency_ms} ms · SLA < 300 ms ${report.sla_compliant ? 'cumplido' : 'excedido'}).`
        );
        await fetchState();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAnalystFeedback = async (
    txId: string,
    verdict: 'confirmed_fraud' | 'false_positive'
  ) => {
    setBusy(true);
    try {
      await fetch('/api/analyst-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_id: txId, verdict }),
      });
      await fetchState();
    } finally {
      setBusy(false);
    }
  };

  const activeLabel = NAV_ITEMS.find((n) => n.key === activeNav)?.label || 'Monitor';
  const pendingCount = state?.metrics.pending_analyst_count ?? 0;

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Escudo Yuma
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-5" aria-label="Navegación principal">
          <div className="space-y-1">
            <div className="px-3 text-[11px] font-medium text-slate-400">Ambiente Usuario</div>
            {USER_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveNav(item.key)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-400'}`} />
                    <span className="truncate">{item.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1">
            <div className="px-3 text-[11px] font-medium text-slate-400">Ambiente Empresa (SOC)</div>
            {SOC_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveNav(item.key)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-400'}`} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.key === 'analysts' && pendingCount > 0 && (
                    <span className="font-mono text-[11px] font-semibold text-red-700 tabular-nums">
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="font-medium text-slate-700">Yuma Pay S.A. · SEDPE</div>
          <div>Datos sintéticos y anonimizados</div>
          <div>Ley 1581/2012 · PCI DSS · SARLAFT</div>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-full bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="font-display text-base font-bold text-slate-900">Escudo Yuma</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Cerrar menú"
                className="p-1.5 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setActiveNav(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium ${
                      isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1-2 primary actions on right */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir navegación"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs sm:text-sm truncate">
              <span className="text-slate-500 whitespace-nowrap hidden sm:inline">
                {activeNav === 'wallet' ? 'Yuma Pay Usuario' : 'Yuma Pay SOC'}
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 truncate">{activeLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={fetchState}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
            {activeNav === 'wallet' ? (
              <button
                onClick={() => setActiveNav('monitor')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Activity className="w-3.5 h-3.5" />
                Ver en Consola SOC
              </button>
            ) : (
              <button
                onClick={handleSimulateBurst}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5" />
                Simular Ráfaga 150 TPS
              </button>
            )}
          </div>
        </header>

        {/* Main Workspace Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-5">
          {activeNav === 'monitor' && <PruebaTransacciones />}
          {burstBanner && (
            <div className="bg-white border border-slate-200 rounded-md px-4 py-3 flex items-center justify-between gap-4 text-xs text-slate-700">
              <span>{burstBanner}</span>
              <button
                onClick={() => setBurstBanner(null)}
                aria-label="Cerrar notificación"
                className="text-slate-400 hover:text-slate-700 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {!state ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-lg p-5 h-28 animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {activeNav === 'wallet' && (
                <WalletView
                  onTransactionSynced={fetchState}
                  onSwitchToEnterpriseAnalysts={() => setActiveNav('analysts')}
                />
              )}
              {activeNav === 'monitor' && (
                <MonitorView
                  state={state}
                  selectedTx={selectedTx}
                  onSelectTx={setSelectedTx}
                  onEvaluateScenario={handleEvaluateScenario}
                  onInjectAnomaly={handleInjectAnomaly}
                  busy={busy}
                />
              )}
              {activeNav === 'sentinel' && (
                <SentinelView
                  state={state}
                  onInjectAnomaly={handleInjectAnomaly}
                  busy={busy}
                />
              )}
              {activeNav === 'analysts' && (
                <AnalystQueueView
                  state={state}
                  onAnalystFeedback={handleAnalystFeedback}
                  busy={busy}
                />
              )}
              {activeNav === 'explainability' && <ExplainabilityGraphView state={state} />}
              {activeNav === 'architecture' && <ArchitectureCodeView />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
