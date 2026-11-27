#!/usr/bin/env python3
"""Compara las reglas de aegix con un modelo de aprendizaje automático (regresión logística), con las mismas
señales y la misma validación temporal: se entrena con mayo–agosto y se mide con septiembre–octubre.

Para comparar en igualdad, el umbral del modelo se fija en entrenamiento para que moleste a la misma proporción de
clientes legítimos que las reglas (fricción) y se ve cuánto fraude detecta cada uno en validación.
Solo biblioteca estándar.

    python3 herramientas/comparar_modelo.py ruta/03_Datos/transacciones.csv
"""
import collections, csv, math, re, sys
from datetime import datetime, timedelta
from pathlib import Path

REGLAS = Path(__file__).resolve().parent.parent / 'config' / 'reglas.yaml'
SENALES = ['dispositivo_nuevo', 'cambio_sim', 'cambio_clave', 'destino_nuevo', 'departamento_distinto', 'hora_atipica',
           'cuenta_nueva', 'monto_sobre_saldo', 'salidas_recientes', 'comercio_desconocido']
ORIGEN = {'hora_atipica', 'departamento_distinto'}
TIPOS = ['transferencia_inmediata', 'pago_qr', 'retiro_corresponsal', 'retiro_cajero', 'pago_servicios', 'recarga_celular', 'compra_tarjeta_virtual']


def leer_reglas():
    texto = REGLAS.read_text(encoding='utf-8')
    pesos = {m[0]: float(m[1]) for m in re.findall(r'senal:\s*(\w+).*?peso:\s*([\d.]+)', texto)}
    umbrales = dict(re.findall(r'(desafiar|retener):\s*([\d.]+)', texto))
    bajo = re.search(r'tipos_bajo_riesgo:\s*\[([^\]]*)\]', texto)
    minimo = re.search(r'min_clientes_comercio:\s*(\d+)', texto)
    return (pesos, float(umbrales['desafiar']), float(umbrales['retener']),
            {t.strip() for t in bajo.group(1).split(',')} if bajo else set(), int(minimo.group(1)) if minimo else 0)


def senales(ruta, minimo_comercio):
    """Recorre el CSV en orden, como el sandbox, y calcula las señales que ve aegix (solo con el pasado)."""
    hist = collections.defaultdict(list)
    pagadores = collections.defaultdict(set)
    for f in csv.DictReader(open(ruta, encoding='utf-8-sig')):
        fecha = datetime.strptime(f['fecha_hora'], '%Y-%m-%d %H:%M:%S')
        cliente, monto, saldo = f['id_cliente'], int(f['monto_cop']), int(f['saldo_antes_cop'])
        previas = hist[cliente]
        horas = collections.Counter(p.hour for p in previas)
        h = fecha.hour
        otros = len(pagadores[f['id_destino']] - {cliente})
        s = {
            'dispositivo_nuevo': f['dispositivo_nuevo'] == '1', 'cambio_sim': f['cambio_sim_48h'] == '1',
            'cambio_clave': f['cambio_clave_24h'] == '1', 'destino_nuevo': f['destino_nuevo'] == '1',
            'departamento_distinto': f['ip_departamento_distinto'] == '1',
            'hora_atipica': len(previas) >= 10 and (horas[(h - 1) % 24] + horas[h] + horas[(h + 1) % 24]) * 10 < len(previas),
            'cuenta_nueva': int(f['antiguedad_cuenta_dias']) < 30,
            'monto_sobre_saldo': saldo > 0 and monto / saldo >= .75,
            'salidas_recientes': sum(p >= fecha - timedelta(minutes=10) for p in previas) >= 2,
            'comercio_desconocido': f['tipo_destino'] == 'comercio' and minimo_comercio > 0 and otros < minimo_comercio,
        }
        yield f['fecha_hora'] < '2026-09-01', f['es_fraude'] == '1', f['tipo_operacion'], s
        previas.append(fecha)
        pagadores[f['id_destino']].add(cliente)


def vector(tipo, s):
    return tuple([1.0] + [float(s[n]) for n in SENALES] + [float(tipo == t) for t in TIPOS[1:]])


def entrenar(patrones, iteraciones=3000, paso=1.0, l2=1e-3):
    """Regresión logística ponderada (fraude con más peso, porque es el 1,4 %) por descenso de gradiente."""
    total_f = sum(f for _, (l, f) in patrones.items()); total_l = sum(l for _, (l, f) in patrones.items())
    peso_f = total_l / max(1, total_f)
    w = [0.0] * len(next(iter(patrones)))
    for _ in range(iteraciones):
        grad = [0.0] * len(w)
        norma = 0.0
        for x, (leg, fra) in patrones.items():
            p = 1 / (1 + math.exp(-sum(a * b for a, b in zip(w, x))))
            error = peso_f * fra * (p - 1) + leg * p
            norma += peso_f * fra + leg
            for i, xi in enumerate(x):
                if xi: grad[i] += error * xi
        w = [wi - paso * (g / norma + l2 * wi) for wi, g in zip(w, grad)]
    return w


def main():
    pesos, desafiar, retener, bajo, minimo = leer_reglas()
    filas = list(senales(sys.argv[1], minimo))
    agregados = collections.defaultdict(lambda: [0, 0])
    for entrena, fraude, tipo, s in filas:
        if entrena: agregados[vector(tipo, s)][fraude] += 1
    w = entrenar({x: tuple(v) for x, v in agregados.items()})
    prob = lambda tipo, s: 1 / (1 + math.exp(-sum(a * b for a, b in zip(w, vector(tipo, s)))))

    def decision_reglas(tipo, s):
        p = min(1, sum(pesos.get(n, 0) for n in SENALES if s[n]))
        otra = any(s[n] for n in SENALES if n not in ORIGEN and pesos.get(n, 0) > 0)
        accion = 'retener' if p >= retener and otra else 'desafiar' if p >= desafiar else 'aprobar'
        return {'retener': 'desafiar', 'desafiar': 'aprobar'}.get(accion, accion) if tipo in bajo else accion

    def medir(conjunto, detecta):
        c = collections.Counter((fraude, detecta(tipo, s)) for _, fraude, tipo, s in conjunto)
        return c[(True, True)] / max(1, c[(True, True)] + c[(True, False)]), c[(False, True)] / max(1, c[(False, True)] + c[(False, False)])

    entrenamiento = [f for f in filas if f[0]]
    validacion = [f for f in filas if not f[0]]
    reglas = lambda tipo, s: decision_reglas(tipo, s) != 'aprobar'
    _, friccion_reglas = medir(entrenamiento, reglas)
    # Umbral del modelo: el que da en entrenamiento la misma fricción que las reglas.
    puntajes = sorted((prob(t, s) for _, f, t, s in entrenamiento if not f), reverse=True)
    umbral = puntajes[int(friccion_reglas * len(puntajes))]
    modelo = lambda tipo, s: prob(tipo, s) > umbral

    print('Septiembre–octubre (no usados para ajustar), misma fricción que las reglas en entrenamiento:')
    for nombre, f in (('Reglas de aegix', reglas), ('Regresión logística', modelo)):
        det, fri = medir(validacion, f)
        print(f'  {nombre:20s} fraude detectado {det:6.1%}   clientes legítimos con fricción {fri:5.2%}')
    # Comparación a igual fricción en validación: cuánto detectaría el modelo molestando lo mismo que las reglas.
    _, friccion_val = medir(validacion, reglas)
    puntajes_val = sorted((prob(t, s) for _, f, t, s in validacion if not f), reverse=True)
    umbral_val = puntajes_val[int(friccion_val * len(puntajes_val))]
    det, fri = medir(validacion, lambda tipo, s: prob(tipo, s) > umbral_val)
    print(f'  {"Regresión logística":20s} fraude detectado {det:6.1%}   clientes legítimos con fricción {fri:5.2%}   (a igual fricción)')
    print('\nPesos que aprendió el modelo (log-odds, mayor = más riesgo):')
    nombres = ['constante'] + SENALES + [f'tipo={t}' for t in TIPOS[1:]]
    for n, wi in sorted(zip(nombres, w), key=lambda x: -abs(x[1]))[:12]:
        print(f'  {n:28s} {wi:+.2f}')


if __name__ == '__main__':
    main()
