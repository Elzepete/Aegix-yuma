// Servidor local sin dependencias: sirve la billetera y la función /api/autorizar como lo haría Vercel.
//   AEGIX_URL=http://127.0.0.1:8081 node dev.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import * as autorizar from './api/autorizar.js';

const raiz = new URL('.', import.meta.url).pathname;
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const puerto = Number(process.env.PORT || 3000);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/autorizar') {
    const manejador = autorizar[req.method];
    if (!manejador) return res.writeHead(405).end();
    const partes = [];
    for await (const p of req) partes.push(p);
    const cabeceras = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress };
    const peticion = new Request(url, { method: req.method, headers: cabeceras, body: req.method === 'POST' ? Buffer.concat(partes) : undefined });
    const r = await manejador(peticion);
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text());
    return;
  }
  const ruta = normalize(join(raiz, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!ruta.startsWith(raiz) || ruta.includes('/api/') || ruta.endsWith('.mjs')) return res.writeHead(404).end();
  let contenido;
  try {
    contenido = await readFile(ruta);
  } catch {
    return res.writeHead(404).end('no encontrado');
  }
  res.writeHead(200, { 'content-type': tipos[extname(ruta)] || 'application/octet-stream' }).end(contenido);
}).listen(puerto, process.env.HOST || '127.0.0.1', () => console.log(`Billetera Yuma en http://localhost:${puerto}  (aegix: ${process.env.AEGIX_URL || 'sin configurar'})`));
