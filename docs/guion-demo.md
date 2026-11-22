# Guion de demo · 5 minutos

Dos pantallas lado a lado: a la izquierda la **billetera** (celular o ventana angosta), a la derecha la
**consola aegix** en «Toda la actividad». Una persona habla y otra opera.

## Antes de presentar (30 minutos antes)

1. `herramientas/iniciar.sh --tunel --demo-limpia` con `YUMA_PANEL_TOKEN`, `YUMA_PANEL_CLAVE` y `NGROK_DOMINIO`
   definidas (ver [despliegue.md](despliegue.md)). La auditoría anterior queda archivada, no se borra.
2. `curl https://<dominio>/salud` → `{"estado":"ok"}` y `curl https://<proyecto>.vercel.app/api/autorizar` →
   `"en_linea"`.
3. En la billetera: *Seguridad → Restablecer la demo*. Ingresa como Laura (300 000 0001, clave 1111).
4. Abre la consola, escribe la contraseña y deja visible «Toda la actividad». La cabecera debe decir «Actualizado ahora».
5. Ten abierto [arquitectura.html](arquitectura.html) en otra pestaña, en la sección 1.
6. Graba la demo una vez completa como video de respaldo.

## El guion

| Tiempo | Se dice | Se hace |
| --- | --- | --- |
| 0:00–0:30 | «Hoy Yuma Pay detecta el fraude 15 minutos después de que la plata salió, y 89 de cada 100 alertas son falsas. aegix decide *antes* de que salga un peso.» | Pantalla de inicio de la billetera. |
| 0:30–1:00 | «La billetera pide permiso a aegix antes de cada operación. aegix decide en 3 milisegundos y el analista lo ve en vivo.» | Diagrama, sección 1: cliente → Vercel → túnel → consola → aegix. |
| 1:00–1:30 | «Laura le paga a su contacto de siempre.» | Enviar $50.000 a Andrés → **¡Listo!** En la consola aparece «aprobar» en menos de 2 s. |
| 1:30–2:15 | «Ahora alguien le robó la cuenta: cambió la SIM, entra por Tor desde un celular nuevo y manda la plata a un número que Laura nunca usó.» | *Seguridad → Toma de cuenta*. Enviar $300.000 a 300 999 0000 → **En revisión**. En la consola, el caso arriba: puntaje 1,00 (dispositivo nuevo, Tor, SIM, destino nuevo) y sus razones en orden. |
| 2:15–2:45 | «La plata no salió. El analista ve por qué y decide.» | Abrir el caso → *Confirmar fraude* → confirmar. En la billetera: **Bloqueada por fraude** en menos de 4 s. |
| 2:45–3:15 | «Si es el cliente legítimo con un SIM nuevo, no lo bloqueamos: le pedimos un código.» | *Seguridad → SIM swapping*. Enviar a Andrés → **código**. Escribirlo → listo. |
| 3:15–3:40 | «Las cuentas mula son el 35 % del fraude.» | *Salir*, ingresar como Julián (300 000 0004, clave 4444, cuenta de 21 días). Enviar «Todo» a un número nuevo → **código**. |
| 3:40–4:20 | «Con las 120.972 operaciones del reto: detectamos 81,5 % del fraude, antes de autorizar, frente al 62,6 % de hoy. Los falsos positivos bajan de 89 % a 17,7 %. Decidimos en 5 ms en el peor 1 %.» | Diagrama, sección 8. |
| 4:20–4:45 | «No es una caja negra: el puntaje es una suma de pesos que cualquiera puede rehacer, y cada resolución del analista entra a la próxima calibración.» | Diagrama, secciones 4 y 5. |
| 4:45–5:00 | «aegix: el fraude se frena antes, el cliente legítimo casi no lo nota y el analista sabe por qué.» | Consola con el pulso en vivo. |

## Preguntas probables

- **¿Por qué reglas y no un modelo de aprendizaje automático?** Porque se explican solas, se cambian sin
  reentrenar y ya superan la meta. El siguiente paso es comparar un modelo con la misma validación temporal.
- **¿Qué pasa si aegix se cae?** La billetera no mueve dinero (falla cerrada). Si aegix tarda más de 250 ms,
  pide un código en vez de aprobar.
- **¿Y la privacidad?** aegix no guarda nombres ni celulares en claro: el identificador de la operación queda como
  HMAC. Ninguna regla usa edad, región ni ingresos.
- **¿Qué fraude se les escapa?** El engaño con QR casi no deja señales técnicas; lo decimos en el reporte.
- **¿Escala?** Más de 1.100 operaciones por segundo en un portátil; el pico exigido es 150.

## Plan B

- **Falla el túnel o internet:** `herramientas/iniciar.sh` y `AEGIX_URL=http://127.0.0.1:8081 node yuma-billetera/dev.mjs`;
  billetera en http://localhost:3000 y consola en http://127.0.0.1:4173. El guion no cambia.
- **Falla el equipo:** el video grabado.
