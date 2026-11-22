package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestSentinelDetectsTamperingAndReplayConcurrency(t *testing.T) {
	mockPython := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(PythonRiskResponse{
			RiskScore:   0.18,
			Decision:    "APROBADA",
			ActionNote:  "Nominal",
			Modality:    "Comportamiento Transaccional Nominal",
			InferenceMs: 1.4,
		})
	}))
	defer mockPython.Close()

	sentinel := NewHashSentinel(mockPython.URL, []byte("test-secret"), 8)

	// 1. Validar concurrencia de 150 transacciones bajo SLA de 300ms
	var wg sync.WaitGroup
	for i := 0; i < 150; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			ev := TransactionEvent{
				TxID:        fmt.Sprintf("TX-%d", idx),
				TimestampMs: time.Now().UnixMilli(),
				Nonce:       fmt.Sprintf("nonce-%d", idx),
				Channel:     "transferencia_llave",
				AmountCOP:   185000,
				Hour:        14,
				SourceHash:  "src_abc",
				DestHash:    "dst_xyz",
			}
			res, err := sentinel.Evaluate(context.Background(), ev)
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if !res.IntegrityOK {
				t.Errorf("expected integrity ok for %s", ev.TxID)
			}
			if res.TotalLatency > 300.0 {
				t.Errorf("SLA violated: %.2f ms", res.TotalLatency)
			}
		}(i)
	}
	wg.Wait()

	// 2. Validar detección de alteración de hash (Tampering)
	tampered := TransactionEvent{
		TxID:              "TX-TAMPER",
		TimestampMs:       time.Now().UnixMilli(),
		Nonce:             "nonce-tamper",
		Channel:           "pago_qr",
		AmountCOP:         950000,
		SourceHash:        "src_abc",
		DestHash:          "dst_xyz",
		ClientPayloadHash: "deadbeef00000000000000000000000000000000000000000000000000000000",
	}
	res, err := sentinel.Evaluate(context.Background(), tampered)
	if err != nil || res.IntegrityOK || res.Decision != "CUARENTENA_INTEGRIDAD" {
		t.Fatalf("expected quarantine on hash mismatch, got %+v (err=%v)", res, err)
	}

	// 3. Validar detección de ataque Replay
	replayEv := TransactionEvent{
		TxID:        "TX-REPLAY",
		TimestampMs: time.Now().UnixMilli(),
		Nonce:       "nonce-1", // Reutilizado
		Channel:     "transferencia_llave",
		AmountCOP:   185000,
		SourceHash:  "src_abc",
		DestHash:    "dst_xyz",
	}
	resReplay, err := sentinel.Evaluate(context.Background(), replayEv)
	if err != nil || resReplay.IntegrityOK || resReplay.SentinelBlock.AnomalyType != "REPLAY_NONCE_DETECTED" {
		t.Fatalf("expected replay detection, got %+v", resReplay)
	}
}
