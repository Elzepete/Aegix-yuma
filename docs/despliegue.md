# Despliegue gratuito de Escudo Yuma

Tres piezas, dos lugares:

| Pieza | Dónde corre | Dirección pública |
| --- | --- | --- |
| Billetera Yuma (HTML + función `api/autorizar.js`) | Vercel, plan Hobby | `https://<proyecto>.vercel.app` |
| Consola del operador (`panel-etapa5/proxy.mjs`, puerto 4173) | tu equipo | `https://<dominio-fijo>` (túnel) |
| aegix (puerto 8081) | tu equipo, solo en 127.0.0.1 | ninguna: se llega a través de la consola |

El túnel apunta a la **consola**, no a aegix. La consola sirve el panel (con contraseña) y deja pasar solo tres
rutas hacia aegix, que valida su propio token: `POST /v1/autorizar`, `GET /v1/autorizar/{id}` y `GET /salud`.
`/score`, `/metricas`, `/alertas` y la resolución de casos quedan detrás de la contraseña.

## 1. Claves (una sola vez)

```bash
openssl rand -hex 24      # → YUMA_PANEL_TOKEN (billetera ↔ aegix)
openssl rand -base64 12   # → YUMA_PANEL_CLAVE (contraseña de la consola en el navegador)
```

Guárdalas en un gestor de contraseñas. No van en el repositorio (`.env*` está ignorado).

## 2. Túnel con dirección fija

**Opción recomendada: ngrok** (gratis, incluye un dominio fijo).

1. Crea una cuenta en ngrok.com e instala el binario (`ngrok`).
2. `ngrok config add-authtoken <tu-authtoken>` (aparece en el panel de ngrok).
3. En *Domains*, reclama tu dominio estático gratuito, p. ej. `aegix-demo.ngrok-free.app`.

**Alternativa: Cloudflare** con un túnel con nombre (requiere un dominio propio en Cloudflare):
`cloudflared tunnel create aegix` y una ruta DNS hacia `http://127.0.0.1:4173`.
Sin cuenta, `cloudflared tunnel --url …` funciona, pero la dirección cambia en cada arranque.

## 3. Arrancar aegix, la consola y el túnel

```bash
export YUMA_PANEL_TOKEN=… YUMA_PANEL_CLAVE=… NGROK_DOMINIO=aegix-demo.ngrok-free.app
herramientas/iniciar.sh --tunel
```

El script compila aegix, compila la consola si hace falta, guarda la auditoría en `datos/decisiones.jsonl`
y se niega a abrir el túnel si falta alguna de las dos claves. Ctrl+C apaga todo.

Para empezar una presentación en cero: `herramientas/iniciar.sh --tunel --demo-limpia`. La auditoría anterior
se **archiva** en `datos/archivo/` (nunca se borra) y la clave HMAC se conserva.

## 4. Billetera en Vercel

Desde GitHub (recomendado):

1. vercel.com → *Add New → Project* → importa el repositorio.
2. *Root Directory*: `yuma-billetera`. *Framework Preset*: `Other`. Sin comando de build.
3. *Environment Variables*: `AEGIX_URL=https://aegix-demo.ngrok-free.app` y `AEGIX_TOKEN=<YUMA_PANEL_TOKEN>`.
4. *Deploy*. Cada `git push` a `main` vuelve a desplegar.

Por terminal: `cd yuma-billetera && npx vercel` y luego `npx vercel --prod`.

## 5. Comprobar

```bash
curl https://aegix-demo.ngrok-free.app/salud                 # {"estado":"ok"…}
curl -i https://aegix-demo.ngrok-free.app/api/metricas        # 401: pide contraseña
curl https://<proyecto>.vercel.app/api/autorizar              # {"aegix":"en_linea"}
```

Abre la billetera, envía plata y mira la consola en `https://aegix-demo.ngrok-free.app` (usuario cualquiera,
contraseña `YUMA_PANEL_CLAVE`): la operación aparece en menos de 2 s en «Toda la actividad».

## Plan B si falla internet o el túnel

Todo funciona en local, sin Vercel ni túnel:

```bash
docker compose up --build                                   # todo con Docker, o bien:
herramientas/iniciar.sh                                      # aegix :8081 y consola :4173
AEGIX_URL=http://127.0.0.1:8081 node yuma-billetera/dev.mjs  # billetera :3000
```

Si la billetera muestra «aegix sin conexión», no autoriza nada: falla cerrada, a propósito.
