/**
 * Valores registrados de una ronda para la matriz «Ver valores» de la planilla
 * (Fase 2, Sprint 3, S3-2). Solo admin la usa (la UI la oculta al operario),
 * pero la lectura es la misma de siempre de `evaluaciones` (RLS: cualquier
 * autenticado). Pide únicamente las columnas del esquema de Evaluación anual:
 * nunca linaje. El cruce y la ronda se filtran con la relación (!inner), no con
 * listas de ids en la URL (un cruce de cientos de individuos daba 414).
 */
import { supabase, traducirError } from './client';
import { camposLegibles } from '@/lib/esquemaFase/protocolo';
import { ESQUEMA_EVALUACION_ANUAL, type ClaveEvaluacionAnual } from '@/lib/esquemaFase/evaluacionAnual';
import type { TipoRonda } from './rondas';

export type ValoresEvaluacion = Partial<Record<ClaveEvaluacionAnual, number | string | null>>;

/**
 * Columnas que se leen: descriptores y muestra, sin derivados (la base no los incluye en el protocolo). Incluye los campos
 * desactivados (`rend_t_ha`): las evaluaciones históricas conservan su valor y la matriz lo sigue mostrando.
 */
export const COLUMNAS_VALORES: readonly ClaveEvaluacionAnual[] = camposLegibles(ESQUEMA_EVALUACION_ANUAL).map((c) => c.clave);

/** PostgREST devuelve hasta 1000 filas por página por defecto. */
const TAMANO_PAGINA = 1000;

/** Valores de cada evaluación (borrador, completa o corregida) de la ronda N de un cruce, por id de evaluación. */
export async function listarValoresDeRonda(plantaId: string, numeroRonda: number, tipo: TipoRonda = 'anual'): Promise<Map<string, ValoresEvaluacion>> {
  const valores = new Map<string, ValoresEvaluacion>();
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await supabase
      .from('evaluaciones')
      .select(`id, ${COLUMNAS_VALORES.join(', ')}, ronda:ronda_evaluacion_anual!inner(individuo:individuos!inner(planta_id))`)
      .eq('ronda.individuo.planta_id', plantaId)
      .eq('ronda.numero_ronda', numeroRonda)
      .eq('ronda.tipo_ronda', tipo)
      .in('estado', ['borrador', 'completa', 'corregida'])
      .order('id')
      .range(desde, desde + TAMANO_PAGINA - 1);
    if (error) throw traducirError(error);
    const filas = (data ?? []) as unknown as ({ id: string } & ValoresEvaluacion)[];
    for (const { id, ...resto } of filas) valores.set(id, resto);
    if (filas.length < TAMANO_PAGINA) return valores;
  }
}
