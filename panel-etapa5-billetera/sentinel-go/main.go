package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// TransactionEvent representa un evento entrante de Yuma Pay anonimizado (Ley 1581 / PCI DSS).
type TransactionEvent struct {
	TxID                 string  `json:"tx_id"`
	TimestampMs          int64   `json:"timestamp_ms"`
	Nonce                string  `json:"nonce"`
	Channel              string  `json:"channel"`
	AmountCOP            float64 `json:"amount_cop"`
	Hour                 int     `json:"hour"`
	SourceHash           string  `json:"source_hash"`
	DestHash             string  `json:"dest_hash"`
	SimSwap24h           bool    `json:"sim_swap_24h"`
	NewDevice            bool    `json:"new_device"`
	PasswordChange1h     bool    `json:"password_change_1h"`
	TxVelocity10m        int     `json:"tx_velocity_10m"`
	UnverifiedQRMerchant bool    `json:"unverified_qr_merchant"`
	FirstTimeBeneficiary bool    `json:"first_time_beneficiary"`
	DestMuleFlag         bool    `json:"dest_mule_flag"`
	ClientPayloadHash    string  `json:"client_payload_hash,omitempty"`
}

// SentinelBlock es un eslabón criptográfico inmutable verificado por el Centinela Go.
type SentinelBlock struct {
	Sequence    uint64 `json:"sequence"`
	TxID        string `json:"tx_id"`
	PrevHash    string `json:"prev_hash"`
	PayloadHash string `json:"payload_hash"`
	ChainHash   string `json:"chain_hash"`
	HMAC        string `json:"hmac"`
	WorkerID    int    `json:"worker_id"`
	Verified    bool   `json:"verified"`
	AnomalyType string `json:"anomaly_type,omitempty"`
	TimestampMs int64  `json:"timestamp_ms"`
}

type PythonRiskResponse struct {
	RiskScore    float64                  `json:"risk_score"`
	RiskLevel    string                   `json:"risk_level,omitempty"`
	Decision     string                   `json:"decision"`
	ActionNote   string                   `json:"action_note"`
	Modality     string                   `json:"modality"`
	Explanations []map[string]interface{} `json:"explanations"`
	InferenceMs  float64                  `json:"python_inference_ms"`
}

type EvaluatedResult struct {
	TxID          string              `json:"tx_id"`
	SentinelBlock SentinelBlock       `json:"sentinel_block"`
	Risk          *PythonRiskResponse `json:"risk,omitempty"`
	RiskLevel     string              `json:"risk_level"`
	TotalLatency  float64             `json:"total_latency_ms"`
	Decision      string              `json:"decision"`
	IntegrityOK   bool                `json:"integrity_ok"`
}

type evalJob struct {
	event    TransactionEvent
	respChan chan EvaluatedResult
}

// HashSentinel implementa verificación concurrente SHA-256 + HMAC, caché anti-replay
// y detección de anomalías por ventana deslizante usando goroutines y canales.
type HashSentinel struct {
	hmacSecret  []byte
	pythonURL   string
	httpClient  *http.Client
	jobs        chan evalJob
	chainMu     sync.Mutex
	sequence    uint64
	lastHash    string
	nonceMu     sync.RWMutex
	seenNonces  map[string]int64
	windowMu    sync.Mutex
	recentTimes []int64
	anomalies   atomic.Uint64
	processed   atomic.Uint64
}

func NewHashSentinel(pythonURL string, hmacSecret []byte, workerCount int) *HashSentinel {
	s := &HashSentinel{
		hmacSecret: hmacSecret,
		pythonURL:  pythonURL,
		httpClient: &http.Client{
			Timeout: 240 * time.Millisecond, // Presupuesto estricto bajo SLA de 300 ms
			Transport: &http.Transport{
				MaxIdleConns:        256,
				MaxIdleConnsPerHost: 256,
				IdleConnTimeout:     60 * time.Second,
			},
		},
		jobs:       make(chan evalJob, 2048),
		lastHash:   "0000000000000000000000000000000000000000000000000000000000000000",
		seenNonces: make(map[string]int64),
	}

	for w := 1; w <= workerCount; w++ {
		go s.worker(w)
	}
	go s.cleanupNoncesLoop()
	return s
}

func canonicalPayloadHash(ev TransactionEvent) string {
	canonical := fmt.Sprintf("%s|%d|%s|%s|%.2f|%s|%s",
		ev.TxID, ev.TimestampMs, ev.Nonce, ev.Channel, ev.AmountCOP, ev.SourceHash, ev.DestHash)
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

func (s *HashSentinel) signHMAC(data string) string {
	mac := hmac.New(sha256.New, s.hmacSecret)
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *HashSentinel) checkReplay(nonce string, nowMs int64) bool {
	if nonce == "" {
		return true
	}
	s.nonceMu.Lock()
	defer s.nonceMu.Unlock()
	if _, exists := s.seenNonces[nonce]; exists {
		return true
	}
	s.seenNonces[nonce] = nowMs
	return false
}

func (s *HashSentinel) checkBurstAnomaly(nowMs int64) bool {
	s.windowMu.Lock()
	defer s.windowMu.Unlock()
	cutoff := nowMs - 1000
	filtered := s.recentTimes[:0]
	for _, t := range s.recentTimes {
		if t >= cutoff {
			filtered = append(filtered, t)
		}
	}
	filtered = append(filtered, nowMs)
	s.recentTimes = filtered
	// Umbral de oleada anómala (>180 TPS locales en ráfaga súbita)
	return len(s.recentTimes) > 180
}

func (s *HashSentinel) appendBlock(workerID int, ev TransactionEvent, payloadHash string, verified bool, anomaly string) SentinelBlock {
	s.chainMu.Lock()
	defer s.chainMu.Unlock()
	s.sequence++
	chainInput := fmt.Sprintf("%d|%s|%s|%d", s.sequence, s.lastHash, payloadHash, ev.TimestampMs)
	sum := sha256.Sum256([]byte(chainInput))
	chainHash := hex.EncodeToString(sum[:])

	block := SentinelBlock{
		Sequence:    s.sequence,
		TxID:        ev.TxID,
		PrevHash:    s.lastHash,
		PayloadHash: payloadHash,
		ChainHash:   chainHash,
		HMAC:        s.signHMAC(chainHash),
		WorkerID:    workerID,
		Verified:    verified,
		AnomalyType: anomaly,
		TimestampMs: time.Now().UnixMilli(),
	}
	if verified {
		s.lastHash = chainHash
	}
	return block
}

func (s *HashSentinel) callPythonML(ctx context.Context, ev TransactionEvent) (*PythonRiskResponse, error) {
	body, err := json.Marshal(ev)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.pythonURL+"/score", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var parsed PythonRiskResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}

func (s *HashSentinel) worker(workerID int) {
	for job := range s.jobs {
		start := time.Now()
		ev := job.event
		nowMs := time.Now().UnixMilli()

		computedHash := canonicalPayloadHash(ev)
		anomaly := ""
		verified := true

		if ev.ClientPayloadHash != "" && ev.ClientPayloadHash != computedHash {
			verified = false
			anomaly = "HASH_MISMATCH_TAMPERING"
		} else if s.checkReplay(ev.Nonce, nowMs) {
			verified = false
			anomaly = "REPLAY_NONCE_DETECTED"
		} else if s.checkBurstAnomaly(nowMs) {
			anomaly = "BURST_SPIKE_WARNING"
		}

		block := s.appendBlock(workerID, ev, computedHash, verified, anomaly)
		s.processed.Add(1)

		if !verified {
			s.anomalies.Add(1)
			job.respChan <- EvaluatedResult{
				TxID:          ev.TxID,
				SentinelBlock: block,
				RiskLevel:     "ALTO",
				TotalLatency:  float64(time.Since(start).Microseconds()) / 1000.0,
				Decision:      "CUARENTENA_INTEGRIDAD",
				IntegrityOK:   false,
			}
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
		riskResp, err := s.callPythonML(ctx, ev)
		cancel()

		decision := "REVISION_ANALISTA"
		if err == nil && riskResp != nil {
			decision = riskResp.Decision
		}

		riskLevel := "BAJO"
		if decision == "REVISION_ANALISTA" || (riskResp != nil && riskResp.RiskScore >= 0.70) {
			riskLevel = "ALTO"
		} else if decision == "DESAFIO_BIOMETRICO" || (riskResp != nil && riskResp.RiskScore >= 0.35) {
			riskLevel = "MEDIO"
		}

		job.respChan <- EvaluatedResult{
			TxID:          ev.TxID,
			SentinelBlock: block,
			Risk:          riskResp,
			RiskLevel:     riskLevel,
			TotalLatency:  float64(time.Since(start).Microseconds()) / 1000.0,
			Decision:      decision,
			IntegrityOK:   true,
		}
	}
}

func (s *HashSentinel) Evaluate(ctx context.Context, ev TransactionEvent) (EvaluatedResult, error) {
	respChan := make(chan EvaluatedResult, 1)
	select {
	case s.jobs <- evalJob{event: ev, respChan: respChan}:
	case <-ctx.Done():
		return EvaluatedResult{}, ctx.Err()
	}

	select {
	case res := <-respChan:
		return res, nil
	case <-ctx.Done():
		return EvaluatedResult{}, ctx.Err()
	}
}

func (s *HashSentinel) cleanupNoncesLoop() {
	ticker := time.NewTicker(30 * time.Second)
	for range ticker.C {
		cutoff := time.Now().UnixMilli() - 5*60*1000
		s.nonceMu.Lock()
		for k, ts := range s.seenNonces {
			if ts < cutoff {
				delete(s.seenNonces, k)
			}
		}
		s.nonceMu.Unlock()
	}
}

func main() {
	pythonURL := os.Getenv("PYTHON_ML_URL")
	if pythonURL == "" {
		pythonURL = "http://127.0.0.1:8001"
	}
	hmacKey := os.Getenv("SENTINEL_HMAC_SECRET")
	if hmacKey == "" {
		hmacKey = "escudo-yuma-dev-hmac-key"
	}
	workers := runtime.NumCPU() * 4
	sentinel := NewHashSentinel(pythonURL, []byte(hmacKey), workers)

	mux := http.NewServeMux()
	mux.HandleFunc("/evaluate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var ev TransactionEvent
		if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 280*time.Millisecond)
		defer cancel()

		res, err := sentinel.Evaluate(ctx, ev)
		if err != nil {
			http.Error(w, "sla timeout", http.StatusGatewayTimeout)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"service":   "escudo-yuma-go-sentinel",
			"workers":   workers,
			"processed": sentinel.processed.Load(),
			"anomalies": sentinel.anomalies.Load(),
		})
	})

	addr := ":8080"
	log.Printf("Go Hash Sentinel active on %s with %d concurrent workers -> Python %s", addr, workers, pythonURL)
	log.Fatal(http.ListenAndServe(addr, mux))
}
