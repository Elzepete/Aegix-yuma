import { useEffect, useMemo, useRef, useState } from 'react';
import type { Alerta, Indicadores } from './tipos';
import { Cola, Cumplimiento, Latencia, Mezcla, Pulso, Revision, Senales, type Metricas } from './components/Consola';
import { PruebaTransacciones } from './components/PruebaTransacciones';
import { alCambiarVoces, estadoVoz, hablar } from './voz';

async function leer<T>(ruta: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(ruta, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`Error HTTP ${res.status}`);
  return res.json();
}

// Una consulta en curso no se cancela por el siguiente ciclo: si cada consulta tardara más de 2 s,
// cancelarla dejaría el panel congelado sin error. Solo se descarta al desmontar.
function useDatosGo<T>(ruta: string, revision: number) {
  const [estado, setEstado] = useState<{ datos?: T; error?: string; en?: number }>({});
  const enCurso = useRef(false);
  const montado = useRef(true);
  useEffect(() => () => { montado.current = false; }, []);
  useEffect(() => {
    if (enCurso.current) return;
    enCurso.current = true;
    leer<T>(ruta, AbortSignal.timeout(8000)).then(
      (datos) => { if (montado.current) setEstado({ datos, en: Date.now() }); },
      (error: Error) => { if (montado.current) setEstado((e) => ({ ...e, error: error.message })); },
    ).finally(() => { enCurso.current = false; });
  }, [ruta, revision]);
  return estado;
}

function leerPreferencia<T extends string>(clave: string, opciones: readonly T[], porDefecto: T): T {
  try {
    const v = localStorage.getItem(clave) as T | null;
    return v && opciones.includes(v) ? v : porDefecto;
  } catch { return porDefecto; }
}

const ESTADO = {
  OPTIMO: ['Óptimo', 'var(--ok)'], DEGRADADO: ['Degradado', 'var(--alerta)'], CRITICO: ['Crítico', 'var(--retener)'],
} as const;
const ORIGENES = { todas: 'Todas', billetera: 'Billetera', sandbox: 'Sandbox' } as const;
const ORDEN = { riesgo: 'Mayor riesgo', recientes: 'Más recientes' } as const;
const VISTA = { casos: 'Casos', actividad: 'Toda la actividad' } as const;

// Ajustes de accesibilidad de quien opera la consola; se guardan en este navegador.
const AJUSTES = {
  texto: ['Texto más grande', 'Agranda toda la consola.'],
  contraste: ['Alto contraste', 'Textos secundarios y bordes más marcados.'],
  movimiento: ['Sin animaciones', 'Quita el destello de los casos nuevos y las transiciones.'],
  voz: ['Leer casos nuevos en voz alta', 'Anuncia por voz cada caso nuevo por resolver.'],
} as const;
type Ajustes = Record<keyof typeof AJUSTES, boolean>;
function leerAjustes(): Ajustes {
  const base = { texto: false, contraste: false, movimiento: false, voz: false };
  try { return { ...base, ...JSON.parse(localStorage.getItem('aegix.accesibilidad') ?? '{}') }; } catch { return base; }
}

function Accesibilidad({ ajustes, cambiar }: { ajustes: Ajustes; cambiar: (a: Ajustes) => void }) {
  const [voz, setVoz] = useState(estadoVoz());
  const [problema, setProblema] = useState('');
  useEffect(() => alCambiarVoces(() => setVoz(estadoVoz())), []);
  return (
    <section id="panel-accesibilidad" className="panel-accesibilidad" aria-label="Accesibilidad de la consola">
      {Object.entries(AJUSTES).map(([clave, [titulo, texto]]) => (
        <label key={clave} className="ajuste">
          <input type="checkbox" role="switch" checked={ajustes[clave as keyof Ajustes]}
                 onChange={(e) => cambiar({ ...ajustes, [clave]: e.target.checked })} />
          <span><b>{titulo}</b><small>{texto}</small></span>
        </label>
      ))}
      <p className="estado-voz">{problema || voz}</p>
      <button type="button" className="boton" onClick={() => setProblema(hablar('Consola aegix. Así se anunciarán los casos nuevos.'))}>Probar la voz</button>
    </section>
  );
}

export default function App() {
  const [revision, setRevision] = useState(0);
  const [enVivo, setEnVivo] = useState(true);
  const [origen, setOrigen] = useState<keyof typeof ORIGENES>('todas');
  const [orden, setOrden] = useState<keyof typeof ORDEN>('recientes');
  // Por defecto, toda la actividad: un envío aprobado de la billetera no aparece en «Casos».
  const [ajustes, setAjustes] = useState<Ajustes>(leerAjustes);
  const [abrirAjustes, setAbrirAjustes] = useState(false);
  const [soloAccesible, setSoloAccesible] = useState(false);
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.toggleAttribute('data-texto-grande', ajustes.texto);
    raiz.toggleAttribute('data-contraste', ajustes.contraste);
    raiz.toggleAttribute('data-sin-movimiento', ajustes.movimiento);
    try { localStorage.setItem('aegix.accesibilidad', JSON.stringify(ajustes)); } catch { /* sin almacenamiento */ }
  }, [ajustes]);
  const [vista, setVistaEstado] = useState<keyof typeof VISTA>(() => leerPreferencia('aegix.vista', ['casos', 'actividad'] as const, 'actividad'));
  const setVista = (v: keyof typeof VISTA) => { setVistaEstado(v); try { localStorage.setItem('aegix.vista', v); } catch { /* sin almacenamiento */ } };
  const { datos: indicadores } = useDatosGo<Indicadores>('/api/indicadores', revision);
  const { datos: alertas, error } = useDatosGo<Alerta[]>('/api/alertas', revision);
  const { datos: metricas, error: errorMetricas, en: actualizado } = useDatosGo<Metricas>('/api/metricas', revision);
  const { datos: actividad } = useDatosGo<Alerta[]>('/api/decisiones', revision);

  // Consulta a aegix cada 2 s: las operaciones de la billetera aparecen sin recargar.
  useEffect(() => {
    if (!enVivo) return;
    const id = setInterval(() => setRevision((v) => v + 1), 2000);
    // Al volver a la pestaña se consulta de inmediato: el navegador frena los temporizadores de pestañas ocultas.
    const alVolver = () => { if (document.visibilityState === 'visible') setRevision((v) => v + 1); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('focus', alVolver); };
  }, [enVivo]);
  const segundosDesde = actualizado ? Math.max(0, Math.round((Date.now() - actualizado) / 1000)) : null;
  const atrasado = enVivo && segundosDesde !== null && segundosDesde > 8;

  // Últimas 60 muestras (2 min) para las líneas del pulso; solo viven mientras el panel está abierto.
  const [historial, setHistorial] = useState<Metricas[]>([]);
  useEffect(() => { if (metricas) setHistorial((h) => [...h.slice(-59), metricas]); }, [metricas]);

  // Resalta los casos que no estaban en la consulta anterior.
  const vistas = useRef<Set<string> | null>(null);
  const nuevas = useMemo(() => {
    const claves = new Set((alertas ?? []).map((a) => `${a.referencia}-${a.registrado_en}`));
    const previas = vistas.current;
    vistas.current = claves;
    return previas ? new Set([...claves].filter((c) => !previas.has(c))) : new Set<string>();
  }, [alertas]);

  const fuente = vista === 'actividad' ? actividad : alertas;
  const visibles = useMemo(() => {
    const lista = (fuente ?? []).filter((a) => (origen === 'todas' || (a.origen ?? 'sandbox') === origen) && (!soloAccesible || !!a.entrada?.accesibilidad));
    return orden === 'recientes'
      ? [...lista].sort((a, b) => b.registrado_en.localeCompare(a.registrado_en))
      : lista; // aegix ya las entrega ordenadas por puntaje
  }, [fuente, origen, orden, soloAccesible]);

  const pendientes = (alertas ?? []).filter((a) => a.decision === 'retener' && !a.resolucion).length;
  // Quién ingresó y qué puede hacer; sin acceso SOC configurado, la consola es abierta y puede todo.
  const { datos: sesion } = useDatosGo<{ usuario: string | null; rol: string | null; permisos: string[] }>('/api/sesion', 0);
  const puede = (permiso: string) => !sesion || sesion.permisos.includes(permiso);
  const sinConexion = !!(error && errorMetricas);

  // El lector de pantalla oye solo lo que importa: casos nuevos por resolver y la pérdida de conexión, no el reloj.
  const [anuncio, setAnuncio] = useState('');
  const previos = useRef<number | null>(null);
  useEffect(() => {
    if (!alertas) return;
    const nuevos = previos.current === null ? 0 : pendientes - previos.current;
    previos.current = pendientes;
    if (nuevos > 0 && ajustes.voz) hablar(`${nuevos === 1 ? 'Un caso nuevo' : `${nuevos} casos nuevos`} por resolver.`);
    if (nuevos > 0) setAnuncio(`${nuevos === 1 ? 'Un caso nuevo' : `${nuevos} casos nuevos`} por resolver. Total pendientes: ${pendientes}.`);
  }, [alertas, pendientes]);
  useEffect(() => { if (sinConexion) setAnuncio('Se perdió la conexión con aegix.'); }, [sinConexion]);
  const [estadoTexto, estadoColor] = sinConexion ? ['Sin conexión con aegix', 'var(--retener)'] : metricas ? ESTADO[metricas.estado] : ['Conectando', 'var(--suave)'];

  return (
    <>
      <header className="cabecera">
        <div className="marca">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="57 82" transform="rotate(135 16 16)" />
            <circle cx="16" cy="16" r="4" fill="currentColor" />
          </svg>
          <b>aegix</b><span>Decisiones de Yuma Pay</span>
        </div>
        <div className="cabecera-der">
          {sesion?.usuario && (
            <span className="sesion"><span className="etiqueta">{sesion.usuario} · {sesion.rol}</span><a href="/salir">Salir</a></span>
          )}
          <span className="etiqueta estado-sistema" style={{ ['--c' as string]: estadoColor }}>{estadoTexto}</span>
          {alertas?.[0] && <span className="etiqueta mono">{alertas[0].version_reglas}</span>}
          <span className={`actualizado${atrasado || errorMetricas ? ' atrasado' : ''}`}>
            {errorMetricas && atrasado ? `Sin respuesta de aegix: ${errorMetricas}`
              : segundosDesde === null ? 'Conectando…'
              : segundosDesde < 3 ? 'Actualizado ahora' : `Actualizado hace ${segundosDesde} s`}
          </span>
          <button type="button" className="boton-vivo" aria-expanded={abrirAjustes} aria-controls="panel-accesibilidad"
                  onClick={() => setAbrirAjustes((v) => !v)}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="4.5" r="2" /><path d="M5 8.5l7 1.5 7-1.5M12 10v4.5m0 0L9 21m3-6.5l3 6.5" /></svg>
            Accesibilidad
          </button>
          <button type="button" className="boton-vivo" aria-pressed={enVivo} onClick={() => setEnVivo((v) => !v)}>
            <i aria-hidden="true" />{enVivo ? 'En vivo' : 'Pausado'}
          </button>
        </div>
      </header>
      {abrirAjustes && <Accesibilidad ajustes={ajustes} cambiar={setAjustes} />}

      <p className="sr-only" aria-live="polite">{anuncio}</p>
      <main className="contenido">
        <Pulso m={metricas} ind={indicadores} historial={historial} />
        {sinConexion && <p className="aviso" role="alert">No se pudo leer aegix ({error}). Revisa que el intermediario esté corriendo en 127.0.0.1:8081.</p>}

        <div className="cuerpo">
          <section className="panel" aria-labelledby="t-cola">
            <div className="panel-cabeza">
              <div className="segmentado" role="group" aria-label="Qué mostrar">
                {Object.entries(VISTA).map(([k, t]) => (
                  <button key={k} type="button" aria-pressed={vista === k} onClick={() => setVista(k as keyof typeof VISTA)}>{t}</button>
                ))}
              </div>
              <h2 id="t-cola" className="sr-only">{vista === 'casos' ? 'Cola del analista' : 'Toda la actividad'}</h2>
              <span className="conteo"><span className="mono">{visibles.length}</span> {vista === 'casos' ? 'casos' : 'decisiones recientes'}, <span className="mono">{pendientes}</span> por resolver</span>
              <div className="controles">
                <div className="segmentado" role="group" aria-label="Origen">
                  {Object.entries(ORIGENES).map(([k, t]) => (
                    <button key={k} type="button" aria-pressed={origen === k} onClick={() => setOrigen(k as keyof typeof ORIGENES)}>{t}</button>
                  ))}
                </div>
                <button type="button" className="filtro-accesible" aria-pressed={soloAccesible} onClick={() => setSoloAccesible((v) => !v)}>
                  Contacto accesible
                </button>
                <div className="segmentado" role="group" aria-label="Orden">
                  {Object.entries(ORDEN).map(([k, t]) => (
                    <button key={k} type="button" aria-pressed={orden === k} onClick={() => setOrden(k as keyof typeof ORDEN)}>{t}</button>
                  ))}
                </div>
              </div>
            </div>
            {fuente ? <Cola alertas={visibles} ahora={Date.now()} nuevas={nuevas} alResolver={() => setRevision((v) => v + 1)} puedeResolver={puede('resolver')} /> : <p className="vacio" role="status">Cargando casos…</p>}
          </section>

          <aside className="costado" aria-label="Contexto">
            {puede('auditar') && <Cumplimiento />}
            <Revision ind={indicadores} pendientes={pendientes} accesibles={(alertas ?? []).filter((a) => a.decision === 'retener' && !a.resolucion && a.entrada?.accesibilidad).length} />
            <Mezcla porOrigen={metricas?.decisiones_por_origen} />
            <Senales modalidades={metricas?.modalidades_detectadas} />
            <Latencia cubetas={metricas?.histograma_latencia_ms} sla={metricas?.sla_maximo_ms ?? 300} />
          </aside>
        </div>

        {puede('probar') && <PruebaTransacciones alTerminar={() => setRevision((v) => v + 1)} />}
      </main>
    </>
  );
}
