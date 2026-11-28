// Acceso SOC a la consola: contraseña con scrypt + código TOTP de 6 dígitos (RFC 6238) y roles.
// Sin dependencias: solo node:crypto. Los usuarios viven en un JSON fuera del repositorio (YUMA_USUARIOS),
// creado con `node usuarios.mjs agregar <usuario> <rol>`.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Qué puede hacer cada rol. ver = casos, actividad y métricas.
export const PERMISOS = {
  admin: ['ver', 'resolver', 'auditar', 'probar'],
  analista: ['ver', 'resolver', 'auditar'],
  auditor: ['ver', 'auditar'],
  empleado: ['ver'],
};
export const puede = (rol, permiso) => (PERMISOS[rol] ?? []).includes(permiso);

// ---------- Contraseña: scrypt (N=2^15, r=8, p=1), formato scrypt$N$r$p$sal$hash ----------
const N = 32768, R = 8, P = 1, LARGO = 32;
const opciones = (n, r, p) => ({ N: n, r, p, maxmem: 128 * n * r * 2 });

export async function hashClave(clave) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(clave.normalize('NFKC'), sal, LARGO, opciones(N, R, P));
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarClave(clave, guardado) {
  const [tipo, n, r, p, sal, hash] = String(guardado).split('$');
  if (tipo !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scryptAsync(String(clave).normalize('NFKC'), Buffer.from(sal, 'base64'), esperado.length,
    opciones(Number(n), Number(r), Number(p)));
  return timingSafeEqual(calculado, esperado);
}

// ---------- TOTP: HMAC-SHA1, pasos de 30 s, 6 dígitos; secreto en base32 como lo leen las apps ----------
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes) {
  let bits = 0, valor = 0, salida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) { salida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function desdeBase32(texto) {
  let bits = 0, valor = 0;
  const salida = [];
  for (const c of String(texto).toUpperCase().replace(/[\s=]/g, '')) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error('secreto TOTP inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) { salida.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(salida);
}

export function codigoTotp(secreto, paso) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', desdeBase32(secreto)).update(contador).digest();
  const desplazamiento = h[h.length - 1] & 15;
  return String((h.readUInt32BE(desplazamiento) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Devuelve el paso usado (para impedir reutilizar el mismo código) o null. Tolera ±30 s de reloj.
export function verificarTotp(secreto, codigo, ahora = Date.now(), ultimoPaso = -1) {
  if (!/^\d{6}$/.test(String(codigo))) return null;
  const actual = Math.floor(ahora / 30000);
  for (const paso of [actual - 1, actual, actual + 1]) {
    if (paso <= ultimoPaso) continue;
    if (timingSafeEqual(Buffer.from(codigoTotp(secreto, paso)), Buffer.from(String(codigo)))) return paso;
  }
  return null;
}

export const uriTotp = (usuario, secreto) =>
  `otpauth://totp/aegix:${encodeURIComponent(usuario)}?secret=${secreto}&issuer=aegix&digits=6&period=30`;

// ---------- Sesión: cookie firmada con HMAC, 8 horas ----------
const DURACION_MS = 8 * 60 * 60 * 1000;

export function firmarSesion(secreto, usuario, rol, ahora = Date.now()) {
  const datos = Buffer.from(JSON.stringify({ u: usuario, r: rol, e: ahora + DURACION_MS })).toString('base64url');
  return `${datos}.${createHmac('sha256', secreto).update(datos).digest('base64url')}`;
}

export function leerSesion(secreto, valor, ahora = Date.now()) {
  const [datos, firma] = String(valor ?? '').split('.');
  if (!datos || !firma) return null;
  const esperada = Buffer.from(createHmac('sha256', secreto).update(datos).digest('base64url'));
  const dada = Buffer.from(firma);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return null;
  try {
    const s = JSON.parse(Buffer.from(datos, 'base64url').toString());
    return s.e > ahora && PERMISOS[s.r] ? { usuario: s.u, rol: s.r } : null;
  } catch { return null; }
}

export function leerCookie(cabecera, nombre) {
  for (const parte of String(cabecera ?? '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return v.join('=');
  }
  return null;
}

// ---------- Usuarios ----------
export async function cargarUsuarios(ruta) {
  const lista = JSON.parse(await readFile(ruta, 'utf8'));
  const usuarios = new Map();
  for (const u of lista) {
    if (!/^[a-z0-9._-]{1,32}$/.test(u.usuario) || !PERMISOS[u.rol] || !u.clave || !u.totp) {
      throw new Error(`usuario inválido en ${ruta}: ${u.usuario}`);
    }
    desdeBase32(u.totp);
    usuarios.set(u.usuario, u);
  }
  if (!usuarios.size) throw new Error(`${ruta} no tiene usuarios`);
  return usuarios;
}

// Límite de intentos fallidos: 5 por usuario y 20 por IP cada 15 minutos.
export function crearLimitador(ventana = 15 * 60 * 1000) {
  const fallos = new Map();
  const recientes = (clave, ahora) => (fallos.get(clave) ?? []).filter((t) => ahora - t < ventana);
  return {
    bloqueado(usuario, ip, ahora = Date.now()) {
      return recientes(`u:${usuario}`, ahora).length >= 5 || recientes(`i:${ip}`, ahora).length >= 20;
    },
    fallo(usuario, ip, ahora = Date.now()) {
      if (fallos.size > 10000) fallos.clear();
      for (const k of [`u:${usuario}`, `i:${ip}`]) fallos.set(k, [...recientes(k, ahora), ahora]);
    },
  };
}
