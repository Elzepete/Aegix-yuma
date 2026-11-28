import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { base32, codigoTotp, firmarSesion, hashClave, leerSesion, verificarClave, verificarTotp } from './acceso.mjs';
import { createPanelHandler } from './proxy.mjs';
import { crearBitacora, verificarBitacora } from './bitacora.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECRETO = base32(Buffer.from('12345678901234567890')); // vector de prueba del RFC 6238

test('TOTP coincide con el RFC 6238 y no acepta el mismo código dos veces', () => {
  assert.equal(codigoTotp(SECRETO, 1), '287082'); // t = 59 s
  assert.equal(codigoTotp(SECRETO, Math.floor(1111111109 / 30)), '081804');
  const ahora = 59_000;
  const paso = verificarTotp(SECRETO, '287082', ahora);
  assert.equal(paso, 1);
  assert.equal(verificarTotp(SECRETO, '287082', ahora, paso), null);
  assert.equal(verificarTotp(SECRETO, '000000', ahora), null);
});

test('scrypt verifica la contraseña correcta y rechaza otra', async () => {
  const h = await hashClave('clave-de-prueba-larga');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verificarClave('clave-de-prueba-larga', h), true);
  assert.equal(await verificarClave('otra-clave', h), false);
});

test('la sesión firmada no se puede alterar ni usar vencida', () => {
  const s = firmarSesion('k', 'ana', 'auditor', 0);
  assert.deepEqual(leerSesion('k', s, 1000), { usuario: 'ana', rol: 'auditor' });
  assert.equal(leerSesion('otra', s, 1000), null);
  assert.equal(leerSesion('k', s, 9 * 3600 * 1000), null);
  const [datos, firma] = s.split('.');
  const falso = Buffer.from(JSON.stringify({ u: 'ana', r: 'admin', e: 9e15 })).toString('base64url');
  assert.equal(leerSesion('k', `${falso}.${firma}`, 1000), null, datos);
});

test('ingreso con contraseña y código; el auditor no puede resolver casos', async (t) => {
  const usuarios = new Map([['ana', { usuario: 'ana', rol: 'auditor', clave: await hashClave('clave-de-ana-123'), totp: SECRETO }]]);
  const llamadas = [];
  const request = async (url, init) => { llamadas.push([String(url), init]); return new Response('[]', { status: 200 }); };
  const archivo = join(mkdtempSync(join(tmpdir(), 'bitacora-')), 'accesos.jsonl');
  const bitacora = crearBitacora({ archivo });
  const servidor = createServer(createPanelHandler({ engine: new URL('http://127.0.0.1:1'), usuarios, request, bitacora }));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;

  assert.equal((await fetch(`${base}/api/alertas`)).status, 401);
  assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).headers.get('location'), '/ingresar');

  const formulario = (codigo, clave = 'clave-de-ana-123') => fetch(`${base}/ingresar`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ usuario: 'ana', clave, codigo }),
  });
  assert.equal((await formulario(codigoTotp(SECRETO, Math.floor(Date.now() / 30000)), 'mala')).status, 401);
  assert.equal((await formulario('000000')).status, 401);
  const ok = await formulario(codigoTotp(SECRETO, Math.floor(Date.now() / 30000)));
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);

  const sesion = await (await fetch(`${base}/api/sesion`, { headers: { cookie } })).json();
  assert.equal(sesion.rol, 'auditor');
  assert.equal((await fetch(`${base}/api/alertas`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/auditoria/verificar`, { headers: { cookie } })).status, 200);
  const resolver = await fetch(`${base}/api/alertas/${'a'.repeat(64)}/resolucion`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"resolucion":"liberar"}',
  });
  assert.equal(resolver.status, 403);
  assert.ok(!llamadas.some(([u]) => u.includes('/resolucion')));

  // Bitácora: quién entró, qué falló y qué se le negó, sin contraseñas ni códigos; cadena verificable.
  const eventos = (await (await fetch(`${base}/api/accesos`, { headers: { cookie } })).json()).map((e) => e.evento);
  assert.deepEqual(eventos, ['acceso_denegado', 'ingreso', 'ingreso_fallido', 'ingreso_fallido']);
  const texto = readFileSync(archivo, 'utf8');
  assert.doesNotMatch(texto, /clave-de-ana|"codigo"/);
  assert.match(texto, /"motivo":"contraseña"/);
  assert.deepEqual(verificarBitacora(texto), []);
  writeFileSync(archivo, texto.replace('"motivo":"contraseña"', '"motivo":"otro"'));
  assert.deepEqual(verificarBitacora(readFileSync(archivo, 'utf8')), [2]);
});
