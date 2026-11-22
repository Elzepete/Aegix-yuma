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

Paso a paso en [docs/despliegue.md](../docs/despliegue.md). En resumen: la billetera va a Vercel
(*Root Directory* `yuma-billetera`, variables `AEGIX_URL` y `AEGIX_TOKEN`) y `AEGIX_URL` apunta al túnel con
dirección fija de la consola del operador, que reenvía solo `/v1/autorizar` y `/salud` hacia aegix.
Si aegix está apagado, la billetera muestra «aegix sin conexión» y no autoriza nada.

## Guion de demo

1. Laura envía $50.000 a Andrés (contacto) → **aprobar**, sin pasos extra.
2. *Seguridad → SIM swapping*, envío a Andrés → **desafiar** con código; el mismo envío a un número nuevo → **retener**.
3. *Seguridad → Toma de cuenta*, cualquier envío → **retener** (Tor + dispositivo nuevo + SIM).
4. *Todo normal*, ingresa como Julián (cuenta de 21 días) y envía «Todo» a un número nuevo → **desafiar**: patrón de cuenta mula.
   (Recargas y pagos de servicios con las mismas señales solo piden código: son de bajo riesgo.)
5. En el panel del operador abre la retención del paso 3 y pulsa *Liberar operación*: en segundos la billetera
   la marca «Aprobada por analista», descuenta y avisa. Con *Confirmar fraude* queda «Bloqueada por fraude».
6. Muestra `/metricas` de aegix: las tres decisiones aparecen en `decisiones_por_origen.billetera`.
