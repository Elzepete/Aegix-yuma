#!/usr/bin/env python3
"""Centinela de aegix: cadena de custodia, expedientes forenses y vigilancia de oleadas.

Adaptado del centinela forense de nuestro compañero de equipo (sentinel_forensics.py) a la auditoría real de
aegix. Corre aparte, en segundo plano: no suma latencia a ninguna decisión y lee la auditoría en solo lectura.

  1. CADENA DE CUSTODIA: comprueba que cada línea de datos/decisiones.jsonl tenga hash_anterior = SHA-256 de la
     línea previa y un sello HMAC-SHA256 válido (el mismo algoritmo que internal/registro/cadena.go).
  2. EXPEDIENTES: por cada operación retenida escribe un informe Markdown con decisión, razones, señales,
     contacto accesible, resolución del analista y los datos de custodia (línea, SHA-256 y sello).
  3. OLEADAS: compara la mezcla reciente de puntajes con la de referencia (PSI). PSI > 0,25 = cambio fuerte
     (posible campaña de fraude o nueva modalidad); 0,10–0,25 = advertencia. Escribe ALERTA_*.json y, si hay
     NTFY_URL, avisa al celular del equipo de seguridad.

Uso:
    python3 herramientas/centinela.py                       # bucle continuo
    python3 herramientas/centinela.py --una-vez             # procesa y sale
    python3 herramientas/centinela.py --verificar-cadena    # código 1 si la cadena está rota

Clave: YUMA_AUDIT_KEY (la misma de aegix) o, si no existe, el archivo <auditoria>.clave que aegix crea.
Solo biblioteca estándar de Python.
"""
import argparse
import hashlib
import hmac
import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

FIN_SELLO = re.compile(rb',"sello":"([0-9a-f]{64})"\}$')
CORTES = [0.05, 0.15, 0.35, 0.65]  # aprobar sin señales | señales leves | casi desafío | desafío | retención
NOMBRES_TRAMOS = ["menos de 0,05", "0,05 a 0,15", "0,15 a 0,35", "0,35 a 0,65", "0,65 o más"]


# ---------------------------------------------------------------------------
# Cadena de custodia
# ---------------------------------------------------------------------------
def clave_sello(ruta_auditoria: str) -> bytes:
    if os.environ.get("YUMA_AUDIT_KEY"):
        base = os.environ["YUMA_AUDIT_KEY"].encode()
    else:
        with open(ruta_auditoria + ".clave", encoding="utf-8") as f:
            base = bytes.fromhex(f.read().strip())
    return hmac.new(base, b"sello-auditoria", hashlib.sha256).digest()


def leer_lineas(ruta: str) -> list:
    with open(ruta, "rb") as f:
        datos = f.read()
    return datos.split(b"\n")[:-1]  # lo que sigue al último salto está vacío o a medio escribir


def verificar_cadena(lineas: list, clave: bytes) -> dict:
    """Mismo algoritmo que internal/registro/cadena.go. Devuelve el resumen con las rupturas."""
    r = {"integra": True, "lineas": len(lineas), "selladas": 0, "previas_a_la_cadena": 0, "rupturas": []}
    anterior = ""
    for n, linea in enumerate(lineas, 1):
        m = FIN_SELLO.search(linea)
        if not m:
            if r["selladas"] == 0:
                r["previas_a_la_cadena"] += 1
            else:
                r["rupturas"].append({"linea": n, "motivo": "línea sin sello después de iniciada la cadena"})
        else:
            r["selladas"] += 1
            cuerpo = linea[: m.start()] + b"}"
            esperado = hmac.new(clave, cuerpo, hashlib.sha256).hexdigest().encode()
            if not hmac.compare_digest(esperado, m.group(1)):
                r["rupturas"].append({"linea": n, "motivo": "sello HMAC inválido: la línea fue alterada"})
            try:
                previo = json.loads(cuerpo).get("hash_anterior", "")
            except ValueError:
                previo = None
            if previo != anterior:
                r["rupturas"].append({"linea": n, "motivo": "hash anterior no coincide: se borró, agregó o movió una línea"})
        anterior = hashlib.sha256(linea).hexdigest()
    r["ultimo_hash"] = anterior
    r["integra"] = not r["rupturas"]
    return r


# ---------------------------------------------------------------------------
# Expedientes forenses
# ---------------------------------------------------------------------------
def limpiar_md(texto) -> str:
    """Evita que contenido de terceros rompa el Markdown del informe."""
    return re.sub(r"[|`<>\r\n]", " ", str(texto))[:300]


def si(valor) -> str:
    return "Sí" if valor else "No"


def expediente(e: dict, n: int, linea: bytes, resolucion: dict, cadena: dict) -> str:
    entrada = e.get("entrada") or {}
    acc = entrada.get("accesibilidad") or {}
    sello = FIN_SELLO.search(linea)
    md = [
        "# Expediente forense · aegix (Escudo Yuma)",
        "",
        f"**Referencia (seudónimo HMAC):** `{limpiar_md(e.get('referencia', 'n/d'))}`  ",
        f"**Registrada (UTC):** {limpiar_md(e.get('registrado_en', 'n/d'))}  ",
        f"**Reglas:** `{limpiar_md(e.get('version_reglas', 'n/d'))}` · **Origen:** {limpiar_md(e.get('origen', 'sandbox'))}",
        "",
        "## 1. Decisión",
        f"- **Decisión:** {limpiar_md(e.get('decision', 'n/d')).upper()} con puntaje {float(e.get('puntaje', 0)):.2f} "
        f"(desafío desde 0,35; retención desde 0,65)",
        f"- **Operación:** {limpiar_md(entrada.get('tipo_operacion', 'n/d'))} por {limpiar_md(entrada.get('canal', 'n/d'))}, "
        f"COP {int(entrada.get('monto_cop', 0)):,}".replace(",", "."),
        f"- **Latencia de la decisión:** {float(e.get('latencia_ms', 0)):.2f} ms",
        "",
        "## 2. Razones, de mayor a menor peso",
    ]
    md += [f"{i}. {limpiar_md(r)}" for i, r in enumerate(e.get("razones") or [], 1)]
    md += [
        "",
        "## 3. Señales técnicas",
        "| Señal | Valor |", "|:--|:--|",
        f"| Dispositivo nuevo | {si(entrada.get('dispositivo_nuevo'))} |",
        f"| Cambio reciente de SIM | {si(entrada.get('cambio_sim'))} |",
        f"| Cambio reciente de clave | {si(entrada.get('cambio_clave'))} |",
        f"| Destino nuevo | {si(entrada.get('destino_nuevo'))} |",
        "",
        "## 4. Contacto con el cliente",
        f"- **Canal preferido:** {limpiar_md(acc.get('contacto') or 'sin preferencia')}"
        + (" · con persona de apoyo" if acc.get("apoyo_de_confianza") else "")
        + (" · lectura fácil" if acc.get("lectura_facil") else ""),
        "- Las preferencias de accesibilidad solo informan cómo contactar; nunca entran al puntaje.",
        "",
        "## 5. Supervisión humana (SARLAFT)",
    ]
    if resolucion:
        md.append(f"- **Resolución:** {limpiar_md(resolucion.get('resolucion'))} el {limpiar_md(resolucion.get('registrado_en'))}"
                  f" por {limpiar_md(resolucion.get('analista') or 'consola sin ingreso individual')}")
    else:
        md.append("- **Estado:** en revisión. Ningún bloqueo definitivo se ejecuta sin un analista.")
    md += [
        "",
        "## 6. Cadena de custodia",
        f"- **Línea de la auditoría:** {n}",
        f"- **SHA-256 de la línea:** `{hashlib.sha256(linea).hexdigest()}`",
        f"- **Sello HMAC:** `{sello.group(1).decode() if sello else 'línea anterior al sello'}`",
        # Sin hora ni conteos: el expediente solo se reescribe si cambia el caso o el estado de la cadena.
        f"- **Cadena completa al escribir este expediente:** {'ÍNTEGRA' if cadena['integra'] else 'ROTA, ver ALERTA_CADENA'}",
        "",
        "## 7. Datos personales (Ley 1581 de 2012)",
        "- La auditoría no guarda nombres ni números de celular: la referencia es un seudónimo HMAC.",
        "- Ninguna regla usa edad, región ni ingresos.",
        "",
    ]
    return "\n".join(md)


def escribir_si_cambia(ruta: str, contenido: str) -> bool:
    try:
        with open(ruta, encoding="utf-8") as f:
            if f.read() == contenido:
                return False
    except FileNotFoundError:
        pass
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(contenido)
    os.replace(tmp, ruta)
    return True


# ---------------------------------------------------------------------------
# Oleadas: PSI de la mezcla de puntajes
# ---------------------------------------------------------------------------
def proporciones(puntajes: list) -> list:
    conteo = [0] * (len(CORTES) + 1)
    for p in puntajes:
        conteo[sum(p >= c for c in CORTES)] += 1
    return [max(c / max(len(puntajes), 1), 1e-4) for c in conteo]


def psi(referencia: list, reciente: list) -> float:
    return sum((a - e) * math.log(a / e) for a, e in zip(proporciones(reciente), proporciones(referencia)))


def evaluar_oleada(puntajes: list, ventana: int = 200) -> dict:
    if len(puntajes) < 2 * ventana:
        return {"estado": "SIN_DATOS_SUFICIENTES", "decisiones": len(puntajes), "alerta": False}
    referencia, reciente = puntajes[:-ventana], puntajes[-ventana:]
    v = psi(referencia, reciente)
    estado = "AMENAZA_EMERGENTE" if v > 0.25 else "ADVERTENCIA" if v > 0.10 else "ESTABLE"
    r = {
        "estado": estado, "psi": round(v, 4), "decisiones": len(puntajes), "ventana_reciente": ventana,
        "mezcla_referencia": dict(zip(NOMBRES_TRAMOS, map(lambda x: round(x, 4), proporciones(referencia)))),
        "mezcla_reciente": dict(zip(NOMBRES_TRAMOS, map(lambda x: round(x, 4), proporciones(reciente)))),
        "alerta": estado != "ESTABLE",
    }
    if r["alerta"]:
        r["diagnostico"] = ("La mezcla de puntajes de las últimas decisiones cambió frente a la referencia: posible "
                            "campaña de fraude, nueva modalidad o cambio en el tráfico.")
        r["accion_recomendada"] = "Revisar los casos recientes en la consola y evaluar una recalibración de las reglas."
    return r


def avisar_ntfy(titulo: str, mensaje: str) -> None:
    url = os.environ.get("NTFY_URL", "").strip()
    m = re.fullmatch(r"(https://[^/]+)/([\w-]{1,64})", url)
    if not m:
        return
    cuerpo = json.dumps({"topic": m.group(2), "title": titulo, "message": mensaje, "tags": ["rotating_light"], "priority": 5}).encode()
    try:
        urllib.request.urlopen(urllib.request.Request(m.group(1) + "/", cuerpo, {"Content-Type": "application/json"}), timeout=4)
    except OSError:
        pass  # el aviso es un extra: el archivo de alerta ya quedó escrito


def escribir_alerta(dir_salida: str, tipo: str, datos: dict) -> str:
    ruta = os.path.join(dir_salida, f"ALERTA_{tipo}_{int(time.time())}.json")
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump({**datos, "hora_utc": datetime.now(timezone.utc).isoformat()}, f, indent=2, ensure_ascii=False)
    return ruta


# ---------------------------------------------------------------------------
def ciclo(a, clave: bytes, memoria: dict) -> dict:
    lineas = leer_lineas(a.auditoria)
    cadena = verificar_cadena(lineas, clave)
    if not cadena["integra"] and memoria.get("cadena") != cadena["ultimo_hash"]:
        ruta = escribir_alerta(a.expedientes, "CADENA", cadena)
        print(f"[ALERTA] cadena de custodia rota: {ruta}", flush=True)
        avisar_ntfy("aegix · auditoría alterada", f"La cadena de la auditoría está rota en la línea {cadena['rupturas'][0]['linea']}.")
        memoria["cadena"] = cadena["ultimo_hash"]

    decisiones, resoluciones = [], {}
    for n, linea in enumerate(lineas, 1):
        try:
            e = json.loads(linea)
        except ValueError:
            continue
        if e.get("resolucion"):
            resoluciones[e.get("referencia")] = e
        else:
            decisiones.append((n, linea, e))

    nuevos = 0
    for n, linea, e in decisiones:
        ref = e.get("referencia", "")
        if e.get("decision") != "retener" or not re.fullmatch(r"[0-9a-f]{64}", ref):
            continue  # nunca usar texto de la auditoría como ruta sin validarlo
        texto = expediente(e, n, linea, resoluciones.get(ref), cadena)
        if escribir_si_cambia(os.path.join(a.expedientes, f"expediente-{ref[:16]}.md"), texto):
            nuevos += 1
    if nuevos:
        print(f"[Forense] {nuevos} expediente(s) escritos o actualizados en {a.expedientes}", flush=True)

    oleada = evaluar_oleada([float(e.get("puntaje", 0)) for _, _, e in decisiones[-5000:]])
    if oleada["alerta"] and (oleada["estado"] != memoria.get("estado") or time.time() - memoria.get("alerta_en", 0) > 300):
        ruta = escribir_alerta(a.expedientes, "OLEADA", oleada)
        print(f"[ALERTA SOC] {oleada['estado']} (PSI {oleada['psi']}): {ruta}", flush=True)
        avisar_ntfy("aegix · posible oleada de fraude", f"{oleada['estado']}: la mezcla de puntajes cambió (PSI {oleada['psi']}).")
        memoria["alerta_en"] = time.time()
    memoria["estado"] = oleada["estado"]
    return {"cadena": cadena, "oleada": oleada}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--auditoria", default=os.environ.get("AUDITORIA", "datos/decisiones.jsonl"))
    ap.add_argument("--expedientes", default=os.environ.get("EXPEDIENTES", "datos/expedientes"))
    ap.add_argument("--intervalo", type=float, default=10.0)
    ap.add_argument("--una-vez", action="store_true")
    ap.add_argument("--verificar-cadena", action="store_true")
    a = ap.parse_args()

    try:
        clave = clave_sello(a.auditoria)
    except OSError as e:
        sys.exit(f"No se encontró la clave de la auditoría ({e}). Define YUMA_AUDIT_KEY o arranca aegix primero.")
    if a.verificar_cadena:
        r = verificar_cadena(leer_lineas(a.auditoria), clave)
        print(json.dumps(r, ensure_ascii=False, indent=2))
        sys.exit(0 if r["integra"] else 1)

    os.makedirs(a.expedientes, exist_ok=True)
    print(f"[Centinela] vigilando {a.auditoria}; expedientes y alertas en {a.expedientes}", flush=True)
    memoria = {}
    while True:
        try:
            r = ciclo(a, clave, memoria)
            if a.una_vez:
                c, o = r["cadena"], r["oleada"]
                print(f"Cadena {'ÍNTEGRA' if c['integra'] else 'ROTA'} ({c['selladas']} selladas, "
                      f"{c['previas_a_la_cadena']} anteriores al sello). Oleadas: {o['estado']}.")
                sys.exit(0 if c["integra"] else 1)
        except FileNotFoundError:
            print("[Centinela] la auditoría aún no existe; reintento.", flush=True)
            if a.una_vez:
                sys.exit(1)
        time.sleep(a.intervalo)


if __name__ == "__main__":
    main()
