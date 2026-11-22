"""Arranca el sandbox, Go y el panel local con una retención de demostración."""

import contextlib
import hmac
import json
import os
import secrets
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

PANEL = Path(__file__).resolve().parent
PROYECTO = PANEL.parent
ID_DEMO = "T00001087"


def puertos_libres(puerto_panel):
    with contextlib.ExitStack() as stack:
        sockets = [stack.enter_context(socket.socket()) for _ in range(3)]
        for sock, port in zip(sockets, (puerto_panel, 0, 0)):
            sock.bind(("127.0.0.1", port))
        return [sock.getsockname()[1] for sock in sockets]


def consultar(url, datos=None, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
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


def enviar_retencion(sandbox, go):
    while True:
        lote = consultar(f"{sandbox}/v1/transacciones/siguiente?cantidad=500")
        for tx in lote["transacciones"]:
            if tx["id_transaccion"] == ID_DEMO:
                decision = consultar(f"{go}/score", {
                    "transaccion": tx,
                    "contexto": {
                        "ip": "203.0.113.10",
                        "pais_ip": "CO",
                        "es_tor": True,
                        "es_proxy_o_datacenter": False,
                        "version_app": "3.4.1",
                        "sistema_operativo": "Android",
                        "huella_dispositivo": tx["id_dispositivo"],
                    },
                })
                if decision["id_transaccion"] != ID_DEMO or decision["decision"] != "retener":
                    raise RuntimeError(f"Decisión de demo inesperada: {decision}")
                return decision
        if not lote["restantes"]:
            raise RuntimeError(f"El sandbox no entregó {ID_DEMO}")


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
    if not (PANEL / "dist/index.html").is_file():
        raise SystemExit("Primero compila el panel con npm run build.")

    archivo_sandbox = Path(os.environ.get("YUMA_SANDBOX_PY", str(
        Path.home() / "Descargas/Caso_de_estudio_Yuma_Pay/04_Sandbox_API/mock_api.py"
    ))).expanduser()
    puerto_panel, puerto_sandbox, puerto_go = puertos_libres(int(os.environ.get("YUMA_PANEL_PORT", "4173")))
    panel, sandbox, go = [f"http://127.0.0.1:{p}" for p in (puerto_panel, puerto_sandbox, puerto_go)]
    token = secrets.token_hex(32)
    clave_auditoria = secrets.token_hex(32)
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
                         "-auditoria", str(Path(temporal) / "decisiones.jsonl")],
                        PROYECTO, YUMA_PANEL_TOKEN=token, YUMA_AUDIT_KEY=clave_auditoria)
        esperar(f"{go}/salud", motor)
        servidor = iniciar(["node", "proxy.mjs"], PANEL, YUMA_PANEL_PORT=str(puerto_panel),
                           YUMA_GO_URL=go, YUMA_SANDBOX_URL=sandbox, YUMA_PANEL_TOKEN=token)
        esperar(panel, servidor, leer_html)

        decision = enviar_retencion(sandbox, go)
        referencia = hmac.digest(clave_auditoria.encode(), ID_DEMO.encode(), "sha256").hex()
        for _ in range(30):
            alertas = consultar(f"{go}/alertas", token=token)
            if any(a["referencia"] == referencia and a["decision"] == "retener"
                   and a["confirmada_por_sandbox"] and a["razones"] == decision["razones"] for a in alertas):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("No apareció la retención confirmada en /alertas")
        if consultar(f"{panel}/api/alertas") != alertas:
            raise RuntimeError("Las alertas del proxy difieren de Go")
        indicadores = consultar(f"{go}/indicadores", token=token)
        if indicadores["retenidas"] != 1 or consultar(f"{panel}/api/indicadores") != indicadores:
            raise RuntimeError("Los indicadores del proxy difieren de Go")
        print(f"Retención confirmada: {ID_DEMO}, puntaje {decision['puntaje']}. Panel: {panel}", flush=True)
        print("Pulsa Ctrl+C para detener los tres servicios.", flush=True)
        while all(p.poll() is None for p in (mock, motor, servidor)):
            time.sleep(0.5)
        raise RuntimeError("Se detuvo un servicio de la demo")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
