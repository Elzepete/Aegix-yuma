import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ejecutarPrueba } from './transacciones-prueba.mjs';
import {
  PERMISOS, cargarUsuarios, crearLimitador, firmarSesion, hashClave, leerCookie, leerSesion, puede, verificarClave, verificarTotp,
} from './acceso.mjs';

const dist = fileURLToPath(new URL('./dist', import.meta.url));
const routes = new Map([
  ['/api/alertas', '/alertas'],
  ['/api/indicadores', '/indicadores'],
  ['/api/metricas', '/metricas'],
  ['/api/decisiones', '/decisiones'],
]);
// Rutas de auditoría: solo para roles con permiso «auditar».
const AUDITORIA = new Map([
  ['/api/auditoria/verificar', '/auditoria/verificar'],
  ['/api/auditoria/exportar', '/auditoria/exportar'],
]);
const COOKIE = 'aegix_sesion';
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function paginaIngreso(res, estado, mensaje = '') {
  res.writeHead(estado, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ingresar · Consola aegix</title><style>
:root{color-scheme:light dark;--f:#F4F5FA;--h:#fff;--t:#1A1D38;--s:#5D6283;--r:#D8DBE8;--a:#17704A;--e:#B4412B}
@media (prefers-color-scheme:dark){:root{--f:#11132A;--h:#191C36;--t:#E6E8F5;--s:#A3A7C4;--r:#2D3154;--a:#4CC48F;--e:#F08A74}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--f);color:var(--t);font:16px/1.5 system-ui,sans-serif;padding:16px}
form{background:var(--h);border:1px solid var(--r);border-radius:16px;padding:28px;width:min(380px,100%);display:grid;gap:14px}
h1{margin:0;font-size:1.5rem}p{margin:0;color:var(--s);font-size:.95rem}label{display:grid;gap:4px;font-weight:600;font-size:.95rem}
input{font:inherit;padding:10px 12px;border:1px solid var(--r);border-radius:10px;background:var(--f);color:var(--t)}
input:focus-visible,button:focus-visible{outline:3px solid var(--a);outline-offset:2px}
button{font:inherit;font-weight:700;padding:12px;border:0;border-radius:10px;background:var(--a);color:#fff;cursor:pointer}
.error{color:var(--e);font-weight:600}</style></head><body>
<form method="post" action="/ingresar"><h1>Consola aegix</h1><p>Acceso para analistas, auditores, empleados y administradores.</p>
${mensaje ? `<p class="error" role="alert">${esc(mensaje)}</p>` : ''}
<label>Usuario<input name="usuario" autocomplete="username" required maxlength="32" autofocus></label>
<label>Contraseña<input name="clave" type="password" autocomplete="current-password" required maxlength="200"></label>
<label>Código de la app autenticadora<input name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
<button type="submit">Ingresar</button><p>El código cambia cada 30 segundos.</p></form></body></html>`);
}
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

function error(response, status, message) {
  json(response, status, { error: message });
}

// Rutas que usa la función de Vercel de la billetera: aegix exige su propio Bearer, así que no piden la clave del panel.
const BILLETERA = /^\/(salud|v1\/autorizar(\/YW[A-Z0-9]{4,40})?)$/;

const resumen = (texto) => createHash('sha256').update(texto).digest();
function claveCorrecta(cabecera, clave) {
  const [tipo, valor] = (cabecera ?? '').split(' ');
  if (tipo !== 'Basic' || !valor) return false;
  const texto = Buffer.from(valor, 'base64').toString('utf8');
  // Cualquier usuario sirve; solo cuenta la contraseña.
  return timingSafeEqual(resumen(texto.slice(texto.indexOf(':') + 1)), resumen(clave));
}

async function reenviarBilletera(req, res, pathname, engine, request) {
  const metodo = pathname === '/v1/autorizar' ? 'POST' : 'GET';
  if (req.method !== metodo) {
    res.setHeader('Allow', metodo);
    return error(res, 405, 'Método no permitido');
  }
  let cuerpo;
  if (metodo === 'POST') {
    cuerpo = '';
    for await (const parte of req) {
      cuerpo += parte;
      if (cuerpo.length > 16 * 1024) return error(res, 413, 'Solicitud demasiado grande');
    }
  }
  try {
    const upstream = await request(new URL(pathname, engine), {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
      body: cuerpo,
      redirect: 'error',
      signal: AbortSignal.timeout(2500),
    });
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(await upstream.text());
  } catch {
    return error(res, 502, 'Motor Go no disponible');
  }
}

export function createPanelHandler({ engine, sandbox, token, clave, usuarios, secretoSesion = randomBytes(32), request = fetch }) {
  let pruebaEnCurso = false;
  const limitador = crearLimitador();
  const ultimosPasos = new Map(); // un código TOTP no sirve dos veces
  const ficticio = usuarios ? hashClave(randomBytes(12).toString('hex')) : null; // mismo costo si el usuario no existe

  async function ingresar(req, res) {
    if (req.method === 'GET') return paginaIngreso(res, 200);
    if (req.method !== 'POST') return error(res, 405, 'Método no permitido');
    let cuerpo = '';
    for await (const parte of req) {
      cuerpo += parte;
      if (cuerpo.length > 2048) return error(res, 413, 'Solicitud demasiado grande');
    }
    const f = new URLSearchParams(cuerpo);
    const usuario = String(f.get('usuario') ?? '').trim().toLowerCase().slice(0, 32);
    const ip = req.socket.remoteAddress ?? 'sin-ip';
    if (limitador.bloqueado(usuario, ip)) return paginaIngreso(res, 429, 'Demasiados intentos. Espera 15 minutos.');
    const u = usuarios.get(usuario);
    const claveOk = await verificarClave(f.get('clave') ?? '', u?.clave ?? await ficticio);
    const paso = u && claveOk ? verificarTotp(u.totp, f.get('codigo'), Date.now(), ultimosPasos.get(usuario) ?? -1) : null;
    if (paso === null) {
      limitador.fallo(usuario, ip);
      return paginaIngreso(res, 401, 'Usuario, contraseña o código incorrectos.');
    }
    ultimosPasos.set(usuario, paso);
    const seguro = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.writeHead(303, {
      Location: '/',
      'Set-Cookie': `${COOKIE}=${firmarSesion(secretoSesion, u.usuario, u.rol)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${seguro}`,
    });
    return res.end();
  }

  return async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      return error(res, 400, 'Ruta inválida');
    }
    if (BILLETERA.test(pathname)) return reenviarBilletera(req, res, pathname, engine, request);
    let sesion = null;
    if (usuarios) {
      if (pathname === '/ingresar') return ingresar(req, res);
      if (pathname === '/salir') {
        res.writeHead(303, { Location: '/ingresar', 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
        return res.end();
      }
      sesion = leerSesion(secretoSesion, leerCookie(req.headers.cookie, COOKIE));
      if (!sesion) {
        if (pathname.startsWith('/api/')) return error(res, 401, 'Ingresa a la consola con tu usuario y código.');
        res.writeHead(303, { Location: '/ingresar' });
        return res.end();
      }
    } else if (clave && !claveCorrecta(req.headers.authorization, clave)) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="Consola aegix", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return res.end('Escribe la contraseña del panel (variable YUMA_PANEL_CLAVE).');
    }
    // Sin usuarios configurados (demo), la consola es de acceso abierto con todos los permisos.
    const permitido = (permiso) => {
      if (!sesion || puede(sesion.rol, permiso)) return true;
      error(res, 403, `Tu rol (${sesion.rol}) no permite esta acción.`);
      return false;
    };
    if (pathname === '/api/sesion') {
      return json(res, 200, sesion
        ? { usuario: sesion.usuario, rol: sesion.rol, permisos: PERMISOS[sesion.rol], acceso: 'soc' }
        : { usuario: null, rol: null, permisos: PERMISOS.admin, acceso: clave ? 'clave' : 'abierto' });
    }
    if (pathname === '/api/prueba-transacciones') {
      if (!permitido('probar')) return;
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return error(res, 405, 'Método no permitido');
      }
      if (req.headers['content-type'] !== 'application/json') {
        return error(res, 415, 'Se requiere application/json');
      }
      if (!sandbox) return error(res, 503, 'Inicia el panel con demo.py para conectar el sandbox.');
      if (pruebaEnCurso) return error(res, 409, 'Ya hay una prueba en ejecución.');
      pruebaEnCurso = true;
      try {
        const resultados = await ejecutarPrueba({ engine, sandbox, request });
        return json(res, 200, resultados);
      } catch (cause) {
        console.error('Error en la prueba de transacciones:', cause);
        const detalle = cause instanceof TypeError
          ? 'Comprueba que el sandbox y Go estén disponibles.'
          : cause.message;
        return error(res, 502, detalle);
      } finally {
        pruebaEnCurso = false;
      }
    }
    const resolucion = pathname.match(/^\/api\/alertas\/([0-9a-f]{64})\/resolucion$/);
    if (resolucion) {
      if (!permitido('resolver')) return;
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return error(res, 405, 'Método no permitido');
      }
      let cuerpo = '';
      for await (const parte of req) {
        cuerpo += parte;
        if (cuerpo.length > 1024) return error(res, 413, 'Solicitud demasiado grande');
      }
      try {
        const upstream = await request(new URL(`/alertas/${resolucion[1]}/resolucion`, engine), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(sesion ? { 'X-Aegix-Analista': `${sesion.usuario} (${sesion.rol})` } : {}),
          },
          body: cuerpo,
          redirect: 'error',
          signal: AbortSignal.timeout(2500),
        });
        res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(await upstream.text());
      } catch {
        return error(res, 502, 'Motor Go no disponible');
      }
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return error(res, 405, 'Método no permitido');
    }
    const auditoria = AUDITORIA.get(pathname);
    if (auditoria) {
      if (!permitido('auditar')) return;
      try {
        const upstream = await request(new URL(auditoria, engine), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        });
        const cabeceras = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        const adjunto = upstream.headers?.get?.('content-disposition');
        if (adjunto) cabeceras['Content-Disposition'] = adjunto;
        res.writeHead(upstream.status, cabeceras);
        if (upstream.body?.getReader) return await pipeline(Readable.fromWeb(upstream.body), res);
        return res.end(await upstream.text());
      } catch {
        if (res.headersSent) return res.destroy();
        return error(res, 502, 'Motor Go no disponible');
      }
    }
    const endpoint = routes.get(pathname);
    if (endpoint) {
      try {
        const upstream = await request(new URL(endpoint, engine), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          redirect: 'error',
          signal: AbortSignal.timeout(2500),
        });
        const data = await upstream.text();
        res.writeHead(upstream.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        return res.end(data);
      } catch {
        return error(res, 502, 'Motor Go no disponible');
      }
    }
    const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + sep) || pathname.startsWith('/api/')) {
      return error(res, 404, 'Ruta no encontrada');
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) return error(res, 404, 'Ruta no encontrada');
      res.writeHead(200, {
        'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'X-Content-Type-Options': 'nosniff',
        // La página siempre se revalida para que el navegador cargue la versión recién compilada.
        ...(extname(file) === '.html' ? { 'Cache-Control': 'no-cache' } : {}),
      });
      await pipeline(createReadStream(file), res);
    } catch (cause) {
      if (res.headersSent) return res.destroy();
      const status = cause.code === 'ENOENT' || cause.code === 'ENOTDIR' ? 404 : 500;
      error(res, status, status === 404 ? 'Ruta no encontrada' : 'Error al servir el panel');
    }
  };
}

function localUrl(value, variable) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new Error(`${variable} debe ser una URL HTTP en 127.0.0.1 sin credenciales`);
  }
  return url;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await access(resolve(dist, 'index.html'));
  } catch {
    console.error('Compila el panel con npm run build antes de iniciarlo.');
    process.exit(1);
  }
  const port = Number(process.env.YUMA_PANEL_PORT ?? 4173);
  const engine = localUrl(process.env.YUMA_GO_URL ?? 'http://127.0.0.1:8081', 'YUMA_GO_URL');
  const sandbox = process.env.YUMA_SANDBOX_URL &&
    localUrl(process.env.YUMA_SANDBOX_URL, 'YUMA_SANDBOX_URL');
  const clave = process.env.YUMA_PANEL_CLAVE;
  let usuarios;
  if (process.env.YUMA_USUARIOS) {
    try {
      usuarios = await cargarUsuarios(process.env.YUMA_USUARIOS);
      console.log(`Acceso SOC: ${usuarios.size} usuario(s) con contraseña y código TOTP.`);
    } catch (e) {
      console.error(`No se pudieron cargar los usuarios de la consola: ${e.message}`);
      process.exit(1);
    }
  } else if (!clave) {
    console.warn('Panel sin contraseña: define YUMA_USUARIOS (acceso 2FA) o YUMA_PANEL_CLAVE antes de exponerlo con un túnel.');
  }
  const server = createServer(createPanelHandler({ engine, sandbox, token: process.env.YUMA_PANEL_TOKEN, clave, usuarios }));
  // En Docker escucha en 0.0.0.0 dentro de la red privada del compose; en local, solo 127.0.0.1.
  server.listen(port, process.env.YUMA_PANEL_HOST ?? '127.0.0.1', () => {
    console.log(`Panel Etapa 5 en http://127.0.0.1:${server.address().port}`);
  });
}
