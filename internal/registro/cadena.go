package registro

// Auditoría inmutable: cada línea lleva el SHA-256 de la anterior (hash_anterior) y termina en un
// HMAC-SHA256 de sí misma (sello). Borrar, cambiar o reordenar una línea rompe la cadena; sin la clave
// nadie puede volver a sellar una línea alterada. herramientas/centinela.py verifica lo mismo en Python.

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"regexp"
	"time"
)

type Ruptura struct {
	Linea  int    `json:"linea"`
	Motivo string `json:"motivo"`
}

type Verificacion struct {
	Integra    bool      `json:"integra"`
	Lineas     int       `json:"lineas"`
	Selladas   int       `json:"selladas"`
	Previas    int       `json:"previas_a_la_cadena"` // líneas escritas antes de que existiera el sello
	UltimoHash string    `json:"ultimo_hash"`
	Rupturas   []Ruptura `json:"rupturas"`
	Verificada time.Time `json:"verificada_en"`
}

const maxRupturas = 50

var finSello = regexp.MustCompile(`,"sello":"([0-9a-f]{64})"\}$`)

func resumen(linea []byte) string {
	h := sha256.Sum256(linea)
	return hex.EncodeToString(h[:])
}

// claveSello deriva una clave propia para los sellos, distinta de la que seudonimiza referencias.
func (r *Registro) claveSello() []byte {
	h := hmac.New(sha256.New, r.clave)
	h.Write([]byte("sello-auditoria"))
	return h.Sum(nil)
}

func firmar(clave, cuerpo []byte) string {
	h := hmac.New(sha256.New, clave)
	h.Write(cuerpo)
	return hex.EncodeToString(h.Sum(nil))
}

// sellar serializa el evento y le agrega el sello al final, sobre los bytes exactos: verificar no
// depende de volver a serializar (Go y Python escriben JSON distinto).
func sellar(clave []byte, e Evento) ([]byte, error) {
	cuerpo, err := json.Marshal(e)
	if err != nil {
		return nil, err
	}
	sello := firmar(clave, cuerpo)
	return append(cuerpo[:len(cuerpo)-1], `,"sello":"`+sello+`"}`...), nil
}

func verificarLineas(datos, clave []byte) Verificacion {
	v := Verificacion{Rupturas: []Ruptura{}, Verificada: time.Now().UTC()}
	lineas := bytes.Split(datos, []byte{'\n'})
	lineas = lineas[:len(lineas)-1] // lo que sigue al último salto está vacío o a medio escribir
	anterior := ""
	romper := func(n int, motivo string) {
		if len(v.Rupturas) < maxRupturas {
			v.Rupturas = append(v.Rupturas, Ruptura{n, motivo})
		}
	}
	for i, linea := range lineas {
		n := i + 1
		v.Lineas++
		m := finSello.FindSubmatchIndex(linea)
		if m == nil {
			if v.Selladas == 0 {
				v.Previas++
			} else {
				romper(n, "línea sin sello después de iniciada la cadena: fue agregada o editada a mano")
			}
			anterior = resumen(linea)
			continue
		}
		v.Selladas++
		cuerpo := append(append([]byte{}, linea[:m[0]]...), '}')
		if !hmac.Equal([]byte(firmar(clave, cuerpo)), linea[m[2]:m[3]]) {
			romper(n, "sello HMAC inválido: la línea fue alterada")
		}
		var c struct {
			HashAnterior string `json:"hash_anterior"`
		}
		if json.Unmarshal(cuerpo, &c) != nil || c.HashAnterior != anterior {
			romper(n, "el hash de la línea anterior no coincide: se borró, agregó o movió una línea")
		}
		anterior = resumen(linea)
	}
	v.UltimoHash = anterior
	v.Integra = len(v.Rupturas) == 0
	return v
}

// Verificar recorre toda la auditoría y comprueba la cadena y los sellos.
func (r *Registro) Verificar() (Verificacion, error) {
	datos, err := os.ReadFile(r.ruta)
	if err != nil {
		return Verificacion{}, err
	}
	return verificarLineas(datos, r.claveSello()), nil
}

// Exportar escribe un JSON normativo: la verificación, el marco legal y cada línea tal como quedó
// sellada (sin volver a serializarla, para que el sello se pueda verificar fuera de aegix).
func (r *Registro) Exportar(w io.Writer, version string) error {
	datos, err := os.ReadFile(r.ruta)
	if err != nil {
		return err
	}
	v := verificarLineas(datos, r.claveSello())
	cabecera, _ := json.Marshal(map[string]any{
		"documento":      "Exportación de auditoría de aegix (Escudo Yuma)",
		"generado_en":    time.Now().UTC(),
		"version_reglas": version,
		"verificacion":   v,
		"metodo": "Cada línea lleva hash_anterior = SHA-256 de la línea previa exacta y termina en sello = " +
			"HMAC-SHA256 de la línea sin el sello. Los identificadores de transacción son seudónimos HMAC.",
		"marco_normativo": []string{
			"Ley 1581 de 2012 (protección de datos): sin nombres ni celulares en claro; identificadores seudonimizados",
			"SARLAFT (Superintendencia Financiera): toda retención la resuelve una persona y queda quién la resolvió",
			"PCI DSS: fuera de alcance; aegix no recibe ni guarda números de tarjeta",
		},
	})
	if _, err := w.Write(append(cabecera[:len(cabecera)-1], `,"eventos":[`...)); err != nil {
		return err
	}
	lineas := bytes.Split(datos, []byte{'\n'})
	for i, linea := range lineas[:len(lineas)-1] {
		if i > 0 {
			if _, err := w.Write([]byte{','}); err != nil {
				return err
			}
		}
		if _, err := w.Write(linea); err != nil {
			return err
		}
	}
	_, err = w.Write([]byte("]}\n"))
	return err
}
