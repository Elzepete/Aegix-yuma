package reglas

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReglasDelRepositorioSonValidas(t *testing.T) {
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	m, err := Abrir(ctx, "../../config/reglas.yaml")
	if err != nil {
		t.Fatal(err)
	}
	cfg := m.Instantanea()
	puntaje, razones, otra := cfg.Evaluar(Variables{CuentaNueva: true, DestinoNuevo: true, MontoSobreSaldo: .8})
	if puntaje < cfg.Umbrales.Desafiar || !otra || len(razones) != 3 {
		t.Fatalf("mula: puntaje %.2f, otra %v, razones %v", puntaje, otra, razones)
	}
	_, razones, _ = cfg.Evaluar(Variables{DestinoNuevo: true, Tor: true, DispositivoNuevo: true})
	if razones[0] != "dispositivo nuevo" || razones[2] != "destino nuevo" {
		t.Fatalf("las razones deben ir de mayor a menor peso: %v", razones)
	}
	// El departamento es una señal de origen: no habilita la retención por sí sola.
	if _, _, otra := cfg.Evaluar(Variables{DepartamentoDistinto: true, Tor: true}); otra {
		t.Fatal("departamento_distinto no debe contar como señal ajena al origen")
	}
}

func TestCuentaNuevaExigeDias(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "r.yaml")
	yaml := strings.Join([]string{
		"version: x", "umbrales: {desafiar: 0.3, retener: 0.6}", "dias_monto: 30", "percentil: 95",
		"min_montos: 10", "minutos_salidas: 10",
		`reglas: [{senal: cuenta_nueva, peso: 0.2, razon: "cuenta nueva"}]`,
	}, "\n")
	if err := os.WriteFile(ruta, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := leer(ruta); err == nil || !strings.Contains(err.Error(), "dias_cuenta_nueva") {
		t.Fatalf("se esperaba error por dias_cuenta_nueva, se obtuvo %v", err)
	}
}

func TestTiposDeBajoRiesgoBajanUnEscalon(t *testing.T) {
	cfg := Config{TiposBajoRiesgo: []string{"recarga_celular"}}
	if a, r := cfg.Ajustar("recarga_celular", "retener", []string{"dispositivo nuevo"}); a != "desafiar" || len(r) != 2 {
		t.Fatalf("retener en recarga debe pasar a desafiar con su razón: %s %v", a, r)
	}
	if a, _ := cfg.Ajustar("recarga_celular", "desafiar", nil); a != "aprobar" {
		t.Fatalf("desafiar en recarga debe aprobarse, se obtuvo %s", a)
	}
	if a, _ := cfg.Ajustar("transferencia_inmediata", "retener", nil); a != "retener" {
		t.Fatalf("una transferencia no cambia, se obtuvo %s", a)
	}
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	m, err := Abrir(ctx, "../../config/reglas.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if a, _ := m.Instantanea().Ajustar("transferencia_inmediata", "retener", nil); a != "retener" {
		t.Fatal("las reglas del repositorio no deben suavizar transferencias")
	}
}
