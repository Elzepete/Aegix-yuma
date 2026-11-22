import { CONVENIOS, OPERACIONES, construirSolicitud, estadoPorDecision, limpiarDestino } from './nucleo.js';

// Clientes ficticios de la demostración. Sus datos viven solo en este navegador.
const CLIENTES = [
  { celular: '3000000001', clave: '1111', nombre: 'Laura Restrepo', perfil: 'Cliente habitual · 2 años', departamento: 'Antioquia', antiguedad: 812, saldo: 1850000,
    contactos: [
      { id: '3000000002', nombre: 'Andrés Mejía', op: 'enviar_yuma' },
      { id: 'COM0380', nombre: 'Panadería La Espiga', op: 'pagar_qr' },
      { id: '3000000001', nombre: 'Mi número', op: 'recargar' },
    ] },
  { celular: '3000000002', clave: '2222', nombre: 'Andrés Mejía', perfil: 'Saldo bajo · 1 año', departamento: 'Bogotá D.C.', antiguedad: 365, saldo: 420300,
    contactos: [
      { id: '3000000001', nombre: 'Laura Restrepo', op: 'enviar_yuma' },
      { id: 'COM1022', nombre: 'Tienda Doña Rosa', op: 'pagar_qr' },
      { id: '3000000002', nombre: 'Mi número', op: 'recargar' },
    ] },
  { celular: '3000000003', clave: '3333', nombre: 'Camila Ortiz', perfil: 'Microcomerciante · saldo alto', departamento: 'Valle del Cauca', antiguedad: 1460, saldo: 6200000,
    contactos: [
      { id: '3000000001', nombre: 'Laura Restrepo', op: 'enviar_yuma' },
      { id: '0044105512', nombre: 'Proveedor Textiles SAS', op: 'enviar_banco' },
      { id: '3000000003', nombre: 'Mi número', op: 'recargar' },
    ] },
  { celular: '3000000004', clave: '4444', nombre: 'Julián Pérez', perfil: 'Cuenta nueva · 21 días', departamento: 'Atlántico', antiguedad: 21, saldo: 95000,
    contactos: [{ id: '3000000004', nombre: 'Mi número', op: 'recargar' }] },
];

const SENALES = [
  { clave: 'dispositivoNuevo', titulo: 'Dispositivo nuevo', texto: 'La operación sale de un celular que el cliente acaba de registrar.' },
  { clave: 'cambioSIM', titulo: 'Cambio de SIM (48 h)', texto: 'El operador reportó un cambio de SIM reciente: señal típica de SIM swapping.' },
  { clave: 'cambioClave', titulo: 'Cambio de clave (24 h)', texto: 'La clave de la cuenta cambió hace poco.' },
  { clave: 'tor', titulo: 'Conexión por Tor', texto: 'La petición llega desde un nodo de salida Tor.' },
  { clave: 'proxy', titulo: 'VPN o centro de datos', texto: 'La IP pertenece a un proxy o a un proveedor de nube.' },
  { clave: 'exterior', titulo: 'Conexión desde el exterior', texto: 'La IP está fuera de Colombia (se envía país US).' },
];

const ESCENARIOS = {
  normal: {},
  sim: { cambioSIM: true, cambioClave: true },
  toma: { tor: true, dispositivoNuevo: true, cambioSIM: true },
};

const ICONOS = {
  enviar: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
  celular: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  servicios: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  banco: '<path d="M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18"/>',
  escudo: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
  ok: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  candado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  casa: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  atras: '<path d="M15 6l-6 6 6 6"/>',
};
const icono = (n, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICONOS[n]}</svg>`;
const MARCA_AEGIX = '<svg class="aegix-marca-svg" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="3.5" stroke-dasharray="57 82" transform="rotate(135 16 16)"/><circle cx="16" cy="16" r="4.5" fill="currentColor"/></svg>';
function dial(puntaje, color) {
  const r = 21, largo = 2 * Math.PI * r, valor = Math.round(puntaje * 100);
  return `<svg class="dial" viewBox="0 0 52 52" role="img" aria-label="Riesgo ${valor} de 100"><circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--linea)" stroke-width="5"/>${valor ? `<circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${largo * Math.min(1, puntaje)} ${largo}" transform="rotate(-90 26 26)"/>` : ''}<text x="26" y="32" text-anchor="middle">${valor}</text></svg>`;
}
const ICONO_OP = { enviar_yuma: 'enviar', enviar_banco: 'banco', pagar_qr: 'qr', recargar: 'celular', servicios: 'servicios' };

const ETIQUETA = {
  completada: 'Completada', verificada: 'Verificada', retenida: 'En revisión', rechazada: 'Rechazada',
  cancelada: 'Cancelada', error: 'No autorizada', desafio: 'Esperando código',
  liberada: 'Aprobada por analista', bloqueada: 'Bloqueada por fraude',
};

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const telefono = (c) => c.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
const iniciales = (n) => n.split(' ').map((p) => p[0]).slice(0, 2).join('');
const azar = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

// ---------- Estado (localStorage, solo conveniencia de la demo) ----------
const CLAVE = 'yuma.billetera.v2';
function inicial() {
  return {
    version: 2,
    usuarios: Object.fromEntries(CLIENTES.map((c) => [c.celular, { ...structuredClone(c), movimientos: [], senales: {} }])),
    dispositivo: `D${azar(4)}`,
    sesion: null,
    ocultarSaldo: false,
  };
}
function cargar() {
  try {
    const e = JSON.parse(localStorage.getItem(CLAVE));
    if (e?.version === 2) {
      // Un desafío sin resolver al recargar la página se da por cancelado.
      Object.values(e.usuarios).forEach((u) => u.movimientos.forEach((m) => { if (m.estado === 'desafio') m.estado = 'cancelada'; }));
      return e;
    }
  } catch { /* almacenamiento bloqueado o dañado: se empieza de cero */ }
  return inicial();
}
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* modo privado */ }
}

let estado = cargar();
let vista = { nombre: estado.sesion ? 'inicio' : 'ingreso' };
let saludAegix = 'cargando';
const app = document.getElementById('app');
const usuario = () => estado.usuarios[estado.sesion];

function ir(nombre, datos = {}) {
  vista = { nombre, ...datos };
  pintar();
  window.scrollTo(0, 0);
}

function consultarSalud() {
  fetch('/api/autorizar')
    .then((r) => r.json())
    .then((d) => { saludAegix = d.aegix; })
    .catch(() => { saludAegix = 'no_disponible'; })
    .finally(() => { if (vista.nombre === 'inicio') pintar(); });
}

// ---------- Vistas ----------
const marca = `<div class="marca"><div class="marca-logo"><svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><path d="M14 12l18 22 18-22M32 34v20" stroke="#FFB627" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div><span class="marca-nombre">yuma</span></div>`;

function vIngreso() {
  const elegido = vista.celular ?? '';
  return `
    <section class="ingreso-hero">
      ${marca}
      <h1>Tu plata, <em>protegida</em> antes de salir.</h1>
      <p class="suave">Cada operación pasa por aegix, que decide en milisegundos si es segura.</p>
    </section>
    <h2>Elige un cliente de prueba</h2>
    <div class="cuentas">
      ${CLIENTES.map((c) => `
        <button class="cuenta" data-accion="elegir" data-celular="${c.celular}" aria-pressed="${c.celular === elegido}">
          <span class="avatar">${iniciales(c.nombre)}</span>
          <span class="cuenta-datos"><b>${esc(c.nombre)}</b><span class="suave pequeno">${telefono(c.celular)} · ${esc(c.perfil)}</span></span>
          <span class="clave-pista">Clave ${c.clave}</span>
        </button>`).join('')}
    </div>
    <form data-form="ingreso" novalidate>
      <div class="campo">
        <label for="celular">Celular</label>
        <input class="entrada" id="celular" name="celular" inputmode="numeric" autocomplete="off" value="${elegido ? telefono(elegido) : ''}" placeholder="300 000 0001">
      </div>
      <div class="campo">
        <label for="clave">Clave de 4 dígitos</label>
        <input class="entrada" id="clave" name="clave" type="password" inputmode="numeric" maxlength="4" autocomplete="off">
      </div>
      <p class="error" id="error">${esc(vista.error ?? '')}</p>
      <button class="boton" type="submit">Ingresar</button>
    </form>`;
}

function senalesActivas() {
  return SENALES.filter((s) => usuario().senales[s.clave]).map((s) => s.titulo);
}

function vMovimiento(m) {
  const salida = ['completada', 'verificada', 'liberada'].includes(m.estado);
  return `
    <li><button class="mov" data-accion="detalle" data-id="${esc(m.id)}">
      <span class="mov-icono">${icono(ICONO_OP[m.clave])}</span>
      <span class="mov-datos"><b>${esc(m.nombre || m.destino)}</b><span class="suave pequeno">${OPERACIONES[m.clave].titulo}, ${new Date(m.fecha).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</span></span>
      <span class="mov-monto"><span class="${salida ? '' : 'tachado'}">−${cop.format(m.monto)}</span><small class="estado-${m.estado}">${ETIQUETA[m.estado]}</small></span>
    </button></li>`;
}

function porDia(movimientos) {
  const dia = (t) => new Date(t).toDateString();
  const hoy = dia(Date.now()), ayer = dia(Date.now() - 864e5);
  const grupos = [];
  for (const m of movimientos) {
    const d = dia(m.fecha);
    if (grupos.at(-1)?.d !== d) grupos.push({ d, fecha: m.fecha, items: [] });
    grupos.at(-1).items.push(m);
  }
  return grupos.map((g) => `<h4 class="dia">${g.d === hoy ? 'Hoy' : g.d === ayer ? 'Ayer' : new Date(g.fecha).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
    <ul class="lista">${g.items.map(vMovimiento).join('')}</ul>`).join('');
}

function vInicio() {
  const u = usuario();
  const activas = senalesActivas();
  const textoSalud = { cargando: 'Conectando…', en_linea: 'aegix protegiendo', no_disponible: 'aegix sin conexión', sin_configurar: 'aegix sin configurar' }[saludAegix];
  return `
    <header class="cabecera">
      <div><span class="suave pequeno">Hola,</span><h2>${esc(u.nombre.split(' ')[0])}</h2></div>
      <span class="pastilla ${saludAegix}">${MARCA_AEGIX}${textoSalud}</span>
    </header>
    <section class="saldo" aria-label="Saldo disponible">
      <svg class="saldo-marca" viewBox="0 0 64 64" aria-hidden="true"><path d="M14 12l18 22 18-22M32 34v20" stroke="currentColor" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="suave pequeno">Saldo disponible</span>
      <div class="saldo-cifra">${estado.ocultarSaldo ? '$ •••••' : cop.format(u.saldo)}</div>
      <span class="suave pequeno">Cuenta ${telefono(u.celular)}</span>
      <button class="ojo" data-accion="ocultar">${estado.ocultarSaldo ? 'Mostrar' : 'Ocultar'}</button>
    </section>
    <nav class="acciones" aria-label="Operaciones">
      <button class="accion" data-accion="operar" data-op="enviar_yuma">${icono('enviar')}Enviar</button>
      <button class="accion" data-accion="operar" data-op="pagar_qr">${icono('qr')}Pagar QR</button>
      <button class="accion" data-accion="operar" data-op="recargar">${icono('celular')}Recargar</button>
      <button class="accion" data-accion="operar" data-op="servicios">${icono('servicios')}Servicios</button>
    </nav>
    ${activas.length ? `<button class="aviso-riesgo" data-accion="ir" data-vista="seguridad">${icono('candado', 'width="20" height="20"')}<span>Simulación de riesgo activa: ${esc(activas.join(', '))}</span></button>` : ''}
    <h3>Movimientos</h3>
    ${u.movimientos.length
      ? porDia(u.movimientos)
      : '<p class="vacio">Aún no hay movimientos. Haz tu primer envío.</p>'}`;
}

function vOperacion() {
  const u = usuario();
  const op = vista.op;
  const esEnvio = op === 'enviar_yuma' || op === 'enviar_banco';
  const contactos = op === 'servicios' ? CONVENIOS : u.contactos.filter((c) => c.op === op);
  const etiquetaDestino = { enviar_yuma: 'Celular o llave Yuma', enviar_banco: 'Cuenta o llave del otro banco', pagar_qr: 'Código del comercio', recargar: 'Número a recargar', servicios: 'Referencia del servicio' }[op];
  return `
    <button class="volver" data-accion="ir" data-vista="inicio">${icono('atras', 'width="18" height="18"')}Inicio</button>
    <h1>${OPERACIONES[op].titulo}</h1>
    ${esEnvio ? `<div class="segmentos" role="group" aria-label="Destino">
      <button type="button" data-accion="operar" data-op="enviar_yuma" aria-pressed="${op === 'enviar_yuma'}">A Yuma</button>
      <button type="button" data-accion="operar" data-op="enviar_banco" aria-pressed="${op === 'enviar_banco'}">Otro banco</button>
    </div>` : ''}
    <form data-form="operacion" novalidate>
      <div class="campo">
        <label for="destino">${etiquetaDestino}</label>
        <input class="entrada" id="destino" name="destino" autocomplete="off" ${['pagar_qr', 'servicios'].includes(op) ? '' : 'inputmode="numeric"'} value="${esc(vista.destino ?? '')}" placeholder="${{ pagar_qr: 'COM0380', servicios: 'Elige un convenio', enviar_banco: '0012345678' }[op] ?? '300 123 4567'}">
        ${contactos.length ? `<div class="fichas">${contactos.map((c) => `<button type="button" class="ficha" data-accion="destino" data-id="${esc(c.id)}">${esc(c.nombre)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="campo">
        <label for="monto">Monto</label>
        <input class="entrada entrada-monto" id="monto" name="monto" inputmode="numeric" autocomplete="off" value="${vista.monto ? cop.format(vista.monto) : ''}" placeholder="$ 0">
        <div class="fichas">${[20000, 50000, 200000, 1000000].map((v) => `<button type="button" class="ficha" data-accion="monto" data-valor="${v}">${cop.format(v)}</button>`).join('')}
          <button type="button" class="ficha" data-accion="monto" data-valor="${u.saldo}">Todo</button></div>
        <span class="suave pequeno">Disponible: ${cop.format(u.saldo)}</span>
      </div>
      <p class="error" id="error">${esc(vista.error ?? '')}</p>
      <button class="boton" type="submit">${icono('escudo', 'width="18" height="18"')}Continuar</button>
    </form>`;
}

const vAutorizando = () => `
  <div class="cargando">
    <div class="escudo-pulso">${icono('escudo', 'width="40" height="40" style="color:#FFB627"')}</div>
    <h2>aegix está verificando</h2>
    <p class="suave">Revisamos el origen, tu dispositivo y tu historial antes de mover la plata.</p>
  </div>`;

function vDecision(m) {
  const d = m.decision;
  if (!d) return `<div class="tarjeta"><b>aegix no respondió</b><p class="suave pequeno">${esc(m.motivo || 'Sin respuesta')}. Por seguridad no se movió dinero.</p></div>`;
  const color = { aprobar: 'var(--ok)', desafiar: 'var(--alerta)', retener: 'var(--peligro)', rechazar: 'var(--peligro)' }[d.decision];
  return `
    <div class="tarjeta">
      <div class="aegix-cabecera">
        ${dial(d.puntaje, color)}
        <div><span class="aegix-marca">${MARCA_AEGIX}Verificado por aegix</span><b style="color:${color}">${{ aprobar: 'Aprobada', desafiar: 'Pide verificación', retener: 'Retenida para revisión', rechazar: 'Rechazada' }[d.decision]}</b></div>
      </div>
      <ul class="razones">${(d.razones || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <div class="datos-tecnicos">
        <span>aegix ${Number(d.latencia_ms).toFixed(1)} ms</span>
        <span>ida y vuelta ${m.idaVueltaMs} ms</span>
        ${d.version_reglas ? `<span>reglas ${esc(d.version_reglas)}</span>` : ''}
        <span>${esc(m.id)}</span>
      </div>
    </div>`;
}

const TEXTO_RESULTADO = {
  completada: ['ok', '¡Listo! Plata enviada', 'aegix aprobó la operación sin pasos extra.'],
  verificada: ['ok', 'Verificada y enviada', 'Confirmaste tu identidad con el código.'],
  desafio: ['candado', 'Confirma que eres tú', 'aegix pide una verificación adicional antes de enviar.'],
  retenida: ['reloj', 'Operación en revisión', 'La plata no salió. Un analista la revisará y te avisaremos aquí mismo.'],
  liberada: ['ok', 'Un analista aprobó tu envío', 'Revisamos la operación y la plata ya salió.'],
  bloqueada: ['x', 'Operación bloqueada', 'Un analista confirmó que no era segura y la plata no salió. Si no la hiciste tú, cambia tu clave.'],
  rechazada: ['x', 'Operación rechazada', 'No se movió dinero.'],
  cancelada: ['x', 'Operación cancelada', 'No se movió dinero.'],
  error: ['x', 'No pudimos verificarla', 'Por seguridad no se movió dinero. Intenta de nuevo.'],
};

function vResultado() {
  const m = usuario().movimientos.find((x) => x.id === vista.id);
  const [ic, titulo, texto] = TEXTO_RESULTADO[m.estado];
  return `
    <section class="resultado">
      <div class="sello ${m.estado}">${icono(ic)}</div>
      <h1>${titulo}</h1>
      <div class="resultado-monto">${cop.format(m.monto)}</div>
      <p class="suave">${esc(m.nombre || m.destino)} · ${OPERACIONES[m.clave].titulo}</p>
      <p>${texto}</p>
    </section>
    ${m.estado === 'desafio' ? `
      <form class="tarjeta" data-form="codigo" novalidate>
        <label for="codigo"><b>Código de 6 dígitos</b></label>
        <p class="suave pequeno">Te lo enviamos por SMS (simulado, arriba de la pantalla).</p>
        <div class="codigo"><input class="entrada" id="codigo" name="codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <p class="error" id="error">${esc(vista.error ?? '')}</p>
        <div class="pila"><button class="boton" type="submit">Confirmar</button>
        <button class="boton boton-sec" type="button" data-accion="cancelar-desafio">Cancelar operación</button></div>
      </form>` : ''}
    ${vDecision(m)}
    ${m.estado !== 'desafio' ? '<button class="boton" data-accion="ir" data-vista="inicio">Volver al inicio</button>' : ''}`;
}

function vSeguridad() {
  return `
    <h1>Seguridad</h1>
    <p class="suave">Activa señales para ver cómo responde aegix. Son simuladas, solo afectan a ${esc(usuario().nombre.split(' ')[0])} y se envían con la siguiente operación.</p>
    <div class="tarjeta">
      <h3>Escenarios rápidos</h3>
      <div class="escenarios">
        <button class="ficha" data-accion="escenario" data-nombre="normal">Todo normal</button>
        <button class="ficha" data-accion="escenario" data-nombre="sim">SIM swapping</button>
        <button class="ficha" data-accion="escenario" data-nombre="toma">Toma de cuenta</button>
      </div>
      <p class="suave pequeno">«SIM swapping» pide código con un contacto y retiene con un número nuevo. «Toma de cuenta» retiene cualquier envío; en recargas y pagos de servicios solo pide código.</p>
    </div>
    <div class="tarjeta">
      ${SENALES.map((s) => `
        <label class="interruptor">
          <span class="interruptor-texto"><b>${s.titulo}</b><span class="suave pequeno">${s.texto}</span></span>
          <input type="checkbox" role="switch" data-senal="${s.clave}" ${usuario().senales[s.clave] ? 'checked' : ''}>
        </label>`).join('')}
    </div>
    <p class="suave pequeno">Huella de este dispositivo: ${esc(estado.dispositivo)}</p>
    <div class="pila">
      <button class="boton boton-sec" data-accion="salir">Cerrar sesión</button>
      <button class="boton boton-peligro" data-accion="restablecer">Restablecer la demo</button>
    </div>`;
}

function vBarra() {
  const actual = vista.nombre === 'seguridad' ? 'seguridad' : 'inicio';
  return `<nav class="barra" aria-label="Principal">
    <button data-accion="ir" data-vista="inicio" ${actual === 'inicio' ? 'aria-current="page"' : ''}>${icono('casa')}Inicio</button>
    <button data-accion="ir" data-vista="seguridad" ${actual === 'seguridad' ? 'aria-current="page"' : ''}>${icono('escudo')}Seguridad</button>
  </nav>`;
}

function pintar() {
  const vistas = { ingreso: vIngreso, inicio: vInicio, operacion: vOperacion, autorizando: vAutorizando, resultado: vResultado, seguridad: vSeguridad };
  const conBarra = ['inicio', 'seguridad'].includes(vista.nombre);
  app.innerHTML = vistas[vista.nombre]() + (conBarra ? vBarra() : '');
}

// ---------- Acciones ----------
const soloDigitos = (t) => String(t).replace(/\D/g, '');

async function autorizar(op) {
  const u = usuario();
  const id = `YW${Date.now().toString(36).toUpperCase()}${azar(2)}`;
  let solicitud;
  try {
    solicitud = construirSolicitud(u, op, u.senales, { id, dispositivo: estado.dispositivo, agente: navigator.userAgent, ahora: new Date() });
  } catch (e) {
    return ir('operacion', { ...op, op: op.clave, error: e.message });
  }
  ir('autorizando');
  const inicio = performance.now();
  let respuesta = {};
  try {
    const r = await fetch('/api/autorizar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(solicitud) });
    respuesta = await r.json();
  } catch {
    respuesta = { error: 'sin conexión con el servidor de la billetera' };
  }
  const valida = ['aprobar', 'desafiar', 'retener', 'rechazar'].includes(respuesta.decision) && respuesta.id_transaccion === id;
  const contacto = [...u.contactos, ...CONVENIOS].find((c) => c.id === solicitud.transaccion.id_destino);
  const m = {
    id, clave: op.clave, destino: solicitud.transaccion.id_destino, nombre: contacto?.nombre ?? '',
    monto: op.monto, fecha: Date.now(), idaVueltaMs: Math.round(performance.now() - inicio),
    estado: valida ? estadoPorDecision(respuesta.decision) : 'error',
    decision: valida ? respuesta : null,
    motivo: valida ? '' : respuesta.error || 'respuesta inesperada',
  };
  if (m.estado === 'completada') u.saldo -= m.monto;
  if (m.estado === 'desafio') enviarCodigo(m);
  u.movimientos.unshift(m);
  guardar();
  ir('resultado', { id });
}

function enviarCodigo(m) {
  m.codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
  m.intentos = 0;
  const sms = document.getElementById('sms');
  sms.innerHTML = `<b>Yuma</b> · Tu código para autorizar ${cop.format(m.monto)} es <b>${m.codigo}</b>. No lo compartas con nadie.`;
  sms.hidden = false;
  clearTimeout(enviarCodigo.t);
  enviarCodigo.t = setTimeout(() => { sms.hidden = true; }, 15000);
}

function cerrarDesafio(m, estadoFinal) {
  m.estado = estadoFinal;
  delete m.codigo;
  if (estadoFinal === 'verificada') usuario().saldo -= m.monto;
  document.getElementById('sms').hidden = true;
  guardar();
  ir('resultado', { id: m.id });
}

function mostrarDetalle(id) {
  const m = usuario().movimientos.find((x) => x.id === id);
  const hoja = document.getElementById('detalle');
  hoja.innerHTML = `
    <h2 id="detalle-titulo">${esc(m.nombre || m.destino)}</h2>
    <p class="suave">${OPERACIONES[m.clave].titulo} · ${cop.format(m.monto)} · <b class="estado-${m.estado}">${ETIQUETA[m.estado]}</b></p>
    ${vDecision(m)}
    <form method="dialog"><button class="boton">Cerrar</button></form>`;
  hoja.showModal();
}

app.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-accion]');
  if (!b) return;
  const d = b.dataset;
  const form = app.querySelector('form[data-form="operacion"]');
  const borrador = form ? { destino: form.destino.value, monto: Number(soloDigitos(form.monto.value)) || 0 } : {};
  switch (d.accion) {
    case 'elegir': return ir('ingreso', { celular: d.celular });
    case 'ir': return ir(d.vista);
    case 'operar': return ir('operacion', { op: d.op, ...borrador });
    case 'destino': return ir('operacion', { ...vista, ...borrador, destino: d.id, error: '' });
    case 'monto': return ir('operacion', { ...vista, ...borrador, monto: Number(d.valor), error: '' });
    case 'ocultar': estado.ocultarSaldo = !estado.ocultarSaldo; guardar(); return pintar();
    case 'detalle': return mostrarDetalle(d.id);
    case 'escenario': usuario().senales = { ...ESCENARIOS[d.nombre] }; guardar(); return pintar();
    case 'cancelar-desafio': return cerrarDesafio(usuario().movimientos.find((x) => x.id === vista.id), 'cancelada');
    case 'salir': estado.sesion = null; guardar(); return ir('ingreso');
    case 'restablecer':
      if (confirm('¿Restablecer saldos, movimientos y señales de todos los clientes de prueba?')) {
        try { localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
        estado = inicial();
        ir('ingreso');
      }
  }
});

app.addEventListener('change', (ev) => {
  const s = ev.target.dataset.senal;
  if (s) { usuario().senales[s] = ev.target.checked; guardar(); }
});

app.addEventListener('input', (ev) => {
  if (ev.target.id === 'monto') {
    const n = Number(soloDigitos(ev.target.value));
    ev.target.value = n ? cop.format(n) : '';
  }
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.dataset.form === 'ingreso') {
    const cel = soloDigitos(f.celular.value);
    const u = estado.usuarios[cel];
    if (!u || u.clave !== f.clave.value) return ir('ingreso', { celular: cel, error: 'Celular o clave incorrectos.' });
    estado.sesion = cel;
    guardar();
    consultarSalud();
    return ir('inicio');
  }
  if (f.dataset.form === 'operacion') {
    return autorizar({ clave: vista.op, destino: limpiarDestino(f.destino.value), monto: Number(soloDigitos(f.monto.value)) });
  }
  if (f.dataset.form === 'codigo') {
    const m = usuario().movimientos.find((x) => x.id === vista.id);
    if (f.codigo.value.trim() === m.codigo) return cerrarDesafio(m, 'verificada');
    m.intentos += 1;
    if (m.intentos >= 3) return cerrarDesafio(m, 'cancelada');
    return ir('resultado', { id: m.id, error: `Código incorrecto. Te quedan ${3 - m.intentos} intentos.` });
  }
});

// Revisa si un analista resolvió alguna retención. revisando evita que dos rondas descuenten dos veces.
let revisando = false;
async function revisarRetenidas() {
  if (revisando) return;
  const pendientes = Object.values(estado.usuarios).flatMap((u) => u.movimientos.filter((m) => m.estado === 'retenida').map((m) => [u, m]));
  if (!pendientes.length) return;
  revisando = true;
  let cambio = false;
  try {
    await Promise.all(pendientes.map(async ([u, m]) => {
      let respuesta;
      try {
        const r = await fetch(`/api/autorizar?id=${encodeURIComponent(m.id)}`, { cache: 'no-store' });
        if (!r.ok) return;
        respuesta = await r.json();
      } catch { return; }
      if (m.estado !== 'retenida') return;
      if (respuesta.estado === 'liberada') {
        if (u.saldo < m.monto) {
          m.estado = 'rechazada';
          m.motivo = 'El analista liberó la operación, pero ya no había saldo suficiente.';
        } else {
          u.saldo -= m.monto;
          m.estado = 'liberada';
        }
      } else if (respuesta.estado === 'fraude_confirmado') {
        m.estado = 'bloqueada';
      } else return;
      cambio = true;
      if (u.celular === estado.sesion) avisar(m.estado === 'liberada'
        ? `Un analista aprobó tu envío de ${cop.format(m.monto)}. La plata ya salió.`
        : `Bloqueamos tu envío de ${cop.format(m.monto)} por seguridad. Si no lo hiciste tú, cambia tu clave.`);
    }));
  } finally {
    revisando = false;
  }
  if (cambio) {
    guardar();
    if (['inicio', 'resultado'].includes(vista.nombre)) pintar();
  }
}

function avisar(texto) {
  const sms = document.getElementById('sms');
  sms.innerHTML = `<b>Yuma</b> · ${esc(texto)}`;
  sms.hidden = false;
  clearTimeout(enviarCodigo.t);
  enviarCodigo.t = setTimeout(() => { sms.hidden = true; }, 8000);
}

setInterval(revisarRetenidas, 4000);
if (estado.sesion) consultarSalud();
pintar();
