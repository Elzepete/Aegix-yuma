async function consultar(request, url, options) {
  const response = await request(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) {
    throw new Error(`${url.pathname} devolvió HTTP ${response.status}.`);
  }
  return response.json();
}

export async function ejecutarPrueba({ engine, sandbox, request }) {
  const rutaLote = new URL('/v1/transacciones/siguiente?cantidad=20', sandbox);
  const { transacciones } = await consultar(request, rutaLote);
  const normal = transacciones.find((tx) =>
    tx.monto_cop < 0.85 * tx.saldo_antes_cop &&
    !tx.dispositivo_nuevo && !tx.cambio_sim_48h && !tx.cambio_clave_24h && !tx.destino_nuevo
  );
  const riesgo = normal && transacciones.find((tx) => tx.id_cliente !== normal.id_cliente);
  if (!normal || !riesgo) {
    throw new Error('El sandbox no entregó dos transacciones adecuadas. Vuelve a intentar la prueba.');
  }
  const casos = [
    { escenario: 'Sin señales añadidas', transaccion: normal, simulado: false },
    {
      escenario: 'Señales de riesgo simuladas',
      transaccion: {
        ...riesgo,
        dispositivo_nuevo: 1,
        cambio_sim_48h: 1,
        cambio_clave_24h: 1,
        destino_nuevo: 1,
      },
      simulado: true,
    },
  ];

  const resultados = [];
  for (const { escenario, transaccion, simulado } of casos) {
    const respuesta = await consultar(request, new URL('/score', engine), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaccion,
        contexto: {
          ip: '203.0.113.10',
          pais_ip: 'CO',
          es_tor: simulado,
          es_proxy_o_datacenter: false,
          version_app: '3.4.1',
          sistema_operativo: 'Android',
          huella_dispositivo: transaccion.id_dispositivo,
        },
      }),
    });
    if (respuesta.id_transaccion !== transaccion.id_transaccion ||
        !['aprobar', 'desafiar', 'retener'].includes(respuesta.decision) ||
        !Number.isFinite(respuesta.puntaje) || !Array.isArray(respuesta.razones)) {
      throw new Error('Go devolvió una respuesta inesperada para la prueba.');
    }
    resultados.push({ escenario, respuesta });
  }
  return resultados;
}
