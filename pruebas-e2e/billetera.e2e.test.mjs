// Recorre la billetera en un navegador real contra aegix y la consola ya corriendo (docker compose o iniciar.sh).
//   BILLETERA_URL (http://127.0.0.1:3000)  CONSOLA_URL (http://127.0.0.1:4173)  NAVEGADOR (ruta a Chrome/Brave, opcional)
// Sin NTFY_URL la billetera muestra el código en pantalla («SMS simulado»), y de ahí lo lee la prueba.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const BILLETERA = process.env.BILLETERA_URL ?? 'http://127.0.0.1:3000';
const CONSOLA = process.env.CONSOLA_URL ?? 'http://127.0.0.1:4173';
let navegador, pagina;

before(async () => {
  navegador = await chromium.launch(process.env.NAVEGADOR ? { executablePath: process.env.NAVEGADOR } : {});
  pagina = await (await navegador.newContext()).newPage(); // contexto nuevo: localStorage vacío
  await pagina.goto(BILLETERA);
});
after(() => navegador?.close());

const codigoEnPantalla = () => pagina.locator('#sms').getAttribute('data-codigo');
const titulo = () => pagina.locator('h1').first().textContent();
const foco = () => pagina.evaluate(() => document.activeElement.tagName);

test('ingreso en dos pasos: clave y código', async () => {
  await pagina.click('[data-accion="elegir"][data-celular="3000000001"]');
  assert.equal(await pagina.evaluate(() => document.activeElement.id), 'clave', 'el foco salta a la clave');
  await pagina.fill('#clave', '1111');
  await pagina.click('form[data-form="ingreso"] button[type="submit"]');
  await pagina.waitForSelector('form[data-form="dos-pasos"]');
  assert.equal(await titulo(), 'Confirma que eres tú');
  assert.equal(await foco(), 'H1', 'el lector de pantalla anuncia la pantalla nueva');
  await pagina.fill('#codigo', await codigoEnPantalla());
  await pagina.click('form[data-form="dos-pasos"] button[type="submit"]');
  await pagina.waitForSelector('.barra');
  assert.equal((await pagina.locator('h2').first().textContent()).trim(), 'Laura');
});

test('transferencia aprobada por aegix que se confirma con código', async () => {
  await pagina.click('[data-op="enviar_yuma"]');
  await pagina.click('[data-accion="destino"][data-id="3000000002"]');
  await pagina.click('[data-accion="monto"][data-valor="20000"]');
  await pagina.click('form[data-form="operacion"] button[type="submit"]');
  await pagina.waitForSelector('form[data-form="codigo"]');
  assert.equal(await titulo(), 'Confirma la transferencia');
  await pagina.fill('#codigo', '000000');
  await pagina.click('form[data-form="codigo"] button[type="submit"]');
  await pagina.waitForSelector('#codigo[aria-invalid="true"]');
  assert.match(await pagina.locator('#error[role="alert"]').textContent(), /Código incorrecto/);
  await pagina.fill('#codigo', await codigoEnPantalla());
  await pagina.click('form[data-form="codigo"] button[type="submit"]');
  await pagina.waitForFunction(() => document.querySelector('h1')?.textContent === 'Verificada y enviada');
});

test('toma de cuenta: aegix la retiene y aparece en la consola', async () => {
  await pagina.click('[data-accion="ir"][data-vista="inicio"]');
  await pagina.click('[data-vista="seguridad"]');
  await pagina.click('[data-nombre="toma"]');
  await pagina.click('[data-vista="inicio"]');
  await pagina.click('[data-op="enviar_yuma"]');
  await pagina.fill('#destino', '3009990000');
  await pagina.fill('#monto', '300000');
  await pagina.click('form[data-form="operacion"] button[type="submit"]');
  await pagina.waitForFunction(() => document.querySelector('h1')?.textContent === 'Operación en revisión');
  const alertas = await (await fetch(`${CONSOLA}/api/alertas`)).json();
  assert.ok(alertas.some((a) => a.decision === 'retener' && a.origen === 'billetera' && a.entrada?.monto_cop === 300000),
    'la retención de la billetera llega a la consola');
});

test('la consola carga y ofrece su menú de accesibilidad', async () => {
  const consola = await navegador.newPage();
  await consola.goto(CONSOLA);
  await consola.getByRole('button', { name: 'Accesibilidad' }).click();
  assert.equal(await consola.locator('.ajuste').count(), 4);
  await consola.close();
});
