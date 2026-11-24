package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"escudo-yuma/internal/contexto"
	"escudo-yuma/internal/defensas"
	"escudo-yuma/internal/registro"
	"escudo-yuma/internal/reglas"
	"escudo-yuma/internal/sandbox"
)

// sandboxFalso confirma toda decisión recibida, o ninguna si caido es true.
func sandboxFalso(t *testing.T, caido bool, llamadas *atomic.Int64) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		llamadas.Add(1)
		if caido {
			http.Error(w, "caído", http.StatusInternalServerError)
			return
		}
		var decisiones []sandbox.Decision
		if err := json.NewDecoder(r.Body).Decode(&decisiones); err != nil {
			http.Error(w, "json", http.StatusBadRequest)
			return
		}
		recibos := make([]sandbox.Recibo, len(decisiones))
		for i, d := range decisiones {
			recibos[i] = sandbox.Recibo{ID: d.ID, Recibida: true}
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(recibos)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func solicitudBase(id string) defensas.Solicitud {
	return defensas.Solicitud{
		Transaccion: sandbox.Transaccion{
			ID: id, FechaHora: "2026-07-15 14:32:10", Cliente: "C-prueba-" + id,
			TipoOperacion: "transferencia_inmediata", Canal: "app", MontoCOP: 50000, SaldoAntesCOP: 900000,
			Destino: "C02508", TipoDestino: "cuenta_yuma", Dispositivo: "D-prueba",
			DepartamentoIP: "Antioquia", AntiguedadCuentaDias: 800,
		},
		Contexto: contexto.Datos{
			IP: "203.0.113.10", PaisIP: "CO", VersionApp: "3.4.1",
			SistemaOperativo: "Android", HuellaDispositivo: "D-prueba",
		},
	}
}

func nuevoServidor(t *testing.T, urlSandbox string, limites defensas.Limites, clave string) http.Handler {
	motor, err := reglas.Abrir(context.Background(), "../../config/reglas.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return Nuevo(sandbox.Nuevo(urlSandbox), Config{
		Origen: contexto.Simulado{}, Motor: motor, Versiones: map[string]bool{"3.4.1": true},
		Limites: limites, ClavePanel: clave,
	})
}

func enviar(t *testing.T, h http.Handler, ruta string, cuerpo any, cabeceras ...string) (*httptest.ResponseRecorder, Respuesta) {
	t.Helper()
	datos, _ := json.Marshal(cuerpo)
	req := httptest.NewRequest(http.MethodPost, ruta, bytes.NewReader(datos))
	for i := 0; i+1 < len(cabeceras); i += 2 {
		req.Header.Set(cabeceras[i], cabeceras[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var r Respuesta
	_ = json.Unmarshal(rec.Body.Bytes(), &r)
	return rec, r
}

func TestScoreDeExtremoAExtremo(t *testing.T) {
	var llamadas atomic.Int64
	sb := sandboxFalso(t, false, &llamadas)
	h := nuevoServidor(t, sb.URL, defensas.Limites{Cliente: 100, IP: 1000, Dispositivo: 100}, "")

	casos := []struct {
		nombre  string
		mutar   func(*defensas.Solicitud)
		estado  int
		accion  string
		razones int // mínimo de razones esperadas
	}{
		{"habitual se aprueba", func(*defensas.Solicitud) {}, 200, "aprobar", 0},
		{"tor + dispositivo nuevo + SIM se retiene", func(s *defensas.Solicitud) {
			s.Contexto.EsTor = true
			s.Transaccion.DispositivoNuevo, s.Transaccion.CambioSIM48h, s.Transaccion.DestinoNuevo = 1, 1, 1
			s.Transaccion.MontoCOP = 880000
		}, 200, "retener", 4},
		{"cambio de SIM y destino nuevo se desafían", func(s *defensas.Solicitud) {
			s.Transaccion.CambioSIM48h, s.Transaccion.DestinoNuevo = 1, 1
		}, 200, "desafiar", 2},
		{"cuenta nueva vaciándose hacia destino nuevo se desafía (mula)", func(s *defensas.Solicitud) {
			s.Transaccion.AntiguedadCuentaDias, s.Transaccion.DestinoNuevo = 12, 1
			s.Transaccion.MontoCOP = 800000
		}, 200, "desafiar", 3},
		{"departamento distinto solo no basta para desafiar", func(s *defensas.Solicitud) {
			s.Transaccion.IPDepartamentoDistinto = 1
		}, 200, "aprobar", 1},
		{"versión de app no permitida se rechaza", func(s *defensas.Solicitud) {
			s.Contexto.VersionApp = "1.0.0"
		}, 400, "rechazar", 1},
		{"fecha mal formada se rechaza", func(s *defensas.Solicitud) {
			s.Transaccion.FechaHora = "15/07/2026"
		}, 400, "rechazar", 1},
	}
	for i, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			s := solicitudBase("T" + string(rune('A'+i)))
			c.mutar(&s)
			rec, r := enviar(t, h, "/score", s)
			if rec.Code != c.estado || r.Accion != c.accion || len(r.Razones) < c.razones {
				t.Fatalf("HTTP %d %s %v (puntaje %.2f); se esperaba %d %s", rec.Code, r.Accion, r.Razones, r.Puntaje, c.estado, c.accion)
			}
			if r.ID != s.Transaccion.ID {
				t.Fatalf("id devuelto %q, se esperaba %q", r.ID, s.Transaccion.ID)
			}
		})
	}
	if got := llamadas.Load(); got != 5 {
		t.Fatalf("el sandbox debía recibir 5 decisiones válidas, recibió %d", got)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metricas", nil))
	var m MetricasCompletas
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	if m.TotalEvaluadas != 7 || m.Confirmadas != 5 || m.Rechazos != 2 || m.PorOrigen["sandbox"]["retener"] != 1 {
		t.Fatalf("métricas inesperadas: total=%d confirmadas=%d rechazos=%d origen=%v", m.TotalEvaluadas, m.Confirmadas, m.Rechazos, m.PorOrigen)
	}
}

func TestScoreSandboxCaidoDevuelve502(t *testing.T) {
	var llamadas atomic.Int64
	h := nuevoServidor(t, sandboxFalso(t, true, &llamadas).URL, defensas.Limites{Cliente: 10, IP: 10, Dispositivo: 10}, "")
	rec, _ := enviar(t, h, "/score", solicitudBase("T1"))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("se esperaba 502, se obtuvo %d", rec.Code)
	}
}

func TestLimiteDeTasaNoCuentaDoble(t *testing.T) {
	var llamadas atomic.Int64
	h := nuevoServidor(t, sandboxFalso(t, false, &llamadas).URL, defensas.Limites{Cliente: 2, IP: 100, Dispositivo: 100}, "")
	estados := map[int]int{}
	for i := range 5 {
		s := solicitudBase("R" + string(rune('0'+i)))
		s.Transaccion.Cliente = "mismo-cliente"
		rec, _ := enviar(t, h, "/score", s)
		estados[rec.Code]++
	}
	if estados[200] != 2 || estados[429] != 3 {
		t.Fatalf("estados inesperados: %v", estados)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metricas", nil))
	var m MetricasCompletas
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	if m.TotalEvaluadas != 5 || m.Rechazos != 3 || m.RechazosPorLimite != 3 {
		t.Fatalf("total=%d rechazos=%d por límite=%d", m.TotalEvaluadas, m.Rechazos, m.RechazosPorLimite)
	}
}

func TestAutorizarBilleteraNoUsaSandboxYPideClave(t *testing.T) {
	var llamadas atomic.Int64
	h := nuevoServidor(t, sandboxFalso(t, true, &llamadas).URL, defensas.Limites{Cliente: 10, IP: 10, Dispositivo: 10}, "secreto")
	s := solicitudBase("YW-1")

	if rec, _ := enviar(t, h, "/v1/autorizar", s); rec.Code != http.StatusUnauthorized {
		t.Fatalf("sin clave se esperaba 401, se obtuvo %d", rec.Code)
	}
	rec, r := enviar(t, h, "/v1/autorizar", s, "Authorization", "Bearer secreto")
	if rec.Code != http.StatusOK || r.Accion != "aprobar" || r.VersionReglas == "" {
		t.Fatalf("HTTP %d %+v", rec.Code, r)
	}
	if llamadas.Load() != 0 {
		t.Fatal("la billetera no debe reportar al sandbox del reto")
	}
}

func TestAnalistaLiberaYLaBilleteraLoVe(t *testing.T) {
	motor, err := reglas.Abrir(context.Background(), "../../config/reglas.yaml")
	if err != nil {
		t.Fatal(err)
	}
	reg, err := registro.Abrir(filepath.Join(t.TempDir(), "a.jsonl"), "k")
	if err != nil {
		t.Fatal(err)
	}
	defer reg.Close()
	h := Nuevo(sandbox.Nuevo("http://127.0.0.1:9"), Config{
		Origen: contexto.Simulado{}, Motor: motor, Versiones: map[string]bool{"3.4.1": true},
		Limites: defensas.Limites{Cliente: 10, IP: 10, Dispositivo: 10}, Registro: reg, ClavePanel: "secreto",
	})
	auth := []string{"Authorization", "Bearer secreto"}
	consultar := func(metodo, ruta, cuerpo string) (int, map[string]string) {
		req := httptest.NewRequest(metodo, ruta, bytes.NewBufferString(cuerpo))
		req.Header.Set(auth[0], auth[1])
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var datos map[string]string
		_ = json.Unmarshal(rec.Body.Bytes(), &datos)
		return rec.Code, datos
	}

	s := solicitudBase("YW-RET")
	s.Contexto.EsTor = true
	s.Transaccion.DispositivoNuevo, s.Transaccion.CambioSIM48h = 1, 1
	if rec, r := enviar(t, h, "/v1/autorizar", s, auth...); rec.Code != 200 || r.Accion != "retener" {
		t.Fatalf("HTTP %d %s", rec.Code, r.Accion)
	}
	for fin := time.Now().Add(2 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		if _, d := consultar("GET", "/v1/autorizar/YW-RET", ""); d["estado"] == "en_revision" {
			break
		} else if time.Now().After(fin) {
			t.Fatalf("estado inicial %q", d["estado"])
		}
	}
	ref := reg.Referencia("YW-RET")
	if code, _ := consultar("POST", "/alertas/"+ref+"/resolucion", `{"resolucion":"liberar"}`); code != 200 {
		t.Fatalf("resolver devolvió %d", code)
	}
	if code, _ := consultar("POST", "/alertas/"+ref+"/resolucion", `{"resolucion":"liberar"}`); code != http.StatusConflict {
		t.Fatalf("la segunda resolución debía dar 409, dio %d", code)
	}
	if code, _ := consultar("POST", "/alertas/no-existe/resolucion", `{"resolucion":"liberar"}`); code != http.StatusNotFound {
		t.Fatalf("caso inexistente debía dar 404, dio %d", code)
	}
	if _, d := consultar("GET", "/v1/autorizar/YW-RET", ""); d["estado"] != "liberada" {
		t.Fatalf("la billetera debía ver liberada, ve %q", d["estado"])
	}
	req := httptest.NewRequest("GET", "/v1/autorizar/YW-RET", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sin clave se esperaba 401, se obtuvo %d", rec.Code)
	}
}

func TestMetricasSobrevivenAlReinicio(t *testing.T) {
	motor, err := reglas.Abrir(context.Background(), "../../config/reglas.yaml")
	if err != nil {
		t.Fatal(err)
	}
	ruta := filepath.Join(t.TempDir(), "a.jsonl")
	nuevo := func(reg *registro.Registro) http.Handler {
		return Nuevo(sandbox.Nuevo("http://127.0.0.1:9"), Config{
			Origen: contexto.Simulado{}, Motor: motor, Versiones: map[string]bool{"3.4.1": true},
			Limites: defensas.Limites{Cliente: 10, IP: 10, Dispositivo: 10}, Registro: reg,
		})
	}
	metricas := func(h http.Handler) MetricasCompletas {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metricas", nil))
		var m MetricasCompletas
		_ = json.Unmarshal(rec.Body.Bytes(), &m)
		return m
	}
	reg, err := registro.Abrir(ruta, "")
	if err != nil {
		t.Fatal(err)
	}
	h := nuevo(reg)
	for _, id := range []string{"YW-A1", "YW-A2"} {
		enviar(t, h, "/v1/autorizar", solicitudBase(id))
	}
	s := solicitudBase("YW-R1")
	s.Contexto.EsTor, s.Transaccion.DispositivoNuevo, s.Transaccion.CambioSIM48h = true, 1, 1
	enviar(t, h, "/v1/autorizar", s)
	for fin := time.Now().Add(2 * time.Second); reg.Indicadores().Total < 3; time.Sleep(5 * time.Millisecond) {
		if time.Now().After(fin) {
			t.Fatal("la auditoría no registró las decisiones")
		}
	}
	reg.Close()

	reg2, err := registro.Abrir(ruta, "")
	if err != nil {
		t.Fatal(err)
	}
	defer reg2.Close()
	m := metricas(nuevo(reg2))
	if m.TotalEvaluadas != 3 || m.PorOrigen["billetera"]["aprobar"] != 2 || m.PorOrigen["billetera"]["retener"] != 1 || m.Aprobadas != 2 {
		t.Fatalf("las métricas no se reconstruyeron desde la auditoría: total=%d origen=%v", m.TotalEvaluadas, m.PorOrigen)
	}
	if m.TPSPico != 0 {
		t.Fatalf("reconstruir no debe inventar un pico de TPS: %.1f", m.TPSPico)
	}
	if reg2.Estado(reg2.Referencia("YW-R1")) != "en_revision" {
		t.Fatal("la billetera debe seguir encontrando su retención tras el reinicio")
	}
}

// Las preferencias de accesibilidad solo informan al analista cómo contactar al cliente:
// nunca cambian el puntaje ni la decisión.
func TestAccesibilidadNoCambiaLaDecisionYLlegaAlAnalista(t *testing.T) {
	motor, err := reglas.Abrir(context.Background(), "../../config/reglas.yaml")
	if err != nil {
		t.Fatal(err)
	}
	reg, err := registro.Abrir(filepath.Join(t.TempDir(), "a.jsonl"), "k")
	if err != nil {
		t.Fatal(err)
	}
	defer reg.Close()
	h := Nuevo(sandbox.Nuevo("http://127.0.0.1:9"), Config{
		Origen: contexto.Simulado{}, Motor: motor, Versiones: map[string]bool{"3.4.1": true},
		Limites: defensas.Limites{Cliente: 10, IP: 10, Dispositivo: 10}, Registro: reg,
	})
	for _, senales := range [][2]int{{0, 0}, {1, 0}, {1, 1}} { // aprobar, desafiar, retener
		sin, con := solicitudBase("YW-SIN"), solicitudBase("YW-CON")
		for _, s := range []*defensas.Solicitud{&sin, &con} {
			s.Transaccion.DispositivoNuevo, s.Transaccion.CambioSIM48h = senales[0], senales[1]
			s.Contexto.EsTor = senales[1] == 1
		}
		con.Transaccion.Cliente = sin.Transaccion.Cliente + "-a"
		con.Contexto.Accesibilidad = &contexto.Accesibilidad{Contacto: "videollamada_lsc", LecturaFacil: true, Apoyo: true}
		_, a := enviar(t, h, "/v1/autorizar", sin)
		_, b := enviar(t, h, "/v1/autorizar", con)
		if a.Accion != b.Accion || a.Puntaje != b.Puntaje {
			t.Fatalf("señales %v: sin preferencias %s %.2f, con preferencias %s %.2f", senales, a.Accion, a.Puntaje, b.Accion, b.Puntaje)
		}
	}
	var alertas []registro.Evento
	for fin := time.Now().Add(2 * time.Second); len(alertas) == 0; time.Sleep(5 * time.Millisecond) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/alertas", nil))
		var todas []registro.Evento
		_ = json.Unmarshal(rec.Body.Bytes(), &todas)
		for _, e := range todas {
			if e.Entrada != nil && e.Entrada.Accesibilidad != nil {
				alertas = append(alertas, e)
			}
		}
		if time.Now().After(fin) {
			t.Fatal("la retención con preferencias no llegó a /alertas")
		}
	}
	if p := alertas[0].Entrada.Accesibilidad; p.Contacto != "videollamada_lsc" || !p.LecturaFacil || !p.Apoyo {
		t.Fatalf("preferencias en la alerta: %+v", p)
	}
	mala := solicitudBase("YW-MALA")
	mala.Contexto.Accesibilidad = &contexto.Accesibilidad{Contacto: "paloma_mensajera"}
	if rec, _ := enviar(t, h, "/v1/autorizar", mala); rec.Code != http.StatusBadRequest {
		t.Fatalf("un canal de contacto desconocido debe dar 400, dio %d", rec.Code)
	}
}
