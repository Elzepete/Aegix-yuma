// Tipos de las respuestas de aegix que usa la consola.
export const indicadores = [
  ['decisiones_registradas', 'Decisiones registradas'],
  ['aprobadas', 'Aprobadas'],
  ['desafios', 'Desafíos'],
  ['retenidas', 'Retenidas'],
  ['rechazos', 'Rechazos'],
  ['omisiones_auditoria', 'Omisiones de auditoría'],
  ['liberadas_por_analista', 'Liberadas por analista'],
  ['fraudes_confirmados', 'Fraudes confirmados'],
] as const;

export const CONTACTO = {
  sms: 'Mensaje de texto', llamada: 'Llamada de voz', videollamada_lsc: 'Videollamada con intérprete de lengua de señas', chat: 'Chat escrito',
} as const;

// Lo que el analista debe saber antes de contactar al cliente, en una línea.
export function comoContactar(p: NonNullable<NonNullable<Alerta['entrada']>['accesibilidad']>): string {
  return [p.contacto ? CONTACTO[p.contacto] : '', p.lectura_facil ? 'en lectura fácil' : '', p.apoyo_de_confianza ? 'lo acompaña una persona de apoyo' : '']
    .filter(Boolean).join(' · ');
}

export type Indicadores = Record<(typeof indicadores)[number][0], number>;

export interface Alerta {
  referencia?: string;
  origen?: 'billetera' | 'sandbox';
  entrada?: {
    canal: string; tipo_operacion: string; fecha_hora: string; monto_cop?: number;
    // Cómo prefiere el cliente que lo contacten. aegix no lo usa para decidir.
    accesibilidad?: { contacto?: keyof typeof CONTACTO; lectura_facil?: boolean; apoyo_de_confianza?: boolean };
  };
  decision: 'aprobar' | 'desafiar' | 'retener' | 'rechazar';
  puntaje: number;
  razones: string[] | null;
  version_reglas: string;
  latencia_ms: number;
  registrado_en: string;
  confirmada_por_sandbox: boolean;
  resolucion?: 'liberar' | 'confirmar_fraude';
  resuelta_en?: string;
  analista?: string;
}
