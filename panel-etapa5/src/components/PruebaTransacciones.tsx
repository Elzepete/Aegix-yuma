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

export function PruebaTransacciones({ alTerminar }: { alTerminar: () => void }) {
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
      const res = await fetch('/api/prueba-transacciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.error ?? `Error HTTP ${res.status}`);
      setResultados(datos);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error inesperado.');
    } finally {
      setEjecutando(false);
      alTerminar();
    }
  }

  return (
    <section id="prueba-transacciones" aria-labelledby="titulo-prueba" className="panel prueba">
      <div className="prueba-barra">
        <h3 id="titulo-prueba">Probar con el sandbox del reto</h3>
        <button type="button" onClick={ejecutar} disabled={ejecutando} className="boton">
          {ejecutando ? 'Ejecutando…' : 'Ejecutar dos transacciones'}
        </button>
      </div>
      <p>aegix evalúa una operación del sandbox tal cual y otra con señales de riesgo simuladas. Disponible al iniciar el panel con demo.py.</p>
      {error && <p role="alert" className="aviso">Falló la prueba. {error}</p>}
      {resultados.length > 0 && (
        <div className="tabla-scroll">
          <table aria-label="Resultados de la prueba">
            <thead>
              <tr><th scope="col">ID</th><th scope="col">Escenario</th><th scope="col">Decisión</th><th scope="col">Puntaje</th></tr>
            </thead>
            <tbody>
              {resultados.map((resultado) => {
                const { escenario, respuesta } = resultado;
                return (
                  <tr key={respuesta.id_transaccion}>
                    <th scope="row">
                      <button type="button" className="enlace mono" onClick={() => setSeleccion(resultado)} aria-pressed={seleccion === resultado}>
                        {respuesta.id_transaccion}
                      </button>
                    </th>
                    <td>{escenario}</td>
                    <td>{decisiones[respuesta.decision]}</td>
                    <td className="mono">{puntaje.format(respuesta.puntaje)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {seleccion && (
        <div aria-live="polite" style={{ display: 'grid', gap: 8 }}>
          <h3>Por qué aegix decidió así</h3>
          <ul className="razones-prueba">
            {seleccion.respuesta.razones.map((razon, indice) => <li key={indice} className="etiqueta">{razon}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
