package registro

import (
	"bufio"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"escudo-yuma/internal/contexto"
)

type Entrada struct {
	Tipo    string `json:"tipo_operacion"`
	Canal   string `json:"canal"`
	Fecha   string `json:"fecha_hora"`
	Nuevo   bool   `json:"dispositivo_nuevo"`
	SIM     bool   `json:"cambio_sim"`
	Clave   bool   `json:"cambio_clave"`
	Destino bool   `json:"destino_nuevo"`
	Monto   int64  `json:"monto_cop"`
	// Preferencias de contacto del cliente, para el analista. No influyen en la decisión.
	Accesibilidad *contexto.Accesibilidad `json:"accesibilidad,omitempty"`
}

type Evento struct {
	ID         string    `json:"referencia,omitempty"`
	Origen     string    `json:"origen,omitempty"` // billetera o sandbox
	Entrada    *Entrada  `json:"entrada,omitempty"`
	Accion     string    `json:"decision"`
	Puntaje    float64   `json:"puntaje"`
	Razones    []string  `json:"razones"`
	Version    string    `json:"version_reglas"`
	LatenciaMS float64   `json:"latencia_ms"`
	Fecha      time.Time `json:"registrado_en"`
	Confirmada bool      `json:"confirmada_por_sandbox"`
	// Resolucion marca un evento del analista sobre una retención previa con la misma referencia:
	// "liberar" (falso positivo, la plata sale) o "confirmar_fraude" (la operación queda bloqueada).
	Resolucion string     `json:"resolucion,omitempty"`
	ResueltaEn *time.Time `json:"resuelta_en,omitempty"`
	// Analista que resolvió (usuario de la consola con su rol); vacío si la consola no exige ingreso.
	Analista string `json:"analista,omitempty"`
	// HashAnterior encadena la auditoría: SHA-256 de la línea anterior tal como quedó escrita.
	// Cada línea termina además en "sello", un HMAC-SHA256 de la línea (ver cadena.go).
	HashAnterior string `json:"hash_anterior,omitempty"`
}

var (
	ErrCasoNoEncontrado  = errors.New("no hay una retención con esa referencia")
	ErrYaResuelto        = errors.New("el caso ya fue resuelto")
	ErrAuditoriaSaturada = errors.New("la auditoría está saturada; intenta de nuevo")
)

type resolucion struct {
	accion   string
	fecha    time.Time
	analista string
}

type Indicadores struct {
	Total     uint64 `json:"decisiones_registradas"`
	Aprobadas uint64 `json:"aprobadas"`
	Desafios  uint64 `json:"desafios"`
	Retenidas uint64 `json:"retenidas"`
	Rechazos  uint64 `json:"rechazos"`
	Omitidas  uint64 `json:"omisiones_auditoria"`
	// Etiquetas confirmadas por analistas: la base para recalibrar reglas o entrenar un modelo.
	Liberadas          uint64 `json:"liberadas_por_analista"`
	FraudesConfirmados uint64 `json:"fraudes_confirmados"`
}

const (
	maxAlertas   = 1000
	maxRecientes = 300
)

type Registro struct {
	mu           sync.RWMutex
	totales      Indicadores
	alertas      []Evento
	recientes    []Evento // todas las decisiones, aprobadas incluidas
	retenidas    map[string]struct{}
	resoluciones map[string]resolucion
	pendientes   chan Evento
	terminado    chan struct{}
	omitidas     atomic.Uint64
	clave        []byte
	ruta         string
	anterior     string // hash de la última línea escrita; solo lo usan Abrir y el escritor
}

func Abrir(ruta, clave string) (*Registro, error) {
	r := &Registro{
		pendientes:   make(chan Evento, 1024),
		terminado:    make(chan struct{}),
		clave:        []byte(clave),
		ruta:         ruta,
		retenidas:    make(map[string]struct{}),
		resoluciones: make(map[string]resolucion),
	}
	if len(r.clave) == 0 {
		// Sin YUMA_AUDIT_KEY la clave se guarda junto a la auditoría: si cambiara en cada arranque,
		// las referencias viejas dejarían de coincidir y la billetera perdería sus operaciones.
		clave, err := leerOCrearClave(ruta + ".clave")
		if err != nil {
			return nil, err
		}
		r.clave = clave
	}
	f, err := os.OpenFile(ruta, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0600)
	if err != nil {
		return nil, err
	}
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return nil, err
	}
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 4096), 1<<20)
	for s.Scan() {
		var e Evento
		if err := json.Unmarshal(s.Bytes(), &e); err != nil {
			f.Close()
			return nil, fmt.Errorf("registro de auditoría inválido: %w", err)
		}
		r.agregar(e)
		r.anterior = resumen(s.Bytes())
	}
	if err := s.Err(); err != nil {
		f.Close()
		return nil, err
	}
	sello := r.claveSello()
	go func() {
		defer close(r.terminado)
		defer f.Close()
		for e := range r.pendientes {
			e.HashAnterior = r.anterior
			linea, err := sellar(sello, e)
			if err == nil {
				_, err = f.Write(append(linea, '\n')) // una sola escritura por línea
			}
			if err != nil {
				r.omitidas.Add(1)
				continue
			}
			r.anterior = resumen(linea)
			r.agregar(e)
		}
	}()
	return r, nil
}

func (r *Registro) Close() {
	close(r.pendientes)
	<-r.terminado
}

func leerOCrearClave(ruta string) ([]byte, error) {
	if datos, err := os.ReadFile(ruta); err == nil {
		clave, err := hex.DecodeString(strings.TrimSpace(string(datos)))
		if err != nil || len(clave) < 16 {
			return nil, fmt.Errorf("clave de auditoría inválida en %s", ruta)
		}
		return clave, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	clave := make([]byte, 32)
	if _, err := rand.Read(clave); err != nil {
		return nil, err
	}
	// O_EXCL: si otro proceso la creó primero, no se pisa.
	f, err := os.OpenFile(ruta, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("no se pudo guardar la clave de auditoría: %w", err)
	}
	defer f.Close()
	if _, err := f.WriteString(hex.EncodeToString(clave) + "\n"); err != nil {
		return nil, err
	}
	return clave, nil
}

// Recorrer vuelve a leer la auditoría y entrega cada decisión (no las resoluciones), en orden.
// Se usa al arrancar para reconstruir las métricas que viven en memoria.
func (r *Registro) Recorrer(fn func(Evento)) error {
	f, err := os.Open(r.ruta)
	if err != nil {
		return err
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 4096), 1<<20)
	for s.Scan() {
		var e Evento
		if err := json.Unmarshal(s.Bytes(), &e); err != nil {
			return fmt.Errorf("registro de auditoría inválido: %w", err)
		}
		if e.Resolucion == "" {
			fn(e)
		}
	}
	return s.Err()
}

// Referencia es el seudónimo HMAC con el que la auditoría guarda un identificador de transacción.
func (r *Registro) Referencia(id string) string {
	h := hmac.New(sha256.New, r.clave)
	_, _ = h.Write([]byte(id))
	return hex.EncodeToString(h.Sum(nil))
}

func (r *Registro) Guardar(e Evento) {
	if e.ID != "" {
		e.ID = r.Referencia(e.ID)
	}
	select {
	case r.pendientes <- e:
	default:
		r.omitidas.Add(1)
	}
}

// Resolver registra la decisión del analista sobre una retención. Se aplica en memoria y se escribe
// en la auditoría; si la auditoría no la acepta, se deshace, porque una resolución sin rastro no vale.
func (r *Registro) Resolver(ref, accion, analista string, ahora time.Time) error {
	if accion != "liberar" && accion != "confirmar_fraude" {
		return fmt.Errorf("resolución inválida: use liberar o confirmar_fraude")
	}
	e := Evento{ID: ref, Resolucion: accion, Fecha: ahora, Analista: analista}
	r.mu.Lock()
	if _, ok := r.retenidas[ref]; !ok {
		r.mu.Unlock()
		return ErrCasoNoEncontrado
	}
	if _, ya := r.resoluciones[ref]; ya {
		r.mu.Unlock()
		return ErrYaResuelto
	}
	r.aplicarResolucion(e, 1)
	r.mu.Unlock()
	select {
	case r.pendientes <- e:
		return nil
	default:
		r.mu.Lock()
		r.aplicarResolucion(e, -1)
		r.mu.Unlock()
		return ErrAuditoriaSaturada
	}
}

// aplicarResolucion requiere r.mu; signo -1 deshace una resolución que no llegó a la auditoría.
func (r *Registro) aplicarResolucion(e Evento, signo int) {
	if signo > 0 {
		r.resoluciones[e.ID] = resolucion{accion: e.Resolucion, fecha: e.Fecha, analista: e.Analista}
	} else {
		delete(r.resoluciones, e.ID)
	}
	contador := &r.totales.Liberadas
	if e.Resolucion == "confirmar_fraude" {
		contador = &r.totales.FraudesConfirmados
	}
	*contador = uint64(int64(*contador) + int64(signo))
}

// Estado responde en_revision, liberada, fraude_confirmado o desconocida para una referencia.
func (r *Registro) Estado(ref string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if res, ok := r.resoluciones[ref]; ok {
		if res.accion == "liberar" {
			return "liberada"
		}
		return "fraude_confirmado"
	}
	if _, ok := r.retenidas[ref]; ok {
		return "en_revision"
	}
	return "desconocida"
}

func (r *Registro) agregar(e Evento) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if e.Resolucion != "" {
		// Al escribir, la resolución ya está aplicada; al releer el archivo, se aplica aquí.
		if _, ya := r.resoluciones[e.ID]; !ya {
			r.aplicarResolucion(e, 1)
		}
		return
	}
	if e.Accion == "retener" && e.ID != "" {
		r.retenidas[e.ID] = struct{}{}
	}
	if len(r.recientes) < maxRecientes {
		r.recientes = append(r.recientes, e)
	} else {
		copy(r.recientes, r.recientes[1:])
		r.recientes[len(r.recientes)-1] = e
	}
	r.totales.Total++
	switch e.Accion {
	case "aprobar":
		r.totales.Aprobadas++
	case "desafiar":
		r.totales.Desafios++
	case "retener":
		r.totales.Retenidas++
	case "rechazar":
		r.totales.Rechazos++
	}
	if e.Accion != "aprobar" {
		if len(r.alertas) < maxAlertas {
			r.alertas = append(r.alertas, e)
		} else {
			copy(r.alertas, r.alertas[1:])
			r.alertas[len(r.alertas)-1] = e
		}
	}
}

func (r *Registro) Indicadores() Indicadores {
	r.mu.RLock()
	defer r.mu.RUnlock()
	i := r.totales
	i.Omitidas = r.omitidas.Load()
	return i
}

// conResolucion copia la lista y le agrega la resolución del analista; requiere r.mu.
func (r *Registro) conResolucion(eventos []Evento) []Evento {
	lista := append(make([]Evento, 0, len(eventos)), eventos...)
	for i := range lista {
		if res, ok := r.resoluciones[lista[i].ID]; ok {
			fecha := res.fecha
			lista[i].Resolucion, lista[i].ResueltaEn, lista[i].Analista = res.accion, &fecha, res.analista
		}
	}
	return lista
}

// Recientes devuelve las últimas decisiones de cualquier tipo, de la más nueva a la más vieja.
func (r *Registro) Recientes() []Evento {
	r.mu.RLock()
	lista := r.conResolucion(r.recientes)
	r.mu.RUnlock()
	for i, j := 0, len(lista)-1; i < j; i, j = i+1, j-1 {
		lista[i], lista[j] = lista[j], lista[i]
	}
	return lista
}

func (r *Registro) Alertas() []Evento {
	r.mu.RLock()
	lista := r.conResolucion(r.alertas)
	r.mu.RUnlock()
	sort.SliceStable(lista, func(i, j int) bool {
		if lista[i].Puntaje != lista[j].Puntaje {
			return lista[i].Puntaje > lista[j].Puntaje
		}
		return lista[i].Fecha.After(lista[j].Fecha)
	})
	return lista
}
