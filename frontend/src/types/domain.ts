/**
 * Tipos y constantes del DOMINIO (escritos a mano, a diferencia de
 * database.types.ts que es generado). Centralizan el ciclo de vida del
 * cruce para que ninguna pantalla hardcodee etapas por su cuenta.
 *
 * El orden de ESTADOS_ORDEN replica EXACTAMENTE el enum estado_planta
 * (verificado contra el SQL, no de memoria) — 10 valores desde North Star v5:
 * se agregaron 'crecimiento' y 'evaluacion_anual' entre 'trasplante' y
 * 'traslado_destino'. Único timeline del cruce, sin excepción (North Star v5,
 * principio 2) — no existe ningún timeline secundario a nivel de individuo.
 */
import type { Database } from './database.types';

export type EstadoPlanta = Database['public']['Enums']['estado_planta'];
export type TipoEvento = Database['public']['Enums']['tipo_evento'];
export type RolUsuario = Database['public']['Enums']['rol_usuario'];

/** Orden secuencial del ciclo de vida (= orden del enum estado_planta). */
export const ESTADOS_ORDEN: EstadoPlanta[] = [
  'sin_empezar',
  'polinizacion',
  'cosecha',
  'siembra_semilla',
  'germinacion',
  'trasplante',
  'crecimiento',
  'evaluacion_anual',
  'traslado_destino',
  'proceso_finalizado',
];

export const ESTADO_LABEL: Record<EstadoPlanta, string> = {
  sin_empezar: 'Sin empezar',
  polinizacion: 'Polinización',
  cosecha: 'Cosecha',
  siembra_semilla: 'Siembra Semilla',
  germinacion: 'Germinación',
  trasplante: 'Trasplante',
  crecimiento: 'Crecimiento',
  evaluacion_anual: 'Evaluación anual',
  traslado_destino: 'Ensayos multisitio',
  proceso_finalizado: 'Proceso finalizado',
};

/** Etiqueta corta para espacios reducidos (BarraFases: píldoras de escritorio, kicker móvil). */
export const ESTADO_LABEL_CORTO: Record<EstadoPlanta, string> = {
  sin_empezar: 'Inicio',
  polinizacion: 'Polin.',
  cosecha: 'Cosecha',
  siembra_semilla: 'Siembra',
  germinacion: 'Germin.',
  trasplante: 'Traspl.',
  crecimiento: 'Crecim.',
  evaluacion_anual: 'Evaluac.',
  traslado_destino: 'Multisitio',
  proceso_finalizado: 'Fin',
};

export const TIPO_EVENTO_LABEL: Record<TipoEvento, string> = {
  polinizacion: 'Polinización',
  cosecha: 'Cosecha',
  siembra_semilla: 'Siembra de semilla',
  germinacion: 'Germinación',
  trasplante: 'Trasplante',
  traslado: 'Traslado',
  otro: 'Otro',
};

/** Siguiente etapa del ciclo, o null si ya está en la última. */
export function siguienteEstado(actual: EstadoPlanta): EstadoPlanta | null {
  const i = ESTADOS_ORDEN.indexOf(actual);
  return i >= 0 && i < ESTADOS_ORDEN.length - 1 ? ESTADOS_ORDEN[i + 1] : null;
}

/**
 * Etapa anterior del ciclo, o null si ya está en la primera. No hay
 * restricción de backend sobre el orden de `estado` — la única guarda real
 * es a nivel de UI: no se debe ofrecer "Anterior" si el cruce ya tiene
 * individuos creados (ver AvanzarEstado.tsx).
 */
export function anteriorEstado(actual: EstadoPlanta): EstadoPlanta | null {
  const i = ESTADOS_ORDEN.indexOf(actual);
  return i > 0 ? ESTADOS_ORDEN[i - 1] : null;
}

/** Tipo de evento que naturalmente corresponde a una etapa (para preseleccionar en formularios). */
export function tipoEventoDeEstado(estado: EstadoPlanta): TipoEvento {
  switch (estado) {
    case 'polinizacion': return 'polinizacion';
    case 'cosecha': return 'cosecha';
    case 'siembra_semilla': return 'siembra_semilla';
    case 'germinacion': return 'germinacion';
    case 'trasplante': return 'trasplante';
    case 'traslado_destino': return 'traslado';
    default: return 'otro';
  }
}

/** Ficha que devuelve la RPC obtener_planta(). El linaje solo viene si el rol lo permite. */
export interface FichaPlanta {
  id: string;
  codigo_sistema: string;
  especie_id: string;
  estado: EstadoPlanta;
  created_at: string;
  updated_at: string;
  cruzamiento?: string | null;
  /** @deprecated Texto libre congelado desde la migración a variedades (Bloque 3, 3C) — usar mama_nombre. Se conserva como respaldo histórico. */
  mama?: string | null;
  /** @deprecated Texto libre congelado desde la migración a variedades (Bloque 3, 3C) — usar papa_nombre. Se conserva como respaldo histórico. */
  papa?: string | null;
  mama_id?: string | null;
  papa_id?: string | null;
  mama_nombre?: string | null;
  papa_nombre?: string | null;
}

/** True si la ficha vino con los campos de linaje (o sea, el backend nos consideró autorizados). */
export function fichaTieneLinaje(f: FichaPlanta): boolean {
  return 'cruzamiento' in f;
}
