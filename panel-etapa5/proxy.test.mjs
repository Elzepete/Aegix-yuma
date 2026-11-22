import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createPanelHandler } from './proxy.mjs';

// Levanta el panel con un aegix falso que registra lo que recibe.
async function panel(opciones) {
  const llamadas = [];
  const request = async (url, init = {}) => {
    llamadas.push({ ruta: url.pathname, metodo: init.method ?? 'GET', auth: init.headers?.Authorization, cuerpo: init.body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const servidor = createServer(createPanelHandler({ engine: new URL('http://127.0.0.1:1'), request, ...opciones }));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { base, llamadas, cerrar: () => new Promise((r) => servidor.close(r)) };
}

const basic = (clave) => `Basic ${Buffer.from(`analista:${clave}`).toString('base64')}`;

test('con YUMA_PANEL_CLAVE el panel exige contraseña', async () => {
  const p = await panel({ clave: 'secreta' });
  try {
    const sin = await fetch(`${p.base}/api/metricas`);
    assert.equal(sin.status, 401);
    assert.match(sin.headers.get('www-authenticate'), /Basic/);
    assert.equal((await fetch(`${p.base}/api/metricas`, { headers: { Authorization: basic('otra') } })).status, 401);
    assert.equal((await fetch(`${p.base}/api/metricas`, { headers: { Authorization: basic('secreta') } })).status, 200);
    assert.equal(p.llamadas.length, 1, 'aegix solo recibe la consulta autorizada');
  } finally { await p.cerrar(); }
});

test('las rutas de la billetera pasan sin la clave del panel y con su propio Bearer', async () => {
  const p = await panel({ clave: 'secreta', token: 'del-panel' });
  try {
    const r = await fetch(`${p.base}/v1/autorizar`, {
      method: 'POST', headers: { Authorization: 'Bearer de-la-billetera', 'Content-Type': 'application/json' }, body: '{"a":1}',
    });
    assert.equal(r.status, 200);
    assert.equal((await fetch(`${p.base}/v1/autorizar/YWABC123`)).status, 200);
    assert.equal((await fetch(`${p.base}/salud`)).status, 200);
    assert.deepEqual(p.llamadas.map((l) => [l.metodo, l.ruta]), [['POST', '/v1/autorizar'], ['GET', '/v1/autorizar/YWABC123'], ['GET', '/salud']]);
    assert.equal(p.llamadas[0].auth, 'Bearer de-la-billetera', 'no se reemplaza por el token del panel');
    assert.equal(p.llamadas[0].cuerpo, '{"a":1}');
    assert.equal((await fetch(`${p.base}/v1/autorizar`)).status, 405);
    assert.equal((await fetch(`${p.base}/v1/autorizar/../alertas`)).status, 401, 'nada fuera de esas rutas se salta la clave');
  } finally { await p.cerrar(); }
});

test('sin clave el panel sigue abierto en local', async () => {
  const p = await panel({});
  try {
    assert.equal((await fetch(`${p.base}/api/metricas`)).status, 200);
  } finally { await p.cerrar(); }
});
