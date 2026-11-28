// Crea o reemplaza un usuario de la consola con contraseña (scrypt) y secreto TOTP.
//
//   node usuarios.mjs agregar <usuario> <admin|analista|auditor|empleado> [archivo]
//
// La contraseña se lee de YUMA_NUEVA_CLAVE o se genera al azar. Imprime el secreto TOTP para
// registrarlo en una app autenticadora (Google Authenticator, Aegis, Authy): «Ingresar clave de configuración».
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PERMISOS, base32, hashClave, uriTotp } from './acceso.mjs';

const [accion, usuario, rol, archivo = process.env.YUMA_USUARIOS || '../datos/usuarios-consola.json'] = process.argv.slice(2);
if (accion !== 'agregar' || !/^[a-z0-9._-]{1,32}$/.test(usuario ?? '') || !PERMISOS[rol]) {
  console.error('Uso: node usuarios.mjs agregar <usuario> <admin|analista|auditor|empleado> [archivo]');
  process.exit(2);
}
const clave = process.env.YUMA_NUEVA_CLAVE || randomBytes(9).toString('base64url');
if (clave.length < 10) {
  console.error('La contraseña debe tener al menos 10 caracteres.');
  process.exit(2);
}
let lista = [];
try { lista = JSON.parse(await readFile(archivo, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const totp = base32(randomBytes(20));
lista = [...lista.filter((u) => u.usuario !== usuario), { usuario, rol, clave: await hashClave(clave), totp }];
await writeFile(archivo, JSON.stringify(lista, null, 2) + '\n', { mode: 0o600 });

console.log(`Usuario «${usuario}» (${rol}) guardado en ${archivo}`);
if (!process.env.YUMA_NUEVA_CLAVE) console.log(`Contraseña: ${clave}`);
console.log(`Secreto TOTP (escríbelo en la app autenticadora): ${totp}`);
console.log(`URI para un generador de QR: ${uriTotp(usuario, totp)}`);
