/**
 * Contrato v3 (docs/rediseno_v3/contrato.md, §2): el estado de un individuo en la ronda y la definición única de «pendiente».
 *
 * Hoy hay dos vocabularios para lo mismo: la planilla de ronda (`sin_ronda`, `sin_iniciar`, `borrador`, `completa`) y el ranking por
 * grupos (`EstadoRanking`, donde `sin_evaluacion` agrupa a quien no tiene ninguna evaluación cerrada). Este módulo los reúne en un
 * solo estado y en una sola pregunta: «¿está pendiente de evaluación?». No lo usa ninguna pantalla todavía.
 */
import type { EstadoRanking } from '@/api/rankingGrupos';
import type { EstadoFilaPlanilla } from '@/api/protocolo';

/**
 * Estado de un individuo en la ronda actual:
 * - `sin_ronda`: la ronda todavía no se inició para él;
 * - `sin_evaluacion`: ronda iniciada, sin ninguna evaluación (ni borrador);
 * - `borrador`: solo hay un borrador, ninguna evaluación cerrada;
 * - `cerrada`: tiene al menos una evaluación cerrada (completa o corregida). Un borrador de visita nueva encima no cambia el estado.
 */
export type EstadoIndividuoRonda = 'sin_ronda' | 'sin_evaluacion' | 'borrador' | 'cerrada';

/** Orden en que se presentan los estados (de lo que falta a lo hecho). */
export const ESTADOS_INDIVIDUO_RONDA: readonly EstadoIndividuoRonda[] = ['sin_ronda', 'sin_evaluacion', 'borrador', 'cerrada'];

/** El estado de una fila de la planilla de ronda (`obtener_planilla_ronda`) en el vocabulario del contrato. */
export function estadoDesdePlanilla(estado: EstadoFilaPlanilla): EstadoIndividuoRonda {
  switch (estado) {
    case 'sin_ronda': return 'sin_ronda';
    case 'sin_iniciar': return 'sin_evaluacion';
    case 'borrador': return 'borrador';
    case 'completa': return 'cerrada';
    // Fase 5 (G3): «No evaluada en esta ronda» está resuelta (no es pendiente) aunque no tenga evaluación cerrada.
    case 'no_evaluada': return 'cerrada';
  }
}

/**
 * El estado de un ítem del ranking por grupos en el vocabulario del contrato. El ranking no distingue un borrador de «sin
 * evaluación» (`sin_evaluacion` incluye a quien solo tiene un borrador), así que nunca devuelve `borrador`. Todo estado que tiene
 * evaluación cerrada (comparable, pocas plantas, excluida por revisión, no comparable, sin datos) es `cerrada`. `sin_version` (no hay
 * versión de puntaje activa) no dice nada del individuo: devuelve `null`.
 */
export function estadoDesdeRanking(estado: EstadoRanking): EstadoIndividuoRonda | null {
  switch (estado) {
    case 'sin_ronda': return 'sin_ronda';
    case 'sin_evaluacion': return 'sin_evaluacion';
    case 'sin_version': return null;
    case 'comparable':
    case 'pocas_plantas':
    case 'excluida_revision':
    case 'no_comparable':
    case 'sin_datos':
      return 'cerrada';
  }
}

/**
 * **Definición única de «pendiente de evaluación»: no tiene ninguna evaluación cerrada en la ronda actual.** Incluye a quien no tiene
 * ronda, a quien no empezó y a quien solo tiene un borrador. No incluye a quien quedó fuera del ranking (excluida por revisión, sin
 * datos, no comparable, pocas plantas): esa evaluación existe y está cerrada. Es la misma regla de `sinEvaluacionCompleta`
 * (`api/rankingGrupos.ts`), ampliada con el borrador de la planilla.
 */
export const esPendienteDeEvaluacion = (estado: EstadoIndividuoRonda): boolean => estado !== 'cerrada';

/**
 * «Sin empezar»: ronda iniciada y ni siquiera un borrador. Es lo que hoy cuenta la píldora «Pendientes» de la planilla y que, por la
 * decisión E16, pasa a llamarse «Sin empezar»: un subconjunto más angosto que `esPendienteDeEvaluacion` (decisión E15), que también
 * incluye a quien no tiene ronda y a quien solo tiene un borrador.
 */
export const esSinEmpezar = (estado: EstadoIndividuoRonda): boolean => estado === 'sin_evaluacion';

/** Cuántos individuos hay en cada estado y cuántos están pendientes de evaluación. */
export function contarEstados(estados: readonly EstadoIndividuoRonda[]): Record<EstadoIndividuoRonda, number> & { pendientes: number; total: number } {
  const cuenta = { sin_ronda: 0, sin_evaluacion: 0, borrador: 0, cerrada: 0 };
  for (const e of estados) cuenta[e] += 1;
  return { ...cuenta, pendientes: cuenta.sin_ronda + cuenta.sin_evaluacion + cuenta.borrador, total: estados.length };
}
