// Función de Vercel: pasarela entre la billetera (navegador) y aegix.
// La URL y la clave de aegix viven solo aquí (variables de entorno), nunca en el navegador.
//   AEGIX_URL    p. ej. https://algo.trycloudflare.com  (túnel hacia aegix local)
//   AEGIX_TOKEN  el mismo valor que YUMA_PANEL_TOKEN en aegix (opcional pero recomendado)

const PLAZO_MS = 4000;
const MAX_CUERPO = 16 * 1024;

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function base() {
  const url = (process.env.AEGIX_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(url) ? url : '';
}

function cabeceras() {
  const h = { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' };
  if (process.env.AEGIX_TOKEN) h.authorization = `Bearer ${process.env.AEGIX_TOKEN}`;
  return h;
}

export async function GET(request) {
  const url = base();
  // ?id=YW… consulta si un analista ya resolvió una operación retenida.
  const id = request ? new URL(request.url).searchParams.get('id') : null;
  if (id !== null) {
    if (!url) return json({ error: 'AEGIX_URL no está configurada en el servidor' }, 503);
    if (!/^YW[A-Z0-9]{4,40}$/.test(id)) return json({ error: 'identificador inválido' }, 400);
    try {
      const r = await fetch(`${url}/v1/autorizar/${id}`, { headers: cabeceras(), signal: AbortSignal.timeout(PLAZO_MS) });
      return json(await r.json().catch(() => ({ error: `aegix devolvió HTTP ${r.status}` })), r.status);
    } catch {
      return json({ error: 'aegix no respondió a tiempo' }, 504);
    }
  }
  if (!url) return json({ aegix: 'sin_configurar' });
  try {
    const r = await fetch(`${url}/salud`, { headers: cabeceras(), signal: AbortSignal.timeout(PLAZO_MS) });
    return json({ aegix: r.ok ? 'en_linea' : 'no_disponible' });
  } catch {
    return json({ aegix: 'no_disponible' });
  }
}

export async function POST(request) {
  const url = base();
  if (!url) return json({ error: 'AEGIX_URL no está configurada en el servidor' }, 503);

  const texto = await request.text();
  if (texto.length > MAX_CUERPO) return json({ error: 'solicitud demasiado grande' }, 413);
  let entrada;
  try {
    entrada = JSON.parse(texto);
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (!entrada || typeof entrada.transaccion !== 'object' || typeof entrada.contexto !== 'object') {
    return json({ error: 'se requieren transaccion y contexto' }, 400);
  }

  // La IP y el país salen de la conexión real; el país solo se reemplaza si la demo simula el exterior.
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') || '192.0.2.1';
  const pais = request.headers.get('x-vercel-ip-country') || 'CO';
  const cuerpo = {
    transaccion: entrada.transaccion,
    contexto: { ...entrada.contexto, ip, pais_ip: entrada.contexto.pais_ip || pais },
  };

  try {
    const r = await fetch(`${url}/v1/autorizar`, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(PLAZO_MS),
    });
    const datos = await r.json().catch(() => ({ error: `aegix devolvió HTTP ${r.status}` }));
    // 400/429 de aegix traen una decisión "rechazar" con su razón: se entregan tal cual.
    return json(datos, r.status);
  } catch {
    return json({ error: 'aegix no respondió a tiempo' }, 504);
  }
}
