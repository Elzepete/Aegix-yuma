// Lectura en voz alta con las voces del sistema. En Linux el navegador las toma de speech-dispatcher:
// sin él la lista llega vacía y se avisa qué instalar en vez de quedarse en silencio.
export const SIN_VOZ = 'Este navegador no tiene voces. En Linux: instala speech-dispatcher y espeak-ng, cierra el navegador por completo (Ctrl+Q) y vuelve a abrirlo. Firefox y Zen las usan; Chrome y los navegadores integrados en apps, no.';

const disponible = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
const voces = () => (disponible() ? speechSynthesis.getVoices() : []);
const vozEspanol = () => {
  const v = voces();
  return v.find((x) => /^es[-_]CO/i.test(x.lang)) ?? v.find((x) => /^es\b/i.test(x.lang)) ?? v.find((x) => /spanish|español/i.test(x.name));
};

export function estadoVoz(): string {
  if (!disponible()) return 'Este navegador no puede leer en voz alta.';
  const v = voces();
  if (!v.length) return SIN_VOZ;
  const es = vozEspanol();
  return es ? `Voz: ${es.name}.` : `No hay voz en español; se usará ${v[0].name}.`;
}

/** Lee el texto; devuelve el motivo si no pudo. */
export function hablar(texto: string): string {
  if (!disponible() || !voces().length) return estadoVoz();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  const es = vozEspanol();
  if (es) u.voice = es;
  u.lang = es?.lang ?? 'es-CO';
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return '';
}

export function alCambiarVoces(fn: () => void): () => void {
  if (!disponible()) return () => {};
  speechSynthesis.addEventListener('voiceschanged', fn);
  return () => speechSynthesis.removeEventListener('voiceschanged', fn);
}
