// Package avisos publica en un tema de ntfy (gratis, sin cuenta) lo que aegix decide sobre las operaciones de la
// billetera, para verlo en el celular durante la demo. Todo ocurre en segundo plano: nunca demora una decisión.
package avisos

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type mensaje struct {
	Tema      string   `json:"topic"`
	Titulo    string   `json:"title"`
	Texto     string   `json:"message"`
	Etiquetas []string `json:"tags,omitempty"`
	Prioridad int      `json:"priority,omitempty"`
}

type Avisador struct {
	servidor, tema string
	cola           chan mensaje
	cliente        *http.Client
}

var temaValido = regexp.MustCompile(`^[\w-]{1,64}$`)

// Nuevo recibe la URL del tema (https://ntfy.sh/mi-tema). Sin URL devuelve nil: un Avisador nil no hace nada.
func Nuevo(direccion string) (*Avisador, error) {
	if strings.TrimSpace(direccion) == "" {
		return nil, nil
	}
	u, err := url.Parse(strings.TrimSpace(direccion))
	if err != nil {
		return nil, fmt.Errorf("NTFY_URL inválida: %w", err)
	}
	tema := strings.Trim(u.Path, "/")
	// http solo hacia 127.0.0.1 (un ntfy local o las pruebas); hacia internet, siempre https.
	if (u.Scheme != "https" && u.Hostname() != "127.0.0.1") || !temaValido.MatchString(tema) {
		return nil, fmt.Errorf("NTFY_URL debe ser https://servidor/tema")
	}
	a := &Avisador{servidor: u.Scheme + "://" + u.Host + "/", tema: tema, cola: make(chan mensaje, 64), cliente: &http.Client{Timeout: 4 * time.Second}}
	go a.trabajar()
	return a, nil
}

func (a *Avisador) trabajar() {
	for m := range a.cola {
		cuerpo, _ := json.Marshal(m)
		r, err := a.cliente.Post(a.servidor, "application/json", bytes.NewReader(cuerpo))
		if err != nil {
			log.Printf("aviso al celular no enviado: %v", err)
			continue
		}
		r.Body.Close()
	}
}

func (a *Avisador) enviar(m mensaje) {
	if a == nil {
		return
	}
	m.Tema = a.tema
	select {
	case a.cola <- m:
	default: // cola llena: se pierde el aviso, nunca la decisión
	}
}

var titulos = map[string][3]string{ // título, etiqueta de ntfy, prioridad
	"aprobar":  {"Yuma · Operación aprobada", "white_check_mark", "3"},
	"desafiar": {"Yuma · Te pedimos un código", "warning", "4"},
	"retener":  {"Yuma · Operación en revisión", "rotating_light", "5"},
	"rechazar": {"Yuma · Operación rechazada", "no_entry", "4"},
}

// Decision avisa lo que aegix decidió sobre una operación de la billetera.
func (a *Avisador) Decision(accion, tipo string, monto int64, razones []string) {
	t, ok := titulos[accion]
	if !ok {
		return
	}
	texto := fmt.Sprintf("%s por %s.", strings.ReplaceAll(tipo, "_", " "), Pesos(monto))
	if accion != "aprobar" && len(razones) > 0 {
		texto += " Razón principal: " + razones[0] + "."
	}
	if accion == "retener" {
		texto += " La plata no salió: un analista la revisará."
	}
	prioridad := int(t[2][0] - '0')
	a.enviar(mensaje{Titulo: t[0], Texto: texto, Etiquetas: []string{t[1]}, Prioridad: prioridad})
}

// Resolucion avisa lo que decidió el analista sobre una retención.
func (a *Avisador) Resolucion(accion string) {
	switch accion {
	case "liberar":
		a.enviar(mensaje{Titulo: "Yuma · Un analista aprobó tu envío", Texto: "Revisamos la operación y la plata ya salió.", Etiquetas: []string{"white_check_mark"}, Prioridad: 4})
	case "confirmar_fraude":
		a.enviar(mensaje{Titulo: "Yuma · Bloqueamos un envío", Texto: "Un analista confirmó que no era seguro. La plata sigue en tu cuenta. Si no fuiste tú, cambia tu clave.", Etiquetas: []string{"lock"}, Prioridad: 5})
	}
}

// Pesos da formato colombiano: 1850000 → $1.850.000.
func Pesos(v int64) string {
	s := fmt.Sprint(v)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "." + s[i:]
	}
	return "$" + s
}
