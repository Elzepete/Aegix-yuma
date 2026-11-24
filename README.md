# Escudo Yuma · aegix

[![CI](https://github.com/Elzepete/Aegix-yuma/actions/workflows/ci.yml/badge.svg)](https://github.com/Elzepete/Aegix-yuma/actions/workflows/ci.yml)

Intermediario antifraude en Go para Yuma Pay (organización ficticia de la hackatón). Decide antes de autorizar
cada operación: aprobar, pedir un código, retener para un analista o rechazar, con sus razones.

**Resultados** con las 120.972 transacciones del reto: 81,5 % del fraude detectado antes de autorizar (línea base
62,6 %, después), 17,7 % de falsos positivos (hoy 89 %), p99 de 5,3 ms. Ver [reporte](docs/reporte-indicadores.md).

| Documento | Para qué |
| --- | --- |
| [docs/arquitectura.html](docs/arquitectura.html) | diagramas: despliegue, etapas del motor, secuencia de una retención, puntaje, ciclo del analista |
| [docs/reporte-indicadores.md](docs/reporte-indicadores.md) | cifras medidas, validación temporal, escenarios de ataque |
| [docs/explicabilidad.md](docs/explicabilidad.md) | cómo decide aegix, cada señal y su peso, accesibilidad y no discriminación, límites |
| [docs/presentacion.html](docs/presentacion.html) · [docs/flujo.md](docs/flujo.md) | diagramas de flujo, cómo ejecutarlo el día de la presentación, lista de verificación y fallas comunes |
| [docs/guion-demo.md](docs/guion-demo.md) | demo de 5 minutos con tiempos, preguntas probables y plan B |
| [docs/despliegue.md](docs/despliegue.md) | publicar gratis: Vercel + túnel con dirección fija |

| Carpeta | Contenido |
| --- | --- |
| `cmd/intermediario`, `internal/` | aegix (Go 1.22, sin base de datos) |
| `cmd/simulador` | carga y escenarios de ataque contra el sandbox del reto |
| `config/reglas.yaml` | pesos y umbrales; se recargan sin reiniciar |
| `yuma-billetera/` | billetera de demostración para Vercel |
| `panel-etapa5/` | consola del operador (React) y su servidor `proxy.mjs` |
| `herramientas/` | `iniciar.sh`, calibración y etiquetas del analista |
| `Dockerfile`, `docker-compose.yml` | aegix, consola y billetera con un comando |
| `.github/workflows/ci.yml` | pruebas de Go, Node y TypeScript, y arranque con Docker en cada push |

## Arrancar

Con Docker (no hace falta instalar Go ni Node):

```bash
docker compose up --build     # consola http://127.0.0.1:4173 · billetera http://127.0.0.1:3000
```

Sin Docker (Go 1.22+ y Node 20+):

```bash
herramientas/iniciar.sh                  # aegix :8081 y consola http://127.0.0.1:4173
herramientas/iniciar.sh --demo-limpia    # archiva la auditoría en datos/archivo/ y empieza en cero
herramientas/iniciar.sh --tunel          # además publica la consola; exige YUMA_PANEL_TOKEN y YUMA_PANEL_CLAVE
AEGIX_URL=http://127.0.0.1:8081 node yuma-billetera/dev.mjs   # billetera http://localhost:3000
```

| Ruta | Para qué |
| --- | --- |
| `POST /score` | transacciones del sandbox del reto; la decisión se reporta al sandbox para calificarla |
| `POST /v1/autorizar` | operaciones de la [billetera Yuma](yuma-billetera/README.md); no se reportan al sandbox |
| `GET /metricas` | métricas JSON: decisiones, montos, latencia p50–p99, SLA, TPS, decisiones por origen, contingencias, histograma |
| `GET /metrics` | lo mismo en formato Prometheus (para Grafana) |
| `GET /alertas`, `GET /indicadores` | panel del analista (con `YUMA_PANEL_TOKEN` si está definido); cada alerta trae `origen`, monto y resolución |
| `POST /alertas/{ref}/resolucion` | el analista resuelve una retención: `{"resolucion": "liberar" \| "confirmar_fraude"}`; 404 si no existe, 409 si ya se resolvió |
| `GET /decisiones` | las últimas 300 decisiones de cualquier tipo, aprobadas incluidas (vista «Toda la actividad» del panel) |
| `GET /v1/autorizar/{id}` | la billetera consulta su operación: `en_revision`, `liberada`, `fraude_confirmado` o `desconocida` |

## Panel del operador

```bash
cd panel-etapa5 && npm run build && npm start      # http://127.0.0.1:4173
```

Con `YUMA_PANEL_CLAVE` pide contraseña (usuario cualquiera); sin ella, avisa al arrancar y queda abierta en local.
La consola también reenvía `/v1/autorizar`, `/v1/autorizar/{id}` y `/salud` hacia aegix, así un solo túnel sirve
para la billetera y el panel. Se actualiza sola cada 2 s («En vivo»). En una retención, el detalle del caso permite **liberar** la operación
(la billetera descuenta y avisa al cliente) o **confirmar fraude** (queda bloqueada), con confirmación previa.
La vista «Toda la actividad» muestra cada operación, también las aprobadas; «Casos» solo lo que necesita revisión.

**Datos persistentes.** La auditoría (`-auditoria`, por defecto `decisiones.jsonl`) es la memoria de aegix: al arrancar
reconstruye desde ella los indicadores, las métricas del panel, las retenciones y sus resoluciones. No la borres
entre reinicios. Si no defines `YUMA_AUDIT_KEY`, aegix crea `decisiones.jsonl.clave` (permisos 0600) y la reutiliza;
sin esa clave las referencias HMAC dejan de coincidir. No compartas ni subas ese archivo.
El historial de comportamiento por cliente (percentiles, hora habitual) sí vive solo en memoria y empieza de cero. Muestra las decisiones de la billetera Yuma en tiempo real
y permite filtrar las alertas por origen (billetera o sandbox). Si aegix usa `YUMA_PANEL_TOKEN`, inicia
el panel con la misma variable.

## Reglas calibradas

`config/reglas.yaml` se calibró con `herramientas/calibrar_reglas.py` (mayo–agosto para ajustar,
septiembre–octubre para validar). aegix recarga el archivo en caliente.

| | etapa-5.1 | etapa-5.2 | etapa-5.3 | Línea base / meta |
| --- | ---: | ---: | ---: | ---: |
| Fraude detectado (validación sep–oct) | 46,2 % | 75,3 % | 75,3 % | 62,6 % |
| Fraude detectado (sandbox, seis meses) | 41,3 %* | 81,4 % | 81,5 % | 62,6 % |
| Falsos positivos (sandbox) | 0 % | 22,0 % | 17,7 % | < 60 % (hoy 89 %) |
| Monto de fraude protegido (sandbox) | — | 87,1 % | 87,0 % | 85,4 % (después de autorizar) |
| Clientes legítimos bloqueados | 0 % | 0,33 % | 0,25 % | |

\* primeras 20 000 transacciones. etapa-5.2 sumó `cuenta_nueva` (las cuentas mula son el 35 % del fraude) y
`departamento_distinto`. etapa-5.3 bajó la fricción: `tipos_bajo_riesgo`, retiró el monto frente al historial y
bajó la hora atípica (detalle en el [reporte](docs/reporte-indicadores.md)).

**Ciclo del analista.** Las resoluciones de la consola entran a la calibración como etiquetas:

```bash
python3 herramientas/calibrar_reglas.py 03_Datos/transacciones.csv --auditoria=datos/decisiones.jsonl
```

## Pruebas

```bash
go test -race ./...
(cd yuma-billetera && node --test) && (cd panel-etapa5 && node --test && npm run lint)
python3 herramientas/etiquetas_analista.py
```

`internal/api/servidor_test.go` prueba de extremo a extremo `/score` y `/v1/autorizar` contra un sandbox falso:
aprobación habitual, toma de cuenta retenida, SIM swapping desafiado, validaciones, límite de tasa,
sandbox caído (502) y clave del panel.

## Simulacros contra el sandbox del reto

```bash
python 04_Sandbox_API/mock_api.py                          # sandbox en :8080
go run ./cmd/intermediario                                  # aegix en :8081
go run ./cmd/simulador -reiniciar -verificar -cantidad 20000 -lote 500 -concurrencia 4
go run ./cmd/simulador -reiniciar -verificar -escenario ato -cantidad 300
go run ./cmd/simulador -reiniciar -verificar -cantidad 121000 -lote 4 -concurrencia 4   # corrida oficial, ~80 s
```

El sandbox mide la latencia desde que entrega el lote: con `-lote 500` su p99 sube a ~390 ms por la espera
en cola, aunque aegix decide en ~2 ms. Para la corrida que se presenta usa `-lote` igual a `-concurrencia`.

Escenarios: `normal`, `tor`, `sim`, `madrugada` (requiere `-concurrencia 1`), `rafaga` (límite de tasa)
y `ato` (Tor + dispositivo nuevo + SIM + destino nuevo). El simulador imprime decisiones, TPS, latencia
p50/p95/p99 vista por el cliente y las métricas del sandbox. Con `-verificar` termina con código 1 si no se cumple:
sin errores, p99 < 300 ms y, según el escenario, falsos positivos < 60 % y fraude detectado ≥ 62,6 % (línea base)
en `normal`, ninguna aprobación en `ato` o el límite actuando en `rafaga`.
