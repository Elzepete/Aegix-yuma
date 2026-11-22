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
  explanations: ExplanationFactor[];
  total_latency_ms: number;
  python_inference_ms: number;
  analyst_resolution?: 'confirmed_fraud' | 'false_positive' | null;
  analyst_resolved_at?: number;
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
    prevented_cop: number;
    total_recent: number;
  };
  transactions: EvaluatedTransaction[];
  sentinel_ledger: SentinelBlock[];
  anomaly_logs: AnomalyLog[];
  audit_trail: AuditEntry[];
}
