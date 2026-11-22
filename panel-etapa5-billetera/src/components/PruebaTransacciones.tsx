import { useState } from 'react';

const decisiones = { aprobar: 'Aprobada', desafiar: 'Desafío', retener: 'Retenida' };
const puntaje = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });

interface Resultado {
  escenario: string;
  respuesta: {
    id_transaccion: string;
    decision: keyof typeof decisiones;
    puntaje: number;
    razones: string[];
  };
}

export function PruebaTransacciones() {
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [seleccion, setSeleccion] = useState<Resultado | null>(null);
  const [ejecutando, setEjecutando] = useState(false);
  const [error, setError] = useState('');

  async function ejecutar() {
    setEjecutando(true);
    setResultados([]);
    setSeleccion(null);
    setError('');
    try {
      const res = await fetch('/api/prueba-go', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const esJson = res.headers.get('content-type')?.includes('application/json');
      if (!esJson) throw new Error(`Consultar el servidor Node · HTTP ${res.status}. La respuesta no es JSON.`);
      const datos = await res.json();
      if (!res.ok) {
        const paso = datos.paso ?? 'Consultar el servidor Node';
        const estado = datos.estado_http == null && datos.paso
          ? `sin estado HTTP del servicio (Node respondió HTTP ${res.status})`
          : `HTTP ${datos.estado_http ?? res.status}`;
        throw new Error(`${paso} · ${estado}. ${datos.error ?? ''}`);
      }
      if (!Array.isArray(datos) || datos.length !== 2) {
        throw new Error(`Consultar el servidor Node · HTTP ${res.status}. Se esperaban dos decisiones.`);
      }
      setResultados(datos);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error inesperado.');
    } finally {
      setEjecutando(false);
    }
  }

  return (
    <section id="prueba-transacciones" aria-labelledby="titulo-prueba"
             className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-prueba" className="text-lg font-semibold">Prueba de transacciones</h2>
        <button type="button" onClick={ejecutar} disabled={ejecutando}
                className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60">
          Ejecutar dos transacciones de prueba
        </button>
      </div>
      <p className="text-sm text-slate-600">
        Operaciones del sandbox. Go evalúa una sin señales añadidas y otra con señales de riesgo simuladas.
      </p>
      {ejecutando && <p role="status" className="text-sm text-blue-800">Ejecutando las dos transacciones…</p>}
      {error && <p role="alert" className="text-sm text-red-700">Falló la prueba. {error}</p>}
      {resultados.length > 0 && (
        <div className="overflow-x-auto">
          <table aria-label="Resultados de la prueba" className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-3 py-2">ID</th>
                <th scope="col" className="px-3 py-2">Escenario</th>
                <th scope="col" className="px-3 py-2">Decisión</th>
                <th scope="col" className="px-3 py-2 text-right">Puntaje</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((resultado) => {
                const { escenario, respuesta } = resultado;
                const seleccionada = seleccion === resultado;
                return (
                  <tr key={respuesta.id_transaccion} onClick={() => setSeleccion(resultado)}
                      className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${seleccionada ? 'bg-blue-50' : ''}`}>
                    <th scope="row" className="px-3 py-3 font-mono font-medium">
                      <button type="button" onClick={() => setSeleccion(resultado)} aria-pressed={seleccionada}
                              className="text-blue-800 underline underline-offset-2">
                        {respuesta.id_transaccion}
                      </button>
                    </th>
                    <td className="px-3 py-3">{escenario}</td>
                    <td className="px-3 py-3">{decisiones[respuesta.decision]}</td>
                    <td className="px-3 py-3 text-right font-mono">{puntaje.format(respuesta.puntaje)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {seleccion && (
        <div aria-live="polite" className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-base font-semibold">¿Por qué tomó esta decisión?</h3>
          <p className="mt-1 font-mono text-sm text-slate-600">{seleccion.respuesta.id_transaccion}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {seleccion.respuesta.razones.map((razon, indice) => <li key={indice}>{razon}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
