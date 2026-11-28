package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"math"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"time"

	"escudo-yuma/internal/avisos"
	"escudo-yuma/internal/contexto"
	"escudo-yuma/internal/defensas"
	"escudo-yuma/internal/registro"
	"escudo-yuma/internal/reglas"
	"escudo-yuma/internal/sandbox"
)

type Respuesta struct {
	sandbox.Decision
	VersionReglas string  `json:"version_reglas"`
	LatenciaMS    float64 `json:"latencia_ms"`
}

type Config struct {
	Origen       contexto.Proveedor
	IPDeConexion bool
	Versiones    map[string]bool
	Limites      defensas.Limites
	Motor        *reglas.Motor
	Registro     *registro.Registro
	ClavePanel   string
	Avisos       *avisos.Avisador // opcional: avisos al celular de lo que pasa con la billetera
}

const tiempoEvaluacion = 250 * time.Millisecond

// registrarDecision deja en el log todo el contexto de una decisión de la billetera, sin datos personales:
// ni IP, ni huella del dispositivo, ni identificadores en claro (la referencia es el seudónimo HMAC recortado).
func registrarDecision(origen string, cfg *reglas.Config, e defensas.Solicitud, d sandbox.Decision, s Respuesta, ref string) {
	t, c := e.Transaccion, e.Contexto
	nivel := slog.LevelInfo
	if d.Accion == "retener" || d.Accion == "rechazar" {
		nivel = slog.LevelWarn
	}
	sobreSaldo := 0.0
	if t.SaldoAntesCOP > 0 {
		sobreSaldo = float64(t.MontoCOP) / float64(t.SaldoAntesCOP)
	}
	contacto := ""
	if c.Accesibilidad != nil {
		contacto = c.Accesibilidad.Contacto
	}
	slog.Log(context.Background(), nivel, "decision",
		"origen", origen, "referencia", ref, "decision", d.Accion, "puntaje", d.Puntaje,
		"nivel_riesgo", cfg.Umbrales.ClasificarRiesgo(d.Puntaje), "razones", d.Razones,
		"version_reglas", cfg.Version, "latencia_ms", s.LatenciaMS,
		slog.Group("operacion", "tipo", t.TipoOperacion, "canal", t.Canal, "monto_cop", t.MontoCOP,
			"monto_sobre_saldo", math.Round(sobreSaldo*100)/100, "tipo_destino", t.TipoDestino,
			"antiguedad_cuenta_dias", t.AntiguedadCuentaDias, "fecha_hora", t.FechaHora),
		slog.Group("senales", "dispositivo_nuevo", t.DispositivoNuevo == 1, "destino_nuevo", t.DestinoNuevo == 1,
			"cambio_sim_48h", t.CambioSIM48h == 1, "cambio_clave_24h", t.CambioClave24h == 1,
			"departamento_distinto", t.IPDepartamentoDistinto == 1, "tor", c.EsTor, "proxy", c.EsProxyODatacenter,
			"pais_ip", c.PaisIP),
		slog.Group("app", "version", c.VersionApp, "sistema_operativo", c.SistemaOperativo),
		"contacto_accesible", contacto)
}

// resumenPeriodico escribe cada minuto, si hubo actividad, los totales y la latencia: así el log cuenta
// también lo que pasa con el simulador sin una línea por operación.
func resumenPeriodico(colector *ColectorMetricas, trabajos chan struct{}) {
	var previo uint64
	for range time.Tick(time.Minute) {
		m := colector.Obtener(len(trabajos), cap(trabajos))
		if m.TotalEvaluadas == previo {
			continue
		}
		slog.Info("resumen_minuto", "estado", m.Estado, "evaluadas_total", m.TotalEvaluadas,
			"nuevas", m.TotalEvaluadas-previo, "aprobadas", m.Aprobadas, "retenidas", m.Retenidas,
			"rechazos", m.Rechazos, "rechazos_por_limite", m.RechazosPorLimite, "tps_actual", m.TPSActual,
			"tps_pico", m.TPSPico, "latencia_p50_ms", m.LatenciaP50MS, "latencia_p99_ms", m.LatenciaP99MS,
			"cumplimiento_sla_pct", m.CumplimientoSLAPct, "monto_protegido_cop", m.MontoProtegidoCOP,
			"por_origen", m.PorOrigen)
		previo = m.TotalEvaluadas
	}
}

// referenciaCorta: los logs llevan el seudónimo HMAC recortado, nunca el identificador de la billetera.
func referenciaCorta(r *registro.Registro, id string) string {
	if r == nil || id == "" {
		return ""
	}
	return r.Referencia(id)[:16]
}

var analistaValido = regexp.MustCompile(`^[a-z0-9._-]{1,32} \((admin|analista|auditor|empleado)\)$`)

type conteos struct {
	Confirmadas uint64  `json:"decisiones_confirmadas"`
	Desafios    uint64  `json:"desafios"`
	Tasa        float64 `json:"tasa_desafios"`
}

func Nuevo(cliente *sandbox.Cliente, cfg Config) http.Handler {
	limitador := defensas.NuevoLimitador(cfg.Limites)
	historial := contexto.NuevoHistorial()
	mux := http.NewServeMux()
	trabajos := make(chan struct{}, 150)
	colector := NuevoColector()
	go resumenPeriodico(colector, trabajos)
	if cfg.Registro != nil {
		// Las métricas viven en memoria: se reconstruyen desde la auditoría para no perderlas al reiniciar.
		err := cfg.Registro.Recorrer(func(e registro.Evento) {
			origen, monto := e.Origen, int64(0)
			if origen == "" {
				origen = "sandbox" // eventos anteriores a que se guardara el origen
			}
			if e.Entrada != nil {
				monto = e.Entrada.Monto
			}
			colector.Restaurar(origen, e.Accion, monto, e.LatenciaMS, e.Razones, e.Confirmada)
			if len(e.Razones) == 1 && strings.HasPrefix(e.Razones[0], "límite de solicitudes") {
				colector.RegistrarRechazoLimite()
			}
		})
		if err != nil {
			log.Printf("no se pudieron reconstruir las métricas desde la auditoría: %v", err)
		}
	}

	mux.HandleFunc("GET /metricas", func(w http.ResponseWriter, _ *http.Request) {
		m := colector.Obtener(len(trabajos), cap(trabajos))
		responder(w, http.StatusOK, m)
	})
	mux.HandleFunc("GET /api/metricas", func(w http.ResponseWriter, _ *http.Request) {
		m := colector.Obtener(len(trabajos), cap(trabajos))
		responder(w, http.StatusOK, m)
	})
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		m := colector.Obtener(len(trabajos), cap(trabajos))
		colector.EscribirPrometheus(w, m)
	})
	proteger := func(w http.ResponseWriter, r *http.Request) bool {
		if cfg.ClavePanel == "" {
			return true
		}
		esperada := sha256.Sum256([]byte("Bearer " + cfg.ClavePanel))
		recibida := sha256.Sum256([]byte(r.Header.Get("Authorization")))
		if subtle.ConstantTimeCompare(esperada[:], recibida[:]) == 1 {
			return true
		}
		responder(w, http.StatusUnauthorized, map[string]string{"error": "credencial de panel requerida"})
		return false
	}
	if cfg.Registro != nil {
		mux.HandleFunc("GET /alertas", func(w http.ResponseWriter, r *http.Request) {
			if proteger(w, r) {
				responder(w, http.StatusOK, cfg.Registro.Alertas())
			}
		})
		mux.HandleFunc("GET /indicadores", func(w http.ResponseWriter, r *http.Request) {
			if proteger(w, r) {
				responder(w, http.StatusOK, cfg.Registro.Indicadores())
			}
		})
		mux.HandleFunc("POST /alertas/{ref}/resolucion", func(w http.ResponseWriter, r *http.Request) {
			if !proteger(w, r) {
				return
			}
			var cuerpo struct {
				Resolucion string `json:"resolucion"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&cuerpo); err != nil {
				responder(w, http.StatusBadRequest, map[string]string{"error": "se espera {\"resolucion\": \"liberar\" | \"confirmar_fraude\"}"})
				return
			}
			ref := r.PathValue("ref")
			// La consola dice quién resolvió; solo ella llega aquí, con el token del panel.
			analista := r.Header.Get("X-Aegix-Analista")
			if !analistaValido.MatchString(analista) {
				analista = ""
			}
			err := cfg.Registro.Resolver(ref, cuerpo.Resolucion, analista, time.Now().UTC())
			switch {
			case errors.Is(err, registro.ErrCasoNoEncontrado):
				responder(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			case errors.Is(err, registro.ErrYaResuelto):
				responder(w, http.StatusConflict, map[string]string{"error": err.Error(), "estado": cfg.Registro.Estado(ref)})
			case errors.Is(err, registro.ErrAuditoriaSaturada):
				responder(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			case err != nil:
				responder(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			default:
				slog.Info("resolucion", "referencia", ref[:16], "accion", cuerpo.Resolucion, "analista", analista)
				cfg.Avisos.Resolucion(cuerpo.Resolucion)
				responder(w, http.StatusOK, map[string]string{"estado": cfg.Registro.Estado(ref)})
			}
		})
		mux.HandleFunc("GET /auditoria/verificar", func(w http.ResponseWriter, r *http.Request) {
			if !proteger(w, r) {
				return
			}
			v, err := cfg.Registro.Verificar()
			if err != nil {
				responder(w, http.StatusInternalServerError, map[string]string{"error": "no se pudo leer la auditoría"})
				return
			}
			if !v.Integra {
				slog.Error("auditoria_alterada", "rupturas", v.Rupturas)
			}
			responder(w, http.StatusOK, v)
		})
		mux.HandleFunc("GET /auditoria/exportar", func(w http.ResponseWriter, r *http.Request) {
			if !proteger(w, r) {
				return
			}
			slog.Info("auditoria_exportada", "ip", r.RemoteAddr)
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename="auditoria-aegix.json"`)
			w.Header().Set("Cache-Control", "no-store")
			version := ""
			if cfg.Motor != nil {
				version = cfg.Motor.Instantanea().Version
			}
			if err := cfg.Registro.Exportar(w, version); err != nil {
				log.Printf("exportar auditoría: %v", err)
			}
		})
		// La billetera consulta con su propio identificador; aegix lo convierte a la referencia HMAC.
		mux.HandleFunc("GET /v1/autorizar/{id}", func(w http.ResponseWriter, r *http.Request) {
			if !proteger(w, r) {
				return
			}
			id := r.PathValue("id")
			if id == "" || len(id) > 128 {
				responder(w, http.StatusBadRequest, map[string]string{"error": "identificador inválido"})
				return
			}
			responder(w, http.StatusOK, map[string]string{"id_transaccion": id, "estado": cfg.Registro.Estado(cfg.Registro.Referencia(id))})
		})
	}
	guardar := func(origen string, r Respuesta, e *registro.Entrada, confirmada bool) {
		if cfg.Registro != nil {
			cfg.Registro.Guardar(registro.Evento{
				ID: r.ID, Origen: origen, Entrada: e, Accion: r.Accion, Puntaje: r.Puntaje, Razones: r.Razones,
				Version: r.VersionReglas, LatenciaMS: r.LatenciaMS, Fecha: time.Now().UTC(), Confirmada: confirmada,
			})
		}
	}
	if cfg.Registro != nil {
		mux.HandleFunc("GET /decisiones", func(w http.ResponseWriter, r *http.Request) {
			if proteger(w, r) {
				responder(w, http.StatusOK, cfg.Registro.Recientes())
			}
		})
	}
	mux.HandleFunc("GET /salud", func(w http.ResponseWriter, _ *http.Request) {
		responder(w, http.StatusOK, map[string]string{"estado": "ok"})
	})
	// reportar=true envía la decisión al sandbox del reto (solo conoce sus propias transacciones);
	// la billetera Yuma autoriza operaciones nuevas que el sandbox no puede confirmar.
	manejar := func(origen string, reportar bool) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			inicio := time.Now()
			reglasActivas := cfg.Motor.Instantanea()
			rechazar := func(w http.ResponseWriter, estado int, inicio time.Time, version, id, razon string) {
				decision := sandbox.Decision{ID: id, Accion: "rechazar", Razones: []string{razon}}
				salida := respuesta(inicio, version, decision)
				colector.RegistrarTransaccion(origen, "rechazar", 0, salida.LatenciaMS, salida.Razones, false)
				guardar(origen, salida, nil, false)
				if origen == "billetera" { // del simulador quedan en la auditoría y en el resumen de cada minuto
					slog.Warn("rechazo", "origen", origen, "http", estado, "razon", razon,
						"referencia", referenciaCorta(cfg.Registro, id), "latencia_ms", salida.LatenciaMS)
				}
				responder(w, estado, salida)
			}
			entrada, err := defensas.Decodificar(http.MaxBytesReader(w, r.Body, 64<<10))
			id := entrada.Transaccion.ID
			if len(id) > 128 {
				id = ""
			}
			if err != nil {
				var limite *http.MaxBytesError
				if errors.As(err, &limite) {
					rechazar(w, http.StatusRequestEntityTooLarge, inicio, reglasActivas.Version, id, "la solicitud supera 64 KiB")
				} else {
					rechazar(w, http.StatusBadRequest, inicio, reglasActivas.Version, id, "el cuerpo no cumple el esquema JSON de /score")
				}
				return
			}
			ip, fecha, err := defensas.Validar(entrada, cfg.Versiones)
			if err != nil {
				rechazar(w, http.StatusBadRequest, inicio, reglasActivas.Version, id, err.Error())
				return
			}
			if cfg.IPDeConexion {
				remota, err := netip.ParseAddrPort(r.RemoteAddr)
				if err != nil {
					rechazar(w, http.StatusBadRequest, inicio, reglasActivas.Version, id, "no se pudo identificar la IP de conexión")
					return
				}
				ip = remota.Addr().Unmap()
			}
			t := entrada.Transaccion
			if err := limitador.Admitir(inicio, t.Cliente, ip, t.Dispositivo); err != nil {
				colector.RegistrarRechazoLimite()
				rechazar(w, http.StatusTooManyRequests, inicio, reglasActivas.Version, id, err.Error())
				return
			}
			ctx, cancelar := context.WithDeadline(r.Context(), inicio.Add(tiempoEvaluacion))
			defer cancelar()
			decision, err := evaluar(ctx, trabajos, cfg.Origen, historial, reglasActivas, entrada, ip, fecha)
			if r.Context().Err() != nil {
				return
			}
			if errors.Is(err, context.DeadlineExceeded) {
				colector.RegistrarContingencia("tiempo_agotado")
				slog.Warn("contingencia", "tipo", "tiempo_agotado", "origen", origen, "plazo_ms", tiempoEvaluacion.Milliseconds(),
					"accion", "se pide un código en vez de aprobar")
				decision = sandbox.Decision{ID: id, Accion: "desafiar", Razones: []string{"tiempo de evaluación agotado"}}
			} else if err != nil {
				colector.RegistrarContingencia("origen_no_disponible")
				slog.Error("contingencia", "tipo", "origen_no_disponible", "origen", origen, "error", err.Error())
				responder(w, http.StatusServiceUnavailable, map[string]string{"error": "no se pudo consultar el origen local"})
				return
			}
			confirmada := false
			if reportar {
				// El envío tiene su propio plazo para poder registrar la decisión de contingencia.
				envio, cancelarEnvio := context.WithTimeout(r.Context(), tiempoEvaluacion)
				defer cancelarEnvio()
				recibos, err := cliente.Enviar(envio, []sandbox.Decision{decision})
				confirmada = err == nil && len(recibos) == 1 && recibos[0].Recibida && recibos[0].ID == id
			}
			salida := respuesta(inicio, reglasActivas.Version, decision)
			guardar(origen, salida, &registro.Entrada{
				Tipo: t.TipoOperacion, Canal: t.Canal, Fecha: t.FechaHora,
				Nuevo: t.DispositivoNuevo == 1, SIM: t.CambioSIM48h == 1,
				Clave: t.CambioClave24h == 1, Destino: t.DestinoNuevo == 1, Monto: t.MontoCOP,
				Accesibilidad: entrada.Contexto.Accesibilidad,
			}, confirmada)
			colector.RegistrarTransaccion(origen, decision.Accion, t.MontoCOP, salida.LatenciaMS, decision.Razones, confirmada)
			if origen == "billetera" {
				cfg.Avisos.Decision(decision.Accion, t.TipoOperacion, t.MontoCOP, decision.Razones)
				// Solo la billetera: el simulador manda miles por segundo y ya quedan en la auditoría.
				registrarDecision(origen, reglasActivas, entrada, decision, salida, referenciaCorta(cfg.Registro, t.ID))
			}
			if reportar && !confirmada {
				colector.RegistrarContingencia("sandbox_sin_confirmar")
				responder(w, http.StatusBadGateway, map[string]string{"error": "el sandbox no confirmó la decisión"})
				return
			}
			responder(w, http.StatusOK, salida)
		}
	}
	mux.HandleFunc("POST /score", manejar("sandbox", true))
	billetera := manejar("billetera", false)
	mux.HandleFunc("POST /v1/autorizar", func(w http.ResponseWriter, r *http.Request) {
		if proteger(w, r) {
			billetera(w, r)
		}
	})
	return mux
}

func evaluar(ctx context.Context, trabajos chan struct{}, proveedor contexto.Proveedor, historial *contexto.Historial, reglasActivas *reglas.Config, entrada defensas.Solicitud, ip netip.Addr, fecha time.Time) (sandbox.Decision, error) {
	select {
	case trabajos <- struct{}{}:
	case <-ctx.Done():
		return sandbox.Decision{}, ctx.Err()
	}
	type resultado struct {
		decision sandbox.Decision
		err      error
	}
	lista := make(chan resultado, 1)
	go func() {
		defer func() { <-trabajos }()
		decision, err := puntuar(ctx, proveedor, historial, reglasActivas, entrada, ip, fecha)
		lista <- resultado{decision, err}
	}()
	select {
	case <-ctx.Done():
		return sandbox.Decision{}, ctx.Err()
	case r := <-lista:
		if err := ctx.Err(); err != nil {
			return sandbox.Decision{}, err
		}
		return r.decision, r.err
	}
}

func puntuar(ctx context.Context, proveedor contexto.Proveedor, historial *contexto.Historial, reglasActivas *reglas.Config, entrada defensas.Solicitud, ip netip.Addr, fecha time.Time) (sandbox.Decision, error) {
	if err := ctx.Err(); err != nil {
		return sandbox.Decision{}, err
	}
	origen, err := proveedor.Consultar(ip, entrada.Contexto)
	if err != nil {
		return sandbox.Decision{}, err
	}
	if err := ctx.Err(); err != nil {
		return sandbox.Decision{}, err
	}
	t := entrada.Transaccion
	resumen := historial.Observar(t.Cliente, t.ID, fecha, origen, t.MontoCOP, contexto.Ventanas{
		DiasMonto: reglasActivas.DiasMonto, Percentil: reglasActivas.Percentil,
		MinMontos: reglasActivas.MinMontos, MinutosSalidas: reglasActivas.MinutosSalidas,
	})
	v := reglas.Variables{
		Tor: origen.Tor, Proxy: origen.ProxyODatacenter,
		HoraAtipica: resumen.HoraAtipica, PaisNuevo: resumen.PaisNuevo,
		DispositivoNuevo: t.DispositivoNuevo == 1, CambioSIM: t.CambioSIM48h == 1,
		CambioClave: t.CambioClave24h == 1, DestinoNuevo: t.DestinoNuevo == 1,
		SalidasRecientes:     resumen.SalidasRecientes,
		CuentaNueva:          t.AntiguedadCuentaDias < reglasActivas.DiasCuentaNueva,
		DepartamentoDistinto: t.IPDepartamentoDistinto == 1,
	}
	if t.TipoDestino == "comercio" && reglasActivas.MinClientesComercio > 0 {
		v.ComercioDesconocido = historial.ClientesPrevios(t.Destino, t.Cliente, reglasActivas.MinClientesComercio) < reglasActivas.MinClientesComercio
	}
	if resumen.PercentilMonto > 0 {
		v.MontoSobrePercentil = float64(t.MontoCOP) / float64(resumen.PercentilMonto)
	}
	if t.SaldoAntesCOP > 0 {
		v.MontoSobreSaldo = float64(t.MontoCOP) / float64(t.SaldoAntesCOP)
	}
	puntaje, razones, otraSenal := reglasActivas.Evaluar(v)
	accion, razones := reglasActivas.Umbrales.Decidir(puntaje, otraSenal, razones)
	accion, razones = reglasActivas.Ajustar(t.TipoOperacion, accion, razones)
	return sandbox.Decision{ID: t.ID, Accion: accion, Puntaje: puntaje, Razones: razones}, nil
}

func respuesta(inicio time.Time, version string, decision sandbox.Decision) Respuesta {
	return Respuesta{
		Decision:      decision,
		VersionReglas: version,
		LatenciaMS:    float64(time.Since(inicio)) / float64(time.Millisecond),
	}
}

func responder(w http.ResponseWriter, estado int, datos any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(estado)
	_ = json.NewEncoder(w).Encode(datos)
}
