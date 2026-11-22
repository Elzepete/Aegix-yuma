export const indicadores = [
  ['decisiones_registradas', 'Decisiones registradas'],
  ['aprobadas', 'Aprobadas'],
  ['desafios', 'Desafíos'],
  ['retenidas', 'Retenidas'],
  ['rechazos', 'Rechazos'],
  ['omisiones_auditoria', 'Omisiones de auditoría'],
  ['liberadas_por_analista', 'Liberadas por analista'],
  ['fraudes_confirmados', 'Fraudes confirmados'],
] as const;

export type Indicadores = Record<(typeof indicadores)[number][0], number>;

export interface Alerta {
  referencia?: string;
  origen?: 'billetera' | 'sandbox';
  entrada?: { canal: string; tipo_operacion: string; fecha_hora: string; monto_cop?: number };
  decision: 'aprobar' | 'desafiar' | 'retener' | 'rechazar';
  puntaje: number;
  razones: string[] | null;
  version_reglas: string;
  latencia_ms: number;
  registrado_en: string;
  confirmada_por_sandbox: boolean;
  resolucion?: 'liberar' | 'confirmar_fraude';
  resuelta_en?: string;
}

const decisiones = { aprobar: 'Aprobada', desafiar: 'Desafiada', retener: 'Retenida', rechazar: 'Rechazada' };
const numero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const porcentaje = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });
const fecha = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/Bogota',
});

export function IndicadoresGo({ datos }: { datos: Indicadores }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {indicadores.map(([clave, titulo]) => (
        <div key={clave} className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">{titulo}</dt>
          <dd className="mt-2 font-mono text-2xl font-semibold">{numero.format(datos[clave])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AlertasGo({ datos }: { datos: Alerta[] }) {
  if (!datos.length) {
    return <p className="rounded-lg border border-slate-200 bg-white p-5">El motor Go aún no registra alertas.</p>;
  }
  return (
    <ul className="space-y-3">
      {datos.map((alerta, indice) => (
        <li key={`${alerta.referencia}-${alerta.registrado_en}-${indice}`}
            className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">
              {decisiones[alerta.decision]} <span className="text-slate-500">· {porcentaje.format(alerta.puntaje)}</span>
              {!!alerta.entrada?.monto_cop && <span className="ml-2 font-mono">{pesos.format(alerta.entrada.monto_cop)}</span>}
            </h3>
            <span className="text-sm text-slate-600">
              {alerta.origen === 'billetera'
                ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">Billetera Yuma</span>
                : alerta.confirmada_por_sandbox ? 'Sandbox · confirmada' : 'Sandbox · sin confirmación'}
            </span>
          </div>
          <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {alerta.referencia && <div className="min-w-0 sm:col-span-2">
              <dt className="font-medium">Referencia de auditoría</dt>
              <dd className="break-all font-mono">{alerta.referencia}</dd>
            </div>}
            {alerta.entrada && <div>
              <dt className="font-medium">Canal y operación</dt>
              <dd>{alerta.entrada.canal} · {alerta.entrada.tipo_operacion}</dd>
            </div>}
            <div>
              <dt className="font-medium">Registro en hora Colombia</dt>
              <dd><time dateTime={alerta.registrado_en}>{fecha.format(new Date(alerta.registrado_en))}</time></dd>
            </div>
            <div>
              <dt className="font-medium">Versión de reglas</dt>
              <dd>{alerta.version_reglas}</dd>
            </div>
            <div>
              <dt className="font-medium">Latencia</dt>
              <dd>{numero.format(alerta.latencia_ms)} ms</dd>
            </div>
          </dl>
          {!!alerta.razones?.length && (
            <>
              <h4 className="mt-4 text-sm font-semibold">Razones de la decisión</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {alerta.razones.map((razon, i) => <li key={i}>{razon}</li>)}
              </ul>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
