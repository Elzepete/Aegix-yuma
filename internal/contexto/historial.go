package contexto

import (
	"slices"
	"sync"
	"time"
)

const FormatoFecha = "2006-01-02 15:04:05"

var Colombia = time.FixedZone("America/Bogota", -5*60*60)

type observacion struct {
	fecha time.Time
	pais  string
	monto int64
}

type Historial struct {
	mu       sync.Mutex
	clientes map[string]map[string]observacion
	// pagadores: clientes distintos que ya le pagaron a cada comercio, hasta el tope que piden las reglas.
	pagadores map[string]map[string]struct{}
}

func NuevoHistorial() *Historial {
	return &Historial{clientes: make(map[string]map[string]observacion), pagadores: make(map[string]map[string]struct{})}
}

// ClientesPrevios dice cuántos clientes distintos de este le pagaron antes al destino (como máximo tope) y anota
// a este cliente. Un comercio de engaño con QR recién creado no tiene pagos previos de nadie.
// shortcut: vive en memoria y empieza vacío al reiniciar; en producción saldría del registro de comercios de Yuma.
func (h *Historial) ClientesPrevios(destino, cliente string, tope int) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	clientes := h.pagadores[destino]
	if clientes == nil {
		clientes = make(map[string]struct{})
		h.pagadores[destino] = clientes
	}
	_, ya := clientes[cliente]
	otros := len(clientes)
	if ya {
		otros--
	}
	if !ya && len(clientes) < tope+1 { // basta con saber si llega al tope
		clientes[cliente] = struct{}{}
	}
	return min(otros, tope)
}

type Resumen struct {
	HoraAtipica, PaisNuevo bool
	PercentilMonto         int64
	SalidasRecientes       int
}

type Ventanas struct {
	DiasMonto, Percentil, MinMontos, MinutosSalidas int
}

// Observar usa solo operaciones anteriores y deduplica por identificador.
func (h *Historial) Observar(cliente, operacion string, fecha time.Time, origen Origen, monto int64, ventanas Ventanas) Resumen {
	h.mu.Lock()
	defer h.mu.Unlock()
	operaciones := h.clientes[cliente]
	if operaciones == nil {
		operaciones = make(map[string]observacion)
		h.clientes[cliente] = operaciones
	}
	var horas [24]int
	paises := make(map[string]int)
	total, totalPaises := 0, 0
	var resumen Resumen
	var montos []int64
	desdeMonto := fecha.AddDate(0, 0, -ventanas.DiasMonto)
	desdeSalidas := fecha.Add(-time.Duration(ventanas.MinutosSalidas) * time.Minute)
	for id, previa := range operaciones {
		if id == operacion || !previa.fecha.Before(fecha) {
			continue
		}
		total++
		if !previa.fecha.Before(desdeMonto) {
			montos = append(montos, previa.monto)
		}
		if !previa.fecha.Before(desdeSalidas) {
			resumen.SalidasRecientes++
		}
		horas[previa.fecha.In(Colombia).Hour()]++
		if previa.pais != "" {
			paises[previa.pais]++
			totalPaises++
		}
	}
	if total >= 10 {
		hora := fecha.In(Colombia).Hour()
		vecinas := horas[(hora+23)%24] + horas[hora] + horas[(hora+1)%24]
		resumen.HoraAtipica = vecinas*10 < total
	}
	resumen.PaisNuevo = origen.Pais != "" && totalPaises >= 10 && paises[origen.Pais] == 0
	if len(montos) >= ventanas.MinMontos {
		slices.Sort(montos)
		indice := (ventanas.Percentil*len(montos)+99)/100 - 1
		resumen.PercentilMonto = montos[indice]
	}
	if _, existe := operaciones[operacion]; !existe {
		operaciones[operacion] = observacion{fecha: fecha, pais: origen.Pais, monto: monto}
	}
	return resumen
}
