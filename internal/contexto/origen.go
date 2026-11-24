package contexto

import (
	"bufio"
	"fmt"
	"net"
	"net/netip"
	"os"
	"strings"

	"github.com/oschwald/maxminddb-golang"
)

// Datos contiene las señales que el simulador envía junto a la operación.
type Datos struct {
	IP                 string `json:"ip"`
	PaisIP             string `json:"pais_ip"`
	EsTor              bool   `json:"es_tor"`
	EsProxyODatacenter bool   `json:"es_proxy_o_datacenter"`
	VersionApp         string `json:"version_app"`
	SistemaOperativo   string `json:"sistema_operativo"`
	HuellaDispositivo  string `json:"huella_dispositivo"`
	// Opcional: cómo prefiere el cliente que lo contacten si un analista revisa su operación.
	// Nunca entra al puntaje.
	Accesibilidad *Accesibilidad `json:"accesibilidad,omitempty"`
}

// Accesibilidad guarda preferencias de comunicación, no diagnósticos ni datos de salud.
type Accesibilidad struct {
	Contacto     string `json:"contacto,omitempty"` // sms, llamada, videollamada_lsc (lengua de señas) o chat
	LecturaFacil bool   `json:"lectura_facil,omitempty"`
	Apoyo        bool   `json:"apoyo_de_confianza,omitempty"` // lo acompaña una persona de apoyo (Ley 1996 de 2019)
}

type Origen struct {
	Pais             string
	Tor              bool
	ProxyODatacenter bool
}

type Proveedor interface {
	Consultar(ip netip.Addr, datos Datos) (Origen, error)
}

type Simulado struct{}

func (Simulado) Consultar(_ netip.Addr, d Datos) (Origen, error) {
	return Origen{Pais: d.PaisIP, Tor: d.EsTor, ProxyODatacenter: d.EsProxyODatacenter}, nil
}

type Local struct {
	db  *maxminddb.Reader
	tor map[netip.Addr]struct{}
}

func AbrirLocal(mmdb, nodosTor string) (*Local, error) {
	archivo, err := os.Open(nodosTor)
	if err != nil {
		return nil, fmt.Errorf("no se pudo abrir la lista local de Tor: %w", err)
	}
	defer archivo.Close()
	nodos := make(map[netip.Addr]struct{})
	lineas := bufio.NewScanner(archivo)
	for lineas.Scan() {
		campos := strings.Fields(strings.SplitN(lineas.Text(), "#", 2)[0])
		if len(campos) == 0 {
			continue
		}
		// Se admite una IP por línea y el formato oficial con ExitAddress.
		if campos[0] == "ExitAddress" && len(campos) >= 2 {
			campos = campos[1:]
		} else if len(campos) != 1 {
			continue
		}
		ip, err := netip.ParseAddr(campos[0])
		if err != nil || ip.Zone() != "" {
			return nil, fmt.Errorf("dirección inválida en la lista local de Tor")
		}
		nodos[ip.Unmap()] = struct{}{}
	}
	if err := lineas.Err(); err != nil {
		return nil, fmt.Errorf("no se pudo leer la lista local de Tor: %w", err)
	}
	db, err := maxminddb.Open(mmdb)
	if err != nil {
		return nil, fmt.Errorf("no se pudo abrir la base GeoIP: %w", err)
	}
	return &Local{db: db, tor: nodos}, nil
}

func (l *Local) Close() error { return l.db.Close() }

type Anonimato struct {
	Proxy       bool `maxminddb:"is_public_proxy"`
	Residencial bool `maxminddb:"is_residential_proxy"`
	Alojamiento bool `maxminddb:"is_hosting_provider"`
	Tor         bool `maxminddb:"is_tor_exit_node"`
}

func (l *Local) Consultar(ip netip.Addr, _ Datos) (Origen, error) {
	var registro struct {
		Country struct {
			ISO string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
		Anonimato
		Traits Anonimato `maxminddb:"traits"`
	}
	if err := l.db.Lookup(net.IP(ip.AsSlice()), &registro); err != nil {
		return Origen{}, err
	}
	_, tor := l.tor[ip.Unmap()]
	return Origen{
		Pais: registro.Country.ISO,
		Tor:  tor || registro.Tor || registro.Traits.Tor,
		ProxyODatacenter: registro.Proxy || registro.Residencial || registro.Alojamiento ||
			registro.Traits.Proxy || registro.Traits.Residencial || registro.Traits.Alojamiento,
	}, nil
}
