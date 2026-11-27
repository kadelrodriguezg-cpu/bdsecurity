/**
 * Ranking por grupos de categorías (Fase 2, Sprint 1; migración
 * 20261023100000). Cada individuo compite solo con los que midieron las mismas
 * categorías del motor; la posición es dentro de su grupo y solo existe si el
 * grupo alcanza el mínimo configurado. Los conteos son de la población
 * completa (A1-077). La RPC nunca expone linaje.
 */
import { supabase, traducirError } from './client';
import { listarScoringDePlanta, type CategoriaScoring, type DetalleMetrica } from './scoring';

export type EstadoRanking =
  | 'comparable'
  | 'pocas_plantas'
  | 'excluida_revision'
  | 'no_comparable'
  | 'sin_datos'
  | 'sin_evaluacion'
  | 'sin_ronda'
  | 'sin_version';

export const ESTADO_RANKING_LABEL: Record<EstadoRanking, string> = {
  comparable: 'Comparable',
  pocas_plantas: 'Pocas plantas para comparar',
  excluida_revision: 'Excluida por revisión',
  no_comparable: 'Marcada como no comparable',
  sin_datos: 'Sin datos de ninguna categoría',
  sin_evaluacion: 'Sin evaluación cerrada en la ronda actual',
  sin_ronda: 'Sin ronda iniciada',
  sin_version: 'Sin puntaje disponible',
};

export interface CoberturaCategoria {
  con_valor: number;
  total: number;
}

export interface ItemRankingGrupos {
  individuo_id: string;
  codigo_display: string;
  planta_id: string;
  codigo_sistema: string;
  especie_id: string;
  es_prueba: boolean;
  evaluacion_id: string | null;
  fecha_evaluacion: string | null;
  numero_ronda: number | null;
  requiere_revision: boolean;
  no_comparable: boolean;
  tiene_metrica_marcada: boolean;
  puntaje: number | null;
  grupo: CategoriaScoring[];
  cobertura: Partial<Record<CategoriaScoring, CoberturaCategoria>>;
  detalle_categorias: Partial<Record<CategoriaScoring, number | null>>;
  estado_ranking: EstadoRanking;
  tamano_grupo: number | null;
  posicion_grupo: number | null;
}

export interface GrupoRanking {
  categorias: CategoriaScoring[];
  n: number;
  con_posicion: boolean;
}

export interface RankingPorGrupos {
  scoring_version_id: string | null;
  scoring_version_nombre: string | null;
  minimo_evaluaciones_grupo: number;
  cobertura_advertencia: number;
  poblacion: {
    total: number;
    comparables: number;
    con_posicion: number;
    pocas_plantas: number;
    excluidas_revision: number;
    no_comparables: number;
    sin_datos: number;
    sin_evaluacion: number;
    sin_version: number;
  };
  grupos: GrupoRanking[];
  items: ItemRankingGrupos[];
  /** v3 paso 8 (N38): la temporada pedida (null = la última ronda de cada individuo). */
  numero_ronda?: number | null;
  /** v3 paso 8: rondas anuales del alcance (individuos vivos con esa ronda y cuántos la tienen cerrada). */
  rondas?: Array<{ numero: number; individuos: number; con_cerrada: number }>;
}

export async function obtenerRankingPorGrupos(alcance: { plantaId?: string; especieId?: string; incluirPruebas?: boolean; numeroRonda?: number }): Promise<RankingPorGrupos> {
  const { data, error } = await supabase.rpc('obtener_ranking_por_grupos', {
    ...(alcance.plantaId ? { p_planta_id: alcance.plantaId } : { p_especie_id: alcance.especieId }),
    p_incluir_pruebas: alcance.incluirPruebas ?? false,
    ...(alcance.numeroRonda ? { p_numero_ronda: alcance.numeroRonda } : {}),
  } as never);
  if (error) throw traducirError(error);
  return data as unknown as RankingPorGrupos;
}

/** Misma clave de grupo que la base (categorías en orden del enum). */
export const claveGrupo = (categorias: readonly string[]) => categorias.join(',');

/** Categorías del grupo con cobertura bajo el umbral de advertencia (decisión: < 50 % en ámbar). */
export function categoriasConCoberturaBaja(item: Pick<ItemRankingGrupos, 'grupo' | 'cobertura'>, umbral: number): CategoriaScoring[] {
  return item.grupo.filter((c) => {
    const cob = item.cobertura[c];
    return cob !== undefined && cob.total > 0 && cob.con_valor / cob.total < umbral;
  });
}

/**
 * «Pendiente de evaluación» = sin evaluación cerrada en la ronda actual. No es lo mismo que tener el puntaje nulo:
 * una evaluación completa puede quedar sin puntaje (excluida por revisión, no comparable, sin datos) y aun así
 * está evaluada. Es la misma definición del ranking por grupos, para que ninguna pantalla lo contradiga.
 */
export const sinEvaluacionCompleta = (item: Pick<ItemRankingGrupos, 'estado_ranking'>) =>
  item.estado_ranking === 'sin_ronda' || item.estado_ranking === 'sin_evaluacion';

/** Individuos que comparten puesto con otro de su grupo (mismo puntaje publicado): se muestran como «3=». */
export function individuosEmpatados(items: readonly Pick<ItemRankingGrupos, 'individuo_id' | 'grupo' | 'posicion_grupo'>[]): Set<string> {
  return new Set(empatesPorIndividuo(items).keys());
}

/** Fase 5 (G19): con cuántos otros comparte cada individuo su puesto en el grupo (solo los que empatan). */
export function empatesPorIndividuo(items: readonly Pick<ItemRankingGrupos, 'individuo_id' | 'grupo' | 'posicion_grupo'>[]): Map<string, number> {
  const cuenta = new Map<string, number>();
  const clave = (i: Pick<ItemRankingGrupos, 'grupo' | 'posicion_grupo'>) => `${claveGrupo(i.grupo)}|${i.posicion_grupo}`;
  for (const i of items) if (i.posicion_grupo !== null) cuenta.set(clave(i), (cuenta.get(clave(i)) ?? 0) + 1);
  const empates = new Map<string, number>();
  for (const i of items) {
    const n = i.posicion_grupo !== null ? (cuenta.get(clave(i)) ?? 0) - 1 : 0;
    if (n > 0) empates.set(i.individuo_id, n);
  }
  return empates;
}

/** Quién compite en un grupo: comparable (con o sin posición todavía). Lo demás queda fuera de toda comparación. */
export const esDelGrupo = (item: Pick<ItemRankingGrupos, 'estado_ranking'>) =>
  item.estado_ranking === 'comparable' || item.estado_ranking === 'pocas_plantas';

/**
 * Valores crudos de los descriptores (detalle_metricas) de los individuos que
 * el ranking por grupos considera. La RPC por grupos no los devuelve (solo
 * subpuntajes por categoría), así que se leen del scoring por cruce
 * (obtener_scoring_planta, sin tope de filas) y se cruzan por individuo. Solo
 * se usa el valor si es de la MISMA evaluación que el ranking por grupos: si
 * difieren, el individuo queda sin dato en vez de mostrar otro valor.
 * De esa lectura no se muestra ningún puntaje ni posición.
 */
export async function obtenerValoresParametros(
  items: readonly Pick<ItemRankingGrupos, 'individuo_id' | 'planta_id' | 'evaluacion_id'>[],
): Promise<Record<string, Record<string, DetalleMetrica>>> {
  const plantas = [...new Set(items.map((i) => i.planta_id))];
  const lecturas = await Promise.all(plantas.map((plantaId) => listarScoringDePlanta(plantaId)));
  const evaluacionDe = new Map(items.map((i) => [i.individuo_id, i.evaluacion_id]));
  const valores: Record<string, Record<string, DetalleMetrica>> = {};
  for (const fila of lecturas.flat()) {
    if (!evaluacionDe.has(fila.individuo_id)) continue;
    if (fila.evaluacion_id !== evaluacionDe.get(fila.individuo_id)) continue;
    valores[fila.individuo_id] = fila.detalle_metricas ?? {};
  }
  return valores;
}

/** Congela el ranking por grupos (solo admin; solo filas con posición en su grupo). Mismo ranking que se muestra. */
export async function congelarRankingGrupos(input: { nombre: string; plantaId?: string; especieId?: string }): Promise<string> {
  if ((input.plantaId === undefined) === (input.especieId === undefined)) {
    throw new Error('Indica exactamente un cruce o una especie.');
  }
  const { data, error } = await supabase.rpc('congelar_ranking_grupos', {
    p_nombre: input.nombre,
    ...(input.plantaId ? { p_planta_id: input.plantaId } : { p_especie_id: input.especieId }),
  });
  if (error) throw traducirError(error);
  return data as string;
}

/** El cierre de esa temporada ya existe en la especie (no se duplica). */
export class CierreYaExiste extends Error {}

/** Año de una temporada (ronda anual N) de la especie (fase 4; lo sigue usando la app anterior). */
export async function obtenerAnioTemporada(especieId: string, numeroRonda: number): Promise<number | null> {
  const { data, error } = await supabase.rpc('anio_temporada', { p_especie_id: especieId, p_numero_ronda: numeroRonda });
  if (error) throw traducirError(error);
  return data ?? null;
}

/** Etiqueta de la temporada (ronda anual N) de la especie, «AAAA-AAAA+1» (fase 5, G2), para sugerir el nombre del cierre. */
export async function obtenerTemporadaSugerida(especieId: string, numeroRonda: number): Promise<string | null> {
  const { data, error } = await supabase.rpc('temporada_sugerida', { p_especie_id: especieId, p_numero_ronda: numeroRonda });
  if (error) throw traducirError(error);
  return data ?? null;
}

export interface TemporadaRonda { planta_id: string | null; tipo_ronda: 'anual' | 'multisitio'; numero_ronda: number; etiqueta: string }

/** Etiquetas de temporada de la especie: por cruce y serie, y (planta_id nulo) la de toda la especie por ronda anual. */
export async function listarTemporadasEspecie(especieId: string): Promise<TemporadaRonda[]> {
  const { data, error } = await supabase.rpc('temporadas_especie', { p_especie_id: especieId });
  if (error) throw traducirError(error);
  return (data ?? []) as TemporadaRonda[];
}

/**
 * «Cerrar temporada y congelar ranking» (solo admin): congela el ranking por grupos de la temporada con el nombre que
 * eligió el admin (sugerido «Temporada AAAA-AAAA+1», fase 5). Si ya existe ese nombre en la especie, lanza `CierreYaExiste`.
 */
export async function cerrarTemporada(especieId: string, numeroRonda: number, nombre: string): Promise<{ snapshot_id: string; nombre: string; poblacion: number }> {
  const { data, error } = await supabase.rpc('cerrar_temporada_ranking', { p_especie_id: especieId, p_numero_ronda: numeroRonda, p_nombre: nombre });
  if (error?.code === '23505') throw new CierreYaExiste(error.message);
  if (error) throw traducirError(error);
  return data as unknown as { snapshot_id: string; nombre: string; poblacion: number };
}
