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

export type Indicadores = Record<(typeof indicadores)[number][0], number>;

export interface Alerta {
  referencia?: string;
  origen?: 'billetera' | 'sandbox';
  entrada?: { canal: string; tipo_operacion: string; fecha_hora: string; monto_cop?: number };
  decision: 'aprobar' | 'desafiar' | 'retener' | 'rechazar';
  puntaje: number;
  razones: string[] | null;
  version_reglas: string;
  latencia_ms: number;
  registrado_en: string;
  confirmada_por_sandbox: boolean;
  resolucion?: 'liberar' | 'confirmar_fraude';
  resuelta_en?: string;
}
