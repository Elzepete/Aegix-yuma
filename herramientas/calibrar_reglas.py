#!/usr/bin/env python3
"""Calibra config/reglas.yaml con los datos etiquetados del reto (solo biblioteca estándar).

Replica las variables que aegix calcula en el escenario "normal" del simulador (historial por cliente,
hora atípica, percentil de montos, operaciones en 10 minutos), agrupa las transacciones por patrón de
señales y ajusta pesos y umbrales por descenso coordenado en mayo–agosto. Septiembre–octubre se reserva
para validar. Falsos positivos aquí = legítimas retenidas / retenidas (más estricto que el sandbox,
que divide entre todo lo detectado, incluidos los desafíos).

    python3 herramientas/calibrar_reglas.py ruta/03_Datos/transacciones.csv [fricción_máx=0.03]
        [--auditoria=datos/decisiones.jsonl] [--peso-analista=10]

Con --auditoria, las retenciones que el analista resolvió en la consola (liberar = legítima, confirmar fraude =
fraude) se suman al entrenamiento; cada una vale --peso-analista transacciones del CSV.
"""
import csv, sys, os, itertools, collections
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from etiquetas_analista import etiquetas

opciones = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
ANALISTA = etiquetas(opciones['auditoria'], os.path.join(os.path.dirname(__file__), '..', 'config', 'reglas.yaml')) if 'auditoria' in opciones else []
PESO_ANALISTA = int(opciones.get('peso-analista', 10))
if 'auditoria' in opciones:
    fuera = sum(bool(s & {'tor', 'proxy', 'pais_nuevo'}) for s, _ in ANALISTA)
    print(f"etiquetas del analista: {len(ANALISTA)} ({sum(f for _, f in ANALISTA)} fraude, "
          f"{sum(not f for _, f in ANALISTA)} legítimas), cada una × {PESO_ANALISTA}; "
          f"{fuera} traen tor/proxy/país, que no se calibran (criterio experto)")

filas = list(csv.DictReader(open(args[0], encoding='utf-8-sig')))
hist = collections.defaultdict(list)   # cliente -> [(fecha, monto)] en orden
crudos = []
for f in filas:  # el CSV ya viene en orden cronológico (como el cursor del sandbox)
    fecha = datetime.strptime(f['fecha_hora'], '%Y-%m-%d %H:%M:%S')
    monto, saldo = int(f['monto_cop']), int(f['saldo_antes_cop'])
    previas = [p for p in hist[f['id_cliente']] if p[0] < fecha]
    horas = collections.Counter(p[0].hour for p in previas)
    h = fecha.hour
    atip = len(previas) >= 10 and (horas[(h-1)%24]+horas[h]+horas[(h+1)%24])*10 < len(previas)
    montos = sorted(p[1] for p in previas if p[0] >= fecha - timedelta(days=30))
    msp = monto / montos[(95*len(montos)+99)//100-1] if len(montos) >= 10 else 0
    sal = sum(p[0] >= fecha - timedelta(minutes=10) for p in previas)
    crudos.append(dict(
        tr=f['fecha_hora'] < '2026-09-01', fraude=f['es_fraude']=='1', monto=monto,
        dispositivo_nuevo=f['dispositivo_nuevo']=='1', cambio_sim=f['cambio_sim_48h']=='1',
        cambio_clave=f['cambio_clave_24h']=='1', destino_nuevo=f['destino_nuevo']=='1',
        departamento_distinto=f['ip_departamento_distinto']=='1', hora_atipica=atip,
        antig=int(f['antiguedad_cuenta_dias']), mss=monto/saldo if saldo>0 else 0, msp=msp, sal=sal))
    hist[f['id_cliente']].append((fecha, monto))

BOOL = ['dispositivo_nuevo','cambio_sim','cambio_clave','destino_nuevo','departamento_distinto','hora_atipica']
ORIGEN = {'hora_atipica','departamento_distinto'}   # no bastan solas para retener

def patrones(dias, u_mss, u_msp, u_sal, cuales):
    agg = collections.defaultdict(lambda: [0,0,0,0])  # legit, fraude, monto fraude, n
    for c in crudos:
        if c['tr'] != cuales: continue
        clave = tuple(c[b] for b in BOOL) + (c['antig'] < dias, c['mss'] >= u_mss, c['msp'] >= u_msp, c['sal'] >= u_sal)
        a = agg[clave]; a[0] += not c['fraude']; a[1] += c['fraude']; a[2] += c['monto']*c['fraude']
    if cuales:  # solo entrenamiento: la validación sigue siendo el CSV intacto
        for senales, fraude in ANALISTA:
            clave = tuple(n in senales for n in NOMBRES)
            a = agg[clave]; a[0] += PESO_ANALISTA * (not fraude); a[1] += PESO_ANALISTA * fraude
    return list(agg.items())

NOMBRES = BOOL + ['cuenta_nueva','monto_sobre_saldo','monto_sobre_percentil','salidas_recientes']
def evaluar(pats, w, ud, ur):
    vp=fn=fp=vn=des_leg=ret_fr=0; mf=mp=0
    for clave, (leg, fr, monto, _) in pats:
        s = min(1, sum(wi for wi, x in zip(w, clave) if x)); otra = any(x for n, x in zip(NOMBRES, clave) if x and n not in ORIGEN)
        acc = 'retener' if s >= ur and otra else 'desafiar' if s >= ud else 'aprobar'
        mf += monto
        if acc == 'aprobar': fn += fr; vn += leg
        else:
            vp += fr; mp += monto
            if acc == 'retener': fp += leg; ret_fr += fr
            else: des_leg += leg; vn += leg
    tot_leg = fp + vn
    return dict(det=vp/max(1,vp+fn), fp=fp/(ret_fr+fp) if ret_fr+fp else 0, friccion=(fp+des_leg)/max(1,tot_leg),
                monto=mp/max(1,mf), retfr=ret_fr/max(1,vp+fn), ret=ret_fr+fp, retleg=fp/max(1,tot_leg))

GRID = [0, .05, .1, .15, .2, .25, .3, .35, .4, .5]
def objetivo(m, friccion_max):
    if m['friccion'] > friccion_max or m['fp'] > .5: return -1   # infactible
    return m['det'] + .1*m['retfr'] + .05*m['monto']

def calibrar(pats, friccion_max):
    w = [.15, .25, .15, .10, .05, .10, .10, .20, .20, .20]; ud, ur = .35, .70
    mejor = objetivo(evaluar(pats, w, ud, ur), friccion_max)
    for _ in range(6):
        for i in range(len(w) + 2):
            opciones = GRID if i < len(w) else ([.2,.25,.3,.35,.4,.45,.5] if i == len(w) else [.5,.55,.6,.65,.7,.75,.8,.9])
            for v in opciones:
                w2, ud2, ur2 = list(w), ud, ur
                if i < len(w): w2[i] = v
                elif i == len(w): ud2 = v
                else: ur2 = v
                if ur2 <= ud2: continue
                o = objetivo(evaluar(pats, w2, ud2, ur2), friccion_max)
                if o > mejor + 1e-9: mejor, w, ud, ur = o, w2, ud2, ur2
    return mejor, w, ud, ur

fmt = lambda m: ' '.join(f"{k}={v:.3f}" if isinstance(v,float) else f"{k}={v}" for k,v in m.items())
previas = ([.15, .25, .15, .10, 1e-9, .10, 0, .20, .20, .20], .35, .70)  # reglas etapa-5.1, sin las señales nuevas
print('etapa-5.1 validación:', fmt(evaluar(patrones(1, .85, 1.25, 3, False), *previas)))
for friccion in [float(args[1]) if len(args) > 1 else .03]:
    res = []
    for dias, umss, umsp, usal in itertools.product([30, 60, 90], [.6, .75, .85], [1.25, 2, 3], [2, 3, 5]):
        o, w, ud, ur = calibrar(patrones(dias, umss, umsp, usal, True), friccion)
        res.append((o, dias, umss, umsp, usal, w, ud, ur))
    o, dias, umss, umsp, usal, w, ud, ur = max(res, key=lambda r: r[0])
    print(f"\n== fricción máx {friccion:.0%} · cuenta_nueva<{dias}d mss>={umss} msp>={umsp} salidas>={usal} desafiar={ud} retener={ur}")
    print('   pesos', dict(zip(NOMBRES, w)))
    print('   entrenamiento:', fmt(evaluar(patrones(dias, umss, umsp, usal, True), w, ud, ur)))
    print('   validación   :', fmt(evaluar(patrones(dias, umss, umsp, usal, False), w, ud, ur)))
