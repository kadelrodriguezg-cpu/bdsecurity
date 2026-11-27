/**
 * Comparación de rondas (deltas) — consume obtener_comparacion_rondas
 * (Sprint 5, docs/BDSecurity_Documento_Maestro.md 2.2). Los deltas se
 * calculan SIEMPRE entre rondas consecutivas del mismo tipo_ronda; nunca se
 * mezclan las series anual y multisitio. Los umbrales de etiqueta viven en
 * scoring_version (configurables sin migración), la RPC los devuelve para
 * que la UI pueda mostrarlos como criterio.
 */
import { supabase, traducirError } from './client';
import type { CategoriaScoring } from './scoring';

export type EtiquetaDelta =
  | 'estable'
  | 'mejoro_leve'
  | 'empeoro_leve'
  | 'mejoro_marcado'
  | 'empeoro_marcado';

export const ETIQUETA_DELTA_LABEL: Record<EtiquetaDelta, string> = {
  estable: 'Estable',
  mejoro_leve: 'Mejoró leve',
  empeoro_leve: 'Empeoró leve',
  mejoro_marcado: 'Mejoró marcado',
  empeoro_marcado: 'Empeoró marcado',
};

export interface DeltaCategoria {
  categoria: CategoriaScoring;
  valor_anterior: number | null;
  valor_actual: number | null;
  delta: number | null;
  etiqueta: EtiquetaDelta | null;
}

export interface DeltaParametro {
  metrica: string;
  categoria: CategoriaScoring;
  valor_anterior: number | null;
  valor_actual: number | null;
  normalizado_anterior: number | null;
  normalizado_actual: number | null;
  delta: number | null;
  etiqueta: EtiquetaDelta | null;
}

export interface ComparacionIndividuo {
  individuo_id: string;
  codigo_display: string;
  tipo_ronda: 'anual' | 'multisitio';
  numero_anterior: number;
  numero_actual: number;
  deltas_categoria: DeltaCategoria[];
  deltas_parametro: DeltaParametro[];
}

export interface ComparacionRondasResponse {
  individuos: ComparacionIndividuo[];
  umbrales: { leve: number; marcado: number } | null;
}

/** Un individuo puntual o un cruce completo — exactamente uno de los dos. */
export async function obtenerComparacionRondas(query: {
  individuoId?: string;
  plantaId?: string;
}): Promise<ComparacionRondasResponse> {
  if ((query.individuoId === undefined) === (query.plantaId === undefined)) {
    throw new Error('La comparación exige exactamente un individuo o un cruce.');
  }
  const { data, error } = await supabase.rpc('obtener_comparacion_rondas', {
    p_individuo_id: query.individuoId,
    p_planta_id: query.plantaId,
  });
  if (error) throw traducirError(error);
  return data as unknown as ComparacionRondasResponse;
}
