package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Transaccion struct {
	ID                     string `json:"id_transaccion"`
	FechaHora              string `json:"fecha_hora"`
	Cliente                string `json:"id_cliente"`
	TipoOperacion          string `json:"tipo_operacion"`
	Canal                  string `json:"canal"`
	MontoCOP               int64  `json:"monto_cop"`
	SaldoAntesCOP          int64  `json:"saldo_antes_cop"`
	Destino                string `json:"id_destino"`
	TipoDestino            string `json:"tipo_destino"`
	DestinoNuevo           int    `json:"destino_nuevo"`
	Dispositivo            string `json:"id_dispositivo"`
	DispositivoNuevo       int    `json:"dispositivo_nuevo"`
	CambioClave24h         int    `json:"cambio_clave_24h"`
	CambioSIM48h           int    `json:"cambio_sim_48h"`
	DepartamentoIP         string `json:"departamento_ip"`
	IPDepartamentoDistinto int    `json:"ip_departamento_distinto"`
	AntiguedadCuentaDias   int    `json:"antiguedad_cuenta_dias"`
}

type Decision struct {
	ID      string   `json:"id_transaccion"`
	Accion  string   `json:"decision"`
	Puntaje float64  `json:"puntaje"`
	Razones []string `json:"razones"`
}

type Recibo struct {
	ID         string   `json:"id_transaccion"`
	Recibida   bool     `json:"recibida"`
	LatenciaMS *float64 `json:"latencia_ms"`
}

type Lote struct {
	Transacciones []Transaccion `json:"transacciones"`
	Restantes     int           `json:"restantes"`
}

type Cliente struct {
	base string
	http *http.Client
}

func Nuevo(base string) *Cliente {
	tr := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 50,
		IdleConnTimeout:     90 * time.Second,
	}
	return &Cliente{
		base: strings.TrimRight(base, "/"),
		http: &http.Client{
			Transport: tr,
			Timeout:   5 * time.Second,
		},
	}
}

func (c *Cliente) Siguiente(ctx context.Context, cantidad int) (Lote, error) {
	var lote Lote
	if cantidad < 1 || cantidad > 500 {
		return lote, fmt.Errorf("cantidad debe estar entre 1 y 500")
	}
	ruta := "/v1/transacciones/siguiente?cantidad=" + strconv.Itoa(cantidad)
	err := c.solicitar(ctx, http.MethodGet, ruta, nil, http.StatusOK, &lote)
	return lote, err
}

func (c *Cliente) Eventos(ctx context.Context, id string, hasta time.Time) ([]map[string]string, error) {
	var respuesta struct {
		Eventos []map[string]string `json:"eventos"`
	}
	if id == "" || hasta.IsZero() {
		return nil, fmt.Errorf("se requieren el cliente y el límite temporal")
	}
	// Colombia usa UTC-5 durante todo el periodo del caso.
	colombia := time.FixedZone("America/Bogota", -5*60*60)
	valores := url.Values{"hasta": {hasta.In(colombia).Format("2006-01-02 15:04:05")}}
	ruta := "/v1/clientes/" + url.PathEscape(id) + "/eventos?" + valores.Encode()
	err := c.solicitar(ctx, http.MethodGet, ruta, nil, http.StatusOK, &respuesta)
	return respuesta.Eventos, err
}

func (c *Cliente) Enviar(ctx context.Context, decisiones []Decision) ([]Recibo, error) {
	var recibos []Recibo
	if len(decisiones) == 0 {
		return nil, fmt.Errorf("se requiere al menos una decisión")
	}
	err := c.solicitar(ctx, http.MethodPost, "/v1/decisiones", decisiones, http.StatusCreated, &recibos)
	return recibos, err
}

func (c *Cliente) Metricas(ctx context.Context) (json.RawMessage, error) {
	var metricas json.RawMessage
	err := c.solicitar(ctx, http.MethodGet, "/v1/metricas", nil, http.StatusOK, &metricas)
	return metricas, err
}

// Reiniciar vuelve el cursor del sandbox al inicio y borra sus decisiones.
func (c *Cliente) Reiniciar(ctx context.Context) error {
	var r map[string]any
	return c.solicitar(ctx, http.MethodPost, "/v1/reiniciar", nil, http.StatusOK, &r)
}

func (c *Cliente) solicitar(ctx context.Context, metodo, ruta string, datos any, estado int, resultado any) error {
	var cuerpo io.Reader
	if datos != nil {
		jsonDatos, err := json.Marshal(datos)
		if err != nil {
			return err
		}
		cuerpo = bytes.NewReader(jsonDatos)
	}
	req, err := http.NewRequestWithContext(ctx, metodo, c.base+ruta, cuerpo)
	if err != nil {
		return fmt.Errorf("URL del sandbox inválida")
	}
	if cuerpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("falló la conexión con el sandbox")
	}
	defer resp.Body.Close()
	if resp.StatusCode != estado {
		return fmt.Errorf("el sandbox devolvió HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(resultado); err != nil {
		return fmt.Errorf("respuesta JSON inválida del sandbox")
	}
	return nil
}
