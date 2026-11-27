#!/usr/bin/env python3
"""Genera docs/escudo-yuma-estructura.pdf (A4 horizontal) a partir de docs/arquitectura.html y docs/presentacion.html.

    python3 herramientas/generar_pdf.py          # requiere Chrome, Chromium o Brave e internet (fuentes y Mermaid)

NAVEGADOR=/ruta/al/navegador elige otro navegador basado en Chromium.
"""
import os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / 'docs' / 'escudo-yuma-estructura.pdf'
CIFRAS = [('86,5 %', 'fraude detectado antes de autorizar<br>(línea base 62,6 %, después)'),
          ('22,5 %', 'falsos positivos<br>(motor actual 89 %)'),
          ('3,5 ms', 'latencia p99<br>(límite 300 ms)'),
          ('1.750', 'transacciones por segundo<br>(pico exigido 150)')]
ESTRUCTURA = [
    ('cmd/intermediario/', 'Go', 'Arranca aegix: lee variables, abre la auditoría y las reglas, publica las rutas.'),
    ('cmd/simulador/', 'Go', 'Envía las 120.972 transacciones del reto y escenarios de ataque; mide TPS y latencia.'),
    ('internal/api/', 'Go', 'Rutas HTTP, orquestación de la decisión en 250 ms, métricas y Prometheus.'),
    ('internal/defensas/', 'Go', 'Validación estricta del JSON y límite de tasa por cliente, IP y dispositivo.'),
    ('internal/contexto/', 'Go', 'Origen de la IP, historial por cliente y clientes que le han pagado a cada comercio.'),
    ('internal/reglas/', 'Go', 'Motor de reglas: suma de pesos, razones ordenadas, recarga en caliente del YAML.'),
    ('internal/decisor/', 'Go', 'Umbrales: aprobar, desafiar o retener (solo con una señal ajena al origen).'),
    ('internal/registro/', 'Go', 'Auditoría JSONL de solo agregar con referencias HMAC; resoluciones del analista.'),
    ('internal/avisos/', 'Go', 'Avisos al celular (ntfy) de cada decisión de la billetera y cada resolución.'),
    ('config/reglas.yaml', 'YAML', 'Pesos, umbrales, tipos de bajo riesgo y comercio desconocido (etapa-5.4).'),
    ('yuma-billetera/', 'HTML, JS', 'Billetera con dos pasos y accesibilidad; funciones de Vercel api/autorizar.js y api/codigo.js.'),
    ('panel-etapa5/', 'React, Node', 'Consola del operador (casos, actividad, métricas, accesibilidad) y proxy.mjs con contraseña.'),
    ('herramientas/', 'Bash, Python', 'iniciar.sh, calibrar_reglas.py, comparar_modelo.py, etiquetas_analista.py y este generador.'),
    ('pruebas-e2e/', 'Playwright', 'Recorre la billetera y la consola en un navegador real dentro del CI.'),
    ('docs/', 'HTML, Markdown', 'Arquitectura, guía de presentación, reporte, explicabilidad y despliegue.'),
    ('Dockerfile, docker-compose.yml', 'Docker', 'aegix, consola y billetera con un solo comando.'),
    ('.github/workflows/ci.yml', 'GitHub Actions', 'Pruebas de Go, Node, TypeScript y navegador, y arranque con Docker.'),
]
INDICE = ['Estructura del repositorio', 'Cómo funciona una operación', 'Dónde corre cada pieza', 'Dentro de aegix: nueve etapas',
          'Un envío retenido, de punta a punta', 'Cómo se calcula el puntaje', 'El ciclo del analista', 'Datos y seguridad',
          'Rutas y resultados', 'Estado frente a la arquitectura del reto']

IMPRESION = """
@page { size: A4 landscape; margin: 11mm 13mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-size: 12.5px; }
.envoltura { max-width: none; padding: 0; }
.pagina { break-after: page; display: flex; flex-direction: column; gap: 8px; min-height: 186mm; position: relative; }
.pagina:last-child { break-after: auto; }
.pagina h2 { margin-top: 0; font-size: 26px; }
.pagina .lectura { max-width: none; }
.pagina .lectura p { max-width: 120ch; }
figure { margin: 6px 0 0; break-inside: avoid; }
.lienzo { overflow: visible; padding: 6px; border-radius: 10px; }
.lienzo svg { min-width: 0 !important; max-height: 132mm; }
figcaption { font-size: 11px; max-width: none; }
.tabla { overflow: visible; margin-top: 8px; }
table { min-width: 0; font-size: 10.5px; }
td, th { padding: 5px 10px 5px 0; }
.puntajes { padding: 12px; margin-top: 8px; }
.caso { margin-top: 8px; }
.barra { height: 26px; }
.medidas { gap: 10px; }
.medida b { font-size: 1.6rem; }
.pie { position: absolute; bottom: 0; right: 0; font-size: 10px; color: var(--suave); }
.portada { justify-content: center; gap: 14px; }
.portada h1 { font-size: 64px; }
.portada .entrada { font-size: 17px; max-width: 80ch; }
.indice-pdf { columns: 2; font-size: 14px; margin: 10px 0 0; padding-left: 20px; max-width: 160mm; }
.cifras-pdf { display: flex; gap: 28px; margin-top: 8px; }
.cifras-pdf b { display: block; font-family: var(--display); font-stretch: 70%; font-size: 34px; line-height: 1; }
.cifras-pdf span { color: var(--suave); font-size: 12px; }
.mermaid { margin: 0; display: flex; justify-content: center; }
.mermaid svg { max-height: 150mm; max-width: 100%; height: auto; }
.dos-flujos { display: grid; grid-template-columns: 1fr 1.25fr; gap: 14px; flex: 1; }
.dos-flujos > div { background: var(--hoja); border: 1px solid var(--regla); border-radius: 10px; padding: 8px; }
.dos-flujos h3 { font-size: 15px; margin-bottom: 4px; }
.pagina.puntaje { display: grid; grid-template-columns: 1.25fr 1fr; grid-template-rows: auto auto 1fr; column-gap: 18px; align-content: start; }
.pagina.puntaje > .lectura { grid-column: 1 / -1; }
.pagina.puntaje > .puntajes { grid-column: 1; grid-row: 2 / 4; margin-top: 8px; align-self: start; }
.pagina.puntaje > .tabla { grid-column: 2; grid-row: 2; margin-top: 8px; }
.pagina.puntaje > .nota { grid-column: 2; grid-row: 3; font-size: 10.5px; }
.pagina.puntaje .caso { grid-template-columns: 105px 1fr; }
.pagina.puntaje .barra .seg { font-size: 9px; letter-spacing: -.02em; padding: 0 2px; }
.pagina.puntaje .caso .nombre span { font-size: 10.5px; line-height: 1.3; display: block; }
.pagina.puntaje table { font-size: 9.5px; }
"""


def armar_html():
    arq = (RAIZ / 'docs' / 'arquitectura.html').read_text(encoding='utf-8')
    pres = (RAIZ / 'docs' / 'presentacion.html').read_text(encoding='utf-8')
    estilo = re.search(r'<style>(.*?)</style>', arq, re.S).group(1)
    cuerpo = arq.split('<!-- 1. Mapa del despliegue -->', 1)[1].rsplit('</div>', 1)[0]
    secciones = [s for s in re.split(r'\n\s*<!-- \d+\. [^>]*-->\n', '\n' + cuerpo.strip()) if s.strip()]
    assert len(secciones) == 9, f'se esperaban 9 secciones en arquitectura.html, hay {len(secciones)}'
    paginas = [('', secciones[0]), ('', secciones[1]), ('', secciones[2]), (' puntaje', secciones[3]), ('', secciones[4]),
               ('', secciones[5]), ('', secciones[6] + secciones[7]), ('', secciones[8])]
    # El flujo se parte en dos columnas para que quepa grande: entrar y decidir | qué pasa después.
    lineas = re.findall(r'<pre class="mermaid"[^>]*>\n(.*?)</pre>', pres, re.S)[0].strip().split('\n')
    corte = next(i for i, l in enumerate(lineas) if l.strip().startswith('AP --> TR'))
    es_estilo = lambda l: l.strip().startswith(('classDef', 'class '))
    estilos = [l for l in lineas if es_estilo(l)]
    flujo1 = '\n'.join([l for l in lineas[:corte] if not es_estilo(l)] + estilos)
    flujo2 = '\n'.join(['flowchart TD', '  AP["Aprobar"]', '  DE["Desafiar"]', '  RE["Retener"]']
                       + [l for l in lineas[corte:] if not es_estilo(l)] + estilos)
    marca = re.search(r'<div class="marca">.*?</div>', arq, re.S).group(0)
    total = 3 + len(paginas)
    pie = lambda n: f'<span class="pie">Escudo Yuma · aegix — página {n} de {total}</span>'
    filas = ''.join(f'<tr><td><code>{c}</code></td><td>{l}</td><td>{d}</td></tr>' for c, l, d in ESTRUCTURA)
    cifras = ''.join(f'<div><b>{v}</b><span>{t}</span></div>' for v, t in CIFRAS)
    return f"""<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8">
<title>Escudo Yuma · estructura del proyecto</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap">
<style>{estilo}{IMPRESION}</style></head><body><div class="envoltura">
<section class="pagina portada">{marca}
  <h1>Escudo Yuma: estructura del proyecto</h1>
  <p class="entrada">aegix es un intermediario antifraude para Yuma Pay, una billetera digital ficticia de la hackatón. Antes de que salga un peso decide si la operación se aprueba, pide un código, se retiene para un analista o se rechaza, y explica por qué.</p>
  <div class="cifras-pdf">{cifras}</div>
  <ol class="indice-pdf">{''.join(f'<li>{t}</li>' for t in INDICE)}</ol>
  {pie(1)}
</section>
<section class="pagina"><h2>Estructura del repositorio</h2>
  <p class="nota">Una sola lógica de negocio: aegix (Go). La billetera y la consola solo consumen su API.</p>
  <div class="tabla"><table><thead><tr><th>Carpeta o archivo</th><th>Lenguaje</th><th>Qué hace</th></tr></thead><tbody>{filas}</tbody></table></div>
  {pie(2)}
</section>
<section class="pagina"><h2>Cómo funciona una operación</h2>
  <p class="nota">Desde que el cliente entra con su clave y su código hasta que la plata sale, se confirma, espera a un analista o se bloquea.</p>
  <div class="dos-flujos"><div><h3>Entrar y decidir</h3><pre class="mermaid">{flujo1}</pre></div>
    <div><h3>Qué pasa con cada decisión</h3><pre class="mermaid">{flujo2}</pre></div></div>
  {pie(3)}
</section>
{''.join(f'<section class="pagina{c}">{p}{pie(i + 4)}</section>' for i, (c, p) in enumerate(paginas))}
</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>mermaid.initialize({{ startOnLoad: false, theme: 'neutral', flowchart: {{ useMaxWidth: true }} }}); mermaid.run({{ querySelector: 'pre.mermaid' }});</script>
</body></html>"""


def navegador():
    if os.environ.get('NAVEGADOR'):
        return os.environ['NAVEGADOR']
    for nombre in ('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'brave', 'brave-browser'):
        if shutil.which(nombre):
            return shutil.which(nombre)
    sys.exit('No encontré Chrome, Chromium ni Brave; define NAVEGADOR=/ruta/al/navegador.')


def main():
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / 'estructura.html'
        html.write_text(armar_html(), encoding='utf-8')
        subprocess.run([navegador(), '--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
                        '--run-all-compositor-stages-before-draw', '--virtual-time-budget=15000',
                        f'--print-to-pdf={SALIDA}', html.as_uri()], check=True, capture_output=True, timeout=120)
    print(f'PDF generado: {SALIDA.relative_to(RAIZ)}')


if __name__ == '__main__':
    main()
