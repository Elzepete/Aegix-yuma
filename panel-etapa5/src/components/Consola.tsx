import { useEffect, useRef, useState } from 'react';
import { comoContactar, type Alerta, type Indicadores } from '../tipos';

export interface Metricas {
  estado: 'OPTIMO' | 'DEGRADADO' | 'CRITICO';
  total_evaluadas: number;
  tps_actual: number;
  tps_pico: number;
  latencia_p50_ms: number;
  latencia_p99_ms: number;
  sla_maximo_ms: number;
  cumplimiento_sla_pct: number;
  monto_protegido_cop: number;
  monto_total_cop: number;
  modalidades_detectadas?: Record<string, number>;
  decisiones_por_origen?: Record<string, Record<string, number>>;
  histograma_latencia_ms?: { hasta_ms: number; total: number }[];
}

export const COLOR: Record<string, string> = {
  aprobar: 'var(--ok)', desafiar: 'var(--alerta)', retener: 'var(--retener)', rechazar: 'var(--rechazo)',
};
const NOMBRE: Record<string, string> = { aprobar: 'Aprobadas', desafiar: 'Desafiadas', retener: 'Retenidas', rechazar: 'Rechazadas' };
const SINGULAR: Record<string, string> = { aprobar: 'Aprobada', desafiar: 'Desafiada', retener: 'Retenida', rechazar: 'Rechazada' };
const RESUELTA = { liberar: ['Liberada por analista', 'var(--ok)'], confirmar_fraude: ['Fraude confirmado', 'var(--rechazo)'] } as const;
const ACCION = {
  liberar: ['Liberar operación', 'La plata sale hacia el destino y el caso se marca como falso positivo.', 'Sí, liberar'],
  confirmar_fraude: ['Confirmar fraude', 'La operación queda bloqueada y el caso se marca como fraude.', 'Sí, confirmar fraude'],
} as const;
type Accion = keyof typeof ACCION;

const entero = new Intl.NumberFormat('es-CO');
const decimal = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const pesosCortos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', notation: 'compact', maximumFractionDigits: 1 });
const reloj = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Bogota' });
const fechaLarga = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/Bogota' });

function hace(iso: string, ahora: number) {
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `hace ${Math.floor(s / 3600)} h`;
}

const ICONO_YUMA = <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 12l18 22 18-22M32 34v20" stroke="currentColor" strokeWidth="10" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const ICONO_SANDBOX = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5l9-4.5 9 4.5v9l-9 4.5-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" /></svg>;

export function Origen({ origen }: { origen?: string }) {
  return origen === 'billetera'
    ? <span className="origen yuma">{ICONO_YUMA}Billetera Yuma</span>
    : <span className="origen">{ICONO_SANDBOX}Sandbox del reto</span>;
}

/** Serie de las últimas muestras (una cada 2 s) que el panel acumula mientras está abierto. */
function LineaPulso({ serie, ok }: { serie: number[]; ok?: boolean }) {
  if (serie.length < 2) return <svg className="linea-pulso" viewBox="0 0 84 28" aria-hidden="true" />;
  const max = Math.max(...serie), min = Math.min(...serie), rango = max - min || 1;
  const puntos = serie.map((v, i) => `${(i / (serie.length - 1)) * 82 + 1},${26 - ((v - min) / rango) * 22}`).join(' ');
  const ultimo = puntos.split(' ').at(-1)!.split(',');
  return (
    <svg className={`linea-pulso${ok ? ' ok' : ''}`} viewBox="0 0 84 28" aria-hidden="true">
      <polyline points={puntos} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={ultimo[0]} cy={ultimo[1]} r="2" fill="currentColor" />
    </svg>
  );
}

export function Pulso({ m, ind, historial }: { m?: Metricas; ind?: Indicadores; historial: Metricas[] }) {
  const sla = m?.sla_maximo_ms ?? 300;
  const deltas = (f: (x: Metricas) => number) => historial.slice(1).map((x, i) => Math.max(0, f(x) - f(historial[i])));
  return (
    <dl className="pulso">
      <div className="cifra">
        <dt>Decisiones</dt>
        <dd className="valor">{entero.format(m?.total_evaluadas ?? 0)}</dd>
        <LineaPulso serie={deltas((x) => x.total_evaluadas)} />
        <p>{entero.format(ind?.omisiones_auditoria ?? 0)} omisiones de auditoría</p>
      </div>
      <div className="cifra">
        <dt>Transacciones por segundo</dt>
        <dd className="valor">{decimal.format(m?.tps_actual ?? 0)}</dd>
        <LineaPulso serie={historial.map((x) => x.tps_actual)} />
        <p>Pico {decimal.format(m?.tps_pico ?? 0)}, capacidad medida 2.100</p>
      </div>
      <div className="cifra">
        <dt>Latencia p99</dt>
        <dd className="valor">{decimal.format(m?.latencia_p99_ms ?? 0)}<small>ms</small></dd>
        <LineaPulso serie={historial.map((x) => x.latencia_p99_ms)} ok={(m?.latencia_p99_ms ?? 0) < sla} />
        <p>{decimal.format(m?.cumplimiento_sla_pct ?? 100)} % dentro de {sla} ms</p>
      </div>
      <div className="cifra">
        <dt>Monto frenado</dt>
        <dd className="valor">{pesosCortos.format(m?.monto_protegido_cop ?? 0)}</dd>
        <LineaPulso serie={deltas((x) => x.monto_protegido_cop)} />
        <p>De {pesosCortos.format(m?.monto_total_cop ?? 0)} evaluados</p>
      </div>
    </dl>
  );
}

function Dial({ puntaje, color, fuerte }: { puntaje: number; color: string; fuerte: boolean }) {
  const r = 14, largo = 2 * Math.PI * r, valor = Math.round(puntaje * 100);
  return (
    <svg className="dial" viewBox="0 0 34 34" role="img" aria-label={`Riesgo ${valor} de 100`}>
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--superficie-2)" strokeWidth="3" />
      {valor > 0 && <circle cx="17" cy="17" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity={fuerte ? 1 : .6}
                            strokeDasharray={`${largo * Math.min(1, puntaje)} ${largo}`} transform="rotate(-90 17 17)" />}
      <text x="17" y="21" textAnchor="middle">{valor}</text>
    </svg>
  );
}

export function Cola({ alertas, ahora, nuevas, alResolver, puedeResolver = true }: { alertas: Alerta[]; ahora: number; nuevas: Set<string>; alResolver: () => void; puedeResolver?: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Accion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorAccion, setErrorAccion] = useState('');
  // El foco sigue a la acción: al pedir confirmación va a «Cancelar» (la opción segura) y al terminar vuelve a la fila.
  const cancelar = useRef<HTMLButtonElement>(null);
  const primera = useRef<HTMLButtonElement>(null);
  const pidio = useRef(false);
  useEffect(() => {
    if (confirmando) { pidio.current = true; cancelar.current?.focus(); }
    else if (pidio.current) { pidio.current = false; primera.current?.focus(); }
  }, [confirmando]);

  async function resolver(ref: string, accion: Accion) {
    setEnviando(true);
    setErrorAccion('');
    try {
      const res = await fetch(`/api/alertas/${ref}/resolucion`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolucion: accion }),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error ?? `aegix respondió HTTP ${res.status}`);
      pidio.current = false;
      setConfirmando(null);
      alResolver();
      document.getElementById(`fila-${ref}`)?.focus();
    } catch (causa) {
      setErrorAccion(causa instanceof Error ? causa.message : 'No se pudo registrar la resolución.');
    } finally {
      setEnviando(false);
    }
  }
  if (!alertas.length) {
    return <p className="vacio">Nada con este filtro todavía. Cada operación que decida aegix aparece aquí en menos de 2 segundos.</p>;
  }
  return (
    <ol className="cola">
      {alertas.map((a) => {
        const clave = `${a.referencia}-${a.registrado_en}`;
        const resuelta = a.resolucion ? RESUELTA[a.resolucion] : null;
        const color = resuelta ? resuelta[1] : COLOR[a.decision];
        const razones = a.razones ?? [];
        const fuerte = (a.decision === 'retener' || a.decision === 'rechazar') && !resuelta;
        const expandido = abierto === clave;
        const resoluble = a.decision === 'retener' && !resuelta && !!a.referencia;
        return (
          <li key={clave} className={`caso${nuevas.has(clave) ? ' nuevo' : ''}`} style={{ ['--c' as string]: color }}>
            <button type="button" className="fila" aria-expanded={expandido} id={a.referencia ? `fila-${a.referencia}` : undefined}
                    onClick={() => { setAbierto(expandido ? null : clave); setConfirmando(null); setErrorAccion(''); }}>
              <Dial puntaje={a.puntaje} color={color} fuerte={fuerte} />
              <span className="col-estado">
                <span className="arriba">
                  <span className="decision">{resuelta ? resuelta[0] : SINGULAR[a.decision]}</span>
                  {!!a.entrada?.monto_cop && <span className="monto mono">{pesos.format(a.entrada.monto_cop)}</span>}
                </span>
                <Origen origen={a.origen} />
                {a.entrada?.accesibilidad && <span className="contacto-accesible">Contacto accesible</span>}
              </span>
              <span className="col-senales">
                {razones.slice(0, 3).map((r, i) => <span key={i} className={`etiqueta${i === 0 && fuerte ? ' principal' : ''}`}>{r}</span>)}
                {razones.length > 3 && <span className="mas" title={razones.slice(3).join('\n')}>+{razones.length - 3} más</span>}
              </span>
              <time className="col-hora mono" dateTime={a.registrado_en} title={`${hace(a.registrado_en, ahora)}, ${fechaLarga.format(new Date(a.registrado_en))}`}>
                {reloj.format(new Date(a.registrado_en))}
              </time>
              <span className="chevron" aria-hidden="true">›</span>
            </button>
            {expandido && (
              <div className="detalle">
                {a.entrada?.accesibilidad && (
                  <p className="preferencia-contacto"><b>Antes de contactar al cliente:</b> {comoContactar(a.entrada.accesibilidad)}.
                    No cambia la decisión de aegix.</p>
                )}
                <section>
                  <h3>Razones, de mayor a menor peso</h3>
                  <ol>{razones.map((r, i) => <li key={i}>{r}</li>)}</ol>
                </section>
                <dl>
                  {a.entrada && <><dt>Operación</dt><dd>{a.entrada.tipo_operacion.replaceAll('_', ' ')} por {a.entrada.canal}</dd></>}
                  <dt>Puntaje</dt><dd className="mono">{decimal.format(a.puntaje)}</dd>
                  <dt>Reglas</dt><dd className="mono">{a.version_reglas}</dd>
                  <dt>Latencia</dt><dd className="mono">{decimal.format(a.latencia_ms)} ms</dd>
                  <dt>Registrada</dt><dd>{fechaLarga.format(new Date(a.registrado_en))}</dd>
                  {a.origen !== 'billetera' && <><dt>Sandbox</dt><dd>{a.confirmada_por_sandbox ? 'Confirmó la decisión' : 'No confirmó la decisión'}</dd></>}
                  {a.referencia && <><dt>Referencia</dt><dd className="mono">{a.referencia}</dd></>}
                  {resuelta && a.resuelta_en && <><dt>Resuelta</dt><dd>{resuelta[0]}, {fechaLarga.format(new Date(a.resuelta_en))}</dd></>}
                  {resuelta && a.analista && <><dt>Resuelta por</dt><dd>{a.analista}</dd></>}
                </dl>
                {resoluble && !puedeResolver && <p className="nota-accion">Tu rol puede ver este caso, pero solo un analista o un administrador lo resuelve.</p>}
                {resoluble && puedeResolver && (
                  <div className="acciones-caso">
                    {!confirmando ? (
                      <>
                        <button type="button" ref={primera} className="boton boton-liberar" onClick={() => setConfirmando('liberar')}>{ACCION.liberar[0]}</button>
                        <button type="button" className="boton boton-fraude" onClick={() => setConfirmando('confirmar_fraude')}>{ACCION.confirmar_fraude[0]}</button>
                        <span className="nota-accion">El cliente verá el resultado en su billetera en unos segundos.</span>
                      </>
                    ) : (
                      <>
                        <span className="pregunta" role="alert">{ACCION[confirmando][1]} No se puede deshacer.</span>
                        <button type="button" className={`boton ${confirmando === 'liberar' ? 'boton-liberar' : 'boton-fraude'}`}
                                disabled={enviando} onClick={() => resolver(a.referencia!, confirmando)}>
                          {enviando ? 'Registrando…' : ACCION[confirmando][2]}
                        </button>
                        <button type="button" ref={cancelar} className="boton" disabled={enviando} onClick={() => setConfirmando(null)}>Cancelar</button>
                      </>
                    )}
                    {errorAccion && <span className="error-accion" role="alert">{errorAccion}</span>}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Mezcla({ porOrigen }: { porOrigen?: Record<string, Record<string, number>> }) {
  const origenes = Object.entries(porOrigen ?? {}).sort(([a]) => (a === 'billetera' ? -1 : 1));
  return (
    <section className="panel" aria-labelledby="t-mezcla">
      <h3 id="t-mezcla">Decisiones por origen</h3>
      {!origenes.length && <p>Todavía no hay decisiones.</p>}
      {origenes.map(([origen, conteo]) => {
        const total = Object.values(conteo).reduce((s, n) => s + n, 0);
        return (
          <div key={origen} className="mezcla-fila">
            <header><Origen origen={origen} /><span className="mono">{entero.format(total)}</span></header>
            <div className="apilada" role="img" aria-label={Object.keys(NOMBRE).map((k) => `${NOMBRE[k]} ${conteo[k] ?? 0}`).join(', ')}>
              {Object.keys(NOMBRE).map((k) => conteo[k]
                ? <span key={k} style={{ width: `${(conteo[k] / total) * 100}%`, ['--c' as string]: COLOR[k] }} />
                : null)}
            </div>
            <div className="leyenda">
              {Object.keys(NOMBRE).filter((k) => conteo[k]).map((k) => (
                <span key={k} style={{ ['--c' as string]: COLOR[k] }}>{NOMBRE[k]} <span className="mono">{entero.format(conteo[k])}</span></span>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function Revision({ ind, pendientes, accesibles }: { ind?: Indicadores; pendientes: number; accesibles: number }) {
  return (
    <section className="panel" aria-labelledby="t-revision">
      <h3 id="t-revision">Revisión de analistas</h3>
      <dl className="revision">
        <div><dt>Por resolver</dt><dd className="mono">{entero.format(pendientes)}</dd></div>
        <div><dt>Con contacto accesible</dt><dd className="mono" style={{ color: 'var(--yuma)' }}>{entero.format(accesibles)}</dd></div>
        <div><dt>Liberadas</dt><dd className="mono" style={{ color: 'var(--ok)' }}>{entero.format(ind?.liberadas_por_analista ?? 0)}</dd></div>
        <div><dt>Fraudes confirmados</dt><dd className="mono" style={{ color: 'var(--rechazo)' }}>{entero.format(ind?.fraudes_confirmados ?? 0)}</dd></div>
      </dl>
      <p>Cada resolución queda en la auditoría como etiqueta confirmada para recalibrar las reglas.</p>
    </section>
  );
}

export function Senales({ modalidades }: { modalidades?: Record<string, number> }) {
  const lista = Object.entries(modalidades ?? {})
    .filter(([r]) => !r.startsWith('ninguna regla'))
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = lista[0]?.[1] ?? 1;
  return (
    <section className="panel" aria-labelledby="t-senales">
      <h3 id="t-senales">Razones más frecuentes</h3>
      {!lista.length && <p>Aún no se activa ninguna señal.</p>}
      {lista.map(([razon, n]) => (
        <div key={razon} className="senal">
          {razon}<span className="mono">{entero.format(n)}</span>
          <i style={{ width: `${(n / max) * 100}%` }} />
        </div>
      ))}
    </section>
  );
}

export function Latencia({ cubetas, sla }: { cubetas?: Metricas['histograma_latencia_ms']; sla: number }) {
  if (!cubetas?.length) return null;
  // El histograma llega acumulado: se convierte a conteo por tramo.
  const conteos = cubetas.map((c, i) => c.total - (i ? cubetas[i - 1].total : 0));
  const max = Math.max(1, ...conteos);
  const x0 = 34, x1 = 298, y0 = 10, y1 = 104, ancho = (x1 - x0) / conteos.length;
  const indiceSla = cubetas.findIndex((c) => c.hasta_ms < 0 || c.hasta_ms > sla);
  const etiqueta = (h: number) => (h < 0 ? '>1s' : h >= 1000 ? '1s' : `${h}`);
  const y = (v: number) => y1 - (v / max) * (y1 - y0);
  return (
    <section className="panel" aria-labelledby="t-latencia">
      <h3 id="t-latencia">Latencia de decisión</h3>
      <svg className="histo" viewBox="0 0 300 124" role="img"
           aria-label={cubetas.map((c, i) => `hasta ${etiqueta(c.hasta_ms)} ms: ${conteos[i]}`).join(', ')}>
        {[0, .5, 1].map((f) => (
          <g key={f}>
            <line x1={x0} x2={x1} y1={y(max * f)} y2={y(max * f)} className="guia" />
            <text x={x0 - 6} y={y(max * f) + 3.5} textAnchor="end">{entero.format(Math.round(max * f))}</text>
          </g>
        ))}
        {conteos.map((n, i) => n > 0 && (
          <rect key={i} x={x0 + i * ancho + 2} width={ancho - 4} y={y(n)} height={Math.max(1.5, y1 - y(n))} rx="1.5"
                className={`barra${indiceSla >= 0 && i >= indiceSla ? ' fuera' : ''}`}><title>{`${entero.format(n)} decisiones`}</title></rect>
        ))}
        {indiceSla > 0 && <line x1={x0 + indiceSla * ancho} x2={x0 + indiceSla * ancho} y1={y0 - 4} y2={y1} className="sla" />}
        {cubetas.map((c, i) => <text key={i} x={x0 + i * ancho + ancho / 2} y="118" textAnchor="middle">{etiqueta(c.hasta_ms)}</text>)}
      </svg>
      <p>Decisiones por tramo de milisegundos. A la derecha de la línea punteada queda lo que supera el SLA de {sla} ms.</p>
    </section>
  );
}

type Verificacion = { integra: boolean; lineas: number; selladas: number; previas_a_la_cadena: number; rupturas: { linea: number; motivo: string }[] };

type Acceso = { ts: string; evento: string; usuario?: string | null; rol?: string | null; ip?: string; motivo?: string; accion?: string; ruta?: string };
const EVENTO: Record<string, string> = {
  ingreso: 'Ingresó', salida: 'Salió', ingreso_fallido: 'Ingreso fallido', ingreso_bloqueado: 'Ingreso bloqueado',
  acceso_denegado: 'Acceso denegado', resolucion: 'Resolvió un caso', auditoria_exportada: 'Exportó la auditoría',
  consola_iniciada: 'Consola iniciada',
};
const ALERTA_ACCESO = new Set(['ingreso_fallido', 'ingreso_bloqueado', 'acceso_denegado']);
const hora = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Bogota' });

// Auditoría inmutable y marco normativo: verifica la cadena SHA-256 + HMAC y lee la bitácora de accesos cada 15 s.
export function Cumplimiento() {
  const [v, setV] = useState<Verificacion | null>(null);
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let vivo = true;
    const consultar = () => {
      fetch('/api/auditoria/verificar', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: Verificacion) => { if (vivo) { setV(d); setError(''); } }, (e: Error) => { if (vivo) setError(e.message); });
      fetch('/api/accesos', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : []))
        .then((d: Acceso[]) => { if (vivo) setAccesos(d.slice(0, 8)); }, () => {});
    };
    consultar();
    const id = setInterval(consultar, 15000);
    return () => { vivo = false; clearInterval(id); };
  }, []);
  return (
    <section className="panel cumplimiento" aria-labelledby="t-cumplimiento">
      <h3 id="t-cumplimiento">Auditoría y cumplimiento</h3>
      {error ? <p className="error-accion" role="alert">No se pudo verificar la auditoría ({error}).</p>
        : !v ? <p>Verificando la cadena…</p>
        : v.integra ? (
          <p role="status"><b style={{ color: 'var(--ok)' }}>Cadena íntegra.</b> {entero.format(v.selladas)} decisiones selladas con SHA-256 + HMAC
            {v.previas_a_la_cadena > 0 && <>, {entero.format(v.previas_a_la_cadena)} anteriores al sello</>}.</p>
        ) : (
          <p role="alert"><b style={{ color: 'var(--retener)' }}>Cadena rota.</b> Línea {v.rupturas[0]?.linea}: {v.rupturas[0]?.motivo}.</p>
        )}
      <p><a className="boton" href="/api/auditoria/exportar" download="auditoria-aegix.json">Exportar auditoría (JSON)</a></p>
      <h4>Bitácora de accesos</h4>
      {accesos.length ? (
        <ol className="accesos">
          {accesos.map((a, i) => (
            <li key={`${a.ts}-${i}`} className={ALERTA_ACCESO.has(a.evento) ? 'alerta' : undefined}>
              <span className="mono">{hora.format(new Date(a.ts))}</span>{' '}
              <b>{EVENTO[a.evento] ?? a.evento}</b>
              {a.usuario ? ` · ${a.usuario}${a.rol ? ` (${a.rol})` : ''}` : ''}
              {a.motivo ? ` · ${a.motivo}` : ''}{a.accion ? ` · ${a.accion.replace('_', ' ')}` : ''}
            </li>
          ))}
        </ol>
      ) : <p>Sin eventos todavía.</p>}
      <ul className="normativa">
        <li><b>Ley 1581 de 2012:</b> sin nombres ni celulares en claro; los identificadores son seudónimos HMAC y la accesibilidad no entra al puntaje.</li>
        <li><b>SARLAFT:</b> toda retención la resuelve una persona y queda registrado quién.</li>
        <li><b>PCI DSS:</b> fuera de alcance; aegix no recibe números de tarjeta.</li>
      </ul>
    </section>
  );
}
