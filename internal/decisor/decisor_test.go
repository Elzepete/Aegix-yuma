package decisor

import "testing"

func TestDecidir(t *testing.T) {
	u := Umbrales{Desafiar: .35, Retener: .70}
	casos := []struct {
		puntaje float64
		otra    bool
		accion  string
	}{
		{.34, false, "aprobar"},
		{.35, true, "desafiar"},
		{.70, false, "desafiar"},
		{.70, true, "retener"},
	}
	for _, c := range casos {
		accion, razones := u.Decidir(c.puntaje, c.otra, nil)
		if accion != c.accion || (c.puntaje >= .70 && !c.otra && len(razones) != 1) {
			t.Errorf("puntaje %v y señal adicional %v: %s, %v", c.puntaje, c.otra, accion, razones)
		}
	}
}
