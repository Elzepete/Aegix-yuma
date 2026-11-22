import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Lock,
  LogOut,
  QrCode,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Store,
  UserPlus,
} from 'lucide-react';
import { EvaluatedTransaction, WalletMovement, WalletStateResponse } from '../types';
import { formatCOP, RiskLevelBadge } from './MonitorView';

interface WalletViewProps {
  onTransactionSynced: () => Promise<void>;
  onSwitchToEnterpriseAnalysts: () => void;
}

const RECIPIENT_PRESETS = [
  {
    id: 'legit_person',
    label: 'Mateo Arbeláez (Contacto habitual)',
    key: '@mateo.arbelaez',
    channel: 'transferencia_llave' as const,
    amount: 180000,
    unverified_qr: false,
    mule: false,
    risk_level: 'BAJO' as const,
    note: '🟢 Riesgo Bajo · Aprobación Inmediata',
  },
  {
    id: 'legit_qr',
    label: 'Café Pergamino Laureles (QR verificado)',
    key: '@pergamino.qr',
    channel: 'pago_qr' as const,
    amount: 64000,
    unverified_qr: false,
    mule: false,
    risk_level: 'BAJO' as const,
    note: '🟢 Riesgo Bajo · Comercio Validado',
  },
  {
    id: 'risk_qr',
    label: 'Comercio QR No Verificado (Prueba 2FA)',
    key: '@comercio.temporal.99',
    channel: 'pago_qr' as const,
    amount: 720000,
    unverified_qr: true,
    mule: false,
    risk_level: 'MEDIO' as const,
    note: '🟡 Riesgo Medio · Desafío Biométrico',
  },
  {
    id: 'risk_mule',
    label: 'Corresponsal Destino Sospechoso (Retención SOC)',
    key: 'corresponsal-mula-01',
    channel: 'retiro_corresponsal' as const,
    amount: 1650000,
    unverified_qr: false,
    mule: true,
    risk_level: 'ALTO' as const,
    note: '🔴 Riesgo Alto · Retención Preventiva',
  },
];
    mule: true,
  },
];

function MovementStatus({ status }: { status: WalletMovement['status'] }) {
  if (status === 'COMPLETADA') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        Completada
      </span>
    );
  }
  if (status === 'PENDIENTE_BIOMETRIA') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Fingerprint className="w-3.5 h-3.5 shrink-0" />
        Requiere Biometría
      </span>
    );
  }
  if (status === 'EN_REVISION_SOC') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        En Revisión SOC
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
      {status === 'RECHAZADA_INTEGRIDAD' ? 'Bloqueada SHA-256' : 'Bloqueada por Fraude'}
    </span>
  );
}

export const WalletView: React.FC<WalletViewProps> = ({
  onTransactionSynced,
  onSwitchToEnterpriseAnalysts,
}) => {
  const [sessionToken, setSessionToken] = useState<string>(() =>
    localStorage.getItem('yuma_wallet_token') || ''
  );
  const [walletState, setWalletState] = useState<WalletStateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<'login' | 'register'>('login');

  // Login 2FA state
  const [phone, setPhone] = useState('+57 314 555 0192');
  const [pin, setPin] = useState('2468');
  const [deviceMode, setDeviceMode] = useState<'trusted' | 'new_device'>('trusted');
  const [simSwapLogin, setSimSwapLogin] = useState(false);
  const [loginChallenge, setLoginChallenge] = useState<{
    login_challenge_id: string;
    account_name?: string;
    totp_preview_code: string;
    new_device_detected: boolean;
    sim_swap_detected: boolean;
  } | null>(null);
  const [loginTotpInput, setLoginTotpInput] = useState('');
  const [loginBiometricOk, setLoginBiometricOk] = useState(false);

  // Digital Onboarding (Register) state
  const [regName, setRegName] = useState('');
  const [regDoc, setRegDoc] = useState('CC-1045992310');
  const [regPhone, setRegPhone] = useState('+57 315 882 4410');
  const [regHandle, setRegHandle] = useState('@nuevo.usuario');
  const [regPin, setRegPin] = useState('4321');
  const [regDeposit, setRegDeposit] = useState('1500000');
  const [regLivenessOk, setRegLivenessOk] = useState(true);
  const [regSpoofTest, setRegSpoofTest] = useState(false);

  // Transaction + 2FA state
  const [channel, setChannel] = useState<'transferencia_llave' | 'pago_qr' | 'retiro_corresponsal'>(
    'transferencia_llave'
  );
  const [recipientLabel, setRecipientLabel] = useState('Mateo Arbeláez (Contacto habitual)');
  const [recipientKey, setRecipientKey] = useState('@mateo.arbelaez');
  const [amountCop, setAmountCop] = useState('180000');
  const [unverifiedQr, setUnverifiedQr] = useState(false);
  const [destMuleFlag, setDestMuleFlag] = useState(false);
  const [txChallenge, setTxChallenge] = useState<{
    tx_challenge_id: string;
    tx_id: string;
    totp_preview_code: string;
    expected_payload_hash: string;
  } | null>(null);
  const [txPinInput, setTxPinInput] = useState('2468');
  const [txTotpInput, setTxTotpInput] = useState('');
  const [txBiometricOk, setTxBiometricOk] = useState(false);
  const [simulateTampering, setSimulateTampering] = useState(false);
  const [lastResult, setLastResult] = useState<{
    movement: WalletMovement;
    evaluation: EvaluatedTransaction;
  } | null>(null);

  const fetchWalletState = useCallback(
    async (tokenOverride?: string) => {
      const tok = tokenOverride ?? sessionToken;
      const res = await fetch('/api/wallet/state', {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (res.ok) {
        const data: WalletStateResponse = await res.json();
        setWalletState(data);
        if (!data.authenticated && tok) {
          localStorage.removeItem('yuma_wallet_token');
          setSessionToken('');
        }
      }
    },
    [sessionToken]
  );

  useEffect(() => {
    fetchWalletState();
  }, [fetchWalletState]);

  const handleInitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      const deviceId =
        deviceMode === 'trusted' ? 'Android-Yuma-Pixel8-A91' : `Unknown-Device-${Date.now().toString(36)}`;
      const res = await fetch('/api/wallet/login/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          pin,
          device_id: deviceId,
          sim_swap_simulated: simSwapLogin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Error iniciando sesión');
        return;
      }
      setLoginChallenge(data);
      setLoginTotpInput('');
      setLoginBiometricOk(false);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginChallenge) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login_challenge_id: loginChallenge.login_challenge_id,
          totp_code: loginTotpInput,
          biometric_verified: loginBiometricOk,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Verificación 2FA fallida');
        return;
      }
      localStorage.setItem('yuma_wallet_token', data.session_token);
      setSessionToken(data.session_token);
      setTxPinInput(pin);
      setLoginChallenge(null);
      setSuccessMsg(null);
      await fetchWalletState(data.session_token);
      await onTransactionSynced();
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: regName,
          document_id: regDoc,
          phone: regPhone,
          handle: regHandle,
          pin: regPin,
          initial_deposit_cop: Number(regDeposit || 1200000),
          biometric_liveness_ok: regLivenessOk,
          simulate_identity_spoofing: regSpoofTest,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Vinculación digital rechazada por Escudo Yuma');
        await onTransactionSynced();
        return;
      }
      setPhone(data.account.phone);
      setPin(data.account.pin);
      setTxPinInput(data.account.pin);
      setEntryMode('login');
      setLoginChallenge(null);
      setSuccessMsg(
        `Persona vinculada en la entidad (${data.account.full_name} · ${data.account.handle}) y verificada en ${data.sentinel_kyc_check.total_latency_ms.toFixed(1)} ms. Ya puedes ingresar con 2FA.`
      );
      await fetchWalletState();
      await onTransactionSynced();
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await fetch('/api/wallet/logout', {
        method: 'POST',
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      });
      localStorage.removeItem('yuma_wallet_token');
      setSessionToken('');
      setTxChallenge(null);
      setLastResult(null);
      await fetchWalletState('');
    } finally {
      setBusy(false);
    }
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = RECIPIENT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setChannel(preset.channel);
    setRecipientLabel(preset.label);
    setRecipientKey(preset.key);
    setAmountCop(String(preset.amount));
    setUnverifiedQr(preset.unverified_qr);
    setDestMuleFlag(preset.mule);
    setTxChallenge(null);
    setErrorMsg(null);
  };

  const handleCreateTxChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLastResult(null);
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/tx/challenge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          channel,
          recipient_label: recipientLabel,
          recipient_key: recipientKey,
          amount_cop: Number(amountCop),
          unverified_qr_merchant: unverifiedQr,
          dest_mule_flag: destMuleFlag,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'No se pudo generar el desafío transaccional');
        return;
      }
      setTxChallenge(data);
      setTxTotpInput('');
      setTxBiometricOk(false);
      setSimulateTampering(false);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txChallenge) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/tx/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          tx_challenge_id: txChallenge.tx_challenge_id,
          pin: txPinInput,
          totp_code: txTotpInput,
          biometric_verified: txBiometricOk,
          simulate_tampering: simulateTampering,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Error confirmando la transacción');
        return;
      }
      setTxChallenge(null);
      setLastResult({
        movement: data.movement,
        evaluation: data.sentinel_evaluation,
      });
      await fetchWalletState();
      await onTransactionSynced();
    } finally {
      setBusy(false);
    }
  };

  const handleStepUpBiometric = async (txId: string, approve: boolean) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/wallet/tx/step-up', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ tx_id: txId, approve }),
      });
      if (res.ok) {
        await fetchWalletState();
        await onTransactionSynced();
      }
    } finally {
      setBusy(false);
    }
  };

  // =========================================================================
  // VISTA NO AUTENTICADA: INGRESO A BILLETERA CON DOBLE IDENTIFICACIÓN (2FA)
  // =========================================================================
  if (!walletState?.authenticated || !walletState.profile) {
    const directory = walletState?.directory || [];
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-blue-700">Billetera Digital Yuma Pay · SEDPE</div>
              <h2 className="text-xl font-display font-semibold text-slate-900 mt-1">
                {entryMode === 'login'
                  ? 'Ingreso con Doble Identificación (2FA)'
                  : 'Registro y Vinculación Digital'}
              </h2>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0 self-start">
              <button
                type="button"
                onClick={() => {
                  setEntryMode('login');
                  setErrorMsg(null);
                }}
                className={`min-h-[36px] px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  entryMode === 'login'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Ingresar (2FA)
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryMode('register');
                  setLoginChallenge(null);
                  setErrorMsg(null);
                }}
                className={`min-h-[36px] px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  entryMode === 'register'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Registrar Persona
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg px-4 py-3">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg px-4 py-3">
              {successMsg}
            </div>
          )}

          {entryMode === 'register' ? (
            <form onSubmit={handleRegisterPerson} className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Simula la apertura de cuenta sintética en Yuma Pay. El Centinela SHA-256 y el motor Python
                validan documento, biometría facial y señales de suplantación antes de activar la cuenta.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="reg-name">
                    Nombre completo (sintético)
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    placeholder="Ej. Sofía Restrepo"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="reg-doc">
                    Documento sintético
                  </label>
                  <input
                    id="reg-doc"
                    type="text"
                    required
                    value={regDoc}
                    onChange={(e) => setRegDoc(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="reg-phone">
                    Número celular
                  </label>
                  <input
                    id="reg-phone"
                    type="text"
                    required
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="reg-handle">
                    Llave Yuma Pay (@alias)
                  </label>
                  <input
                    id="reg-handle"
                    type="text"
                    required
                    value={regHandle}
                    onChange={(e) => setRegHandle(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="reg-pin">
                    PIN de 4 dígitos
                  </label>
                  <input
                    id="reg-pin"
                    type="text"
                    maxLength={4}
                    required
                    value={regPin}
                    onChange={(e) => setRegPin(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="reg-deposit">
                    Depósito inicial sintético (COP)
                  </label>
                  <input
                    id="reg-deposit"
                    type="number"
                    min={50000}
                    step={50000}
                    value={regDeposit}
                    onChange={(e) => setRegDeposit(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <button
                  type="button"
                  onClick={() => setRegLivenessOk((v) => !v)}
                  className={`w-full min-h-[44px] px-4 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                    regLivenessOk
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <Fingerprint className="w-4 h-4" />
                  {regLivenessOk
                    ? 'Biometría facial de vinculación verificada (Liveness OK)'
                    : 'Activar verificación biométrica facial (obligatoria)'}
                </button>

                <label className="flex items-center gap-2.5 text-xs text-red-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={regSpoofTest}
                    onChange={(e) => setRegSpoofTest(e.target.checked)}
                    className="w-4 h-4 rounded border-red-300"
                  />
                  Simular intento de suplantación de identidad / apertura de cuenta mula
                </label>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[48px] bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <UserPlus className="w-4 h-4" />
                Evaluar KYC y Registrar en Yuma Pay
              </button>
            </form>
          ) : !loginChallenge ? (
            <form onSubmit={handleInitLogin} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="wallet-phone">
                    Número celular registrado
                  </label>
                  <input
                    id="wallet-phone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="wallet-pin">
                    Factor 1 · PIN personal (4 dígitos)
                  </label>
                  <input
                    id="wallet-pin"
                    type="password"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="text-xs font-medium text-slate-700">
                  Contexto del dispositivo para pruebas antifraude
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDeviceMode('trusted')}
                    className={`min-h-[44px] px-3.5 py-2.5 text-left rounded-lg border text-xs transition-colors ${
                      deviceMode === 'trusted'
                        ? 'border-blue-700 bg-blue-50/50 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    <div className="font-semibold">Dispositivo habitual confiable</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 font-mono">Android-Yuma-Pixel8-A91</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeviceMode('new_device')}
                    className={`min-h-[44px] px-3.5 py-2.5 text-left rounded-lg border text-xs transition-colors ${
                      deviceMode === 'new_device'
                        ? 'border-amber-600 bg-amber-50/60 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    <div className="font-semibold">Simular dispositivo nuevo</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Reporta alerta al motor Python</div>
                  </button>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={simSwapLogin}
                    onChange={(e) => setSimSwapLogin(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-700"
                  />
                  Simular alerta de cambio reciente de SIM (&lt;24h) en operador móvil
                </label>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[48px] bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" />
                Continuar a Doble Identificación (2FA)
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyLogin} className="space-y-5">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">Autenticador TOTP Enlazado (Sin SMS vulnerable)</span>
                  <span className="font-mono text-slate-500">{loginChallenge.login_challenge_id}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-2xl font-bold tracking-widest text-slate-900 tabular-nums">
                    {loginChallenge.totp_preview_code}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLoginTotpInput(loginChallenge.totp_preview_code)}
                    className="min-h-[40px] px-3 text-xs font-medium text-blue-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md whitespace-nowrap"
                  >
                    Autocompletar TOTP
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700" htmlFor="login-totp">
                  Factor 2A · Ingresa el código TOTP de 6 dígitos
                </label>
                <input
                  id="login-totp"
                  type="text"
                  maxLength={6}
                  placeholder="000000"
                  value={loginTotpInput}
                  onChange={(e) => setLoginTotpInput(e.target.value)}
                  className="w-full min-h-[44px] px-3 text-base font-mono tracking-widest bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-700">
                  Factor 2B · Confirmación biométrica en dispositivo
                </div>
                <button
                  type="button"
                  onClick={() => setLoginBiometricOk(true)}
                  className={`w-full min-h-[48px] px-4 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                    loginBiometricOk
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Fingerprint className="w-4 h-4" />
                  {loginBiometricOk
                    ? 'Biometría verificada correctamente'
                    : 'Validar Huella / Reconocimiento Facial'}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setLoginChallenge(null)}
                  className="min-h-[48px] px-4 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Volver
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 min-h-[48px] bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Verificar e Ingresar a la Billetera
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right Panel: Synthetic Accounts Directory + Security Architecture */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Cuentas Sintéticas Disponibles para Prueba
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Haz clic en cualquier persona registrada para cargar sus datos de ingreso en el formulario.
              </p>
            </div>

            <div className="space-y-2.5">
              {directory.map((acct) => {
                const isSelected = phone.replace(/\s+/g, '') === acct.phone.replace(/\s+/g, '');
                return (
                  <button
                    key={acct.user_id}
                    type="button"
                    onClick={() => {
                      setEntryMode('login');
                      setLoginChallenge(null);
                      setPhone(acct.phone);
                      setPin(acct.pin);
                      setTxPinInput(acct.pin);
                      setErrorMsg(null);
                    }}
                    className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-blue-700 bg-blue-50/50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">{acct.full_name}</span>
                      <span className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCOP(acct.balance_cop)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] font-mono text-slate-600">
                      <span>{acct.phone}</span>
                      <span aria-hidden="true">·</span>
                      <span>PIN: {acct.pin}</span>
                      <span aria-hidden="true">·</span>
                      <span>{acct.handle}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Conexión en Vivo con Escudo Yuma (SOC)
            </h3>
            <ul className="space-y-2.5 text-xs text-slate-600 leading-relaxed">
              <li>
                <span className="font-semibold text-slate-900">Ingreso 2FA:</span> PIN + Token TOTP enlazado + Biometría (sin OTP SMS vulnerable a SIM swapping).
              </li>
              <li>
                <span className="font-semibold text-slate-900">Vinculación Digital:</span> Cada nuevo registro evalúa documento, liveness facial y señales de suplantación en &lt; 300 ms.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Firma Transaccional:</span> Cada envío sella su hash SHA-256 y se sincroniza con la Cola de Analistas SOC.
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VISTA AUTENTICADA: BILLETERA YUMA PAY + DOBLE IDENTIFICACIÓN TRANSACCIONAL
  // =========================================================================
  const { profile, session, movements } = walletState;

  return (
    <div className="space-y-6">
      {/* Top User Identity & Balance Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Account Balance Card */}
        <div className="lg:col-span-5 bg-slate-900 text-white rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs text-slate-300">{profile.full_name} · {profile.handle}</div>
              <div className="text-xs font-mono text-slate-400 mt-0.5">{profile.phone}</div>
            </div>
            <button
              onClick={handleLogout}
              disabled={busy}
              className="min-h-[40px] px-3 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Salir
            </button>
          </div>

          <div>
            <div className="text-xs text-slate-400">Saldo disponible en cuenta</div>
            <div className="text-3xl font-display font-bold tabular-nums font-mono mt-1">
              {formatCOP(profile.balance_cop)}
            </div>
            {profile.held_cop > 0 && (
              <div className="mt-2 text-xs text-amber-300 font-mono tabular-nums">
                En retención preventiva Escudo Yuma: {formatCOP(profile.held_cop)}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              {session?.device_id}
            </span>
            <span className="text-emerald-400 font-medium">2FA Activo ({session?.two_factor_method})</span>
          </div>
        </div>

        {/* Transaction Initiation + 2FA Card */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Enviar Dinero o Pagar con Doble Identificación
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Validación criptográfica SHA-256 + scoring ML antes de debitar tu cuenta
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg px-4 py-3">
              {errorMsg}
            </div>
          )}

          {!txChallenge ? (
            <form onSubmit={handleCreateTxChallenge} className="space-y-4">
              {/* Quick Presets */}
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-600">Destinos rápidos de prueba:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {RECIPIENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleApplyPreset(preset.id)}
                      className={`min-h-[44px] px-3 py-2 text-left rounded-lg border text-xs transition-colors ${
                        recipientKey === preset.key
                          ? 'border-blue-700 bg-blue-50/50 text-slate-900'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="font-medium truncate">{preset.label}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {preset.key} · {formatCOP(preset.amount)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Channel Selector */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'transferencia_llave' as const, label: 'Llave', icon: Send },
                  { id: 'pago_qr' as const, label: 'Pago QR', icon: QrCode },
                  { id: 'retiro_corresponsal' as const, label: 'Corresponsal', icon: Store },
                ].map((ch) => {
                  const Icon = ch.icon;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setChannel(ch.id)}
                      className={`min-h-[44px] px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                        channel === ch.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {ch.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="tx-recipient">
                    Llave, QR o Corresponsal destino
                  </label>
                  <input
                    id="tx-recipient"
                    type="text"
                    value={recipientKey}
                    onChange={(e) => {
                      setRecipientKey(e.target.value);
                      setRecipientLabel(e.target.value);
                    }}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="tx-amount">
                    Monto en COP
                  </label>
                  <input
                    id="tx-amount"
                    type="number"
                    min={1000}
                    step={1000}
                    value={amountCop}
                    onChange={(e) => setAmountCop(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[48px] bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ArrowUpRight className="w-4 h-4" />
                Preparar Operación y Solicitar 2FA
              </button>
            </form>
          ) : (
            <form onSubmit={handleConfirmTx} className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">
                    Autorizando {formatCOP(Number(amountCop))} hacia {recipientKey}
                  </span>
                  <span className="font-mono text-slate-500">{txChallenge.tx_id}</span>
                </div>
                <div className="text-[11px] font-mono text-slate-600 truncate">
                  Sello SHA-256 previo: {txChallenge.expected_payload_hash}
                </div>
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500">Token TOTP de confirmación</div>
                    <div className="font-mono text-xl font-bold tracking-widest text-slate-900 tabular-nums">
                      {txChallenge.totp_preview_code}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTxTotpInput(txChallenge.totp_preview_code)}
                    className="min-h-[40px] px-3 text-xs font-medium text-blue-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md"
                  >
                    Autocompletar TOTP
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="confirm-pin">
                    Factor 1 · PIN Transaccional (4 dígitos)
                  </label>
                  <input
                    id="confirm-pin"
                    type="password"
                    maxLength={4}
                    value={txPinInput}
                    onChange={(e) => setTxPinInput(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="confirm-totp">
                    Factor 2A · Código TOTP (6 dígitos)
                  </label>
                  <input
                    id="confirm-totp"
                    type="text"
                    maxLength={6}
                    placeholder="000000"
                    value={txTotpInput}
                    onChange={(e) => setTxTotpInput(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setTxBiometricOk(true)}
                className={`w-full min-h-[44px] px-4 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                  txBiometricOk
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Fingerprint className="w-4 h-4" />
                {txBiometricOk
                  ? 'Factor 2B · Biometría confirmada'
                  : 'Factor 2B · Firmar con Huella / Rostro'}
              </button>

              <label className="flex items-center gap-2.5 text-xs text-red-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simulateTampering}
                  onChange={(e) => setSimulateTampering(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300"
                />
                Probar defensa del Centinela: alterar monto en tránsito (+$950.000) después de firmar
              </label>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setTxChallenge(null)}
                  className="min-h-[48px] px-4 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 min-h-[48px] bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Lock className="w-4 h-4" />
                  Confirmar Envío con Doble Identificación
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Live Response Banner from Escudo Yuma after a Wallet Transaction */}
      {lastResult && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-mono font-semibold text-slate-900">{lastResult.movement.tx_id}</span>
              <MovementStatus status={lastResult.movement.status} />
              <span className="font-mono text-slate-500 tabular-nums">
                Evaluado en {lastResult.evaluation.total_latency_ms.toFixed(1)} ms
              </span>
            </div>
            <p className="text-xs text-slate-700">{lastResult.movement.action_note}</p>
            <p className="text-[11px] font-mono text-slate-500">
              SHA-256 Verificado: {lastResult.movement.payload_hash.slice(0, 24)}… · Riesgo ML:{' '}
              {(lastResult.evaluation.risk_score * 100).toFixed(1)}%
            </p>
          </div>
          {lastResult.movement.status === 'EN_REVISION_SOC' && (
            <button
              onClick={onSwitchToEnterpriseAnalysts}
              className="min-h-[44px] px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
            >
              Revisar en Consola Empresa (SOC)
            </button>
          )}
        </div>
      )}

      {/* User Movements Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Movimientos de tu Billetera</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cada movimiento refleja en tiempo real la decisión de Escudo Yuma y del equipo SOC
            </p>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {movements.map((mov) => (
            <div
              key={mov.id}
              className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{mov.recipient_label}</span>
                  <span className="text-xs font-mono text-slate-400">{mov.tx_id}</span>
                </div>
                <div className="text-xs text-slate-500">{mov.action_note}</div>
                <div className="text-[11px] font-mono text-slate-400 truncate">
                  SHA-256: {mov.payload_hash.slice(0, 20)}… · Latencia {mov.latency_ms.toFixed(1)} ms
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                <div className="text-sm font-mono font-semibold text-slate-900 tabular-nums">
                  -{formatCOP(mov.amount_cop)}
                </div>
                <MovementStatus status={mov.status} />
                {mov.status === 'PENDIENTE_BIOMETRIA' && (
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      disabled={busy}
                      onClick={() => handleStepUpBiometric(mov.tx_id, true)}
                      className="min-h-[36px] px-3 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
                    >
                      Confirmar Biometría
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => handleStepUpBiometric(mov.tx_id, false)}
                      className="min-h-[36px] px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
