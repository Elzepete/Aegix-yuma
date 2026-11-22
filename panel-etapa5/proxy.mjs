import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { ejecutarPrueba } from './transacciones-prueba.mjs';

const dist = fileURLToPath(new URL('./dist', import.meta.url));
const routes = new Map([
  ['/api/alertas', '/alertas'],
  ['/api/indicadores', '/indicadores'],
  ['/api/metricas', '/metricas'],
  ['/api/decisiones', '/decisiones'],
]);
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

export function createPanelHandler({ engine, sandbox, token, request = fetch }) {
  let pruebaEnCurso = false;
  return async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      return error(res, 400, 'Ruta inválida');
    }
    if (pathname === '/api/prueba-transacciones') {
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
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  const server = createServer(createPanelHandler({ engine, sandbox, token: process.env.YUMA_PANEL_TOKEN }));
  server.listen(port, '127.0.0.1', () => {
    console.log(`Panel Etapa 5 en http://127.0.0.1:${server.address().port}`);
  });
}
