package api

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// MetricasCompletas agrupa todas las métricas operativas, financieras, de latencia
// y de concurrencia del intermediario aegix para Yuma Pay.
type MetricasCompletas struct {
	// Compatibilidad heredada con contratos previos
	Confirmadas uint64  `json:"decisiones_confirmadas"`
	Desafios    uint64  `json:"desafios"`
	Tasa        float64 `json:"tasa_desafios"`

	// Métricas ampliadas de aegix
	Version            string            `json:"version"`
	Estado             string            `json:"estado"`
	UptimeSegundos     int64             `json:"uptime_segundos"`
	TotalEvaluadas     uint64            `json:"total_evaluadas"`
	Aprobadas          uint64            `json:"aprobadas"`
	Retenidas          uint64            `json:"retenidas"`
	Rechazos           uint64            `json:"rechazos"`
	RechazosPorLimite  uint64            `json:"rechazos_por_limite"`
	TasaAprobacion     float64           `json:"tasa_aprobacion"`
	TasaDesafios       float64           `json:"tasa_desafios_pct"`
	TasaRetencion      float64           `json:"tasa_retencion"`
	TasaRechazos       float64           `json:"tasa_rechazos"`
	MontoTotalCOP      int64             `json:"monto_total_cop"`
	MontoProtegidoCOP  int64             `json:"monto_protegido_cop"`
	LatenciaMediaMS    float64           `json:"latencia_media_ms"`
	LatenciaP50MS      float64           `json:"latencia_p50_ms"`
	LatenciaP90MS      float64           `json:"latencia_p90_ms"`
	LatenciaP95MS      float64           `json:"latencia_p95_ms"`
	LatenciaP99MS      float64           `json:"latencia_p99_ms"`
	SLAMaximoMS        float64           `json:"sla_maximo_ms"`
	CumplimientoSLAPct float64           `json:"cumplimiento_sla_pct"`
	TPSActual          float64           `json:"tps_actual"`
	TPSPico            float64           `json:"tps_pico"`
	TrabajosActivos    int               `json:"trabajos_activos"`
	CapacidadTrabajos  int               `json:"capacidad_trabajos"`
	Modalidades        map[string]uint64 `json:"modalidades_detectadas"`

	PorOrigen     map[string]map[string]uint64 `json:"decisiones_por_origen"`
	Contingencias map[string]uint64            `json:"contingencias"`
	// Histograma acumulado (no se reinicia con la ventana de percentiles).
	HistogramaLatencia []CubetaLatencia `json:"histograma_latencia_ms"`
	LatenciaSumaMS     float64          `json:"latencia_suma_ms"`
}

type CubetaLatencia struct {
	HastaMS float64 `json:"hasta_ms"`
	Total   uint64  `json:"total"`
}

// Límites superiores (ms) del histograma; el SLA de 300 ms tiene su propia cubeta.
var cubetasLatencia = [...]float64{5, 10, 25, 50, 100, 250, 300, 500, 1000}

type ColectorMetricas struct {
	inicio            time.Time
	totalEvaluadas    atomic.Uint64
	confirmadas       atomic.Uint64
	aprobadas         atomic.Uint64
	desafios          atomic.Uint64
	retenidas         atomic.Uint64
	rechazos          atomic.Uint64
	rechazosPorLimite atomic.Uint64
	montoTotalCOP     atomic.Int64
	montoProtegidoCOP atomic.Int64
	tpsPico           atomic.Uint64 // TPS * 100

	latMu     sync.Mutex
	latencias []float64
	latIndex  int
	latCount  int
	latSuma   float64
	histo     [len(cubetasLatencia) + 1]uint64 // la última es +Inf
	histoSuma float64

	modMu       sync.Mutex
	modalidades map[string]uint64
	porOrigen   map[string]map[string]uint64
	contingen   map[string]uint64

	tpsMu      sync.Mutex
	segundoAct int64
	cuentaSeg  uint64
	cuentaPrev uint64
}

const maxMuestrasLatencia = 2048

func NuevoColector() *ColectorMetricas {
	return &ColectorMetricas{
		inicio:      time.Now(),
		latencias:   make([]float64, maxMuestrasLatencia),
		modalidades: make(map[string]uint64),
		porOrigen:   make(map[string]map[string]uint64),
		contingen:   make(map[string]uint64),
	}
}

func (c *ColectorMetricas) RegistrarTransaccion(origen, accion string, montoCOP int64, latenciaMS float64, razones []string, confirmada bool) {
	c.acumular(origen, accion, montoCOP, latenciaMS, razones, confirmada)
	c.contarTPS()
}

// Restaurar suma una decisión leída de la auditoría al arrancar, sin tocar el conteo por segundo.
func (c *ColectorMetricas) Restaurar(origen, accion string, montoCOP int64, latenciaMS float64, razones []string, confirmada bool) {
	c.acumular(origen, accion, montoCOP, latenciaMS, razones, confirmada)
}

func (c *ColectorMetricas) acumular(origen, accion string, montoCOP int64, latenciaMS float64, razones []string, confirmada bool) {
	c.totalEvaluadas.Add(1)
	if confirmada {
		c.confirmadas.Add(1)
	}
	c.montoTotalCOP.Add(montoCOP)

	switch accion {
	case "aprobar":
		c.aprobadas.Add(1)
	case "desafiar":
		c.desafios.Add(1)
		c.montoProtegidoCOP.Add(montoCOP)
	case "retener":
		c.retenidas.Add(1)
		c.montoProtegidoCOP.Add(montoCOP)
	case "rechazar":
		c.rechazos.Add(1)
		c.montoProtegidoCOP.Add(montoCOP)
	}

	// Registrar latencia de forma eficiente
	c.latMu.Lock()
	if c.latCount < maxMuestrasLatencia {
		c.latencias[c.latCount] = latenciaMS
		c.latCount++
		c.latSuma += latenciaMS
	} else {
		c.latSuma -= c.latencias[c.latIndex]
		c.latencias[c.latIndex] = latenciaMS
		c.latSuma += latenciaMS
		c.latIndex = (c.latIndex + 1) % maxMuestrasLatencia
	}
	cubeta := len(cubetasLatencia)
	for i, limite := range cubetasLatencia {
		if latenciaMS <= limite {
			cubeta = i
			break
		}
	}
	c.histo[cubeta]++
	c.histoSuma += latenciaMS
	c.latMu.Unlock()

	c.modMu.Lock()
	for _, r := range razones {
		c.modalidades[r]++
	}
	if c.porOrigen[origen] == nil {
		c.porOrigen[origen] = make(map[string]uint64)
	}
	c.porOrigen[origen][accion]++
	c.modMu.Unlock()

}

// contarTPS lleva la cuenta por segundo; Restaurar no la usa porque las decisiones son del pasado.
func (c *ColectorMetricas) contarTPS() {
	ahoraSeg := time.Now().Unix()
	c.tpsMu.Lock()
	if ahoraSeg == c.segundoAct {
		c.cuentaSeg++
	} else {
		c.cuentaPrev = c.cuentaSeg
		c.cuentaSeg = 1
		c.segundoAct = ahoraSeg
		picoActual := c.tpsPico.Load()
		if c.cuentaPrev*100 > picoActual {
			c.tpsPico.Store(c.cuentaPrev * 100)
		}
	}
	c.tpsMu.Unlock()
}

// RegistrarRechazoLimite solo marca la causa: el rechazo ya se cuenta con RegistrarTransaccion.
func (c *ColectorMetricas) RegistrarRechazoLimite() {
	c.rechazosPorLimite.Add(1)
}

// RegistrarContingencia cuenta salidas degradadas: tiempo_agotado, origen_no_disponible, sandbox_sin_confirmar.
func (c *ColectorMetricas) RegistrarContingencia(tipo string) {
	c.modMu.Lock()
	c.contingen[tipo]++
	c.modMu.Unlock()
}

func (c *ColectorMetricas) Obtener(trabajosActivos, capacidad int) MetricasCompletas {
	conf := c.confirmadas.Load()
	des := c.desafios.Load()
	total := c.totalEvaluadas.Load()
	aprob := c.aprobadas.Load()
	ret := c.retenidas.Load()
	rech := c.rechazos.Load()

	m := MetricasCompletas{
		Version:           "aegix-v2.0",
		UptimeSegundos:    int64(time.Since(c.inicio).Seconds()),
		Confirmadas:       conf,
		Desafios:          des,
		TotalEvaluadas:    total,
		Aprobadas:         aprob,
		Retenidas:         ret,
		Rechazos:          rech,
		RechazosPorLimite: c.rechazosPorLimite.Load(),
		MontoTotalCOP:     c.montoTotalCOP.Load(),
		MontoProtegidoCOP: c.montoProtegidoCOP.Load(),
		SLAMaximoMS:       300.0,
		TrabajosActivos:   trabajosActivos,
		CapacidadTrabajos: capacidad,
	}

	if conf > 0 {
		m.Tasa = float64(des) / float64(conf)
	}
	if total > 0 {
		m.TasaAprobacion = float64(aprob) / float64(total)
		m.TasaDesafios = float64(des) / float64(total)
		m.TasaRetencion = float64(ret) / float64(total)
		m.TasaRechazos = float64(rech) / float64(total)
	}

	c.tpsMu.Lock()
	ahoraSeg := time.Now().Unix()
	if ahoraSeg == c.segundoAct {
		m.TPSActual = float64(c.cuentaSeg)
	} else if ahoraSeg == c.segundoAct+1 {
		m.TPSActual = float64(c.cuentaPrev)
	} else {
		m.TPSActual = 0
	}
	m.TPSPico = float64(c.tpsPico.Load()) / 100.0
	if m.TPSActual > m.TPSPico {
		m.TPSPico = m.TPSActual
	}
	c.tpsMu.Unlock()

	// Calcular percentiles precisos de latencia
	c.latMu.Lock()
	var acumulado uint64
	m.HistogramaLatencia = make([]CubetaLatencia, 0, len(c.histo))
	for i, total := range c.histo {
		acumulado += total
		hasta := -1.0 // JSON no admite +Inf: -1 marca la cubeta abierta
		if i < len(cubetasLatencia) {
			hasta = cubetasLatencia[i]
		}
		m.HistogramaLatencia = append(m.HistogramaLatencia, CubetaLatencia{HastaMS: hasta, Total: acumulado})
	}
	m.LatenciaSumaMS = math.Round(c.histoSuma*1000) / 1000
	n := c.latCount
	if n > 0 {
		copia := make([]float64, n)
		copy(copia, c.latencias[:n])
		m.LatenciaMediaMS = math.Round((c.latSuma/float64(n))*100) / 100
		c.latMu.Unlock()

		sort.Float64s(copia)
		m.LatenciaP50MS = percentil(copia, 0.50)
		m.LatenciaP90MS = percentil(copia, 0.90)
		m.LatenciaP95MS = percentil(copia, 0.95)
		m.LatenciaP99MS = percentil(copia, 0.99)

		dentroSLA := 0
		for _, v := range copia {
			if v <= 300.0 {
				dentroSLA++
			}
		}
		m.CumplimientoSLAPct = math.Round((float64(dentroSLA)/float64(n))*1000) / 10
	} else {
		c.latMu.Unlock()
		m.CumplimientoSLAPct = 100.0
	}

	c.modMu.Lock()
	m.Modalidades = make(map[string]uint64, len(c.modalidades))
	for k, v := range c.modalidades {
		m.Modalidades[k] = v
	}
	m.PorOrigen = make(map[string]map[string]uint64, len(c.porOrigen))
	for origen, conteo := range c.porOrigen {
		m.PorOrigen[origen] = make(map[string]uint64, len(conteo))
		for accion, v := range conteo {
			m.PorOrigen[origen][accion] = v
		}
	}
	m.Contingencias = make(map[string]uint64, len(c.contingen))
	for k, v := range c.contingen {
		m.Contingencias[k] = v
	}
	c.modMu.Unlock()

	switch {
	case m.CumplimientoSLAPct >= 99:
		m.Estado = "OPTIMO"
	case m.CumplimientoSLAPct >= 95:
		m.Estado = "DEGRADADO"
	default:
		m.Estado = "CRITICO"
	}

	return m
}

func percentil(ordenados []float64, p float64) float64 {
	if len(ordenados) == 0 {
		return 0
	}
	idx := int(float64(len(ordenados)-1) * p)
	return math.Round(ordenados[idx]*100) / 100
}

func (c *ColectorMetricas) EscribirPrometheus(w http.ResponseWriter, m MetricasCompletas) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, "# HELP aegix_uptime_seconds Tiempo de actividad del intermediario aegix en segundos\n")
	fmt.Fprintf(w, "# TYPE aegix_uptime_seconds counter\n")
	fmt.Fprintf(w, "aegix_uptime_seconds %d\n\n", m.UptimeSegundos)

	fmt.Fprintf(w, "# HELP aegix_transactions_total Total de transacciones evaluadas por decision\n")
	fmt.Fprintf(w, "# TYPE aegix_transactions_total counter\n")
	fmt.Fprintf(w, "aegix_transactions_total{decision=\"aprobar\"} %d\n", m.Aprobadas)
	fmt.Fprintf(w, "aegix_transactions_total{decision=\"desafiar\"} %d\n", m.Desafios)
	fmt.Fprintf(w, "aegix_transactions_total{decision=\"retener\"} %d\n", m.Retenidas)
	fmt.Fprintf(w, "aegix_transactions_total{decision=\"rechazar\"} %d\n", m.Rechazos)
	fmt.Fprintf(w, "aegix_transactions_total{status=\"confirmada_sandbox\"} %d\n\n", m.Confirmadas)

	fmt.Fprintf(w, "# HELP aegix_rate_limit_rejected_total Total de solicitudes bloqueadas por exceder limite de tasa\n")
	fmt.Fprintf(w, "# TYPE aegix_rate_limit_rejected_total counter\n")
	fmt.Fprintf(w, "aegix_rate_limit_rejected_total %d\n\n", m.RechazosPorLimite)

	fmt.Fprintf(w, "# HELP aegix_amount_cop_total Monto acumulado evaluado en pesos colombianos (COP)\n")
	fmt.Fprintf(w, "# TYPE aegix_amount_cop_total counter\n")
	fmt.Fprintf(w, "aegix_amount_cop_total %d\n\n", m.MontoTotalCOP)

	fmt.Fprintf(w, "# HELP aegix_fraud_prevented_cop_total Monto retenido o bloqueado para proteccion de fondos en COP\n")
	fmt.Fprintf(w, "# TYPE aegix_fraud_prevented_cop_total counter\n")
	fmt.Fprintf(w, "aegix_fraud_prevented_cop_total %d\n\n", m.MontoProtegidoCOP)

	fmt.Fprintf(w, "# HELP aegix_latency_ms Latencia de decision del intermediario aegix en milisegundos\n")
	fmt.Fprintf(w, "# TYPE aegix_latency_ms gauge\n")
	fmt.Fprintf(w, "aegix_latency_ms{quantile=\"0.50\"} %.2f\n", m.LatenciaP50MS)
	fmt.Fprintf(w, "aegix_latency_ms{quantile=\"0.90\"} %.2f\n", m.LatenciaP90MS)
	fmt.Fprintf(w, "aegix_latency_ms{quantile=\"0.95\"} %.2f\n", m.LatenciaP95MS)
	fmt.Fprintf(w, "aegix_latency_ms{quantile=\"0.99\"} %.2f\n", m.LatenciaP99MS)
	fmt.Fprintf(w, "aegix_latency_ms{type=\"mean\"} %.2f\n\n", m.LatenciaMediaMS)

	fmt.Fprintf(w, "# HELP aegix_sla_compliance_percent Porcentaje de decisiones completadas dentro del SLA de 300ms\n")
	fmt.Fprintf(w, "# TYPE aegix_sla_compliance_percent gauge\n")
	fmt.Fprintf(w, "aegix_sla_compliance_percent %.1f\n\n", m.CumplimientoSLAPct)

	fmt.Fprintf(w, "# HELP aegix_tps_current Transacciones por segundo calculadas en la ventana actual\n")
	fmt.Fprintf(w, "# TYPE aegix_tps_current gauge\n")
	fmt.Fprintf(w, "aegix_tps_current %.2f\n\n", m.TPSActual)

	fmt.Fprintf(w, "# HELP aegix_workers_active Goroutines o workers concurrentes en ejecucion\n")
	fmt.Fprintf(w, "# TYPE aegix_workers_active gauge\n")
	fmt.Fprintf(w, "aegix_workers_active %d\n\n", m.TrabajosActivos)

	fmt.Fprintf(w, "# HELP aegix_decisions_total Decisiones por origen (sandbox del reto o billetera Yuma)\n")
	fmt.Fprintf(w, "# TYPE aegix_decisions_total counter\n")
	for _, origen := range ordenadas(m.PorOrigen) {
		for _, accion := range ordenadas(m.PorOrigen[origen]) {
			fmt.Fprintf(w, "aegix_decisions_total{origen=%q,decision=%q} %d\n", origen, accion, m.PorOrigen[origen][accion])
		}
	}

	fmt.Fprintf(w, "\n# HELP aegix_contingencies_total Salidas degradadas por tipo\n")
	fmt.Fprintf(w, "# TYPE aegix_contingencies_total counter\n")
	for _, tipo := range ordenadas(m.Contingencias) {
		fmt.Fprintf(w, "aegix_contingencies_total{tipo=%q} %d\n", tipo, m.Contingencias[tipo])
	}

	fmt.Fprintf(w, "\n# HELP aegix_decision_latency_ms Histograma de latencia de decision en milisegundos\n")
	fmt.Fprintf(w, "# TYPE aegix_decision_latency_ms histogram\n")
	for _, cubeta := range m.HistogramaLatencia {
		le := "+Inf"
		if cubeta.HastaMS >= 0 {
			le = fmt.Sprint(cubeta.HastaMS)
		}
		fmt.Fprintf(w, "aegix_decision_latency_ms_bucket{le=%q} %d\n", le, cubeta.Total)
	}
	var total uint64
	if n := len(m.HistogramaLatencia); n > 0 {
		total = m.HistogramaLatencia[n-1].Total
	}
	fmt.Fprintf(w, "aegix_decision_latency_ms_sum %.3f\n", m.LatenciaSumaMS)
	fmt.Fprintf(w, "aegix_decision_latency_ms_count %d\n", total)
}

func ordenadas[V any](m map[string]V) []string {
	claves := make([]string, 0, len(m))
	for k := range m {
		claves = append(claves, k)
	}
	sort.Strings(claves)
	return claves
}
