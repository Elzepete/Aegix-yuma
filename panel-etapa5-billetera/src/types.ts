export interface ExplanationFactor {
  feature: string;
  label: string;
  value: number;
  contribution: number;
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

export type RiskLevel = 'BAJO' | 'MEDIO' | 'ALTO';

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
  risk_level: RiskLevel;
  decision: 'APROBADA' | 'DESAFIO_BIOMETRICO' | 'REVISION_ANALISTA' | 'CUARENTENA_INTEGRIDAD';
  action_note: string;
  modality: string;
  explanations: ExplanationFactor[];
  total_latency_ms: number;
  sentinel_ms?: number;
  python_inference_ms: number;
  concurrency?: number;
  analyst_resolution?: 'confirmed_fraud' | 'false_positive' | null;
  analyst_resolved_at?: number;
}

export interface LatencyHistoryPoint {
  sequence: number;
  tx_id: string;
  total_ms: number;
  sentinel_ms: number;
  python_ms: number;
  concurrency: number;
  integrity_ok: boolean;
  worker_id: number;
  anomaly_type: string | null;
}

export interface ConcurrencyBucketSummary {
  bucket: string;
  count: number;
  avg_total_ms: number;
  avg_sentinel_ms: number;
  p95_ms: number;
  integrity_rate: number;
}

export interface AnomalyLog {
  id: string;
  timestamp_ms: number;
  tx_id: string;
  type: string;
  detail: string;
  expected_hash?: string;
  received_hash?: string;
}

export interface AuditEntry {
  id: string;
  timestamp_ms: number;
  tx_id: string;
  verdict: string;
  actor: string;
  note: string;
}

export interface PythonHealth {
  service: string;
  status: string;
  model_version: string;
  weights: Record<string, number>;
  thresholds: {
    step_up_biometrico: number;
    revision_analista: number;
  };
  stats: {
    total_scored: number;
    feedback_confirmed_fraud: number;
    feedback_false_positive: number;
    legacy_fp_rate: number;
    current_fp_rate: number;
  };
}

export interface AppStateResponse {
  python_ready: boolean;
  python_health: PythonHealth | null;
  metrics: {
    total_evaluated: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
    sla_target_ms: number;
    legacy_fp_rate: number;
    current_fp_rate: number;
    approved_count: number;
    challenge_count: number;
    pending_analyst_count: number;
    quarantined_count: number;
    riesgo_bajo_count: number;
    riesgo_medio_count: number;
    riesgo_alto_count: number;
    prevented_cop: number;
    total_recent: number;
  };
  latency_history: LatencyHistoryPoint[];
  concurrency_summary: ConcurrencyBucketSummary[];
  transactions: EvaluatedTransaction[];
  sentinel_ledger: SentinelBlock[];
  anomaly_logs: AnomalyLog[];
  audit_trail: AuditEntry[];
}

export interface WalletMovement {
  id: string;
  tx_id: string;
  timestamp_ms: number;
  channel: string;
  recipient_label: string;
  recipient_key: string;
  amount_cop: number;
  risk_level: RiskLevel;
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

export interface WalletDirectoryEntry {
  user_id: string;
  full_name: string;
  document_id: string;
  handle: string;
  phone: string;
  pin: string;
  balance_cop: number;
  kyc_status: 'VERIFICADA' | 'EN_REVISION_KYC';
}

export interface WalletStateResponse {
  authenticated: boolean;
  directory: WalletDirectoryEntry[];
  session: {
    device_id: string;
    sim_swap_simulated: boolean;
    new_device_simulated: boolean;
    two_factor_method: string;
    created_at: number;
  } | null;
  profile: {
    full_name: string;
    document_id?: string;
    handle: string;
    phone: string;
    trusted_device_id: string;
    balance_cop: number;
    held_cop: number;
    kyc_status?: string;
  } | null;
  movements: WalletMovement[];
}

