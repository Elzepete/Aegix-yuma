package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"escudo-yuma/internal/contexto"
	"escudo-yuma/internal/defensas"
	"escudo-yuma/internal/reglas"
	"escudo-yuma/internal/sandbox"
)

func TestColectorMetricas(t *testing.T) {
	c := NuevoColector()
	c.RegistrarTransaccion("sandbox", "aprobar", 100000, 4.5, nil, true)
	c.RegistrarTransaccion("sandbox", "desafiar", 250000, 8.2, []string{"cambio de SIM"}, true)
	c.RegistrarTransaccion("billetera", "retener", 1500000, 12.1, []string{"conexión por Tor"}, false)
	// Un rechazo por límite pasa por ambos registros; no debe contarse dos veces.
	c.RegistrarTransaccion("sandbox", "rechazar", 0, 0.3, []string{"límite"}, false)
	c.RegistrarRechazoLimite()
	c.RegistrarContingencia("tiempo_agotado")

	m := c.Obtener(2, 150)
	if m.Confirmadas != 2 {
		t.Fatalf("se esperaban 2 confirmadas, se obtuvo %d", m.Confirmadas)
	}
	if m.TotalEvaluadas != 4 {
		t.Fatalf("se esperaban 4 evaluadas, se obtuvo %d", m.TotalEvaluadas)
	}
	if m.Aprobadas != 1 || m.Desafios != 1 || m.Retenidas != 1 || m.Rechazos != 1 {
		t.Fatalf("conteo de decisiones inesperado: %+v", m)
	}
	if m.MontoTotalCOP != 1850000 {
		t.Fatalf("monto total inesperado: %d", m.MontoTotalCOP)
	}
	if m.MontoProtegidoCOP != 1750000 {
		t.Fatalf("monto protegido inesperado: %d", m.MontoProtegidoCOP)
	}
	if m.LatenciaP50MS <= 0 || m.LatenciaMediaMS <= 0 {
		t.Fatalf("latencias invalidas: p50=%.2f, media=%.2f", m.LatenciaP50MS, m.LatenciaMediaMS)
	}
	if m.CumplimientoSLAPct != 100.0 {
		t.Fatalf("se esperaba 100%% cumplimiento SLA, se obtuvo %.1f%%", m.CumplimientoSLAPct)
	}
	if m.Modalidades["cambio de SIM"] != 1 {
		t.Fatalf("modalidad 'cambio de SIM' no registrada")
	}
	if m.RechazosPorLimite != 1 {
		t.Fatalf("rechazos por límite inesperados: %d", m.RechazosPorLimite)
	}
	if m.PorOrigen["billetera"]["retener"] != 1 || m.PorOrigen["sandbox"]["aprobar"] != 1 {
		t.Fatalf("decisiones por origen inesperadas: %v", m.PorOrigen)
	}
	if m.Contingencias["tiempo_agotado"] != 1 {
		t.Fatalf("contingencias inesperadas: %v", m.Contingencias)
	}
	if h := m.HistogramaLatencia; len(h) != len(cubetasLatencia)+1 || h[0].Total != 2 || h[len(h)-1].Total != 4 {
		t.Fatalf("histograma inesperado: %v", h)
	}
	if m.Estado != "OPTIMO" {
		t.Fatalf("estado inesperado: %s", m.Estado)
	}

	// Probar exportación a Prometheus
	rec := httptest.NewRecorder()
	c.EscribirPrometheus(rec, m)
	body := rec.Body.String()
	if !strings.Contains(body, "aegix_transactions_total{decision=\"aprobar\"} 1") {
		t.Fatalf("formato prometheus inválido: %s", body)
	}
	for _, linea := range []string{
		`aegix_decisions_total{origen="billetera",decision="retener"} 1`,
		`aegix_decision_latency_ms_bucket{le="+Inf"} 4`,
		`aegix_decision_latency_ms_count 4`,
		`aegix_contingencies_total{tipo="tiempo_agotado"} 1`,
	} {
		if !strings.Contains(body, linea) {
			t.Fatalf("falta %q en prometheus: %s", linea, body)
		}
	}
	if !strings.Contains(body, "aegix_amount_cop_total 1850000") {
		t.Fatalf("monto en prometheus inválido: %s", body)
	}
}

func TestEndpointsMetricasHTTP(t *testing.T) {
	motor, err := reglas.Abrir(context.Background(), "../../config/reglas.yaml")
	if err != nil {
		t.Fatalf("no se pudo abrir config/reglas.yaml: %v", err)
	}
	cfg := Config{
		Origen:    contexto.Simulado{},
		Motor:     motor,
		Versiones: map[string]bool{"3.4.1": true},
		Limites:   defensas.Limites{Cliente: 10, IP: 100, Dispositivo: 10},
	}
	handler := Nuevo(sandbox.Nuevo("http://127.0.0.1:9999"), cfg)

	// GET /metricas (JSON)
	reqJSON := httptest.NewRequest(http.MethodGet, "/metricas", nil)
	recJSON := httptest.NewRecorder()
	handler.ServeHTTP(recJSON, reqJSON)
	if recJSON.Code != http.StatusOK {
		t.Fatalf("HTTP /metricas devolvió %d", recJSON.Code)
	}
	var data MetricasCompletas
	if err := json.Unmarshal(recJSON.Body.Bytes(), &data); err != nil {
		t.Fatalf("JSON /metricas inválido: %v", err)
	}
	if data.Version != "aegix-v2.0" {
		t.Fatalf("version inesperada: %s", data.Version)
	}

	// GET /metrics (Prometheus)
	reqProm := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	recProm := httptest.NewRecorder()
	handler.ServeHTTP(recProm, reqProm)
	if recProm.Code != http.StatusOK {
		t.Fatalf("HTTP /metrics devolvió %d", recProm.Code)
	}
	if !strings.Contains(recProm.Body.String(), "aegix_uptime_seconds") {
		t.Fatalf("cuerpo prometheus no contiene aegix_uptime_seconds: %s", recProm.Body.String())
	}
}
