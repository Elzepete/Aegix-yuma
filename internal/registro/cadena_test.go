package registro

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCadenaDetectaAlteracionBorradoYAgregado(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "auditoria.jsonl")
	os.WriteFile(ruta, []byte(`{"decision":"aprobar","puntaje":0}`+"\n"), 0600) // línea anterior al sello
	r, err := Abrir(ruta, "clave-de-prueba")
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range []string{"aprobar", "retener", "desafiar"} {
		r.Guardar(Evento{ID: "YW" + a, Accion: a, Puntaje: .4})
	}
	esperar(t, func() bool { return r.Indicadores().Total == 4 })
	r.Close()
	// Al reabrir, la cadena sigue desde la última línea.
	r, _ = Abrir(ruta, "clave-de-prueba")
	r.Guardar(Evento{ID: "YW5", Accion: "aprobar"})
	esperar(t, func() bool { return r.Indicadores().Total == 5 })
	r.Close()

	v, err := r.Verificar()
	if err != nil || !v.Integra || v.Selladas != 4 || v.Previas != 1 || v.Lineas != 5 {
		t.Fatalf("cadena íntegra esperada: %+v %v", v, err)
	}
	original, _ := os.ReadFile(ruta)
	lineas := bytes.Split(original, []byte{'\n'})
	casos := map[string][]byte{
		"alterada": bytes.Replace(original, []byte(`"puntaje":0.4`), []byte(`"puntaje":0.1`), 1),
		"borrada":  bytes.Join(append(append([][]byte{}, lineas[:2]...), lineas[3:]...), []byte{'\n'}),
		"agregada": append(append([]byte{}, original...), []byte(`{"decision":"aprobar"}`+"\n")...),
	}
	for nombre, datos := range casos {
		if verificarLineas(datos, r.claveSello()).Integra {
			t.Errorf("%s: la verificación no detectó el cambio", nombre)
		}
	}
	if verificarLineas(original, []byte("otra clave")).Integra {
		t.Error("con otra clave los sellos no deberían valer")
	}
}
