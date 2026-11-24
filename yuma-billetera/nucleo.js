// Lógica pura de la billetera: arma la solicitud que aegix espera en /v1/autorizar.
// Se usa desde el navegador (app.js) y desde las pruebas (node --test).

export const VERSION_APP = '3.4.1';

// Tipos de operación de la billetera → esquema del sandbox Yuma Pay.
export const OPERACIONES = {
  enviar_yuma: { tipo: 'transferencia_inmediata', destino: 'cuenta_yuma', titulo: 'Enviar a Yuma' },
  enviar_banco: { tipo: 'transferencia_inmediata', destino: 'otra_entidad', titulo: 'Enviar a otro banco' },
  pagar_qr: { tipo: 'pago_qr', destino: 'comercio', titulo: 'Pagar con QR' },
  recargar: { tipo: 'recarga_celular', destino: 'operador', titulo: 'Recargar celular' },
  servicios: { tipo: 'pago_servicios', destino: 'servicio', titulo: 'Pagar servicios' },
};

// Colombia usa UTC-5 todo el año; aegix exige AAAA-MM-DD HH:MM:SS en hora de Colombia.
export function fechaColombia(fecha = new Date()) {
  return new Date(fecha.getTime() - 5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
}

export function sistemaOperativo(agente = '') {
  if (/android/i.test(agente)) return 'Android';
  if (/iphone|ipad|ios/i.test(agente)) return 'iOS';
  if (/windows/i.test(agente)) return 'Windows';
  if (/mac os/i.test(agente)) return 'macOS';
  if (/linux/i.test(agente)) return 'Linux';
  return 'Web';
}

export function limpiarDestino(texto) {
  return String(texto ?? '').trim().replace(/[\s.]+/g, '').toUpperCase().slice(0, 64);
}

// Convenios de pago de servicios registrados en Yuma (ficticios).
export const CONVENIOS = [
  { id: 'SRV-EPM', nombre: 'EPM energía' },
  { id: 'SRV-ACB', nombre: 'Acueducto Bogotá' },
  { id: 'SRV-GAS', nombre: 'Gases del Caribe' },
  { id: 'SRV-NET', nombre: 'Internet Fibra' },
];

const CELULAR = [/^3\d{9}$/, 'Escribe un celular de 10 dígitos que empiece por 3.'];
const FORMATOS = {
  enviar_yuma: CELULAR,
  recargar: CELULAR,
  enviar_banco: [/^\d{6,20}$/, 'Escribe un número de cuenta de 6 a 20 dígitos.'],
  pagar_qr: [/^COM\d{4}$/, 'El código del comercio tiene la forma COM0380.'],
  servicios: [new RegExp(`^(${CONVENIOS.map((c) => c.id).join('|')})$`), 'Elige un convenio de la lista.'],
};

// Devuelve el mensaje de error, o '' si el destino es válido para esa operación.
export function validarDestino(clave, destino, celularPropio) {
  const [formato, mensaje] = FORMATOS[clave];
  if (!destino) return 'Falta el destino.';
  if (!formato.test(destino)) return mensaje;
  if (clave === 'enviar_yuma' && destino === celularPropio) return 'No puedes enviarte plata a ti mismo.';
  return '';
}

// Canales con los que un analista puede contactar al cliente si revisa su operación (los mismos que acepta aegix).
export const CONTACTOS = {
  sms: 'Mensaje de texto',
  llamada: 'Llamada de voz',
  videollamada_lsc: 'Videollamada con intérprete de lengua de señas',
  chat: 'Chat escrito',
};

// Razones de aegix (config/reglas.yaml) en lectura fácil: frases cortas, en segunda persona y sin tecnicismos.
const RAZON_FACIL = {
  'ninguna regla de riesgo se activó': 'Todo se ve normal.',
  'dispositivo nuevo': 'Estás usando un celular que registraste hace poco.',
  'conexión por un nodo de salida Tor': 'Tu conexión está escondida con la red Tor.',
  'conexión desde un proxy o centro de datos': 'Tu conexión pasa por una VPN o un servidor.',
  'hora atípica para este cliente': 'Es una hora en la que casi nunca usas Yuma.',
  'país de conexión fuera del historial del cliente': 'Te conectas desde otro país.',
  'conexión desde un departamento distinto al habitual': 'Te conectas desde otra región.',
  'cambio reciente de SIM': 'Tu tarjeta SIM cambió hace poco.',
  'cambio reciente de clave': 'Cambiaste tu clave hace poco.',
  'destino nuevo': 'Nunca le habías enviado plata a este destino.',
  'cuenta con menos de 30 días': 'Tu cuenta es muy nueva.',
  'monto elevado frente al saldo disponible': 'Estás enviando casi toda tu plata.',
  'varias operaciones del cliente en los últimos 10 minutos': 'Hiciste varias operaciones en pocos minutos.',
  'operación de bajo riesgo: se verifica la identidad en lugar de retener': 'Por seguridad, solo te pedimos un código.',
  'se requiere una señal adicional ajena al origen y al horario para retener': 'Por seguridad, te pedimos un código.',
};
export const razonFacil = (r) => RAZON_FACIL[r] ?? r;

/**
 * @param usuario   perfil del cliente de demostración
 * @param op        { clave: keyof OPERACIONES, destino, monto }
 * @param senales   interruptores del simulador de riesgo
 * @param entorno   { id, dispositivo, agente, ahora, accesibilidad? }
 */
export function construirSolicitud(usuario, op, senales, entorno) {
  const tipo = OPERACIONES[op.clave];
  if (!tipo) throw new Error('operación desconocida');
  const destino = limpiarDestino(op.destino);
  const invalido = validarDestino(op.clave, destino, usuario.celular);
  if (invalido) throw new Error(invalido);
  if (!Number.isInteger(op.monto) || op.monto <= 0) throw new Error('Escribe un monto mayor que cero.');
  if (op.monto > usuario.saldo) throw new Error('Saldo insuficiente.');

  const conocido = usuario.contactos.some((c) => c.id === destino) ||
    usuario.movimientos.some((m) => m.destino === destino && ['completada', 'verificada', 'liberada'].includes(m.estado));
  // Un dispositivo nuevo se simula con otra huella además de la marca.
  const dispositivo = senales.dispositivoNuevo ? `${entorno.dispositivo}-N` : entorno.dispositivo;
  const contexto = {
    es_tor: !!senales.tor,
    es_proxy_o_datacenter: !!senales.proxy,
    version_app: VERSION_APP,
    sistema_operativo: sistemaOperativo(entorno.agente),
    huella_dispositivo: dispositivo,
  };
  // Sin simulación, la función del servidor completa IP y país reales de la conexión.
  if (senales.exterior) contexto.pais_ip = 'US';
  // Solo se envía lo que el cliente eligió. aegix lo muestra al analista y no lo usa para decidir.
  const { contacto = '', lectura_facil = false, apoyo_de_confianza = false } = entorno.accesibilidad ?? {};
  if (contacto && !CONTACTOS[contacto]) throw new Error('Canal de contacto desconocido.');
  if (contacto || lectura_facil || apoyo_de_confianza) {
    contexto.accesibilidad = {
      ...(contacto && { contacto }), ...(lectura_facil && { lectura_facil }), ...(apoyo_de_confianza && { apoyo_de_confianza }),
    };
  }

  return {
    transaccion: {
      id_transaccion: entorno.id,
      fecha_hora: fechaColombia(entorno.ahora),
      id_cliente: `YUMA-${usuario.celular}`,
      tipo_operacion: tipo.tipo,
      canal: 'app',
      monto_cop: op.monto,
      saldo_antes_cop: usuario.saldo,
      id_destino: destino,
      tipo_destino: tipo.destino,
      destino_nuevo: conocido ? 0 : 1,
      id_dispositivo: dispositivo,
      dispositivo_nuevo: senales.dispositivoNuevo ? 1 : 0,
      cambio_clave_24h: senales.cambioClave ? 1 : 0,
      cambio_sim_48h: senales.cambioSIM ? 1 : 0,
      departamento_ip: usuario.departamento,
      ip_departamento_distinto: senales.exterior ? 1 : 0,
      antiguedad_cuenta_dias: usuario.antiguedad,
    },
    contexto,
  };
}

// Estado del movimiento según la decisión de aegix (desafiar se resuelve después con el código).
export function estadoPorDecision(accion) {
  return { aprobar: 'completada', desafiar: 'desafio', retener: 'retenida', rechazar: 'rechazada' }[accion] ?? 'error';
}
