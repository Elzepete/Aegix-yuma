"""Arranca el panel con billetera, el sandbox oficial y el motor Go."""

import argparse
import contextlib
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

PANEL = Path(__file__).resolve().parent
PROYECTO = PANEL.parent
def puerto_disponible(preferido):
    for p in range(preferido, preferido + 50):
        try:
            with socket.socket() as s:
                s.bind(("127.0.0.1", p))
                return p
        except OSError:
            continue
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def puertos_libres(puerto_panel):
    panel = puerto_disponible(puerto_panel)
    with contextlib.ExitStack() as stack:
        sockets = [stack.enter_context(socket.socket()) for _ in range(3)]
        for sock in sockets:
            sock.bind(("127.0.0.1", 0))
        return [panel] + [sock.getsockname()[1] for sock in sockets]


def consultar(url, datos=None):
    headers = {}
    if datos is not None:
        headers["Content-Type"] = "application/json"
        datos = json.dumps(datos).encode()
    with urlopen(Request(url, data=datos, headers=headers), timeout=3) as response:
        return json.load(response)


def esperar(url, proceso, leer=consultar):
    limite = time.monotonic() + 15
    while time.monotonic() < limite and proceso.poll() is None:
        try:
            return leer(url)
        except URLError:
            time.sleep(0.1)
    raise RuntimeError(f"El servicio no respondió en {url}")


def detener(proceso):
    if proceso.poll() is not None:
        return
    proceso.terminate()
    try:
        proceso.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proceso.kill()
        proceso.wait()


def leer_html(url):
    with urlopen(url, timeout=3) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verificar", action="store_true",
                        help="comprueba las dos decisiones y la billetera por HTTP, y termina")
    args = parser.parse_args()
    if not (PANEL / "dist/index.html").is_file():
        raise SystemExit("Primero compila el panel con npm run build.")

    archivo_sandbox = Path(os.environ.get("YUMA_SANDBOX_PY", str(
        Path.home() / "Descargas/Caso_de_estudio_Yuma_Pay/04_Sandbox_API/mock_api.py"
    ))).expanduser()
    puerto_panel, puerto_sandbox, puerto_go, puerto_ml = puertos_libres(
        int(os.environ.get("YUMA_PANEL_PORT", "4183"))
    )
    panel, sandbox, go = [f"http://127.0.0.1:{p}" for p in (puerto_panel, puerto_sandbox, puerto_go)]
    with tempfile.TemporaryDirectory(prefix="yuma-panel-") as temporal, contextlib.ExitStack() as stack:
        binario = Path(temporal) / "intermediario"
        subprocess.run(["go", "build", "-buildvcs=false", "-o", str(binario), "./cmd/intermediario"],
                       cwd=PROYECTO, check=True)

        def iniciar(args, carpeta, **variables):
            proceso = subprocess.Popen(args, cwd=carpeta, env={**os.environ, **variables})
            stack.callback(detener, proceso)
            return proceso

        mock = iniciar(["python3", str(archivo_sandbox), "--puerto", str(puerto_sandbox)], PROYECTO)
        esperar(f"{sandbox}/v1/salud", mock)
        motor = iniciar([str(binario), "-escuchar", f"127.0.0.1:{puerto_go}", "-sandbox", sandbox,
                         "-auditoria", str(Path(temporal) / "decisiones.jsonl")], PROYECTO)
        esperar(f"{go}/salud", motor)
        servidor = iniciar(
            ["node", "--import", "tsx", "server.ts"], PANEL, NODE_ENV="production",
            YUMA_PANEL_HOST="127.0.0.1", YUMA_PANEL_PORT=str(puerto_panel),
            YUMA_GO_URL=go, YUMA_SANDBOX_URL=sandbox, PYTHON_ML_PORT=str(puerto_ml),
        )
        esperar(panel, servidor, leer_html)

        if args.verificar:
            resultados = consultar(f"{panel}/api/prueba-go", {})
            decisiones = [fila["respuesta"] for fila in resultados]
            if [d["decision"] for d in decisiones] != ["aprobar", "retener"] or not all(
                d["id_transaccion"] and d["razones"] for d in decisiones
            ):
                raise RuntimeError(f"Decisiones inesperadas: {decisiones}")
            if consultar(f"{sandbox}/v1/metricas")["transacciones_decididas"] != 2:
                raise RuntimeError("El sandbox no registró las dos decisiones")
            consultar(f"{panel}/api/wallet/state")
            print(json.dumps(decisiones, ensure_ascii=False, indent=2))
            return
        print(f"Panel: {panel}. Pulsa Ctrl+C para detener la demo.", flush=True)
        while all(p.poll() is None for p in (mock, motor, servidor)):
            time.sleep(0.5)
        raise RuntimeError("Se detuvo un servicio de la demo")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
