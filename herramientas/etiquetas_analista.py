"""Convierte las resoluciones del analista en la auditoría de aegix en ejemplos etiquetados para la calibración.

Una retención liberada es un falso positivo (legítima); una con fraude confirmado es fraude. Las razones que
aegix guardó en la decisión dicen qué señales se activaron, que es justo el patrón que agrupa el calibrador.
Solo hay etiquetas de operaciones retenidas: corrigen sobre todo los falsos positivos de esa zona.
"""
import json, re

def razones_por_senal(ruta_reglas):
    """{razón legible: señal} leído de config/reglas.yaml (formato de una regla por línea)."""
    mapa = {}
    for linea in open(ruta_reglas, encoding='utf-8'):
        m = re.search(r'senal:\s*(\w+).*razon:\s*"([^"]+)"', linea)
        if m: mapa[m.group(2)] = m.group(1)
    return mapa

def etiquetas(ruta_auditoria, ruta_reglas):
    """Lista de (conjunto de señales activas, es_fraude) por cada retención resuelta por el analista."""
    mapa = razones_por_senal(ruta_reglas)
    decisiones, resueltas = {}, {}
    for linea in open(ruta_auditoria, encoding='utf-8'):
        if not linea.strip(): continue
        e = json.loads(linea)
        ref = e.get('referencia')
        if not ref: continue
        if e.get('resolucion'): resueltas[ref] = e['resolucion']
        elif e.get('decision') == 'retener': decisiones[ref] = e.get('razones') or []
    salida = []
    for ref, resolucion in resueltas.items():
        if ref not in decisiones or resolucion not in ('liberar', 'confirmar_fraude'): continue
        senales = {mapa[r] for r in decisiones[ref] if r in mapa}
        salida.append((senales, resolucion == 'confirmar_fraude'))
    return salida

if __name__ == '__main__':  # autoprueba: python3 herramientas/etiquetas_analista.py
    import os, tempfile
    d = tempfile.mkdtemp()
    reglas, aud = os.path.join(d, 'r.yaml'), os.path.join(d, 'a.jsonl')
    open(reglas, 'w').write('  - {senal: dispositivo_nuevo, peso: 0.5, razon: "dispositivo nuevo"}\n'
                            '  - {senal: cambio_sim, peso: 0.25, razon: "cambio reciente de SIM"}\n')
    eventos = [
        {'referencia': 'a', 'decision': 'retener', 'razones': ['dispositivo nuevo', 'cambio reciente de SIM']},
        {'referencia': 'b', 'decision': 'retener', 'razones': ['dispositivo nuevo']},
        {'referencia': 'c', 'decision': 'aprobar', 'razones': []},
        {'referencia': 'a', 'decision': 'retener', 'resolucion': 'confirmar_fraude'},
        {'referencia': 'b', 'decision': 'retener', 'resolucion': 'liberar'},
        {'referencia': 'z', 'decision': 'retener', 'resolucion': 'liberar'},  # sin decisión original: se ignora
    ]
    open(aud, 'w').write('\n'.join(json.dumps(e) for e in eventos) + '\n')
    r = sorted(etiquetas(aud, reglas), key=lambda x: len(x[0]))
    assert r == [({'dispositivo_nuevo'}, False), ({'dispositivo_nuevo', 'cambio_sim'}, True)], r
    print('ok')
