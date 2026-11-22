import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_PORT = Number(process.env.PYTHON_ML_PORT || 8001);
const PYTHON_URL = `http://127.0.0.1:${PYTHON_PORT}`;
const HMAC_SECRET = process.env.SENTINEL_HMAC_SECRET || 'escudo-yuma-dev-hmac-key';

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
  python_inference_ms: number;
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

let pythonProcess: ChildProcess | null = null;
let pythonReady = false;

function startPythonEngine(): void {
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

  pythonProcess.on('exit', (code) => {
    pythonReady = false;
    console.warn(`[Python ML] exited with code ${code}. Restarting in 1s...`);
    setTimeout(startPythonEngine, 1000);
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

async function evaluateThroughSentinel(ev: TransactionInput, workerId = 1): Promise<EvaluatedTransaction> {
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
      python_inference_ms: 0,
      analyst_resolution: null,
    };
    evaluatedHistory.unshift(quarantined);
    if (evaluatedHistory.length > 160) evaluatedHistory.length = 160;
    return quarantined;
  }

  // Llamada real al microservicio Python 3.11 con timeout estricto de 250ms
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 250);
  let pyRes: {
    risk_score: number;
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
    pyRes = await response.json();
  } finally {
    clearTimeout(timer);
  }

  const totalLatency = Number((performance.now() - t0).toFixed(2));
  latencySamples.push(totalLatency);
  if (latencySamples.length > 500) latencySamples.shift();

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
    decision: pyRes.decision,
    action_note: pyRes.action_note,
    modality: pyRes.modality,
    explanations: pyRes.explanations,
    total_latency_ms: totalLatency,
    python_inference_ms: pyRes.python_inference_ms,
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
  for (let i = 0; i < plan.length; i++) {
    await evaluateThroughSentinel(generateSyntheticTx(plan[i], i + 1), (i % 8) + 1);
  }
}

async function startServer() {
  startPythonEngine();
  const ok = await waitForPython();
  if (ok) {
    await seedInitialTransactions();
  } else {
    console.error('Python ML Engine did not respond in time.');
  }

  const app = express();
  app.use(express.json());

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
        prevented_cop: preventedCop,
        total_recent: total,
      },
      transactions: evaluatedHistory.slice(0, 60),
      sentinel_ledger: sentinelLedger.slice(0, 40),
      anomaly_logs: anomalyLogs.slice(0, 30),
      audit_trail: auditTrail.slice(0, 30),
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
      return evaluateThroughSentinel(generateSyntheticTx(sc, idx + 1), (idx % 16) + 1);
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
      const result = await evaluateThroughSentinel(tx, 3);
      return res.json(result);
    }
    if (kind === 'replay_attack') {
      const existingNonce = evaluatedHistory.find((t) => t.integrity_ok)?.sentinel_block
        ? Array.from(seenNonces.keys())[0]
        : 'replayed-nonce-001';
      const tx = generateSyntheticTx('normal', 992);
      tx.nonce = existingNonce || 'replayed-nonce-001';
      seenNonces.set(tx.nonce, Date.now());
      const result = await evaluateThroughSentinel(tx, 5);
      return res.json(result);
    }
    // phishing_wave
    const wave = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        evaluateThroughSentinel(generateSyntheticTx(i % 2 === 0 ? 'phishing' : 'sim_swap', 800 + i), (i % 16) + 1)
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

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Escudo Yuma server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
