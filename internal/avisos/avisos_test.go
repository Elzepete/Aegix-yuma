package avisos

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPublicaDecisionesYResolucionesEnElTema(t *testing.T) {
	recibidos := make(chan mensaje, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m mensaje
		_ = json.NewDecoder(r.Body).Decode(&m)
		recibidos <- m
	}))
	defer srv.Close()
	a, err := Nuevo(srv.URL + "/yuma-demo")
	if err != nil {
		t.Fatal(err)
	}
	a.Decision("retener", "transferencia_inmediata", 300000, []string{"dispositivo nuevo", "destino nuevo"})
	a.Resolucion("confirmar_fraude")
	for _, quiere := range []string{"Yuma · Operación en revisión", "Yuma · Bloqueamos un envío"} {
		select {
		case m := <-recibidos:
			if m.Tema != "yuma-demo" || m.Titulo != quiere {
				t.Fatalf("aviso %+v, se esperaba %q en el tema yuma-demo", m, quiere)
			}
			if quiere == "Yuma · Operación en revisión" && m.Texto != "transferencia inmediata por $300.000. Razón principal: dispositivo nuevo. La plata no salió: un analista la revisará." {
				t.Fatalf("texto: %q", m.Texto)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("no llegó %q", quiere)
		}
	}
}

func TestSinURLNoHaceNadaYValidaLaDireccion(t *testing.T) {
	a, err := Nuevo("")
	if a != nil || err != nil {
		t.Fatal("sin URL debe devolver nil, nil")
	}
	a.Decision("aprobar", "pago_qr", 1, nil) // un Avisador nil no falla
	for _, mala := range []string{"http://ntfy.sh/tema", "https://ntfy.sh/", "https://ntfy.sh/a/b", "%zz"} {
		if _, err := Nuevo(mala); err == nil {
			t.Fatalf("%q debía rechazarse", mala)
		}
	}
	if Pesos(1850000) != "$1.850.000" || Pesos(500) != "$500" {
		t.Fatalf("formato: %s %s", Pesos(1850000), Pesos(500))
	}
}
