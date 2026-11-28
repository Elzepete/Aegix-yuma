package registro

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

// esperar hasta que el escritor asíncrono procese lo encolado.
func esperar(t *testing.T, cond func() bool) {
	t.Helper()
	for fin := time.Now().Add(2 * time.Second); time.Now().Before(fin); time.Sleep(5 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatal("el registro no procesó el evento a tiempo")
}

func TestResolucionDelAnalistaPersiste(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "auditoria.jsonl")
	r, err := Abrir(ruta, "clave-de-prueba")
	if err != nil {
		t.Fatal(err)
	}
	r.Guardar(Evento{ID: "YW1", Accion: "retener", Puntaje: .9})
	r.Guardar(Evento{ID: "YW2", Accion: "desafiar", Puntaje: .5})
	ref := r.Referencia("YW1")
	esperar(t, func() bool { return r.Estado(ref) == "en_revision" })

	if err := r.Resolver(r.Referencia("YW2"), "liberar", "", time.Now()); !errors.Is(err, ErrCasoNoEncontrado) {
		t.Fatalf("un desafío no se resuelve desde el panel: %v", err)
	}
	if err := r.Resolver(ref, "aprobar", "", time.Now()); err == nil {
		t.Fatal("se esperaba error por resolución inválida")
	}
	if err := r.Resolver(ref, "confirmar_fraude", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := r.Resolver(ref, "liberar", "", time.Now()); !errors.Is(err, ErrYaResuelto) {
		t.Fatalf("se esperaba ErrYaResuelto, se obtuvo %v", err)
	}
	if r.Estado(ref) != "fraude_confirmado" || r.Indicadores().FraudesConfirmados != 1 {
		t.Fatalf("estado %s, indicadores %+v", r.Estado(ref), r.Indicadores())
	}
	if a := r.Alertas(); a[0].Resolucion != "confirmar_fraude" || a[0].ResueltaEn == nil {
		t.Fatalf("la alerta no muestra la resolución: %+v", a[0])
	}
	r.Close()

	// Al reabrir con la misma clave, la resolución se reconstruye desde el archivo y no se cuenta dos veces.
	r2, err := Abrir(ruta, "clave-de-prueba")
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Close()
	if r2.Estado(ref) != "fraude_confirmado" || r2.Indicadores().FraudesConfirmados != 1 || r2.Indicadores().Total != 2 {
		t.Fatalf("tras reabrir: estado %s, indicadores %+v", r2.Estado(ref), r2.Indicadores())
	}
}

func TestSinVariableLaClaveSobreviveAlReinicio(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "auditoria.jsonl")
	r, err := Abrir(ruta, "")
	if err != nil {
		t.Fatal(err)
	}
	ref := r.Referencia("YW1")
	r.Close()
	r2, err := Abrir(ruta, "")
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Close()
	if r2.Referencia("YW1") != ref {
		t.Fatal("sin YUMA_AUDIT_KEY la clave cambió al reabrir: la billetera ya no encontraría sus operaciones")
	}
}

func TestActividadIncluyeAprobadasYSobreviveAlReinicio(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "auditoria.jsonl")
	r, err := Abrir(ruta, "k")
	if err != nil {
		t.Fatal(err)
	}
	r.Guardar(Evento{ID: "YW1", Origen: "billetera", Accion: "aprobar", Fecha: time.Now()})
	r.Guardar(Evento{ID: "YW2", Origen: "billetera", Accion: "retener", Fecha: time.Now().Add(time.Second)})
	esperar(t, func() bool { return len(r.Recientes()) == 2 })
	if a := r.Recientes(); a[0].Accion != "retener" || a[1].Accion != "aprobar" {
		t.Fatalf("la actividad debe ir de la más nueva a la más vieja: %+v", a)
	}
	r.Close()
	r2, err := Abrir(ruta, "k")
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Close()
	vistos := 0
	if err := r2.Recorrer(func(Evento) { vistos++ }); err != nil || vistos != 2 || len(r2.Recientes()) != 2 {
		t.Fatalf("tras reabrir: recorridos %d (%v), recientes %d", vistos, err, len(r2.Recientes()))
	}
}
