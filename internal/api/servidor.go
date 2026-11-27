package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/netip"
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
			err := cfg.Registro.Resolver(ref, cuerpo.Resolucion, time.Now().UTC())
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
				cfg.Avisos.Resolucion(cuerpo.Resolucion)
				responder(w, http.StatusOK, map[string]string{"estado": cfg.Registro.Estado(ref)})
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
				decision = sandbox.Decision{ID: id, Accion: "desafiar", Razones: []string{"tiempo de evaluación agotado"}}
			} else if err != nil {
				colector.RegistrarContingencia("origen_no_disponible")
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
