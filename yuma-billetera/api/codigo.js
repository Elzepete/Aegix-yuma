// Función de Vercel: códigos de verificación de un solo uso (ingreso y desafíos de aegix).
//
// Sin base de datos: el servidor no guarda el código. Devuelve una ficha firmada con HMAC(código, celular, motivo,
// vencimiento) y, al verificar, recalcula la firma con el código que escribe el cliente.
//
//   NTFY_URL        tema de ntfy al que se suscribe el celular, p. ej. https://ntfy.sh/yuma-demo-8f3k2q (gratis).
//                   Sin esta variable el código se devuelve a la pantalla como «SMS simulado».
//   CODIGO_SECRETO  clave de firma; si falta se usa AEGIX_TOKEN. Debe ser la misma en todas las instancias.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const VIGENCIA_MS = 10 * 60 * 1000; // 10 minutos, y siempre se puede pedir otro
const MOTIVOS = { ingreso: 'entrar a Yuma', operacion: 'autorizar' };
// shortcut: clave por proceso si no hay variables; en Vercel cada instancia tendría la suya, define CODIGO_SECRETO.
const SECRETO_LOCAL = randomBytes(32).toString('hex');
const secreto = () => process.env.CODIGO_SECRETO || process.env.AEGIX_TOKEN || SECRETO_LOCAL;
const b64 = (texto) => Buffer.from(texto).toString('base64url');
const firma = (datos, codigo) => createHmac('sha256', secreto()).update(`${datos}.${codigo}`).digest('base64url');

// operacion ata el código a «monto|destino»: un código para enviar $50.000 a un número no sirve para otro envío.
export function emitir(celular, motivo, ahora = Date.now(), operacion = '') {
  const codigo = String(randomInt(0, 1e6)).padStart(6, '0');
  const datos = b64(JSON.stringify({ c: celular, m: motivo, o: operacion, e: ahora + VIGENCIA_MS }));
  return { codigo, ficha: `${datos}.${firma(datos, codigo)}` };
}

export function comprobar(ficha, codigo, celular, motivo, ahora = Date.now(), operacion = '') {
  const [datos, recibida] = String(ficha).split('.');
  if (!datos || !recibida || !/^\d{6}$/.test(String(codigo))) return 'incorrecto';
  const esperada = Buffer.from(firma(datos, codigo));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return 'incorrecto';
  let d;
  try { d = JSON.parse(Buffer.from(datos, 'base64url').toString()); } catch { return 'incorrecto'; }
  if (d.c !== celular || d.m !== motivo || (d.o ?? '') !== operacion) return 'incorrecto';
  return ahora > d.e ? 'vencido' : 'valido';
}

// https://ntfy.sh/mi-tema → { servidor: 'https://ntfy.sh', nombre: 'mi-tema' }; null si no está configurado.
export function temaNtfy(valor) {
  try {
    const u = new URL(String(valor ?? '').trim());
    const nombre = u.pathname.replace(/^\/+|\/+$/g, '');
    return u.protocol === 'https:' && /^[\w-]{1,64}$/.test(nombre) ? { servidor: u.origin, nombre } : null;
  } catch { return null; }
}

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export async function POST(request) {
  let e;
  try { e = JSON.parse(await request.text()); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (!e || !/^3\d{9}$/.test(e.celular) || !MOTIVOS[e.motivo]) return json({ error: 'celular o motivo inválido' }, 400);

  const montoValido = Number.isInteger(e.monto) && e.monto > 0 && e.monto < 1e11;
  const destino = typeof e.destino === 'string' && /^[A-Z0-9]{4,20}$/.test(e.destino) ? e.destino : '';
  const operacion = e.motivo === 'operacion' ? `${montoValido ? e.monto : ''}|${destino}` : '';
  if (e.accion === 'verificar') return json({ resultado: comprobar(e.ficha, e.codigo, e.celular, e.motivo, Date.now(), operacion) });
  if (e.accion !== 'enviar') return json({ error: 'acción desconocida' }, 400);

  // El mensaje dice qué se autoriza: monto y los últimos 4 caracteres del destino.
  const monto = (montoValido ? ` ${pesos.format(e.monto)}` : '') + (destino ? ` a •••${destino.slice(-4)}` : '');
  const { codigo, ficha } = emitir(e.celular, e.motivo, Date.now(), operacion);
  const tema = temaNtfy(process.env.NTFY_URL);
  if (!tema) return json({ ficha, canal: 'simulado', codigo });
  try {
    // Publicación JSON de ntfy: el título y el mensaje viajan en UTF-8 (las cabeceras no admiten tildes).
    const r = await fetch(`${tema.servidor}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: tema.nombre, title: 'Yuma · código de verificación', tags: ['lock'], priority: 4,
        message: `Tu código para ${MOTIVOS[e.motivo]}${monto} es ${codigo}. Vale 10 minutos. No lo compartas con nadie. (Demo: Yuma Pay es ficticia)`,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new Error(`ntfy respondió ${r.status}`);
  } catch {
    // Sin celular disponible no se cae la demo: el código vuelve a la pantalla, avisando que es simulado.
    return json({ ficha, canal: 'simulado', codigo, aviso: 'No se pudo enviar al celular' });
  }
  return json({ ficha, canal: 'celular' });
}
