package reglas

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"escudo-yuma/internal/decisor"

	"gopkg.in/yaml.v3"
)

type Variables struct {
	Tor, Proxy, HoraAtipica, PaisNuevo, DispositivoNuevo, CambioSIM, CambioClave, DestinoNuevo bool
	CuentaNueva, DepartamentoDistinto                                                          bool
	MontoSobrePercentil, MontoSobreSaldo                                                       float64
	SalidasRecientes                                                                           int
}

type regla struct {
	Senal  string   `yaml:"senal"`
	Umbral *float64 `yaml:"umbral"`
	Peso   float64  `yaml:"peso"`
	Razon  string   `yaml:"razon"`
}

type Config struct {
	Umbrales       decisor.Umbrales `yaml:"umbrales"`
	Version        string           `yaml:"version"`
	DiasMonto      int              `yaml:"dias_monto"`
	Percentil      int              `yaml:"percentil"`
	MinMontos      int              `yaml:"min_montos"`
	MinutosSalidas int              `yaml:"minutos_salidas"`
	// Antigüedad (días) por debajo de la cual la cuenta cuenta como nueva; 0 desactiva la señal.
	DiasCuentaNueva int     `yaml:"dias_cuenta_nueva"`
	Reglas          []regla `yaml:"reglas"`
}

type Motor struct {
	actual atomic.Pointer[Config]
}

// Abrir valida el archivo inicial y vigila cambios fuera de la ruta de evaluación.
func Abrir(ctx context.Context, ruta string) (*Motor, error) {
	cfg, huella, err := leer(ruta)
	if err != nil {
		return nil, err
	}
	m := new(Motor)
	m.actual.Store(&cfg)
	go func() {
		reloj := time.NewTicker(time.Second)
		defer reloj.Stop()
		vistas := map[string][32]byte{cfg.Version: huella}
		ultimaHuella, ultimoError := huella, ""
		for {
			select {
			case <-ctx.Done():
				return
			case <-reloj.C:
				nueva, h, err := leer(ruta)
				if err == nil && h != ultimaHuella {
					if anterior, existe := vistas[nueva.Version]; existe && anterior != h {
						err = fmt.Errorf("la versión %q identifica otro contenido", nueva.Version)
					} else {
						vistas[nueva.Version] = h
						m.actual.Store(&nueva)
						ultimaHuella = h
						log.Printf("reglas activas %s", nueva.Version)
					}
				}
				if err != nil {
					if mensaje := err.Error(); mensaje != ultimoError {
						log.Printf("se conservaron las reglas %s: %s", m.actual.Load().Version, mensaje)
						ultimoError = mensaje
					}
				} else {
					ultimoError = ""
				}
			}
		}
	}()
	return m, nil
}

// Instantanea mantiene la misma versión durante toda una evaluación.
func (m *Motor) Instantanea() *Config { return m.actual.Load() }

func leer(ruta string) (Config, [32]byte, error) {
	var cfg Config
	var huella [32]byte
	f, err := os.Open(ruta)
	if err != nil {
		return cfg, huella, err
	}
	defer f.Close()
	datos, err := io.ReadAll(io.LimitReader(f, (64<<10)+1))
	if err != nil {
		return cfg, huella, err
	}
	if len(datos) > 64<<10 {
		return cfg, huella, fmt.Errorf("el YAML supera 64 KiB")
	}
	y := yaml.NewDecoder(bytes.NewReader(datos))
	y.KnownFields(true)
	if err := y.Decode(&cfg); err != nil {
		return cfg, huella, err
	}
	if err := y.Decode(new(any)); err != io.EOF {
		return cfg, huella, fmt.Errorf("se requiere un único documento YAML")
	}
	if strings.TrimSpace(cfg.Version) == "" || cfg.DiasMonto < 1 || cfg.DiasMonto > 365 ||
		cfg.Percentil < 1 || cfg.Percentil > 100 || cfg.MinMontos < 1 ||
		cfg.MinutosSalidas < 1 || cfg.MinutosSalidas > 1440 || len(cfg.Reglas) == 0 ||
		cfg.DiasCuentaNueva < 0 || cfg.DiasCuentaNueva > 3650 {
		return cfg, huella, fmt.Errorf("versión, ventanas, percentil, muestra o lista de reglas inválidos")
	}
	if err := cfg.Umbrales.Validar(); err != nil {
		return cfg, huella, err
	}
	vistas := make(map[string]bool)
	for _, r := range cfg.Reglas {
		_, numerica, existe := (Variables{}).valor(r.Senal)
		if !existe || vistas[r.Senal] || strings.TrimSpace(r.Razon) == "" ||
			math.IsNaN(r.Peso) || r.Peso <= 0 || r.Peso > 1 || numerica != (r.Umbral != nil) {
			return cfg, huella, fmt.Errorf("regla inválida para %q", r.Senal)
		}
		if numerica && (math.IsNaN(*r.Umbral) || math.IsInf(*r.Umbral, 0) || *r.Umbral <= 0) {
			return cfg, huella, fmt.Errorf("umbral inválido para %q", r.Senal)
		}
		if r.Senal == "cuenta_nueva" && cfg.DiasCuentaNueva == 0 {
			return cfg, huella, fmt.Errorf("la regla cuenta_nueva requiere dias_cuenta_nueva")
		}
		vistas[r.Senal] = true
	}
	return cfg, sha256.Sum256(datos), nil
}

func (c *Config) Evaluar(v Variables) (float64, []string, bool) {
	var puntaje float64
	otraSenal := false
	activas := make([]regla, 0, len(c.Reglas))
	for _, r := range c.Reglas {
		valor, numerica, _ := v.valor(r.Senal)
		if (numerica && valor >= *r.Umbral) || (!numerica && valor == 1) {
			puntaje += r.Peso
			switch r.Senal {
			case "tor", "proxy", "hora_atipica", "pais_nuevo", "departamento_distinto":
			default:
				otraSenal = true
			}
			activas = append(activas, r)
		}
	}
	// La razón que más pesó va primero: es la que el analista y el cliente leen.
	sort.SliceStable(activas, func(i, j int) bool { return activas[i].Peso > activas[j].Peso })
	razones := make([]string, 0, len(activas))
	for _, r := range activas {
		razones = append(razones, r.Razon)
	}
	if len(razones) == 0 {
		razones = append(razones, "ninguna regla de riesgo se activó")
	}
	return min(puntaje, 1), razones, otraSenal
}

func (v Variables) valor(senal string) (float64, bool, bool) {
	var activa bool
	switch senal {
	case "tor":
		activa = v.Tor
	case "proxy":
		activa = v.Proxy
	case "hora_atipica":
		activa = v.HoraAtipica
	case "pais_nuevo":
		activa = v.PaisNuevo
	case "dispositivo_nuevo":
		activa = v.DispositivoNuevo
	case "cambio_sim":
		activa = v.CambioSIM
	case "cambio_clave":
		activa = v.CambioClave
	case "destino_nuevo":
		activa = v.DestinoNuevo
	case "cuenta_nueva":
		activa = v.CuentaNueva
	case "departamento_distinto":
		activa = v.DepartamentoDistinto
	case "monto_sobre_percentil":
		return v.MontoSobrePercentil, true, true
	case "monto_sobre_saldo":
		return v.MontoSobreSaldo, true, true
	case "salidas_recientes":
		return float64(v.SalidasRecientes), true, true
	default:
		return 0, false, false
	}
	if activa {
		return 1, false, true
	}
	return 0, false, true
}
