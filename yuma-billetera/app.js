import { CONTACTOS, CONVENIOS, OPERACIONES, construirSolicitud, estadoPorDecision, limpiarDestino, razonFacil } from './nucleo.js';

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
  persona: '<circle cx="12" cy="4.5" r="2"/><path d="M5 8.5l7 1.5 7-1.5M12 10v4.5m0 0L9 21m3-6.5l3 6.5"/>',
  altavoz: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>',
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
    usuarios: Object.fromEntries(CLIENTES.map((c) => [c.celular, { ...structuredClone(c), movimientos: [], senales: {}, preferencias: { contacto: '', apoyo: false } }])),
    dispositivo: `D${azar(4)}`,
    sesion: null,
    ocultarSaldo: false,
    accesibilidad: { ...SIN_AJUSTES },
  };
}
// Ajustes de este dispositivo; las preferencias de contacto son de cada cliente (usuario.preferencias).
const SIN_AJUSTES = { texto: false, contraste: false, facil: false, voz: false };
function cargar() {
  try {
    const e = JSON.parse(localStorage.getItem(CLAVE));
    if (e?.version === 2) {
      // Un desafío sin resolver al recargar la página se da por cancelado.
      Object.values(e.usuarios).forEach((u) => u.movimientos.forEach((m) => { if (m.estado === 'desafio') m.estado = 'cancelada'; }));
      e.accesibilidad = { ...SIN_AJUSTES, ...e.accesibilidad };
      Object.values(e.usuarios).forEach((u) => { u.preferencias ??= { contacto: '', apoyo: false }; });
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

// Al cambiar de pantalla el foco va al título, para que el lector de pantalla la anuncie; si hay un error, al campo.
function ir(nombre, datos = {}) {
  const misma = vista.nombre === nombre;
  vista = { nombre, ...datos };
  pintar();
  if (vista.error) return app.querySelector('[aria-invalid="true"]')?.focus();
  if (misma) return;
  window.scrollTo(0, 0);
  const titulo = app.querySelector('h1, h2');
  titulo?.setAttribute('tabindex', '-1');
  titulo?.focus({ preventScroll: true });
}

const ajustes = () => estado.accesibilidad;
const facil = (normal, sencillo) => (ajustes().facil ? sencillo : normal);
// El atributo que une un campo con el mensaje de error, y lo marca inválido cuando el error es suyo.
const invalido = (campo) => `aria-describedby="error"${vista.error && vista.campo === campo ? ' aria-invalid="true"' : ''}`;
const mensajeError = () => `<p class="error" id="error" ${vista.error ? 'role="alert"' : ''}>${esc(vista.error ?? '')}</p>`;

function hablar(texto) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const voz = new SpeechSynthesisUtterance(texto);
  voz.lang = 'es-CO';
  voz.rate = 0.9;
  speechSynthesis.speak(voz);
}
const digitos = (codigo) => codigo.split('').join(', ');

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
      <div class="ingreso-arriba">${marca}<button class="enlace" data-accion="ir" data-vista="accesibilidad">${icono('persona', 'width="18" height="18"')}Accesibilidad</button></div>
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
        <input class="entrada" id="celular" name="celular" inputmode="numeric" autocomplete="off" ${invalido('celular')} value="${elegido ? telefono(elegido) : ''}" placeholder="300 000 0001">
      </div>
      <div class="campo">
        <label for="clave">Clave de 4 dígitos</label>
        <input class="entrada" id="clave" name="clave" type="password" inputmode="numeric" maxlength="4" autocomplete="off" ${invalido('clave')}>
      </div>
      ${mensajeError()}
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
      <span class="mov-monto"><span class="${salida ? '' : 'tachado'}">−${cop.format(m.monto)}${salida ? '' : '<span class="sr-only"> (no salió)</span>'}</span><small class="estado-${m.estado}">${ETIQUETA[m.estado]}</small></span>
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
      <button class="ojo" data-accion="ocultar" aria-label="${estado.ocultarSaldo ? 'Mostrar' : 'Ocultar'} saldo">${estado.ocultarSaldo ? 'Mostrar' : 'Ocultar'}</button>
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
        <input class="entrada" id="destino" name="destino" autocomplete="off" ${invalido('destino')} ${['pagar_qr', 'servicios'].includes(op) ? '' : 'inputmode="numeric"'} value="${esc(vista.destino ?? '')}" placeholder="${{ pagar_qr: 'COM0380', servicios: 'Elige un convenio', enviar_banco: '0012345678' }[op] ?? '300 123 4567'}">
        ${contactos.length ? `<div class="fichas">${contactos.map((c) => `<button type="button" class="ficha" data-accion="destino" data-id="${esc(c.id)}">${esc(c.nombre)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="campo">
        <label for="monto">Monto</label>
        <input class="entrada entrada-monto" id="monto" name="monto" inputmode="numeric" autocomplete="off" ${invalido('monto')} value="${vista.monto ? cop.format(vista.monto) : ''}" placeholder="$ 0">
        <div class="fichas">${[20000, 50000, 200000, 1000000].map((v) => `<button type="button" class="ficha" data-accion="monto" data-valor="${v}">${cop.format(v)}</button>`).join('')}
          <button type="button" class="ficha" data-accion="monto" data-valor="${u.saldo}">Todo</button></div>
        <span class="suave pequeno">Disponible: ${cop.format(u.saldo)}</span>
      </div>
      ${mensajeError()}
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
      <ul class="razones">${(d.razones || []).map((r) => `<li>${esc(facil(r, razonFacil(r)))}</li>`).join('')}</ul>
      <div class="datos-tecnicos" ${ajustes().facil ? 'hidden' : ''}>
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
// Lectura fácil: una idea por frase, palabras de uso diario.
const TEXTO_FACIL = {
  completada: 'Tu plata ya salió.',
  verificada: 'Escribiste bien el código. Tu plata ya salió.',
  desafio: 'Antes de enviar, escribe el código que te mandamos.',
  retenida: 'Tu plata no salió todavía. Una persona de Yuma va a revisar el envío. Te avisamos aquí.',
  liberada: 'Una persona revisó tu envío. Tu plata ya salió.',
  bloqueada: 'Una persona revisó tu envío y lo frenó para protegerte. Tu plata sigue en tu cuenta. Si no fuiste tú, cambia tu clave.',
  rechazada: 'No se movió plata.',
  cancelada: 'No se movió plata.',
  error: 'No pudimos revisar el envío. Tu plata sigue en tu cuenta. Intenta otra vez.',
};
function textoResultado(m) {
  const [ic, titulo, normal] = TEXTO_RESULTADO[m.estado];
  const contacto = CONTACTOS[usuario().preferencias.contacto];
  const aviso = m.estado === 'retenida' && contacto ? ` Si hace falta, te contactaremos por ${contacto.toLowerCase()}.` : '';
  return [ic, titulo, facil(normal, TEXTO_FACIL[m.estado]) + aviso];
}

function vResultado() {
  const m = usuario().movimientos.find((x) => x.id === vista.id);
  const [ic, titulo, texto] = textoResultado(m);
  return `
    <section class="resultado">
      <div class="sello ${m.estado}">${icono(ic)}</div>
      <h1>${titulo}</h1>
      <div class="resultado-monto">${cop.format(m.monto)}</div>
      <p class="suave">${esc(m.nombre || m.destino)} · ${OPERACIONES[m.clave].titulo}</p>
      <p>${texto}</p>
      <button class="enlace" data-accion="escuchar">${icono('altavoz', 'width="18" height="18"')}Escuchar</button>
    </section>
    ${m.estado === 'desafio' ? formCodigo('codigo', m.canal, 'Confirmar', '<button class="boton boton-sec" type="button" data-accion="cancelar-desafio">Cancelar operación</button>') : ''}
    ${vDecision(m)}
    ${m.estado !== 'desafio' ? '<button class="boton" data-accion="ir" data-vista="inicio">Volver al inicio</button>' : ''}`;
}

// Formulario del código de 6 dígitos (ingreso en dos pasos y desafíos de aegix).
function formCodigo(form, canal, boton, extra = '') {
  return `
      <form class="tarjeta" data-form="${form}" novalidate>
        <label for="codigo"><b>Código de 6 dígitos</b></label>
        <p class="suave pequeno" id="codigo-ayuda">${canal === 'celular' ? 'Te lo enviamos a tu celular.' : 'Te lo enviamos por SMS (simulado, arriba de la pantalla).'} Vale 10 minutos; si se vence, pide otro.</p>
        <div class="codigo"><input class="entrada" id="codigo" name="codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code" ${invalido('codigo').replace('aria-describedby="error"', 'aria-describedby="codigo-ayuda error"')}></div>
        ${mensajeError()}
        <button class="enlace" type="button" data-accion="otro-codigo">Enviar otro código</button>
        <div class="pila"><button class="boton" type="submit">${boton}</button>${extra}</div>
      </form>`;
}

function vDosPasos() {
  return `
    <button class="volver" data-accion="ir" data-vista="ingreso">${icono('atras', 'width="18" height="18"')}Ingreso</button>
    <h1>Confirma que eres tú</h1>
    <p class="suave">Verificación en dos pasos: además de tu clave, escribe el código que te enviamos para entrar como ${esc(estado.usuarios[vista.celular].nombre.split(' ')[0])}.</p>
    ${formCodigo('dos-pasos', vista.canal, 'Entrar')}`;
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

const interruptor = (dato, clave, titulo, texto, activo) => `
  <label class="interruptor">
    <span class="interruptor-texto"><b>${titulo}</b><span class="suave pequeno">${texto}</span></span>
    <input type="checkbox" role="switch" ${dato}="${clave}" ${activo ? 'checked' : ''}>
  </label>`;

function vAccesibilidad() {
  const a = ajustes();
  const u = estado.sesion && usuario();
  return `
    ${u ? '' : `<button class="volver" data-accion="ir" data-vista="ingreso">${icono('atras', 'width="18" height="18"')}Ingreso</button>`}
    <h1>Accesibilidad</h1>
    <p class="suave">Ajusta Yuma a tu manera. Estos ajustes se guardan en este dispositivo.</p>
    <div class="tarjeta">
      <h2>Ver y leer</h2>
      ${interruptor('data-ajuste', 'texto', 'Texto más grande', 'Agranda letras y botones en toda la billetera.', a.texto)}
      ${interruptor('data-ajuste', 'contraste', 'Alto contraste', 'Colores más oscuros y bordes más marcados.', a.contraste)}
      ${interruptor('data-ajuste', 'facil', 'Lectura fácil', 'Frases cortas y sin palabras técnicas para explicar cada decisión.', a.facil)}
      ${interruptor('data-ajuste', 'voz', 'Leer en voz alta', 'Lee el resultado de cada operación y el código de verificación.', a.voz)}
    </div>
    ${u ? `<div class="tarjeta">
      <h2>Si una persona revisa tu operación</h2>
      <fieldset class="opciones">
        <legend>¿Cómo prefieres que te contactemos?</legend>
        ${[['', 'Sin preferencia'], ...Object.entries(CONTACTOS)].map(([v, t]) => `
          <label class="opcion"><input type="radio" name="contacto" value="${v}" data-preferencia="contacto" ${u.preferencias.contacto === v ? 'checked' : ''}>${t}</label>`).join('')}
      </fieldset>
      ${interruptor('data-preferencia', 'apoyo', 'Me acompaña una persona de apoyo', 'Alguien de tu confianza puede estar contigo cuando te contactemos.', u.preferencias.apoyo)}
      <p class="suave pequeno">Esto no cambia cómo aegix evalúa tus operaciones: solo le dice al analista cómo comunicarse contigo. No te preguntamos por diagnósticos ni datos de salud.</p>
    </div>` : ''}`;
}

function vBarra() {
  const actual = ['seguridad', 'accesibilidad'].includes(vista.nombre) ? vista.nombre : 'inicio';
  return `<nav class="barra" aria-label="Principal">
    <button data-accion="ir" data-vista="inicio" ${actual === 'inicio' ? 'aria-current="page"' : ''}>${icono('casa')}Inicio</button>
    <button data-accion="ir" data-vista="seguridad" ${actual === 'seguridad' ? 'aria-current="page"' : ''}>${icono('escudo')}Seguridad</button>
    <button data-accion="ir" data-vista="accesibilidad" ${actual === 'accesibilidad' ? 'aria-current="page"' : ''}>${icono('persona')}Accesibilidad</button>
  </nav>`;
}

// Selector que vuelve a encontrar el control enfocado después de redibujar la pantalla.
function selectorDe(el) {
  if (!el || el === document.body || !app.contains(el)) return '';
  if (el.matches('h1, h2')) return 'h1, h2'; // el título que ir() enfocó
  if (el.id) return `#${CSS.escape(el.id)}`;
  const datos = Object.entries(el.dataset).map(([k, v]) => `[data-${k}="${CSS.escape(v)}"]`).join('');
  return datos ? `${el.tagName}${datos}${el.value && el.type === 'radio' ? `[value="${CSS.escape(el.value)}"]` : ''}` : '';
}

function pintar() {
  const vistas = { ingreso: vIngreso, 'dos-pasos': vDosPasos, inicio: vInicio, operacion: vOperacion, autorizando: vAutorizando, resultado: vResultado, seguridad: vSeguridad, accesibilidad: vAccesibilidad };
  const conBarra = estado.sesion && ['inicio', 'seguridad', 'accesibilidad'].includes(vista.nombre);
  const foco = selectorDe(document.activeElement);
  app.innerHTML = vistas[vista.nombre]() + (conBarra ? vBarra() : '');
  const raiz = document.documentElement;
  raiz.toggleAttribute('data-texto-grande', ajustes().texto);
  raiz.toggleAttribute('data-contraste', ajustes().contraste);
  const destino = foco && app.querySelector(foco);
  if (!destino) return;
  if (destino.matches('h1, h2')) destino.setAttribute('tabindex', '-1');
  destino.focus({ preventScroll: true });
}

// ---------- Acciones ----------
const soloDigitos = (t) => String(t).replace(/\D/g, '');

async function autorizar(op) {
  const u = usuario();
  const id = `YW${Date.now().toString(36).toUpperCase()}${azar(2)}`;
  let solicitud;
  try {
    solicitud = construirSolicitud(u, op, u.senales, {
      id, dispositivo: estado.dispositivo, agente: navigator.userAgent, ahora: new Date(),
      accesibilidad: { contacto: u.preferencias.contacto, lectura_facil: ajustes().facil, apoyo_de_confianza: u.preferencias.apoyo },
    });
  } catch (e) {
    return ir('operacion', { ...op, op: op.clave, error: e.message, campo: /monto|saldo/i.test(e.message) ? 'monto' : 'destino' });
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
  let envio = null;
  if (m.estado === 'desafio') {
    envio = await pedirCodigo(u.celular, 'operacion', m.monto);
    if (envio) Object.assign(m, { ficha: envio.ficha, canal: envio.canal, codigo: envio.codigo, intentos: 0 });
    else Object.assign(m, { estado: 'error', motivo: 'No pudimos enviar el código de verificación' });
  }
  u.movimientos.unshift(m);
  guardar();
  ir('resultado', { id });
  if (envio) anunciarCodigo(envio, `autorizar ${cop.format(m.monto)}`);
  if (ajustes().voz) leerResultado(m);
}

// Pide un código al servidor: llega al celular (ntfy) o, sin celular configurado, vuelve como SMS simulado.
async function pedirCodigo(celular, motivo, monto) {
  try {
    const r = await fetch('/api/codigo', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'enviar', celular, motivo, monto }),
    });
    const d = await r.json();
    return r.ok && d.ficha ? d : null;
  } catch { return null; }
}

async function verificarCodigo(ficha, codigo, celular, motivo) {
  try {
    const r = await fetch('/api/codigo', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'verificar', ficha, codigo, celular, motivo }),
    });
    return (await r.json()).resultado ?? 'sin_conexion';
  } catch { return 'sin_conexion'; }
}

function anunciarCodigo(envio, para) {
  if (envio.canal === 'simulado') return mostrarCodigo(envio.codigo, para);
  avisar(`Te enviamos el código para ${para} a tu celular.`);
}

const ERROR_CODIGO = { vencido: 'El código venció. Pide otro con «Enviar otro código».', sin_conexion: 'No pudimos comprobar el código. Revisa tu conexión e inténtalo de nuevo.' };

function leerResultado(m) {
  const [, titulo, texto] = textoResultado(m);
  hablar(`${titulo}. ${texto}${m.estado === 'desafio' && m.codigo ? ` Tu código es ${digitos(m.codigo)}.` : ''}`);
}

// El código no desaparece solo (WCAG 2.2.1): se cierra con el botón o al terminar la verificación.
function mostrarCodigo(codigo, para) {
  clearTimeout(avisar.t);
  const sms = document.getElementById('sms');
  sms.innerHTML = `<p><b>Yuma</b> · Tu código para ${esc(para)} es <b class="sms-codigo">${codigo}</b>. No lo compartas con nadie.</p>
    <div class="sms-acciones"><button type="button" data-sms="escuchar">${icono('altavoz', 'width="16" height="16"')}Escuchar código</button><button type="button" data-sms="cerrar">Cerrar</button></div>`;
  sms.dataset.codigo = codigo;
  sms.hidden = false;
  if (ajustes().voz) hablar(`Tu código es ${digitos(codigo)}`);
}

function cerrarDesafio(m, estadoFinal) {
  m.estado = estadoFinal;
  delete m.codigo;
  delete m.ficha;
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
    case 'elegir': ir('ingreso', { celular: d.celular }); return app.querySelector('#clave')?.focus();
    case 'escuchar': return leerResultado(usuario().movimientos.find((x) => x.id === vista.id));
    case 'otro-codigo': return otroCodigo();
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
        const conservar = estado.accesibilidad; // los ajustes de accesibilidad son de la persona, no de la demo
        estado = inicial();
        estado.accesibilidad = conservar;
        ir('ingreso');
      }
  }
});

app.addEventListener('change', (ev) => {
  const { senal, ajuste, preferencia } = ev.target.dataset;
  if (senal) usuario().senales[senal] = ev.target.checked;
  if (ajuste) estado.accesibilidad[ajuste] = ev.target.checked;
  if (preferencia) usuario().preferencias[preferencia] = ev.target.type === 'radio' ? ev.target.value : ev.target.checked;
  guardar();
  if (ajuste) pintar();
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
    if (!u || u.clave !== f.clave.value) return ir('ingreso', { celular: cel, error: 'Celular o clave incorrectos.', campo: 'clave' });
    return iniciarDosPasos(cel);
  }
  if (f.dataset.form === 'dos-pasos') return confirmarIngreso(f.codigo.value.trim());
  if (f.dataset.form === 'operacion') {
    return autorizar({ clave: vista.op, destino: limpiarDestino(f.destino.value), monto: Number(soloDigitos(f.monto.value)) });
  }
  if (f.dataset.form === 'codigo') return confirmarDesafio(f.codigo.value.trim());
});

let verificando = false; // evita que un doble envío gaste dos intentos
async function iniciarDosPasos(celular) {
  const envio = await pedirCodigo(celular, 'ingreso');
  if (!envio) return ir('ingreso', { celular, error: 'No pudimos enviar el código. Intenta de nuevo.', campo: 'clave' });
  ir('dos-pasos', { celular, ficha: envio.ficha, canal: envio.canal, intentos: 0 });
  anunciarCodigo(envio, 'entrar a Yuma');
}

async function confirmarIngreso(codigo) {
  if (verificando) return;
  verificando = true;
  const resultado = await verificarCodigo(vista.ficha, codigo, vista.celular, 'ingreso').finally(() => { verificando = false; });
  if (resultado === 'valido') {
    estado.sesion = vista.celular;
    guardar();
    document.getElementById('sms').hidden = true;
    consultarSalud();
    return ir('inicio');
  }
  if (resultado !== 'incorrecto') return ir('dos-pasos', { ...vista, error: ERROR_CODIGO[resultado], campo: 'codigo' });
  const intentos = vista.intentos + 1;
  if (intentos >= 3) return ir('ingreso', { celular: vista.celular, error: 'Demasiados intentos. Escribe tu clave otra vez.', campo: 'clave' });
  ir('dos-pasos', { ...vista, intentos, error: `Código incorrecto. Te quedan ${3 - intentos} intentos.`, campo: 'codigo' });
}

async function confirmarDesafio(codigo) {
  if (verificando) return;
  const m = usuario().movimientos.find((x) => x.id === vista.id);
  verificando = true;
  const resultado = await verificarCodigo(m.ficha, codigo, usuario().celular, 'operacion').finally(() => { verificando = false; });
  if (m.estado !== 'desafio') return;
  if (resultado === 'valido') return cerrarDesafio(m, 'verificada');
  if (resultado !== 'incorrecto') return ir('resultado', { id: m.id, error: ERROR_CODIGO[resultado], campo: 'codigo' });
  m.intentos += 1;
  if (m.intentos >= 3) return cerrarDesafio(m, 'cancelada');
  guardar();
  ir('resultado', { id: m.id, error: `Código incorrecto. Te quedan ${3 - m.intentos} intentos.`, campo: 'codigo' });
}

async function otroCodigo() {
  if (vista.nombre === 'dos-pasos') {
    const envio = await pedirCodigo(vista.celular, 'ingreso');
    if (!envio) return ir('dos-pasos', { ...vista, error: 'No pudimos enviar otro código. Intenta de nuevo.', campo: 'codigo' });
    ir('dos-pasos', { ...vista, ficha: envio.ficha, canal: envio.canal, error: '' });
    return anunciarCodigo(envio, 'entrar a Yuma');
  }
  const m = usuario().movimientos.find((x) => x.id === vista.id);
  const envio = await pedirCodigo(usuario().celular, 'operacion', m.monto);
  if (!envio) return ir('resultado', { id: m.id, error: 'No pudimos enviar otro código. Intenta de nuevo.', campo: 'codigo' });
  Object.assign(m, { ficha: envio.ficha, canal: envio.canal, codigo: envio.codigo });
  guardar();
  ir('resultado', { id: m.id });
  anunciarCodigo(envio, `autorizar ${cop.format(m.monto)}`);
}

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
  sms.innerHTML = `<p><b>Yuma</b> · ${esc(texto)}</p><div class="sms-acciones"><button type="button" data-sms="cerrar">Cerrar</button></div>`;
  delete sms.dataset.codigo;
  sms.hidden = false;
  if (ajustes().voz) hablar(texto);
  // El mismo aviso queda en el movimiento; este recuadro se cierra solo a los 20 s, salvo que tenga el foco.
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => { if (!sms.contains(document.activeElement)) sms.hidden = true; }, 20000);
}

document.getElementById('sms').addEventListener('click', (ev) => {
  const accion = ev.target.closest('[data-sms]')?.dataset.sms;
  const sms = ev.currentTarget;
  if (accion === 'escuchar') hablar(`Tu código es ${digitos(sms.dataset.codigo)}`);
  if (accion === 'cerrar') sms.hidden = true;
});

setInterval(revisarRetenidas, 4000);
if (estado.sesion) consultarSalud();
pintar();
