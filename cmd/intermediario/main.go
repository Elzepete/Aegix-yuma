package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"escudo-yuma/internal/api"
	"escudo-yuma/internal/avisos"
	"escudo-yuma/internal/contexto"
	"escudo-yuma/internal/defensas"
	"escudo-yuma/internal/registro"
	"escudo-yuma/internal/reglas"
	"escudo-yuma/internal/sandbox"
)

func main() {
	urlSandbox := os.Getenv("YUMA_SANDBOX_URL")
	if urlSandbox == "" {
		urlSandbox = "http://127.0.0.1:8080"
	}
	direccion := flag.String("escuchar", "127.0.0.1:8081", "dirección de escucha")
	url := flag.String("sandbox", urlSandbox, "URL base del sandbox")
	mmdb := flag.String("geoip", "", "archivo local MMDB")
	tor := flag.String("tor", "", "archivo local de nodos de salida Tor")
	versiones := flag.String("versiones-app", "3.4.1", "versiones permitidas separadas por comas")
	porCliente := flag.Int("limite-cliente", 30, "solicitudes por segundo por cliente")
	porIP := flag.Int("limite-ip", 1500, "solicitudes por segundo por IP")
	porDispositivo := flag.Int("limite-dispositivo", 30, "solicitudes por segundo por dispositivo")
	rutaReglas := flag.String("reglas", "config/reglas.yaml", "archivo YAML de reglas")
	rutaAuditoria := flag.String("auditoria", "decisiones.jsonl", "archivo JSONL de auditoría")
	flag.Parse()

	motor, err := reglas.Abrir(context.Background(), *rutaReglas)
	if err != nil {
		log.Fatalf("no se pudieron cargar las reglas: %v", err)
	}

	if *porCliente < 1 || *porIP < 1 || *porDispositivo < 1 {
		log.Fatal("los límites deben ser positivos")
	}
	cfg := api.Config{
		Origen:    contexto.Simulado{},
		Motor:     motor,
		Versiones: make(map[string]bool),
		Limites:   defensas.Limites{Cliente: *porCliente, IP: *porIP, Dispositivo: *porDispositivo},
	}
	for _, version := range strings.Split(*versiones, ",") {
		if version = strings.TrimSpace(version); version != "" {
			cfg.Versiones[version] = true
		}
	}
	if len(cfg.Versiones) == 0 {
		log.Fatal("se requiere al menos una versión de aplicación permitida")
	}
	if *mmdb != "" && *tor != "" {
		local, err := contexto.AbrirLocal(*mmdb, *tor)
		if err != nil {
			log.Fatal(err)
		}
		defer local.Close()
		cfg.Origen, cfg.IPDeConexion = local, true
	} else if *mmdb != "" || *tor != "" {
		log.Fatal("el modo local requiere -geoip y -tor")
	} else {
		host, _, err := net.SplitHostPort(*direccion)
		ip, ipErr := netip.ParseAddr(host)
		if err != nil || (host != "localhost" && (ipErr != nil || !ip.IsLoopback())) {
			log.Fatal("el modo simulado requiere una dirección de escucha local")
		}
	}

	clavePanel := os.Getenv("YUMA_PANEL_TOKEN")
	host, _, _ := net.SplitHostPort(*direccion)
	ip, _ := netip.ParseAddr(host)
	if clavePanel == "" && host != "localhost" && !ip.IsLoopback() {
		log.Fatal("define YUMA_PANEL_TOKEN para publicar el panel fuera del equipo local")
	}
	auditoria, err := registro.Abrir(*rutaAuditoria, os.Getenv("YUMA_AUDIT_KEY"))
	if err != nil {
		log.Fatalf("no se pudo abrir la auditoría: %v", err)
	}
	cfg.Registro, cfg.ClavePanel = auditoria, clavePanel
	if cfg.Avisos, err = avisos.Nuevo(os.Getenv("NTFY_URL")); err != nil {
		log.Fatal(err)
	}

	servidor := &http.Server{
		Addr:              *direccion,
		Handler:           api.Nuevo(sandbox.Nuevo(*url), cfg),
		ReadHeaderTimeout: 2 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	log.Printf("intermediario en %s", *direccion)
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()
	fin := make(chan error, 1)
	go func() { fin <- servidor.ListenAndServe() }()
	select {
	case err := <-fin:
		auditoria.Close()
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case <-ctx.Done():
		if err := servidor.Shutdown(context.Background()); err != nil {
			log.Printf("cierre HTTP: %v", err)
		}
		auditoria.Close()
	}
}
