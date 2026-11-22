class ErrorPrueba extends Error {
  constructor(paso, mensaje, estadoHttp = null) {
    super(mensaje);
    this.paso = paso;
    this.estadoHttp = estadoHttp;
  }
}

async function consultar(request, url, paso, options) {
  let response;
  try {
    response = await request(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw new ErrorPrueba(paso, 'El servicio no respondió.');
  }
  if (!response.ok) {
    throw new ErrorPrueba(paso, 'El servicio rechazó la solicitud.', response.status);
  }
  try {
    return { datos: await response.json(), estadoHttp: response.status };
  } catch {
    throw new ErrorPrueba(paso, 'El servicio devolvió una respuesta que no es JSON.', response.status);
  }
}

async function ejecutarPrueba({ engine, sandbox, request }) {
  const pasoSandbox = 'Obtener transacciones del sandbox';
  const rutaLote = new URL('/v1/transacciones/siguiente?cantidad=20', sandbox);
  const lote = await consultar(request, rutaLote, pasoSandbox);
  const transacciones = lote.datos?.transacciones;
  if (!Array.isArray(transacciones)) {
    throw new ErrorPrueba(pasoSandbox, 'El sandbox devolvió un lote inválido.', lote.estadoHttp);
  }
  const normal = transacciones.find((tx) =>
    tx.monto_cop < 0.85 * tx.saldo_antes_cop &&
    !tx.dispositivo_nuevo && !tx.cambio_sim_48h && !tx.cambio_clave_24h && !tx.destino_nuevo
  );
  const riesgo = normal && transacciones.find((tx) => tx.id_cliente !== normal.id_cliente);
  if (!normal || !riesgo) {
    throw new ErrorPrueba(pasoSandbox, 'El lote no contiene dos transacciones adecuadas. Vuelve a intentar.', lote.estadoHttp);
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
    const paso = `Evaluar en Go · ${escenario} (${transaccion.id_transaccion})`;
    const { datos: respuesta, estadoHttp } = await consultar(request, new URL('/score', engine), paso, {
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
    if (respuesta?.id_transaccion !== transaccion.id_transaccion ||
        !['aprobar', 'desafiar', 'retener'].includes(respuesta.decision) ||
        !Number.isFinite(respuesta.puntaje) || !Array.isArray(respuesta.razones)) {
      throw new ErrorPrueba(paso, 'Go devolvió una decisión inválida.', estadoHttp);
    }
    resultados.push({ escenario, respuesta });
  }
  return resultados;
}

export function crearRutaPruebaGo({ engine, sandbox, request = fetch }) {
  let enCurso = false;
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const fallar = (status, paso, error, estadoHttp = null) =>
      res.status(status).json({ paso, error, estado_http: estadoHttp });
    if (!req.is('application/json')) {
      return fallar(415, 'Recibir la solicitud en Node', 'Se requiere application/json.', 415);
    }
    if (!engine || !sandbox) {
      return fallar(503, 'Configurar la demo', 'Arranca el panel con demo.py para conectar Go y el sandbox.');
    }
    if (enCurso) {
      return fallar(409, 'Iniciar la prueba en Node', 'Ya hay una prueba en ejecución.', 409);
    }
    enCurso = true;
    try {
      return res.json(await ejecutarPrueba({ engine, sandbox, request }));
    } catch (cause) {
      if (cause instanceof ErrorPrueba) {
        return fallar(502, cause.paso, cause.message, cause.estadoHttp);
      }
      console.error('Error interno de /api/prueba-go:', cause);
      return fallar(500, 'Ejecutar la prueba en Node', 'Error interno del panel.', 500);
    } finally {
      enCurso = false;
    }
  };
}
