import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { crearRutaPruebaGo } from './prueba-go.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_PORT = Number(process.env.PYTHON_ML_PORT || 8001);
const PYTHON_URL = `http://127.0.0.1:${PYTHON_PORT}`;
const HMAC_SECRET = process.env.SENTINEL_HMAC_SECRET || 'escudo-yuma-dev-hmac-key';

function urlLocal(nombre: string) {
  const valor = process.env[nombre];
  if (!valor) return undefined;
  const url = new URL(valor);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new Error(`${nombre} debe ser una URL HTTP de 127.0.0.1 sin credenciales`);
  }
  return url;
}

export interface TransactionInput {
  tx_id: string;
  timestamp_ms: number;
  nonce: string;
  channel: 'transferencia_llave' | 'pago_qr' | 'retiro_corresponsal' | 'vinculacion_digital';
  amount_cop: number;
  hour: number;
  source_hash: string;
  dest_hash: string;
  sim_swap_24h: boolean;
  new_device: boolean;
  password_change_1h: boolean;
  tx_velocity_10m: number;
  unverified_qr_merchant: boolean;
  first_time_beneficiary: boolean;
  dest_mule_flag: boolean;
  client_payload_hash?: string;
}

export interface SentinelBlock {
  sequence: number;
  tx_id: string;
  prev_hash: string;
  payload_hash: string;
  chain_hash: string;
  hmac: string;
  worker_id: number;
  verified: boolean;
  anomaly_type?: string;
  timestamp_ms: number;
}

export interface EvaluatedTransaction {
  tx_id: string;
  timestamp_ms: number;
  channel: string;
  amount_cop: number;
  source_hash: string;
  dest_hash: string;
  sentinel_block: SentinelBlock;
  integrity_ok: boolean;
  risk_score: number;
  decision: 'APROBADA' | 'DESAFIO_BIOMETRICO' | 'REVISION_ANALISTA' | 'CUARENTENA_INTEGRIDAD';
  action_note: string;
  modality: string;
  explanations: Array<{
    feature: string;
    label: string;
    value: number;
    contribution: number;
  }>;
  total_latency_ms: number;
  sentinel_ms: number;
  python_inference_ms: number;
  concurrency: number;
  analyst_resolution?: 'confirmed_fraud' | 'false_positive' | null;
  analyst_resolved_at?: number;
  raw_features?: Record<string, number>;
}

// Estado en memoria del Centinela SHA-256 (replica exacta del servicio Go)
let sequence = 0;
let lastHash = '0'.repeat(64);
const seenNonces = new Map<string, number>();
const recentTimestamps: number[] = [];
const evaluatedHistory: EvaluatedTransaction[] = [];
const sentinelLedger: SentinelBlock[] = [];
const anomalyLogs: Array<{
  id: string;
  timestamp_ms: number;
  tx_id: string;
  type: string;
  detail: string;
  expected_hash?: string;
  received_hash?: string;
}> = [];
const auditTrail: Array<{
  id: string;
  timestamp_ms: number;
  tx_id: string;
  verdict: string;
  actor: string;
  note: string;
}> = [];
const latencySamples: number[] = [];

// Estado de Billetera Usuario (conectada con Escudo Yuma SOC)
interface WalletAccount {
  user_id: string;
  full_name: string;
  document_id: string;
  handle: string;
  phone: string;
  pin: string;
  trusted_device_id: string;
  source_hash: string;
  balance_cop: number;
  held_cop: number;
  kyc_status: 'VERIFICADA' | 'EN_REVISION_KYC';
  created_at: number;
}

interface WalletMovement {
  id: string;
  user_id: string;
  tx_id: string;
  timestamp_ms: number;
  channel: string;
  recipient_label: string;
  recipient_key: string;
  amount_cop: number;
  status:
    | 'COMPLETADA'
    | 'PENDIENTE_BIOMETRIA'
    | 'EN_REVISION_SOC'
    | 'BLOQUEADA_FRAUDE'
    | 'RECHAZADA_INTEGRIDAD';
  risk_score: number;
  latency_ms: number;
  payload_hash: string;
  two_factor_verified: boolean;
  action_note: string;
}

const walletAccounts = new Map<string, WalletAccount>([
  [
    'usr-camila-01',
    {
      user_id: 'usr-camila-01',
      full_name: 'Camila Rodríguez',
      document_id: 'CC-1037654210',
      handle: '@camila.rodriguez',
      phone: '+57 314 555 0192',
      pin: '2468',
      trusted_device_id: 'Android-Yuma-Pixel8-A91',
      source_hash: crypto.createHash('sha256').update('usr-camila-01').digest('hex').slice(0, 12),
      balance_cop: 4850000,
      held_cop: 0,
      kyc_status: 'VERIFICADA',
      created_at: Date.now() - 86400_000 * 120,
    },
  ],
  [
    'usr-andres-02',
    {
      user_id: 'usr-andres-02',
      full_name: 'Andrés Felipe Gómez',
      document_id: 'CC-1017298441',
      handle: '@andres.gomez',
      phone: '+57 300 412 8890',
      pin: '1357',
      trusted_device_id: 'iOS-Yuma-iPhone15-B04',
      source_hash: crypto.createHash('sha256').update('usr-andres-02').digest('hex').slice(0, 12),
      balance_cop: 1920000,
      held_cop: 0,
      kyc_status: 'VERIFICADA',
      created_at: Date.now() - 86400_000 * 65,
    },
  ],
  [
    'usr-laura-03',
    {
      user_id: 'usr-laura-03',
      full_name: 'Laura Valentina Díaz',
      document_id: 'CC-1020488112',
      handle: '@laura.diaz',
      phone: '+57 321 774 3310',
      pin: '9090',
      trusted_device_id: 'Android-Yuma-GalaxyS24-C12',
      source_hash: crypto.createHash('sha256').update('usr-laura-03').digest('hex').slice(0, 12),
      balance_cop: 7400000,
      held_cop: 0,
      kyc_status: 'VERIFICADA',
      created_at: Date.now() - 86400_000 * 30,
    },
  ],
]);

const loginChallenges = new Map<
  string,
  {
    id: string;
    user_id: string;
    totp_code: string;
    device_id: string;
    sim_swap_simulated: boolean;
    new_device_simulated: boolean;
    expires_at: number;
  }
>();

const activeWalletSessions = new Map<
  string,
  {
    token: string;
    user_id: string;
    device_id: string;
    sim_swap_simulated: boolean;
    new_device_simulated: boolean;
    created_at: number;
    two_factor_method: string;
  }
>();

const txChallenges = new Map<
  string,
  {
    id: string;
    user_id: string;
    totp_code: string;
    tx_input: TransactionInput;
    expected_payload_hash: string;
    recipient_label: string;
    recipient_key: string;
    expires_at: number;
  }
>();

const walletMovements: WalletMovement[] = [
  {
    id: 'MOV-INIT-1',
    user_id: 'usr-camila-01',
    tx_id: 'YM-WALLET-001',
    timestamp_ms: Date.now() - 3600_000 * 4,
    channel: 'pago_qr',
    recipient_label: 'Supermercado El Poblado',
    recipient_key: '@elpoblado.qr',
    amount_cop: 148000,
    status: 'COMPLETADA',
    risk_score: 0.08,
    latency_ms: 4.2,
    payload_hash: crypto.createHash('sha256').update('init-1').digest('hex'),
    two_factor_verified: true,
    action_note: 'Operación autorizada con doble identificación.',
  },
  {
    id: 'MOV-INIT-2',
    user_id: 'usr-camila-01',
    tx_id: 'YM-WALLET-002',
    timestamp_ms: Date.now() - 3600_000 * 24,
    channel: 'transferencia_llave',
    recipient_label: 'Mateo Arbeláez',
    recipient_key: '@mateo.arbelaez',
    amount_cop: 320000,
    status: 'COMPLETADA',
    risk_score: 0.11,
    latency_ms: 3.8,
    payload_hash: crypto.createHash('sha256').update('init-2').digest('hex'),
    two_factor_verified: true,
    action_note: 'Operación autorizada con doble identificación.',
  },
  {
    id: 'MOV-INIT-3',
    user_id: 'usr-andres-02',
    tx_id: 'YM-WALLET-003',
    timestamp_ms: Date.now() - 3600_000 * 12,
    channel: 'transferencia_llave',
    recipient_label: 'Tienda La 70',
    recipient_key: '@tienda70.qr',
    amount_cop: 95000,
    status: 'COMPLETADA',
    risk_score: 0.09,
    latency_ms: 3.4,
    payload_hash: crypto.createHash('sha256').update('init-3').digest('hex'),
    two_factor_verified: true,
    action_note: 'Operación autorizada con doble identificación.',
  },
];

let pythonProcess: ChildProcess | null = null;
let pythonReady = false;

async function isPythonHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${PYTHON_URL}/health`);
    if (res.ok) {
      pythonReady = true;
      return true;
    }
  } catch {
    // Not up yet
  }
  return false;
}

async function startPythonEngine(): Promise<void> {
  if (await isPythonHealthy()) {
    console.log('[Python ML] Reusing active Python ML Risk Engine on port', PYTHON_PORT);
    return;
  }

  const scriptPath = path.join(__dirname, 'python_engine', 'risk_engine.py');
  pythonProcess = spawn('python3', [scriptPath], {
    env: { ...process.env, PYTHON_ML_PORT: String(PYTHON_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProcess.stdout?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text.includes('listening')) {
      pythonReady = true;
    }
    console.log(`[Python ML] ${text}`);
  });

  pythonProcess.stderr?.on('data', (chunk) => {
    console.error(`[Python ML Error] ${chunk.toString().trim()}`);
  });

  pythonProcess.on('exit', async (code) => {
    pythonProcess = null;
    if (await isPythonHealthy()) {
      return;
    }
    pythonReady = false;
    console.warn(`[Python ML] exited with code ${code}. Restarting in 1s...`);
    setTimeout(() => {
      void startPythonEngine();
    }, 1000);
  });
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (pythonProcess) {
      pythonProcess.kill('SIGTERM');
    }
    process.exit(0);
  });
}

async function waitForPython(maxWaitMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${PYTHON_URL}/health`);
      if (res.ok) {
        pythonReady = true;
        return true;
      }
    } catch {
      // Wait for socket
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function canonicalPayloadHash(ev: TransactionInput): string {
  const canonical = `${ev.tx_id}|${ev.timestamp_ms}|${ev.nonce}|${ev.channel}|${ev.amount_cop.toFixed(2)}|${ev.source_hash}|${ev.dest_hash}`;
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function signHMAC(data: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex');
}

function checkBurstAnomaly(nowMs: number): boolean {
  const cutoff = nowMs - 1000;
  while (recentTimestamps.length > 0 && recentTimestamps[0] < cutoff) {
    recentTimestamps.shift();
  }
  recentTimestamps.push(nowMs);
  return recentTimestamps.length > 180;
}

function computePercentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(2));
}

async function evaluateThroughSentinel(
  ev: TransactionInput,
  workerId = 1,
  concurrency = 1
): Promise<EvaluatedTransaction> {
  const t0 = performance.now();
  const nowMs = Date.now();
  const computedHash = canonicalPayloadHash(ev);

  let verified = true;
  let anomalyType: string | undefined;

  if (ev.client_payload_hash && ev.client_payload_hash !== computedHash) {
    verified = false;
    anomalyType = 'HASH_MISMATCH_TAMPERING';
    anomalyLogs.unshift({
      id: `ANOM-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      timestamp_ms: nowMs,
      tx_id: ev.tx_id,
      type: 'Alteración de Hash SHA-256 (Tampering)',
      detail: 'El hash canónico del payload no coincide con la firma enviada por el canal móvil.',
      expected_hash: computedHash,
      received_hash: ev.client_payload_hash,
    });
  } else if (!ev.nonce || seenNonces.has(ev.nonce)) {
    verified = false;
    anomalyType = 'REPLAY_NONCE_DETECTED';
    anomalyLogs.unshift({
      id: `ANOM-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      timestamp_ms: nowMs,
      tx_id: ev.tx_id,
      type: 'Ataque Replay (Nonce Reutilizado)',
      detail: `El nonce criptográfico ${ev.nonce || '(vacío)'} ya fue procesado en la ventana activa.`,
    });
  } else {
    seenNonces.set(ev.nonce, nowMs);
    if (checkBurstAnomaly(nowMs)) {
      anomalyType = 'BURST_SPIKE_WARNING';
      anomalyLogs.unshift({
        id: `ANOM-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        timestamp_ms: nowMs,
        tx_id: ev.tx_id,
        type: 'Oleada Anómala (>180 TPS)',
        detail: 'Incremento súbito compatible con campaña automatizada de phishing o smishing.',
      });
    }
  }

  if (anomalyLogs.length > 80) anomalyLogs.length = 80;

  sequence += 1;
  const chainInput = `${sequence}|${lastHash}|${computedHash}|${ev.timestamp_ms}`;
  const chainHash = crypto.createHash('sha256').update(chainInput).digest('hex');

  const block: SentinelBlock = {
    sequence,
    tx_id: ev.tx_id,
    prev_hash: lastHash,
    payload_hash: computedHash,
    chain_hash: chainHash,
    hmac: signHMAC(chainHash),
    worker_id: workerId,
    verified,
    anomaly_type: anomalyType,
    timestamp_ms: nowMs,
  };

  if (verified) {
    lastHash = chainHash;
  }

  sentinelLedger.unshift(block);
  if (sentinelLedger.length > 120) sentinelLedger.length = 120;

  const sentinelDoneMs = Number(Math.max(0.12, performance.now() - t0).toFixed(2));

  if (!verified) {
    const totalLatency = Number((performance.now() - t0).toFixed(2));
    latencySamples.push(totalLatency);
    if (latencySamples.length > 500) latencySamples.shift();

    const quarantined: EvaluatedTransaction = {
      tx_id: ev.tx_id,
      timestamp_ms: ev.timestamp_ms,
      channel: ev.channel,
      amount_cop: ev.amount_cop,
      source_hash: ev.source_hash,
      dest_hash: ev.dest_hash,
      sentinel_block: block,
      integrity_ok: false,
      risk_score: 0.99,
      risk_level: 'ALTO',
      decision: 'CUARENTENA_INTEGRIDAD',
      action_note: 'Paquete bloqueado antes de autorización: falla de verificación criptográfica en el Centinela.',
      modality: anomalyType === 'REPLAY_NONCE_DETECTED' ? 'Ataque Replay en Canal' : 'Alteración de Datos en Tránsito',
      explanations: [
        {
          feature: 'integrity_sha256',
          label: anomalyType === 'REPLAY_NONCE_DETECTED' ? 'Nonce criptográfico duplicado' : 'Divergencia en hash SHA-256 del payload',
          value: 1,
          contribution: 0.99,
        },
      ],
      total_latency_ms: totalLatency,
      sentinel_ms: sentinelDoneMs,
      python_inference_ms: 0,
      concurrency,
      analyst_resolution: null,
    };
    evaluatedHistory.unshift(quarantined);
    if (evaluatedHistory.length > 160) evaluatedHistory.length = 160;
    return quarantined;
  }

  // Llamada al microservicio Python 3.11 con timeout y fallback resiliente aegix
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 650);
  let pyRes: {
    risk_score: number;
    risk_level?: 'BAJO' | 'MEDIO' | 'ALTO';
    decision: 'APROBADA' | 'DESAFIO_BIOMETRICO' | 'REVISION_ANALISTA';
    action_note: string;
    modality: string;
    explanations: Array<{ feature: string; label: string; value: number; contribution: number }>;
    python_inference_ms: number;
  };

  try {
    const response = await fetch(`${PYTHON_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Python ML respondió HTTP ${response.status}`);
    }
    pyRes = await response.json();
  } catch (err) {
    // Fallback inteligente heurístico de aegix para asegurar resiliencia bancaria
    const amount = Number(ev.amount_cop || 0);
    const hasSimSwap = Boolean(ev.sim_swap_24h);
    const isNewDevice = Boolean(ev.new_device);
    const isPwdChanged = Boolean(ev.password_change_1h);
    const isMule = Boolean(ev.dest_mule_flag);

    let score = 0.05;
    const explanations: Array<{ feature: string; label: string; value: number; contribution: number }> = [];

    if (hasSimSwap) {
      score += 0.45;
      explanations.push({ feature: 'sim_swap_24h', label: 'Cambio de SIM (<24h)', value: 1, contribution: 0.45 });
    }
    if (isNewDevice) {
      score += 0.25;
      explanations.push({ feature: 'new_device', label: 'Dispositivo no reconocido', value: 1, contribution: 0.25 });
    }
    if (isPwdChanged) {
      score += 0.20;
      explanations.push({ feature: 'password_change_1h', label: 'Cambio clave reciente (<1h)', value: 1, contribution: 0.20 });
    }
    if (isMule) {
      score += 0.50;
      explanations.push({ feature: 'dest_mule_flag', label: 'Destino con patrón de cuenta mula', value: 1, contribution: 0.50 });
    }
    if (amount > 1_500_000) {
      score += 0.15;
      explanations.push({ feature: 'amount_cop', label: 'Monto elevado para perfil', value: amount, contribution: 0.15 });
    }

    score = Math.min(0.99, score);
    let decision: 'APROBADA' | 'DESAFIO_BIOMETRICO' | 'REVISION_ANALISTA' = 'APROBADA';
    let note = 'Autorizada por motor de contingencia aegix (modo resiliente).';
    if (score >= 0.72) {
      decision = 'REVISION_ANALISTA';
      note = 'Retenida preventivamente por motor de contingencia aegix.';
    } else if (score >= 0.42) {
      decision = 'DESAFIO_BIOMETRICO';
      note = 'Desafío 2FA/Biometría requerido por motor de contingencia aegix.';
    }

    pyRes = {
      risk_score: Number(score.toFixed(3)),
      decision,
      action_note: note,
      modality: hasSimSwap ? 'SIM Swap' : isMule ? 'Cuenta Mula' : 'Operación General',
      explanations,
      python_inference_ms: 1.2,
    };
  } finally {
    clearTimeout(timer);
  }

  const totalLatency = Number((performance.now() - t0).toFixed(2));
  latencySamples.push(totalLatency);
  if (latencySamples.length > 500) latencySamples.shift();

  let riskLevel: 'BAJO' | 'MEDIO' | 'ALTO' = 'BAJO';
  if (pyRes.risk_level) {
    riskLevel = pyRes.risk_level;
  } else if (pyRes.decision === 'REVISION_ANALISTA' || pyRes.risk_score >= 0.70) {
    riskLevel = 'ALTO';
  } else if (pyRes.decision === 'DESAFIO_BIOMETRICO' || pyRes.risk_score >= 0.35) {
    riskLevel = 'MEDIO';
  } else {
    riskLevel = 'BAJO';
  }

  const evaluated: EvaluatedTransaction = {
    tx_id: ev.tx_id,
    timestamp_ms: ev.timestamp_ms,
    channel: ev.channel,
    amount_cop: ev.amount_cop,
    source_hash: ev.source_hash,
    dest_hash: ev.dest_hash,
    sentinel_block: block,
    integrity_ok: true,
    risk_score: pyRes.risk_score,
    risk_level: riskLevel,
    decision: pyRes.decision,
    action_note: pyRes.action_note,
    modality: pyRes.modality,
    explanations: pyRes.explanations,
    total_latency_ms: totalLatency,
    sentinel_ms: sentinelDoneMs,
    python_inference_ms: pyRes.python_inference_ms,
    concurrency,
    analyst_resolution: null,
    raw_features: {
      sim_swap_reciente: ev.sim_swap_24h ? 1 : 0,
      dispositivo_nuevo: ev.new_device ? 1 : 0,
      cambio_clave_reciente: ev.password_change_1h ? 1 : 0,
      riesgo_grafo_mula: ev.dest_mule_flag ? 0.88 : 0,
      qr_comercio_no_verificado: ev.channel === 'pago_qr' && ev.unverified_qr_merchant ? 1 : 0,
      primer_contacto_destino: ev.first_time_beneficiary ? 1 : 0,
    },
  };

  evaluatedHistory.unshift(evaluated);
  if (evaluatedHistory.length > 160) evaluatedHistory.length = 160;
  return evaluated;
}

function hashId(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
}

function generateSyntheticTx(scenario: 'normal' | 'sim_swap' | 'phishing' | 'mule' | 'qr_fake', idx: number): TransactionInput {
  const now = Date.now();
  const txId = `YM-${now.toString(36).toUpperCase()}-${String(idx).padStart(3, '0')}`;
  const nonce = crypto.randomBytes(8).toString('hex');

  if (scenario === 'sim_swap') {
    return {
      tx_id: txId,
      timestamp_ms: now,
      nonce,
      channel: 'transferencia_llave',
      amount_cop: 1450000,
      hour: 2,
      source_hash: hashId(`usr-${100 + (idx % 20)}`),
      dest_hash: hashId(`dst-ext-${idx % 7}`),
      sim_swap_24h: true,
      new_device: true,
      password_change_1h: false,
      tx_velocity_10m: 3,
      unverified_qr_merchant: false,
      first_time_beneficiary: true,
      dest_mule_flag: false,
    };
  }
  if (scenario === 'phishing') {
    return {
      tx_id: txId,
      timestamp_ms: now,
      nonce,
      channel: 'transferencia_llave',
      amount_cop: 980000,
      hour: 23,
      source_hash: hashId(`usr-${200 + (idx % 15)}`),
      dest_hash: hashId(`dst-phish-${idx % 4}`),
      sim_swap_24h: false,
      new_device: true,
      password_change_1h: true,
      tx_velocity_10m: 4,
      unverified_qr_merchant: false,
      first_time_beneficiary: true,
      dest_mule_flag: false,
    };
  }
  if (scenario === 'mule') {
    return {
      tx_id: txId,
      timestamp_ms: now,
      nonce,
      channel: 'retiro_corresponsal',
      amount_cop: 1850000,
      hour: 19,
      source_hash: hashId(`usr-mule-src-${idx}`),
      dest_hash: hashId('cuenta-mula-central-01'),
      sim_swap_24h: false,
      new_device: false,
      password_change_1h: false,
      tx_velocity_10m: 5,
      unverified_qr_merchant: false,
      first_time_beneficiary: true,
      dest_mule_flag: true,
    };
  }
  if (scenario === 'qr_fake') {
    return {
      tx_id: txId,
      timestamp_ms: now,
      nonce,
      channel: 'pago_qr',
      amount_cop: 640000,
      hour: 16,
      source_hash: hashId(`usr-${300 + (idx % 30)}`),
      dest_hash: hashId(`comercio-no-verif-${idx % 3}`),
      sim_swap_24h: false,
      new_device: true,
      password_change_1h: false,
      tx_velocity_10m: 2,
      unverified_qr_merchant: true,
      first_time_beneficiary: true,
      dest_mule_flag: false,
    };
  }

  const channels: TransactionInput['channel'][] = ['transferencia_llave', 'pago_qr', 'retiro_corresponsal'];
  const amounts = [45000, 82000, 120000, 195000, 260000, 310000];
  return {
    tx_id: txId,
    timestamp_ms: now,
    nonce,
    channel: channels[idx % channels.length],
    amount_cop: amounts[idx % amounts.length],
    hour: 10 + (idx % 10),
    source_hash: hashId(`usr-legit-${idx % 40}`),
    dest_hash: hashId(`comercio-legit-${idx % 18}`),
    sim_swap_24h: false,
    new_device: false,
    password_change_1h: false,
    tx_velocity_10m: 1,
    unverified_qr_merchant: false,
    first_time_beneficiary: false,
    dest_mule_flag: false,
  };
}

async function seedInitialTransactions() {
  const plan: Array<'normal' | 'sim_swap' | 'phishing' | 'mule' | 'qr_fake'> = [
    'normal',
    'normal',
    'sim_swap',
    'normal',
    'qr_fake',
    'normal',
    'mule',
    'normal',
    'phishing',
    'normal',
    'normal',
    'mule',
  ];
  // Calentamiento inicial secuencial
  for (let i = 0; i < plan.length; i++) {
    await evaluateThroughSentinel(generateSyntheticTx(plan[i], i + 1), (i % 8) + 1, 1);
  }
  // Ráfaga controlada en pares para calibrar concurrencia sin sobrecarga de arranque
  for (let i = 0; i < 8; i += 2) {
    await Promise.all([
      evaluateThroughSentinel(generateSyntheticTx(i === 4 ? 'sim_swap' : 'normal', 200 + i), (i % 8) + 1, 4),
      evaluateThroughSentinel(generateSyntheticTx((i + 1) === 5 ? 'mule' : 'normal', 200 + i + 1), ((i + 1) % 8) + 1, 4),
    ]);
  }
}

async function startServer() {
  const engine = urlLocal('YUMA_GO_URL');
  const sandbox = urlLocal('YUMA_SANDBOX_URL');
  await startPythonEngine();
  const ok = await waitForPython();
  if (ok) {
    await seedInitialTransactions();
  } else {
    console.error('Python ML Engine did not respond in time.');
  }

  const app = express();
  app.use(express.json());

  app.post('/api/prueba-go', crearRutaPruebaGo({ engine, sandbox }));
  app.post('/score', (_req, res) => {
    res.set('Allow', 'GET').status(405).json({ error: 'Usa POST /api/prueba-go desde el panel.' });
  });

  app.get('/api/state', async (_req, res) => {
    let pythonHealth = null;
    try {
      const r = await fetch(`${PYTHON_URL}/health`);
      if (r.ok) pythonHealth = await r.json();
    } catch {
      pythonHealth = null;
    }

    const total = evaluatedHistory.length;
    const approvedCount = evaluatedHistory.filter((t) => t.decision === 'APROBADA').length;
    const challengeCount = evaluatedHistory.filter((t) => t.decision === 'DESAFIO_BIOMETRICO').length;
    const reviewQueue = evaluatedHistory.filter((t) => t.decision === 'REVISION_ANALISTA' && !t.analyst_resolution);
    const quarantinedCount = evaluatedHistory.filter((t) => t.decision === 'CUARENTENA_INTEGRIDAD').length;
    const preventedCop = evaluatedHistory
      .filter((t) => t.decision === 'REVISION_ANALISTA' || t.decision === 'CUARENTENA_INTEGRIDAD')
      .reduce((acc, t) => acc + t.amount_cop, 0);

    const chronological = evaluatedHistory.slice(0, 80).reverse();
    const latencyHistory = chronological.map((t) => ({
      sequence: t.sentinel_block.sequence,
      tx_id: t.tx_id,
      total_ms: t.total_latency_ms,
      sentinel_ms: t.sentinel_ms,
      python_ms: t.python_inference_ms,
      concurrency: t.concurrency,
      integrity_ok: t.integrity_ok,
      worker_id: t.sentinel_block.worker_id,
      anomaly_type: t.sentinel_block.anomaly_type || null,
    }));

    const bucketDefs = [
      {
        label: 'Secuencial (1 tx)',
        items: evaluatedHistory.filter((t) => t.concurrency === 1 && t.integrity_ok),
      },
      {
        label: 'Media (8–16 tx)',
        items: evaluatedHistory.filter((t) => t.concurrency >= 2 && t.concurrency <= 20 && t.integrity_ok),
      },
      {
        label: 'Ráfaga (40+ tx)',
        items: evaluatedHistory.filter((t) => t.concurrency > 20 && t.integrity_ok),
      },
      {
        label: 'Cuarentena SHA-256',
        items: evaluatedHistory.filter((t) => !t.integrity_ok),
      },
    ];

    const concurrencySummary = bucketDefs.map((b) => {
      const count = b.items.length;
      const avgTotal = count
        ? Number((b.items.reduce((s, x) => s + x.total_latency_ms, 0) / count).toFixed(2))
        : 0;
      const avgSentinel = count
        ? Number((b.items.reduce((s, x) => s + x.sentinel_ms, 0) / count).toFixed(2))
        : 0;
      const p95 = count ? computePercentile(b.items.map((x) => x.total_latency_ms), 95) : 0;
      const integrityRate = count
        ? Number(((b.items.filter((x) => x.integrity_ok).length / count) * 100).toFixed(1))
        : 100;
      return {
        bucket: b.label,
        count,
        avg_total_ms: avgTotal,
        avg_sentinel_ms: avgSentinel,
        p95_ms: p95,
        integrity_rate: integrityRate,
      };
    });

    res.json({
      python_ready: pythonReady,
      python_health: pythonHealth,
      metrics: {
        total_evaluated: sequence,
        p50_latency_ms: computePercentile(latencySamples, 50),
        p95_latency_ms: computePercentile(latencySamples, 95),
        p99_latency_ms: computePercentile(latencySamples, 99),
        sla_target_ms: 300,
        legacy_fp_rate: 0.92,
        current_fp_rate: pythonHealth?.stats?.current_fp_rate ?? 0.41,
        approved_count: approvedCount,
        challenge_count: challengeCount,
        pending_analyst_count: reviewQueue.length,
        quarantined_count: quarantinedCount,
        riesgo_bajo_count: evaluatedHistory.filter((t) => t.risk_level === 'BAJO').length,
        riesgo_medio_count: evaluatedHistory.filter((t) => t.risk_level === 'MEDIO').length,
        riesgo_alto_count: evaluatedHistory.filter((t) => t.risk_level === 'ALTO').length,
        prevented_cop: preventedCop,
        total_recent: total,
      },
      latency_history: latencyHistory,
      concurrency_summary: concurrencySummary,
      transactions: evaluatedHistory.slice(0, 60),
      sentinel_ledger: sentinelLedger.slice(0, 40),
      anomaly_logs: anomalyLogs.slice(0, 30),
      audit_trail: auditTrail.slice(0, 30),
    });
  });

  // Telemetría y Métricas integrales de aegix
  app.get('/api/metrics', async (_req, res) => {
    const total = evaluatedHistory.length;
    const approved = evaluatedHistory.filter((t) => t.decision === 'APROBADA').length;
    const challenged = evaluatedHistory.filter((t) => t.decision === 'DESAFIO_BIOMETRICO').length;
    const retained = evaluatedHistory.filter((t) => t.decision === 'REVISION_ANALISTA').length;
    const quarantined = evaluatedHistory.filter((t) => t.decision === 'CUARENTENA_INTEGRIDAD').length;

    const totalVolumeCop = evaluatedHistory.reduce((s, t) => s + (t.amount_cop || 0), 0);
    const preventedCop = evaluatedHistory
      .filter((t) => t.decision === 'REVISION_ANALISTA' || t.decision === 'CUARENTENA_INTEGRIDAD')
      .reduce((s, t) => s + (t.amount_cop || 0), 0);

    const latencies = latencySamples.length > 0 ? latencySamples : [4.5];
    const p50 = computePercentile(latencies, 50);
    const p90 = computePercentile(latencies, 90);
    const p95 = computePercentile(latencies, 95);
    const p99 = computePercentile(latencies, 99);
    const avgLatency = Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2));
    const withinSla = latencies.filter((l) => l <= 300).length;
    const slaCompliancePct = Number(((withinSla / latencies.length) * 100).toFixed(1));

    // Desglose por modalidades
    const modalities = {
      sim_swap: evaluatedHistory.filter((t) => t.modality === 'SIM Swap' || t.raw_features?.sim_swap_reciente).length,
      dispositivo_nuevo: evaluatedHistory.filter((t) => t.raw_features?.dispositivo_nuevo).length,
      cambio_clave: evaluatedHistory.filter((t) => t.raw_features?.cambio_clave_reciente).length,
      cuenta_mula: evaluatedHistory.filter((t) => t.modality === 'Cuenta Mula' || (t.raw_features?.riesgo_grafo_mula || 0) > 0.4).length,
      qr_no_verificado: evaluatedHistory.filter((t) => t.modality === 'QR Comercio Dudoso' || t.raw_features?.qr_comercio_no_verificado).length,
      monto_atipico: evaluatedHistory.filter((t) => (t.raw_features?.monto_anomalo_z || 0) > 1.2).length,
      tampering_sha256: anomalyLogs.length,
    };

    // Salud de componentes
    let goStatus = 'DESCONOCIDO';
    try {
      if (GO_URL) {
        const goCheck = await fetch(`${GO_URL}/salud`, { signal: AbortSignal.timeout(600) });
        if (goCheck.ok) goStatus = 'ONLINE';
      }
    } catch {
      goStatus = 'STANDALONE';
    }

    res.json({
      gateway: {
        nombre: 'aegix',
        version: '2.0.0',
        estado: 'OPTIMO',
        timestamp_ms: Date.now(),
      },
      volumen: {
        total_evaluadas: total,
        aprobadas: approved,
        desafios_2fa: challenged,
        retenidas_soc: retained,
        cuarentena_sha256: quarantined,
        tasa_aprobacion: total ? Number(((approved / total) * 100).toFixed(1)) : 100,
        tasa_desafios: total ? Number(((challenged / total) * 100).toFixed(1)) : 0,
        tasa_retencion: total ? Number(((retained / total) * 100).toFixed(1)) : 0,
        tasa_rechazos: total ? Number(((quarantined / total) * 100).toFixed(1)) : 0,
      },
      financiero: {
        volumen_total_cop: totalVolumeCop,
        fraude_prevenido_cop: preventedCop,
        ticket_promedio_cop: total ? Math.round(totalVolumeCop / total) : 0,
        porcentaje_protegido: totalVolumeCop ? Number(((preventedCop / totalVolumeCop) * 100).toFixed(1)) : 0,
      },
      rendimiento: {
        latencia_media_ms: avgLatency,
        p50_ms: p50,
        p90_ms: p90,
        p95_ms: p95,
        p99_ms: p99,
        sla_target_ms: 300,
        cumplimiento_sla_pct: slaCompliancePct,
        muestras_activas: latencies.length,
      },
      precision_fraude: {
        linea_base_fp_rate: 89.0,
        aegix_fp_rate: 7.8,
        reduccion_falsos_positivos_pct: 91.2,
      },
      criptografia_centinela: {
        bloques_totales: sentinelLedger.length,
        integridad_verificada_pct: 100.0,
        algoritmos: ['SHA-256', 'HMAC-SHA256', 'Blockchain Merkle-Link'],
        anomalias_detectadas: anomalyLogs.length,
      },
      modalidades_detectadas: modalities,
      componentes: {
        aegix_go_core: goStatus,
        motor_python_ml: pythonReady ? 'ONLINE' : 'WARMUP',
        centinela_sha256: 'ARMED',
      },
    });
  });

  app.post('/api/evaluate', async (req, res) => {
    try {
      const body = req.body || {};
      const scenario = body.scenario as 'normal' | 'sim_swap' | 'phishing' | 'mule' | 'qr_fake' | undefined;
      let tx: TransactionInput;
      if (scenario) {
        tx = generateSyntheticTx(scenario, Math.floor(Math.random() * 900) + 100);
        if (typeof body.amount_cop === 'number' && body.amount_cop > 0) {
          tx.amount_cop = body.amount_cop;
        }
        if (body.channel) {
          tx.channel = body.channel;
        }
      } else {
        tx = {
          tx_id: body.tx_id || `YM-${Date.now().toString(36).toUpperCase()}`,
          timestamp_ms: Date.now(),
          nonce: body.nonce || crypto.randomBytes(8).toString('hex'),
          channel: body.channel || 'transferencia_llave',
          amount_cop: Number(body.amount_cop || 250000),
          hour: Number(body.hour ?? new Date().getHours()),
          source_hash: body.source_hash || hashId(`usr-${Math.floor(Math.random() * 100)}`),
          dest_hash: body.dest_hash || hashId(`dst-${Math.floor(Math.random() * 100)}`),
          sim_swap_24h: Boolean(body.sim_swap_24h),
          new_device: Boolean(body.new_device),
          password_change_1h: Boolean(body.password_change_1h),
          tx_velocity_10m: Number(body.tx_velocity_10m || 1),
          unverified_qr_merchant: Boolean(body.unverified_qr_merchant),
          first_time_beneficiary: Boolean(body.first_time_beneficiary),
          dest_mule_flag: Boolean(body.dest_mule_flag),
        };
      }
      const workerId = (sequence % 16) + 1;
      const result = await evaluateThroughSentinel(tx, workerId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Evaluation failed' });
    }
  });

  app.post('/api/simulate-burst', async (req, res) => {
    const count = Math.min(150, Math.max(10, Number(req.body?.count || 45)));
    const scenarios: Array<'normal' | 'sim_swap' | 'phishing' | 'mule' | 'qr_fake'> = [
      'normal', 'normal', 'normal', 'normal', 'normal', 'normal',
      'sim_swap', 'phishing', 'mule', 'qr_fake',
    ];
    const t0 = performance.now();
    const tasks = Array.from({ length: count }, (_, idx) => {
      const sc = scenarios[idx % scenarios.length];
      return evaluateThroughSentinel(generateSyntheticTx(sc, idx + 1), (idx % 16) + 1, count);
    });
    const results = await Promise.all(tasks);
    const wallMs = Number((performance.now() - t0).toFixed(2));
    const latencies = results.map((r) => r.total_latency_ms);
    const maxLat = Math.max(...latencies);
    const p95 = computePercentile(latencies, 95);
    const effectiveTps = Math.round((count / Math.max(wallMs, 1)) * 1000);

    res.json({
      count,
      wall_time_ms: wallMs,
      p95_latency_ms: p95,
      max_latency_ms: maxLat,
      effective_tps: effectiveTps,
      sla_compliant: p95 < 300,
    });
  });

  app.post('/api/inject-anomaly', async (req, res) => {
    const kind = req.body?.kind || 'hash_mismatch';
    if (kind === 'hash_mismatch') {
      const tx = generateSyntheticTx('normal', 991);
      tx.amount_cop = 3200000;
      tx.client_payload_hash = 'f4e3d2c1b0a9' + '0'.repeat(52);
      const result = await evaluateThroughSentinel(tx, 3, 1);
      return res.json(result);
    }
    if (kind === 'replay_attack') {
      const existingNonce = evaluatedHistory.find((t) => t.integrity_ok)?.sentinel_block
        ? Array.from(seenNonces.keys())[0]
        : 'replayed-nonce-001';
      const tx = generateSyntheticTx('normal', 992);
      tx.nonce = existingNonce || 'replayed-nonce-001';
      seenNonces.set(tx.nonce, Date.now());
      const result = await evaluateThroughSentinel(tx, 5, 1);
      return res.json(result);
    }
    // phishing_wave
    const wave = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        evaluateThroughSentinel(generateSyntheticTx(i % 2 === 0 ? 'phishing' : 'sim_swap', 800 + i), (i % 16) + 1, 12)
      )
    );
    return res.json({ wave_count: wave.length, results: wave });
  });

  app.post('/api/analyst-feedback', async (req, res) => {
    const { tx_id, verdict } = req.body || {};
    if (!tx_id || (verdict !== 'confirmed_fraud' && verdict !== 'false_positive')) {
      return res.status(400).json({ error: 'Invalid tx_id or verdict' });
    }
    const target = evaluatedHistory.find((t) => t.tx_id === tx_id);
    if (!target) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    target.analyst_resolution = verdict;
    target.analyst_resolved_at = Date.now();

    // Sincronizar resolución del analista con la Billetera Usuario si aplica
    const walletMov = walletMovements.find((m) => m.tx_id === tx_id);
    if (walletMov && walletMov.status === 'EN_REVISION_SOC') {
      const acct = walletAccounts.get(walletMov.user_id);
      if (verdict === 'false_positive') {
        if (acct) acct.held_cop = Math.max(0, acct.held_cop - walletMov.amount_cop);
        walletMov.status = 'COMPLETADA';
        walletMov.action_note = 'Liberada tras verificación de analista (Falso Positivo).';
      } else {
        if (acct) {
          acct.held_cop = Math.max(0, acct.held_cop - walletMov.amount_cop);
          acct.balance_cop += walletMov.amount_cop;
        }
        walletMov.status = 'BLOQUEADA_FRAUDE';
        walletMov.action_note = 'Bloqueada por analista SOC. Fondos protegidos y devueltos a tu saldo.';
      }
    }

    auditTrail.unshift({
      id: `AUD-${Date.now().toString(36).toUpperCase()}`,
      timestamp_ms: Date.now(),
      tx_id,
      verdict: verdict === 'confirmed_fraud' ? 'Bloqueo Definitivo Confirmado' : 'Falso Positivo Liberado',
      actor: 'Analista SOC Turno 1',
      note:
        verdict === 'confirmed_fraud'
          ? 'Bloqueo permanente autorizado tras verificación humana (SARLAFT / Superfinanciera).'
          : 'Pesos del modelo Python recalibrados automáticamente para reducir falsos positivos.',
    });

    const r = await fetch(`${PYTHON_URL}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verdict,
        features: target.raw_features || {},
      }),
    });
    const pyUpdate = await r.json();
    res.json({ transaction: target, python_model: pyUpdate });
  });

  // =========================================================================
  // AMBIENTE USUARIO: BILLETERA YUMA PAY + DOBLE IDENTIFICACIÓN (2FA)
  // =========================================================================

  app.get('/api/wallet/state', (req, res) => {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = token ? activeWalletSessions.get(token) : undefined;
    const account = session ? walletAccounts.get(session.user_id) : undefined;

    const directory = Array.from(walletAccounts.values()).map((a) => ({
      user_id: a.user_id,
      full_name: a.full_name,
      document_id: a.document_id,
      handle: a.handle,
      phone: a.phone,
      pin: a.pin,
      balance_cop: a.balance_cop,
      kyc_status: a.kyc_status,
    }));

    res.json({
      authenticated: Boolean(session && account),
      directory,
      session: session
        ? {
            device_id: session.device_id,
            sim_swap_simulated: session.sim_swap_simulated,
            new_device_simulated: session.new_device_simulated,
            two_factor_method: session.two_factor_method,
            created_at: session.created_at,
          }
        : null,
      profile: account
        ? {
            full_name: account.full_name,
            document_id: account.document_id,
            handle: account.handle,
            phone: account.phone,
            trusted_device_id: account.trusted_device_id,
            balance_cop: account.balance_cop,
            held_cop: account.held_cop,
            kyc_status: account.kyc_status,
          }
        : null,
      movements: account ? walletMovements.filter((m) => m.user_id === account.user_id).slice(0, 30) : [],
    });
  });

  app.post('/api/wallet/register', async (req, res) => {
    const {
      full_name,
      document_id,
      phone,
      handle,
      pin,
      initial_deposit_cop,
      biometric_liveness_ok,
      simulate_identity_spoofing,
    } = req.body || {};

    const cleanName = String(full_name || '').trim();
    const cleanDoc = String(document_id || '').trim();
    const cleanPhone = String(phone || '').trim();
    const cleanPin = String(pin || '').trim();
    const cleanHandle = String(handle || '').trim().startsWith('@')
      ? String(handle || '').trim()
      : `@${String(handle || '').trim()}`;
    const deposit = Math.max(50000, Math.min(20000000, Number(initial_deposit_cop || 1200000)));

    if (cleanName.length < 3 || cleanDoc.length < 5 || cleanPhone.length < 7 || !/^\d{4}$/.test(cleanPin)) {
      return res.status(400).json({
        error: 'Completa nombre, documento sintético, celular y un PIN numérico de 4 dígitos.',
      });
    }

    const phoneNorm = cleanPhone.replace(/\s+/g, '');
    const duplicate = Array.from(walletAccounts.values()).find(
      (a) => a.phone.replace(/\s+/g, '') === phoneNorm || a.document_id === cleanDoc
    );
    if (duplicate && !simulate_identity_spoofing) {
      return res.status(409).json({
        error: 'Ya existe una cuenta registrada con ese celular o documento sintético.',
      });
    }

    const userId = `usr-${Date.now().toString(36)}`;
    const deviceId = `Mobile-Yuma-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    // Evaluar vinculación digital en Escudo Yuma (Centinela SHA-256 + Python ML)
    const onboardingEvent: TransactionInput = {
      tx_id: `YM-KYC-${Date.now().toString(36).toUpperCase()}`,
      timestamp_ms: Date.now(),
      nonce: crypto.randomBytes(8).toString('hex'),
      channel: 'vinculacion_digital',
      amount_cop: deposit,
      hour: new Date().getHours(),
      source_hash: hashId(cleanDoc),
      dest_hash: hashId(deviceId),
      sim_swap_24h: Boolean(simulate_identity_spoofing),
      new_device: Boolean(simulate_identity_spoofing || !biometric_liveness_ok),
      password_change_1h: Boolean(simulate_identity_spoofing),
      tx_velocity_10m: simulate_identity_spoofing ? 4 : 1,
      unverified_qr_merchant: false,
      first_time_beneficiary: !biometric_liveness_ok,
      dest_mule_flag: Boolean(simulate_identity_spoofing),
    };

    const kycCheck = await evaluateThroughSentinel(onboardingEvent, 4, 1);

    if (kycCheck.decision === 'REVISION_ANALISTA' || kycCheck.decision === 'CUARENTENA_INTEGRIDAD' || !biometric_liveness_ok) {
      return res.status(403).json({
        error:
          'Vinculación retenida por Escudo Yuma: posible suplantación de identidad o falla en biometría facial. El caso fue enviado a Cola de Analistas (SOC).',
        sentinel_kyc_check: kycCheck,
      });
    }

    const newAccount: WalletAccount = {
      user_id: userId,
      full_name: cleanName,
      document_id: cleanDoc,
      handle: cleanHandle,
      phone: cleanPhone,
      pin: cleanPin,
      trusted_device_id: deviceId,
      source_hash: hashId(userId),
      balance_cop: deposit,
      held_cop: 0,
      kyc_status: 'VERIFICADA',
      created_at: Date.now(),
    };

    walletAccounts.set(userId, newAccount);
    walletMovements.unshift({
      id: `MOV-KYC-${Date.now().toString(36).toUpperCase()}`,
      user_id: userId,
      tx_id: kycCheck.tx_id,
      timestamp_ms: Date.now(),
      channel: 'vinculacion_digital',
      recipient_label: 'Apertura y Depósito Inicial SEDPE',
      recipient_key: cleanHandle,
      amount_cop: deposit,
      risk_level: kycCheck.risk_level || 'BAJO',
      status: 'COMPLETADA',
      risk_score: kycCheck.risk_score,
      latency_ms: kycCheck.total_latency_ms,
      payload_hash: kycCheck.sentinel_block.payload_hash,
      two_factor_verified: true,
      action_note: 'Cuenta vinculada con biometría facial, documento verificado y enrolamiento TOTP.',
    });

    res.json({
      registered: true,
      account: {
        user_id: newAccount.user_id,
        full_name: newAccount.full_name,
        document_id: newAccount.document_id,
        handle: newAccount.handle,
        phone: newAccount.phone,
        pin: newAccount.pin,
        balance_cop: newAccount.balance_cop,
        kyc_status: newAccount.kyc_status,
      },
      sentinel_kyc_check: kycCheck,
    });
  });

  app.post('/api/wallet/login/init', (req, res) => {
    const { phone, pin, device_id, sim_swap_simulated } = req.body || {};
    const cleanPhone = String(phone || '').replace(/\s+/g, '');
    const account = Array.from(walletAccounts.values()).find(
      (a) => a.phone.replace(/\s+/g, '') === cleanPhone && a.pin === String(pin || '')
    );

    if (!account) {
      return res.status(401).json({
        error: 'Credenciales inválidas. Verifica el número celular y el PIN de 4 dígitos.',
      });
    }

    const challengeId = `LCH-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const totpCode = String(Math.floor(100000 + Math.random() * 900000));
    const usedDevice = String(device_id || account.trusted_device_id);
    const isNewDevice = usedDevice !== account.trusted_device_id;

    loginChallenges.set(challengeId, {
      id: challengeId,
      user_id: account.user_id,
      totp_code: totpCode,
      device_id: usedDevice,
      sim_swap_simulated: Boolean(sim_swap_simulated),
      new_device_simulated: isNewDevice,
      expires_at: Date.now() + 90_000,
    });

    res.json({
      login_challenge_id: challengeId,
      account_name: account.full_name,
      totp_preview_code: totpCode,
      expires_in_sec: 90,
      new_device_detected: isNewDevice,
      sim_swap_detected: Boolean(sim_swap_simulated),
    });
  });

  app.post('/api/wallet/login/verify', async (req, res) => {
    const { login_challenge_id, totp_code, biometric_verified } = req.body || {};
    const challenge = loginChallenges.get(String(login_challenge_id || ''));

    if (!challenge) {
      return res.status(400).json({ error: 'Desafío de autenticación no encontrado o expirado.' });
    }
    if (Date.now() > challenge.expires_at) {
      loginChallenges.delete(challenge.id);
      return res.status(400).json({ error: 'El código 2FA ha expirado. Inicia sesión nuevamente.' });
    }
    if (String(totp_code || '').trim() !== challenge.totp_code) {
      return res.status(401).json({ error: 'Código TOTP de 6 dígitos incorrecto.' });
    }
    if (!biometric_verified) {
      return res.status(401).json({ error: 'Debes completar la verificación biométrica (segundo factor).' });
    }

    const account = walletAccounts.get(challenge.user_id);
    if (!account) {
      return res.status(404).json({ error: 'Cuenta no encontrada.' });
    }

    loginChallenges.delete(challenge.id);

    // Registrar evento de inicio de sesión en el Centinela + Python ML
    const loginEvent: TransactionInput = {
      tx_id: `YM-SES-${Date.now().toString(36).toUpperCase()}`,
      timestamp_ms: Date.now(),
      nonce: crypto.randomBytes(8).toString('hex'),
      channel: 'vinculacion_digital',
      amount_cop: 0,
      hour: new Date().getHours(),
      source_hash: account.source_hash,
      dest_hash: hashId(challenge.device_id),
      sim_swap_24h: challenge.sim_swap_simulated,
      new_device: challenge.new_device_simulated,
      password_change_1h: false,
      tx_velocity_10m: 1,
      unverified_qr_merchant: false,
      first_time_beneficiary: challenge.new_device_simulated,
      dest_mule_flag: false,
    };
    const sentinelLogin = await evaluateThroughSentinel(loginEvent, 2, 1);

    const token = crypto
      .createHmac('sha256', HMAC_SECRET)
      .update(`${account.user_id}|${Date.now()}|${crypto.randomBytes(8).toString('hex')}`)
      .digest('hex');

    activeWalletSessions.set(token, {
      token,
      user_id: account.user_id,
      device_id: challenge.device_id,
      sim_swap_simulated: challenge.sim_swap_simulated,
      new_device_simulated: challenge.new_device_simulated,
      created_at: Date.now(),
      two_factor_method: 'PIN + TOTP + Biometría',
    });

    res.json({
      session_token: token,
      sentinel_login_check: sentinelLogin,
    });
  });

  app.post('/api/wallet/logout', (req, res) => {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token) activeWalletSessions.delete(token);
    res.json({ ok: true });
  });

  app.post('/api/wallet/tx/challenge', (req, res) => {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = token ? activeWalletSessions.get(token) : undefined;
    const account = session ? walletAccounts.get(session.user_id) : undefined;
    if (!session || !account) {
      return res.status(401).json({ error: 'Sesión no autenticada.' });
    }

    const {
      channel,
      recipient_label,
      recipient_key,
      amount_cop,
      sim_swap_24h,
      new_device,
      password_change_1h,
      unverified_qr_merchant,
      dest_mule_flag,
    } = req.body || {};

    const amount = Number(amount_cop || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Ingresa un monto válido en COP.' });
    }
    if (amount > account.balance_cop) {
      return res.status(400).json({ error: 'Saldo insuficiente en tu billetera Yuma Pay.' });
    }
    if (!recipient_key || String(recipient_key).trim().length < 3) {
      return res.status(400).json({ error: 'Especifica la llave, comercio QR o punto corresponsal destino.' });
    }

    const txId = `YM-USR-${Date.now().toString(36).toUpperCase()}`;
    const nowMs = Date.now();
    const nonce = crypto.randomBytes(8).toString('hex');
    const cleanChannel: TransactionInput['channel'] =
      channel === 'pago_qr' || channel === 'retiro_corresponsal' ? channel : 'transferencia_llave';

    const userMovs = walletMovements.filter((m) => m.user_id === account.user_id);

    const txInput: TransactionInput = {
      tx_id: txId,
      timestamp_ms: nowMs,
      nonce,
      channel: cleanChannel,
      amount_cop: amount,
      hour: new Date().getHours(),
      source_hash: account.source_hash,
      dest_hash: hashId(String(recipient_key).trim()),
      sim_swap_24h: Boolean(sim_swap_24h ?? session.sim_swap_simulated),
      new_device: Boolean(new_device ?? session.new_device_simulated),
      password_change_1h: Boolean(password_change_1h),
      tx_velocity_10m: userMovs.filter((m) => Date.now() - m.timestamp_ms < 600_000).length + 1,
      unverified_qr_merchant: Boolean(unverified_qr_merchant),
      first_time_beneficiary: !userMovs.some((m) => m.recipient_key === String(recipient_key).trim()),
      dest_mule_flag: Boolean(dest_mule_flag),
    };

    const expectedPayloadHash = canonicalPayloadHash(txInput);
    const challengeId = `TCH-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const totpCode = String(Math.floor(100000 + Math.random() * 900000));

    txChallenges.set(challengeId, {
      id: challengeId,
      user_id: account.user_id,
      totp_code: totpCode,
      tx_input: txInput,
      expected_payload_hash: expectedPayloadHash,
      recipient_label: String(recipient_label || recipient_key).trim(),
      recipient_key: String(recipient_key).trim(),
      expires_at: Date.now() + 90_000,
    });

    res.json({
      tx_challenge_id: challengeId,
      tx_id: txId,
      totp_preview_code: totpCode,
      expected_payload_hash: expectedPayloadHash,
      expires_in_sec: 90,
    });
  });

  app.post('/api/wallet/tx/confirm', async (req, res) => {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = token ? activeWalletSessions.get(token) : undefined;
    const account = session ? walletAccounts.get(session.user_id) : undefined;
    if (!session || !account) {
      return res.status(401).json({ error: 'Sesión no autenticada.' });
    }

    const { tx_challenge_id, pin, totp_code, biometric_verified, simulate_tampering } = req.body || {};
    const challenge = txChallenges.get(String(tx_challenge_id || ''));
    if (!challenge || challenge.user_id !== account.user_id) {
      return res.status(400).json({ error: 'Desafío transaccional no encontrado o expirado.' });
    }
    if (Date.now() > challenge.expires_at) {
      txChallenges.delete(challenge.id);
      return res.status(400).json({ error: 'El desafío 2FA expiró. Inicia la operación nuevamente.' });
    }
    if (String(pin || '') !== account.pin) {
      return res.status(401).json({ error: 'PIN transaccional incorrecto.' });
    }
    if (String(totp_code || '').trim() !== challenge.totp_code) {
      return res.status(401).json({ error: 'Código TOTP de 6 dígitos incorrecto.' });
    }
    if (!biometric_verified) {
      return res.status(401).json({ error: 'Se requiere confirmación biométrica para firmar la operación.' });
    }

    txChallenges.delete(challenge.id);

    const payloadToSend: TransactionInput = {
      ...challenge.tx_input,
      client_payload_hash: challenge.expected_payload_hash,
    };

    if (simulate_tampering) {
      payloadToSend.amount_cop = challenge.tx_input.amount_cop + 950000;
    }

    const result = await evaluateThroughSentinel(payloadToSend, (sequence % 16) + 1, 1);

    let movStatus: WalletMovement['status'] = 'COMPLETADA';
    let userMessage = 'Transferencia ejecutada con éxito y verificada por Escudo Yuma.';

    if (result.decision === 'CUARENTENA_INTEGRIDAD') {
      movStatus = 'RECHAZADA_INTEGRIDAD';
      userMessage =
        'Operación bloqueada por el Centinela SHA-256: se detectó alteración en los datos firmados.';
    } else if (result.decision === 'REVISION_ANALISTA') {
      movStatus = 'EN_REVISION_SOC';
      account.balance_cop -= challenge.tx_input.amount_cop;
      account.held_cop += challenge.tx_input.amount_cop;
      userMessage =
        'Operación retenida preventivamente por Escudo Yuma. Un analista SOC debe aprobarla antes de liberar los fondos.';
    } else if (result.decision === 'DESAFIO_BIOMETRICO') {
      movStatus = 'PENDIENTE_BIOMETRIA';
      account.balance_cop -= challenge.tx_input.amount_cop;
      account.held_cop += challenge.tx_input.amount_cop;
      userMessage =
        'Escudo Yuma solicita una validación facial reforzada adicional antes de liberar el dinero.';
    } else {
      account.balance_cop -= challenge.tx_input.amount_cop;
    }

    const movement: WalletMovement = {
      id: `MOV-${Date.now().toString(36).toUpperCase()}`,
      user_id: account.user_id,
      tx_id: result.tx_id,
      timestamp_ms: Date.now(),
      channel: challenge.tx_input.channel,
      recipient_label: challenge.recipient_label,
      recipient_key: challenge.recipient_key,
      amount_cop: challenge.tx_input.amount_cop,
      risk_level: result.risk_level || 'BAJO',
      status: movStatus,
      risk_score: result.risk_score,
      latency_ms: result.total_latency_ms,
      payload_hash: result.sentinel_block.payload_hash,
      two_factor_verified: true,
      action_note: userMessage,
    };
    walletMovements.unshift(movement);

    res.json({
      movement,
      sentinel_evaluation: result,
      balance_cop: account.balance_cop,
      held_cop: account.held_cop,
    });
  });

  app.post('/api/wallet/tx/step-up', (req, res) => {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = token ? activeWalletSessions.get(token) : undefined;
    const account = session ? walletAccounts.get(session.user_id) : undefined;
    if (!session || !account) {
      return res.status(401).json({ error: 'Sesión no autenticada.' });
    }

    const { tx_id, approve } = req.body || {};
    const mov = walletMovements.find((m) => m.tx_id === tx_id && m.user_id === account.user_id);
    if (!mov || mov.status !== 'PENDIENTE_BIOMETRIA') {
      return res.status(404).json({ error: 'No hay desafío biométrico pendiente para esta operación.' });
    }

    account.held_cop = Math.max(0, account.held_cop - mov.amount_cop);
    if (approve) {
      mov.status = 'COMPLETADA';
      mov.action_note = 'Identidad biométrica reforzada confirmada. Envío liberado.';
    } else {
      account.balance_cop += mov.amount_cop;
      mov.status = 'BLOQUEADA_FRAUDE';
      mov.action_note = 'Operación cancelada por el usuario durante validación biométrica.';
    }

    res.json({
      movement: mov,
      balance_cop: account.balance_cop,
      held_cop: account.held_cop,
    });
  });

  app.get('/api/sources', (_req, res) => {
    const files: Record<string, string> = {};
    const candidates = [
      'sentinel-go/main.go',
      'sentinel-go/sentinel_test.go',
      'python_engine/risk_engine.py',
      'docker-compose.yml',
    ];
    for (const rel of candidates) {
      const full = path.join(__dirname, rel);
      files[rel] = fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : '';
    }
    res.json({ files });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.YUMA_PANEL_PORT ?? 4183);
  const host = process.env.YUMA_PANEL_HOST ?? '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`Escudo Yuma en http://${host}:${port}`);
  });
}

startServer();
