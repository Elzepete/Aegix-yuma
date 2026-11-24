import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { CONTACTOS, construirSolicitud, fechaColombia, estadoPorDecision, razonFacil, validarDestino } from './nucleo.js';

const laura = {
  celular: '3000000001', departamento: 'Antioquia', antiguedad: 812, saldo: 1850000,
  contactos: [{ id: '3000000002', nombre: 'Andrés', op: 'enviar_yuma' }], movimientos: [],
};
const entorno = { id: 'YW1', dispositivo: 'DABCD', agente: 'Mozilla/5.0 (Linux; Android 14)', ahora: new Date('2026-07-15T19:32:10Z') };

test('fecha en hora de Colombia (UTC-5)', () => {
  assert.equal(fechaColombia(new Date('2026-07-15T03:00:00Z')), '2026-07-14 22:00:00');
});

test('solicitud habitual: contacto conocido y sin señales', () => {
  const s = construirSolicitud(laura, { clave: 'enviar_yuma', destino: ' 3000000002 ', monto: 50000 }, {}, entorno);
  assert.equal(s.transaccion.fecha_hora, '2026-07-15 14:32:10');
  assert.equal(s.transaccion.id_destino, '3000000002');
  assert.equal(s.transaccion.destino_nuevo, 0);
  assert.equal(s.transaccion.tipo_operacion, 'transferencia_inmediata');
  assert.equal(s.transaccion.saldo_antes_cop, 1850000);
  assert.equal(s.contexto.sistema_operativo, 'Android');
  assert.equal(s.contexto.pais_ip, undefined, 'el servidor completa el país real');
});

test('toma de cuenta: señales simuladas llegan a aegix', () => {
  const senales = { tor: true, dispositivoNuevo: true, cambioSIM: true, exterior: true };
  const s = construirSolicitud(laura, { clave: 'pagar_qr', destino: 'COM9999', monto: 1800000 }, senales, entorno);
  assert.equal(s.transaccion.destino_nuevo, 1);
  assert.equal(s.transaccion.dispositivo_nuevo, 1);
  assert.equal(s.transaccion.cambio_sim_48h, 1);
  assert.notEqual(s.transaccion.id_dispositivo, 'DABCD');
  assert.equal(s.contexto.huella_dispositivo, s.transaccion.id_dispositivo);
  assert.deepEqual([s.contexto.es_tor, s.contexto.pais_ip], [true, 'US']);
});

test('valida monto y saldo antes de llamar a aegix', () => {
  assert.throws(() => construirSolicitud(laura, { clave: 'enviar_yuma', destino: '3001112233', monto: 0 }, {}, entorno), /monto/);
  assert.throws(() => construirSolicitud(laura, { clave: 'enviar_yuma', destino: '3001112233', monto: 9e9 }, {}, entorno), /saldo/i);
  assert.throws(() => construirSolicitud(laura, { clave: 'enviar_yuma', destino: '  ', monto: 10 }, {}, entorno), /destino/);
});

test('el destino debe tener el formato de cada operación', () => {
  const casos = [
    ['enviar_yuma', 'hola', false], ['enviar_yuma', '12345', false], ['enviar_yuma', '2001234567', false],
    ['enviar_yuma', '3001234567', true], ['enviar_yuma', '3000000001', false], // el propio número
    ['recargar', '3000000001', true], ['enviar_banco', '00123456', true], ['enviar_banco', 'abc123', false],
    ['pagar_qr', 'COM0380', true], ['pagar_qr', 'COM1', false], ['servicios', 'SRV-EPM', true], ['servicios', 'SRV-XXX', false],
  ];
  for (const [clave, destino, ok] of casos) {
    assert.equal(validarDestino(clave, destino, '3000000001') === '', ok, `${clave} ${destino}`);
  }
});

test('estado por decisión', () => {
  assert.deepEqual(['aprobar', 'desafiar', 'retener', 'rechazar', '??'].map(estadoPorDecision),
    ['completada', 'desafio', 'retenida', 'rechazada', 'error']);
});

test('la función de Vercel reenvía a aegix con IP, país y clave', async (t) => {
  let recibido;
  const falso = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (p) => { cuerpo += p; });
    req.on('end', () => {
      recibido = { ruta: req.url, auth: req.headers.authorization, cuerpo: cuerpo && JSON.parse(cuerpo) };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_transaccion: 'YW1', decision: 'aprobar', puntaje: 0, razones: [] }));
    });
  }).listen(0);
  t.after(() => falso.close());
  await new Promise((r) => falso.once('listening', r));
  process.env.AEGIX_URL = `http://127.0.0.1:${falso.address().port}/`;
  process.env.AEGIX_TOKEN = 'secreto';
  const { POST, GET } = await import('./api/autorizar.js');

  const s = construirSolicitud(laura, { clave: 'enviar_yuma', destino: '3000000002', monto: 1000 }, {}, entorno);
  const r = await POST(new Request('http://x/api/autorizar', {
    method: 'POST', body: JSON.stringify(s),
    headers: { 'x-forwarded-for': '181.50.1.2, 10.0.0.1', 'x-vercel-ip-country': 'CO' },
  }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).decision, 'aprobar');
  assert.equal(recibido.ruta, '/v1/autorizar');
  assert.equal(recibido.auth, 'Bearer secreto');
  assert.deepEqual([recibido.cuerpo.contexto.ip, recibido.cuerpo.contexto.pais_ip], ['181.50.1.2', 'CO']);

  assert.equal((await POST(new Request('http://x', { method: 'POST', body: '{' }))).status, 400);
  assert.equal((await (await GET(new Request('http://x/api/autorizar'))).json()).aegix, 'en_linea');
  const estado = await GET(new Request('http://x/api/autorizar?id=YWABC123'));
  assert.equal(estado.status, 200);
  assert.equal(recibido.ruta, '/v1/autorizar/YWABC123');
  assert.equal((await GET(new Request('http://x/api/autorizar?id=../salud'))).status, 400);

  process.env.AEGIX_URL = 'http://127.0.0.1:1';
  assert.equal((await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(s) }))).status, 504);
});

test('accesibilidad: las preferencias viajan a aegix solo si el cliente las eligió', () => {
  const op = { clave: 'enviar_yuma', destino: '3000000002', monto: 50000 };
  assert.equal(construirSolicitud(laura, op, {}, entorno).contexto.accesibilidad, undefined);
  const s = construirSolicitud(laura, op, {}, { ...entorno, accesibilidad: { contacto: 'llamada', lectura_facil: true, apoyo_de_confianza: false } });
  assert.deepEqual(s.contexto.accesibilidad, { contacto: 'llamada', lectura_facil: true });
  assert.equal(construirSolicitud(laura, op, {}, { ...entorno, accesibilidad: { contacto: '', lectura_facil: false, apoyo_de_confianza: false } }).contexto.accesibilidad, undefined);
  assert.throws(() => construirSolicitud(laura, op, {}, { ...entorno, accesibilidad: { contacto: 'fax' } }), /contacto/);
  assert.deepEqual(Object.keys(CONTACTOS), ['sms', 'llamada', 'videollamada_lsc', 'chat'], 'los mismos canales que valida aegix');
});

test('lectura fácil: cada razón de reglas.yaml tiene su versión sencilla', () => {
  const razones = [...readFileSync(new URL('../config/reglas.yaml', import.meta.url), 'utf8').matchAll(/razon: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(razones.length >= 10);
  for (const r of [...razones, 'ninguna regla de riesgo se activó', 'operación de bajo riesgo: se verifica la identidad en lugar de retener']) {
    assert.notEqual(razonFacil(r), r, `falta la versión fácil de «${r}»`);
  }
  assert.equal(razonFacil('algo nuevo'), 'algo nuevo', 'una razón desconocida se muestra tal cual');
});
