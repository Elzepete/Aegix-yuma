#!/usr/bin/env bash
# Arranca aegix y la consola del operador; opcionalmente abre el túnel público.
#
#   herramientas/iniciar.sh                 # local: aegix :8081 y consola :4173
#   herramientas/iniciar.sh --demo-limpia   # archiva la auditoría actual y empieza en cero
#   herramientas/iniciar.sh --tunel         # además publica la consola (y la API de la billetera) por un túnel
#   herramientas/iniciar.sh --tunel --sin-clave   # consola pública sin contraseña (solo para una demostración)
#
# Variables:
#   YUMA_PANEL_TOKEN   clave entre la billetera (Vercel, AEGIX_TOKEN) y aegix. Obligatoria con --tunel.
#   YUMA_PANEL_CLAVE   contraseña de la consola en el navegador. Obligatoria con --tunel, salvo con --sin-clave.
#   NGROK_DOMINIO      dominio fijo gratuito de ngrok (p. ej. aegix-demo.ngrok-free.app); o bien
#   CLOUDFLARE_TUNEL   nombre de un túnel con nombre de Cloudflare (requiere dominio propio).
#   Sin ninguno de los dos, se usa un túnel rápido de Cloudflare (dirección distinta en cada arranque).
#   NTFY_URL           opcional: tema de ntfy (https://ntfy.sh/tu-tema) para recibir en el celular los avisos de aegix.
set -euo pipefail
cd "$(dirname "$0")/.."

limpia=0; tunel=0; sin_clave=0
for a in "$@"; do
  case "$a" in
    --demo-limpia) limpia=1 ;;
    --tunel) tunel=1 ;;
    --sin-clave) sin_clave=1 ;;
    *) echo "opción desconocida: $a" >&2; exit 2 ;;
  esac
done

mkdir -p datos/archivo bin
auditoria=datos/decisiones.jsonl

if [[ $sin_clave == 1 ]]; then
  unset YUMA_PANEL_CLAVE
  echo "Aviso: la consola queda sin contraseña; quien tenga la dirección del túnel puede ver y resolver casos." >&2
fi
if [[ $tunel == 1 && ( -z "${YUMA_PANEL_TOKEN:-}" || ( $sin_clave == 0 && -z "${YUMA_PANEL_CLAVE:-}" ) ) ]]; then
  echo "Con --tunel define YUMA_PANEL_TOKEN y YUMA_PANEL_CLAVE (o usa --sin-clave): sin ellas cualquiera podría liberar operaciones." >&2
  exit 1
fi

if [[ $limpia == 1 && -s $auditoria ]]; then
  # Se archiva, nunca se borra: es la evidencia de las decisiones. La clave HMAC se conserva para poder verificarla.
  destino="datos/archivo/decisiones-$(date +%Y%m%d-%H%M%S).jsonl"
  mv "$auditoria" "$destino"
  echo "Auditoría anterior archivada en $destino"
fi

go build -o bin/intermediario ./cmd/intermediario
[[ -f panel-etapa5/dist/index.html ]] || (cd panel-etapa5 && npm ci --silent && npm run build)

pids=()
terminar() { kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap terminar EXIT INT TERM

bin/intermediario -auditoria "$auditoria" & pids+=($!)
node panel-etapa5/proxy.mjs & pids+=($!)
sleep 1
echo "aegix:   http://127.0.0.1:8081/salud"
echo "consola: http://127.0.0.1:4173"

if [[ $tunel == 1 ]]; then
  ngrok=$(command -v ngrok || echo bin/ngrok) # también sirve el binario descargado en bin/
  if [[ -n "${NGROK_DOMINIO:-}" && -x "$ngrok" ]]; then
    echo "Túnel fijo: https://$NGROK_DOMINIO  (en Vercel: AEGIX_URL=https://$NGROK_DOMINIO)"
    "$ngrok" http --url="$NGROK_DOMINIO" 4173 --log=stdout >/dev/null & pids+=($!)
  elif [[ -n "${CLOUDFLARE_TUNEL:-}" ]] && command -v cloudflared >/dev/null; then
    cloudflared tunnel run "$CLOUDFLARE_TUNEL" & pids+=($!)
  elif command -v cloudflared >/dev/null; then
    echo "Túnel rápido: la dirección cambia en cada arranque; actualiza AEGIX_URL en Vercel." >&2
    cloudflared tunnel --url http://127.0.0.1:4173 & pids+=($!)
  else
    echo "Instala ngrok o cloudflared para usar --tunel (ver docs/despliegue.md)." >&2
    exit 1
  fi
fi

wait -n "${pids[@]}"
