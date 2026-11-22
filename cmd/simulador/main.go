package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash/fnv"
	"log"
	"net/http"
	"os"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"escudo-yuma/internal/api"
	"escudo-yuma/internal/contexto"
	"escudo-yuma/internal/defensas"
	"escudo-yuma/internal/sandbox"
)

// Línea base del caso (linea_base.py) y metas del formulario.
const (
	metaFalsosPositivosPct = 60.0
	baseFraudeDetectadoPct = 62.6
	metaLatenciaP99MS      = 300.0
)

var escenarios = []string{"normal", "tor", "madrugada", "sim", "rafaga", "ato"}

type resultado struct {
	accion    string // decisión, o "error"
	latencia  time.Duration
	err       error
	porLimite bool
}

func main() {
	urlSandbox := os.Getenv("YUMA_SANDBOX_URL")
	if urlSandbox == "" {
		urlSandbox = "http://127.0.0.1:8080"
	}
	origen := flag.String("sandbox", urlSandbox, "URL base del sandbox")
	intermediario := flag.String("intermediario", "http://127.0.0.1:8081", "URL base del intermediario aegix")
	limite := flag.Int("cantidad", 100, "total de transacciones a procesar")
	tamano := flag.Int("lote", 10, "tamaño de cada lectura del sandbox (1 a 500)")
	escenario := flag.String("escenario", "normal", strings.Join(escenarios, ", "))
	concurrencia := flag.Int("concurrencia", 1, "solicitudes simultáneas hacia aegix (prueba de carga)")
	reiniciar := flag.Bool("reiniciar", false, "reinicia el cursor y las decisiones del sandbox antes de empezar")
	verificar := flag.Bool("verificar", false, "termina con código 1 si no se cumplen las metas del MVP")
	flag.Parse()
	if !slices.Contains(escenarios, *escenario) {
		log.Fatalf("escenario desconocido; use uno de: %s", strings.Join(escenarios, ", "))
	}
	if *limite < 1 || *tamano < 1 || *tamano > 500 || *concurrencia < 1 {
		log.Fatal("cantidad y concurrencia deben ser positivas y lote debe estar entre 1 y 500")
	}
	if *escenario == "madrugada" && *concurrencia != 1 {
		log.Fatal("el escenario madrugada depende del orden de llegada: use -concurrencia 1")
	}

	ctx := context.Background()
	cliente := sandbox.Nuevo(*origen)
	if *reiniciar {
		if err := cliente.Reiniciar(ctx); err != nil {
			log.Fatal(err)
		}
	}
	httpCliente := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{MaxIdleConnsPerHost: *concurrencia}}
	scoreURL := strings.TrimRight(*intermediario, "/") + "/score"

	trabajos := make(chan struct {
		tx     sandbox.Transaccion
		indice int
	})
	resultados := make(chan resultado, *concurrencia)
	var grupo sync.WaitGroup
	for range *concurrencia {
		grupo.Add(1)
		go func() {
			defer grupo.Done()
			for t := range trabajos {
				inicio := time.Now()
				accion, porLimite, err := puntuar(ctx, httpCliente, scoreURL, t.tx, *escenario, t.indice)
				if err != nil {
					accion = "error"
				}
				resultados <- resultado{accion, time.Since(inicio), err, porLimite}
			}
		}()
	}
	go func() {
		defer close(trabajos)
		for enviadas := 0; enviadas < *limite; {
			lote, err := cliente.Siguiente(ctx, min(*tamano, *limite-enviadas))
			if err != nil {
				log.Fatal(err)
			}
			for _, tx := range lote.Transacciones {
				trabajos <- struct {
					tx     sandbox.Transaccion
					indice int
				}{tx, enviadas}
				enviadas++
			}
			if lote.Restantes == 0 || len(lote.Transacciones) == 0 {
				return
			}
		}
	}()
	go func() { grupo.Wait(); close(resultados) }()

	inicio := time.Now()
	conteo := map[string]int{}
	errores := map[string]int{}
	var latencias []float64
	porLimite := 0
	for r := range resultados {
		conteo[r.accion]++
		if r.err != nil {
			errores[r.err.Error()]++
			continue
		}
		if r.porLimite {
			porLimite++
		}
		latencias = append(latencias, float64(r.latencia)/float64(time.Millisecond))
	}
	duracion := time.Since(inicio)
	sort.Float64s(latencias)

	total := 0
	for _, n := range conteo {
		total += n
	}
	fmt.Printf("\n== aegix · escenario %q · %d transacciones · concurrencia %d ==\n", *escenario, total, *concurrencia)
	fmt.Printf("duración %.2fs · %.1f TPS\n", duracion.Seconds(), float64(total)/duracion.Seconds())
	for _, accion := range []string{"aprobar", "desafiar", "retener", "rechazar", "error"} {
		if conteo[accion] > 0 {
			fmt.Printf("  %-9s %6d  (%.1f%%)\n", accion, conteo[accion], 100*float64(conteo[accion])/float64(total))
		}
	}
	if porLimite > 0 {
		fmt.Printf("  rechazos por límite de tasa: %d\n", porLimite)
	}
	for mensaje, n := range errores {
		fmt.Printf("  error ×%d: %s\n", n, mensaje)
	}
	p99 := percentil(latencias, .99)
	fmt.Printf("latencia vista por el cliente: p50 %.1f ms · p95 %.1f ms · p99 %.1f ms · máx %.1f ms\n",
		percentil(latencias, .50), percentil(latencias, .95), p99, percentil(latencias, 1))

	crudo, err := cliente.Metricas(ctx)
	if err != nil {
		log.Fatal(err)
	}
	var legibles bytes.Buffer
	_ = json.Indent(&legibles, crudo, "", "  ")
	fmt.Printf("\nmétricas del sandbox:\n%s\n", legibles.String())

	if !*verificar {
		return
	}
	var sb struct {
		FalsosPositivos *float64 `json:"falsos_positivos_pct"`
		FraudeDetectado *float64 `json:"fraude_detectado_pct"`
	}
	_ = json.Unmarshal(crudo, &sb)
	type criterio struct {
		nombre string
		ok     bool
	}
	criterios := []criterio{
		{fmt.Sprintf("sin errores (%d)", conteo["error"]), conteo["error"] == 0},
		{fmt.Sprintf("p99 < %.0f ms (%.1f)", metaLatenciaP99MS, p99), p99 < metaLatenciaP99MS},
	}
	switch *escenario {
	case "normal":
		// Con pocas transacciones puede no haber fraude ni alertas: el indicador queda nulo y no se juzga.
		if sb.FalsosPositivos != nil {
			criterios = append(criterios, criterio{fmt.Sprintf("falsos positivos < %.0f%% (%.1f%%)", metaFalsosPositivosPct, *sb.FalsosPositivos), *sb.FalsosPositivos < metaFalsosPositivosPct})
		}
		if sb.FraudeDetectado != nil {
			criterios = append(criterios, criterio{fmt.Sprintf("fraude detectado ≥ línea base %.1f%% (%.1f%%)", baseFraudeDetectadoPct, *sb.FraudeDetectado), *sb.FraudeDetectado >= baseFraudeDetectadoPct})
		}
	case "ato":
		criterios = append(criterios, criterio{fmt.Sprintf("toma de cuenta nunca se aprueba (%d aprobadas)", conteo["aprobar"]), conteo["aprobar"] == 0})
	case "rafaga":
		criterios = append(criterios, criterio{fmt.Sprintf("el límite de tasa actúa (%d rechazos)", porLimite), porLimite > 0})
	}
	fallo := false
	fmt.Println("verificación:")
	for _, c := range criterios {
		marca := "OK  "
		if !c.ok {
			marca, fallo = "FALLA", true
		}
		fmt.Printf("  [%s] %s\n", marca, c.nombre)
	}
	if fallo {
		os.Exit(1)
	}
}

func percentil(ordenados []float64, p float64) float64 {
	if len(ordenados) == 0 {
		return 0
	}
	return ordenados[int(float64(len(ordenados)-1)*p)]
}

func puntuar(ctx context.Context, cliente *http.Client, url string, tx sandbox.Transaccion, escenario string, indice int) (string, bool, error) {
	// Datos inventados. Cada cliente recibe una IP estable de los bloques reservados para documentación,
	// para que la prueba de carga no choque con el límite por IP como si todo viniera de un solo equipo.
	h := fnv.New32a()
	h.Write([]byte(tx.Cliente))
	bloques := [...]string{"192.0.2", "198.51.100", "203.0.113"}
	entrada := defensas.Solicitud{
		Transaccion: tx,
		Contexto: contexto.Datos{
			IP:                fmt.Sprintf("%s.%d", bloques[h.Sum32()%3], 1+h.Sum32()/3%254),
			PaisIP:            "CO",
			VersionApp:        "3.4.1",
			SistemaOperativo:  "Android",
			HuellaDispositivo: tx.Dispositivo,
		},
	}
	switch escenario {
	case "tor":
		entrada.Contexto.EsTor = true
	case "sim":
		entrada.Transaccion.CambioSIM48h = 1
	case "ato":
		// Toma de cuenta: Tor, dispositivo nuevo, SIM cambiada y destino nuevo.
		entrada.Contexto.EsTor = true
		entrada.Transaccion.DispositivoNuevo, entrada.Transaccion.CambioSIM48h, entrada.Transaccion.DestinoNuevo = 1, 1, 1
	case "madrugada":
		entrada.Transaccion.Cliente = "cliente-demo-madrugada"
		fecha := time.Date(2026, 5, 1, 14, 0, 0, 0, contexto.Colombia)
		if indice >= 10 {
			entrada.Contexto.PaisIP = "US"
			fecha = fecha.Add(13 * time.Hour)
		}
		entrada.Transaccion.FechaHora = fecha.Add(time.Duration(indice) * time.Second).Format(contexto.FormatoFecha)
	case "rafaga":
		entrada.Transaccion.Cliente = "cliente-demo-rafaga"
		entrada.Transaccion.Dispositivo = "dispositivo-demo-rafaga"
		entrada.Contexto.HuellaDispositivo = entrada.Transaccion.Dispositivo
	}
	cuerpo, err := json.Marshal(entrada)
	if err != nil {
		return "", false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(cuerpo))
	if err != nil {
		return "", false, errors.New("URL del intermediario inválida")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := cliente.Do(req)
	if err != nil {
		return "", false, errors.New("falló la conexión con el intermediario")
	}
	defer resp.Body.Close()
	var salida api.Respuesta
	decodErr := json.NewDecoder(resp.Body).Decode(&salida)
	if resp.StatusCode == http.StatusTooManyRequests {
		if decodErr != nil || salida.ID != tx.ID || salida.Accion != "rechazar" {
			return "", false, errors.New("rechazo por límite inválido")
		}
		return "rechazar", true, nil
	}
	if resp.StatusCode != http.StatusOK {
		return "", false, fmt.Errorf("el intermediario devolvió HTTP %d", resp.StatusCode)
	}
	if decodErr != nil {
		return "", false, errors.New("respuesta JSON inválida del intermediario")
	}
	if salida.ID != tx.ID || (salida.Accion != "aprobar" && salida.Accion != "desafiar" && salida.Accion != "retener") {
		return "", false, errors.New("el intermediario devolvió una decisión inesperada")
	}
	return salida.Accion, false, nil
}
