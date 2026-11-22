package decisor

import (
	"fmt"
	"math"
)

type Umbrales struct {
	Desafiar float64 `yaml:"desafiar"`
	Retener  float64 `yaml:"retener"`
}

func (u Umbrales) Validar() error {
	if math.IsNaN(u.Desafiar) || math.IsNaN(u.Retener) ||
		u.Desafiar <= 0 || u.Retener <= u.Desafiar || u.Retener > 1 {
		return fmt.Errorf("los umbrales deben cumplir 0 < desafiar < retener <= 1")
	}
	return nil
}

func (u Umbrales) Decidir(puntaje float64, otraSenal bool, razones []string) (string, []string) {
	if puntaje >= u.Retener && otraSenal {
		return "retener", razones
	}
	if puntaje >= u.Desafiar {
		if puntaje >= u.Retener {
			razones = append(razones, "se requiere una señal adicional ajena al origen y al horario para retener")
		}
		return "desafiar", razones
	}
	return "aprobar", razones
}

// ClasificarRiesgo categoriza el nivel en "bajo", "medio" o "alto" para Aegix.
func (u Umbrales) ClasificarRiesgo(puntaje float64) string {
	if puntaje >= u.Retener {
		return "alto"
	}
	if puntaje >= u.Desafiar {
		return "medio"
	}
	return "bajo"
}
