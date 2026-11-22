package defensas

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/netip"
	"strings"
	"time"

	"escudo-yuma/internal/contexto"
	"escudo-yuma/internal/sandbox"
)

type Solicitud struct {
	Transaccion sandbox.Transaccion `json:"transaccion"`
	Contexto    contexto.Datos      `json:"contexto"`
}

func Decodificar(cuerpo io.Reader) (Solicitud, error) {
	var entrada Solicitud
	decoder := json.NewDecoder(cuerpo)
	decoder.DisallowUnknownFields()
	var partes struct {
		Transaccion json.RawMessage `json:"transaccion"`
		Contexto    json.RawMessage `json:"contexto"`
	}
	if err := decoder.Decode(&partes); err != nil {
		return entrada, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		if err == nil {
			err = fmt.Errorf("se esperaba un solo objeto JSON")
		}
		return entrada, err
	}

	err := decodificarObjeto(partes.Transaccion, &entrada.Transaccion, strings.Fields(
		"id_transaccion fecha_hora id_cliente tipo_operacion canal monto_cop saldo_antes_cop id_destino "+
			"tipo_destino destino_nuevo id_dispositivo dispositivo_nuevo cambio_clave_24h cambio_sim_48h "+
			"departamento_ip ip_departamento_distinto antiguedad_cuenta_dias"))
	if err != nil {
		return entrada, err
	}
	err = decodificarObjeto(partes.Contexto, &entrada.Contexto, strings.Fields(
		"ip pais_ip es_tor es_proxy_o_datacenter version_app sistema_operativo huella_dispositivo"))
	return entrada, err
}

func decodificarObjeto(raw json.RawMessage, destino any, requeridos []string) error {
	var campos map[string]json.RawMessage
	if err := json.Unmarshal(raw, &campos); err != nil {
		return fmt.Errorf("se requiere un objeto JSON")
	}
	for _, nombre := range requeridos {
		if valor := campos[nombre]; len(valor) == 0 || bytes.Equal(valor, []byte("null")) {
			return fmt.Errorf("falta el campo %s", nombre)
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(destino)
}

func Validar(s Solicitud, versiones map[string]bool) (netip.Addr, time.Time, error) {
	t, d := s.Transaccion, s.Contexto
	for _, id := range []string{t.ID, t.Cliente, t.Destino, t.Dispositivo, d.HuellaDispositivo} {
		if id == "" || len(id) > 128 || strings.TrimSpace(id) != id {
			return netip.Addr{}, time.Time{}, fmt.Errorf("identificador vacío o inválido")
		}
	}
	fecha, err := time.ParseInLocation(contexto.FormatoFecha, t.FechaHora, contexto.Colombia)
	if err != nil || fecha.Format(contexto.FormatoFecha) != t.FechaHora {
		return netip.Addr{}, time.Time{}, fmt.Errorf("fecha_hora debe usar AAAA-MM-DD HH:MM:SS")
	}
	if t.MontoCOP <= 0 || t.AntiguedadCuentaDias < 0 {
		return netip.Addr{}, time.Time{}, fmt.Errorf("monto o antigüedad de cuenta fuera de rango")
	}
	for _, valor := range []int{t.DestinoNuevo, t.DispositivoNuevo, t.CambioClave24h, t.CambioSIM48h, t.IPDepartamentoDistinto} {
		if valor != 0 && valor != 1 {
			return netip.Addr{}, time.Time{}, fmt.Errorf("los indicadores de transacción deben valer 0 o 1")
		}
	}
	if !esUnoDe(t.Canal, "app", "corresponsal", "cajero") ||
		!esUnoDe(t.TipoOperacion, "transferencia_inmediata", "pago_qr", "retiro_corresponsal", "retiro_cajero", "pago_servicios", "recarga_celular", "compra_tarjeta_virtual") ||
		!esUnoDe(t.TipoDestino, "cuenta_yuma", "otra_entidad", "comercio", "corresponsal", "cajero", "servicio", "operador") {
		return netip.Addr{}, time.Time{}, fmt.Errorf("canal, tipo de operación o tipo de destino inválido")
	}
	ip, err := netip.ParseAddr(d.IP)
	if err != nil || ip.Zone() != "" {
		return netip.Addr{}, time.Time{}, fmt.Errorf("dirección IP inválida")
	}
	if len(d.PaisIP) != 2 || d.PaisIP[0] < 'A' || d.PaisIP[0] > 'Z' || d.PaisIP[1] < 'A' || d.PaisIP[1] > 'Z' {
		return netip.Addr{}, time.Time{}, fmt.Errorf("pais_ip debe tener dos letras mayúsculas")
	}
	if strings.TrimSpace(d.SistemaOperativo) == "" {
		return netip.Addr{}, time.Time{}, fmt.Errorf("falta sistema_operativo")
	}
	if !versiones[d.VersionApp] {
		return netip.Addr{}, time.Time{}, fmt.Errorf("versión de la aplicación no permitida")
	}
	return ip.Unmap(), fecha, nil
}

func esUnoDe(valor string, opciones ...string) bool {
	for _, opcion := range opciones {
		if valor == opcion {
			return true
		}
	}
	return false
}
