// Bitácora de seguridad de la consola: ingresos, intentos fallidos, accesos denegados, resoluciones y
// exportaciones. Una línea JSON por evento, a la salida estándar (docker logs) y, si se pide, a un archivo.
// Cada línea lleva el SHA-256 de la anterior: si alguien borra o edita una línea del archivo, se nota.
// Nunca registra contraseñas ni códigos.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const resumen = (texto) => createHash('sha256').update(texto).digest('hex');

export function crearBitacora({ archivo, salida = null, maximo = 300 } = {}) {
  const recientes = [];
  let anterior = '';
  if (archivo) {
    try {
      const lineas = readFileSync(archivo, 'utf8').split('\n').filter(Boolean);
      for (const l of lineas.slice(-maximo)) { try { recientes.push(JSON.parse(l)); } catch { /* línea dañada */ } }
      if (lineas.length) anterior = resumen(lineas.at(-1));
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return {
    registrar(evento, datos = {}) {
      const linea = JSON.stringify({ ts: new Date().toISOString(), evento, ...datos, hash_anterior: anterior });
      anterior = resumen(linea);
      recientes.push(JSON.parse(linea));
      if (recientes.length > maximo) recientes.shift();
      salida?.write(linea + '\n');
      if (archivo) {
        try { appendFileSync(archivo, linea + '\n', { mode: 0o600 }); } catch (e) { console.error(`bitácora: ${e.message}`); }
      }
    },
    recientes: () => [...recientes].reverse(),
  };
}

// Verifica la cadena de un archivo de bitácora; devuelve los números de línea rotos.
export function verificarBitacora(texto) {
  let anterior = '';
  const rotas = [];
  texto.split('\n').filter(Boolean).forEach((l, i) => {
    let previo;
    try { previo = JSON.parse(l).hash_anterior; } catch { previo = null; }
    if (previo !== anterior) rotas.push(i + 1);
    anterior = resumen(l);
  });
  return rotas;
}
