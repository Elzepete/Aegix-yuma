# Billetera Yuma (demo) · protegida por aegix

Billetera de demostración de Yuma Pay (organización **ficticia** de la hackatón). Cada envío, pago QR,
recarga o pago de servicios pasa primero por **aegix** (`POST /v1/autorizar`), que responde
`aprobar`, `desafiar`, `retener` o `rechazar` con sus razones:

| aegix decide | La billetera… |
| --- | --- |
| aprobar | descuenta el saldo y muestra «¡Listo!» |
| desafiar | envía un código por «SMS» simulado; si es correcto, descuenta |
| retener | deja la operación «En revisión», la plata no sale; consulta cada 4 s si un analista la liberó (descuenta y avisa) o confirmó fraude (la bloquea) |
| rechazar / sin respuesta | no mueve dinero (falla cerrada) |

Sin dependencias ni paso de compilación: HTML + CSS + JS y una función de Vercel (`api/autorizar.js`)
que guarda la URL y la clave de aegix fuera del navegador y añade la IP y el país reales de la conexión.
Saldos y movimientos viven en el `localStorage` del navegador (es una demo).

Clientes de prueba: celulares 300 000 0001 a 300 000 0004, claves 1111 a 4444 (aparecen en pantalla).
Cada uno tiene su perfil (Julián es una cuenta de 21 días) y sus propias señales de riesgo simuladas;
aegix además arma un historial por cliente con cada operación.

Destinos válidos: celular de 10 dígitos que empiece por 3 (envíos Yuma y recargas, nunca el propio),
cuenta de 6 a 20 dígitos (otro banco), código `COM` + 4 dígitos (QR) o un convenio de la lista (servicios).

## Probar en local

```bash
# 1. aegix (desde la raíz del repo)
go run ./cmd/intermediario -sandbox http://127.0.0.1:8080
# 2. la billetera
AEGIX_URL=http://127.0.0.1:8081 node dev.mjs     # http://localhost:3000
# 3. pruebas de la billetera
node --test
```

## Publicar gratis

**1. Exponer aegix con un túnel** (gratis, sin cuenta). aegix sigue escuchando solo en 127.0.0.1:

```bash
YUMA_PANEL_TOKEN=una-clave-larga go run ./cmd/intermediario
cloudflared tunnel --url http://127.0.0.1:8081   # imprime https://algo.trycloudflare.com
```

Con `YUMA_PANEL_TOKEN`, aegix exige la clave en `/v1/autorizar`, `/alertas` e `/indicadores`.
`/score`, `/metricas` y `/metrics` siguen abiertos a través del túnel.

**2. Desplegar la billetera en Vercel** (plan Hobby gratuito):

- Sube el repo a GitHub → en vercel.com, *Add New → Project* → importa el repo.
- *Root Directory*: `yuma-billetera`. *Framework Preset*: `Other`. Sin comando de build.
- *Environment Variables*: `AEGIX_URL` = la URL del túnel, `AEGIX_TOKEN` = el mismo valor de `YUMA_PANEL_TOKEN`.
- Deploy. (Alternativa por terminal: `npx vercel` dentro de esta carpeta.)

La URL de un túnel rápido cambia cada vez que lo reinicias: actualiza `AEGIX_URL` y vuelve a desplegar.
Si aegix está apagado, la billetera muestra «aegix sin conexión» y no autoriza nada.

## Guion de demo

1. Laura envía $50.000 a Andrés (contacto) → **aprobar**, sin pasos extra.
2. *Seguridad → SIM swapping*, envío a Andrés → **desafiar** con código; el mismo envío a un número nuevo → **retener**.
3. *Seguridad → Toma de cuenta*, cualquier envío → **retener** (Tor + dispositivo nuevo + SIM).
4. *Todo normal*, ingresa como Julián (cuenta de 21 días) y envía «Todo» a un número nuevo → **desafiar**: patrón de cuenta mula.
5. En el panel del operador abre la retención del paso 3 y pulsa *Liberar operación*: en segundos la billetera
   la marca «Aprobada por analista», descuenta y avisa. Con *Confirmar fraude* queda «Bloqueada por fraude».
6. Muestra `/metricas` de aegix: las tres decisiones aparecen en `decisiones_por_origen.billetera`.
