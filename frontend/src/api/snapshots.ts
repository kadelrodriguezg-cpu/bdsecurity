/**
 * Snapshots de ranking consultables (Sprint 5) — cierra la "función
 * fantasma" del hallazgo Grave del E2E: congelar_ranking existía pero nada
 * listaba ni comparaba lo congelado. Crear un snapshot sigue viviendo en
 * api/scoring.ts (congelarRanking); acá van listar, detalle y comparación.
 */
import { supabase, traducirError } from './client';
import type { CategoriaScoring, DetalleMetrica } from './scoring';
import type { EtiquetaDelta } from './comparacion';

export interface SnapshotCabecera {
  id: string;
  nombre: string;
  alcance: 'cruzamiento' | 'especie';
  scoring_version_id: string;
  scoring_version_nombre: string;
  especie_id: string;
  planta_id: string | null;
  poblacion_comparada: number;
  criterios: {
    modo?: 'grupos';
    empates?: string;
    desempate?: string[];
    exclusiones?: string[];
    seleccion_evaluacion?: string;
    scoring_version_nombre?: string;
  };
  created_by: string;
  created_at: string;
}

export interface SnapshotsListado {
  items: SnapshotCabecera[];
  total: number;
  limite: number;
  offset: number;
}

export interface SnapshotResultado {
  individuo_id: string;
  codigo_display: string;
  evaluacion_id: string;
  posicion: number;
  /** Solo en snapshots por grupos (Fase 2): posición dentro de su grupo de categorías. */
  posicion_grupo?: number | null;
  grupo?: string[] | null;
  puntaje: number;
  detalle: {
    fecha_evaluacion: string;
    numero_ronda: number;
    estado_evaluacion: string;
    scoring_version_id: string;
    scoring_version_nombre: string;
    metricas: Record<string, DetalleMetrica>;
    /** Presente en snapshots congelados desde Sprint 5; los anteriores no lo traen. */
    categorias?: Record<CategoriaScoring, number | null>;
    /** Tamaño del grupo al congelar (solo snapshots por grupos). */
    tamano_grupo?: number;
  };
}

export interface SnapshotDetalle {
  snapshot: SnapshotCabecera;
  resultados: SnapshotResultado[];
}

export interface ComparacionSnapshotIndividuo {
  individuo_id: string;
  codigo_display: string;
  estaba_en_snapshot: boolean;
  esta_en_vivo: boolean;
  puntaje_snapshot: number | null;
  puntaje_vivo: number | null;
  delta: number | null;
  etiqueta: EtiquetaDelta | null;
  categorias_snapshot: Record<CategoriaScoring, number | null> | null;
  categorias_vivo: Record<CategoriaScoring, number | null> | null;
}

export interface ComparacionSnapshotVivo {
  snapshot_id: string;
  scoring_version_snapshot_id: string;
  scoring_version_viva_id: string | null;
  version_cambio: boolean;
  umbrales: { leve: number; marcado: number };
  individuos: ComparacionSnapshotIndividuo[];
}

/** Lista snapshots de un cruce o de una especie — exactamente uno de los dos. */
export async function listarSnapshotsRanking(query: {
  plantaId?: string;
  especieId?: string;
  limite?: number;
  offset?: number;
}): Promise<SnapshotsListado> {
  if ((query.plantaId === undefined) === (query.especieId === undefined)) {
    throw new Error('Indica exactamente un cruce o una especie.');
  }
  const { data, error } = await supabase.rpc('listar_snapshots_ranking', {
    p_planta_id: query.plantaId,
    p_especie_id: query.especieId,
    p_limite: query.limite ?? 25,
    p_offset: query.offset ?? 0,
  });
  if (error) throw traducirError(error);
  return data as unknown as SnapshotsListado;
}

export async function obtenerDetalleSnapshot(snapshotId: string): Promise<SnapshotDetalle> {
  const { data, error } = await supabase.rpc('obtener_detalle_snapshot', {
    p_snapshot_id: snapshotId,
  });
  if (error) throw traducirError(error);
  return data as unknown as SnapshotDetalle;
}

export async function compararSnapshotVivo(snapshotId: string): Promise<ComparacionSnapshotVivo> {
  const { data, error } = await supabase.rpc('comparar_snapshot_vivo', {
    p_snapshot_id: snapshotId,
  });
  if (error) throw traducirError(error);
  return data as unknown as ComparacionSnapshotVivo;
}

/** Cobertura por categoría que `congelar_ranking_grupos` guarda por individuo (nula en snapshots anteriores a la Fase 2). */
export type CoberturaSnapshot = Record<string, Partial<Record<CategoriaScoring, { con_valor: number; total: number }>> | null>;

/**
 * `obtener_detalle_snapshot` todavía no devuelve la cobertura guardada, así que se lee de la tabla (RLS: lectura
 * para autenticados; la columna no contiene linaje). Se pagina porque PostgREST corta en 1.000 filas y un snapshot
 * de especie puede pasar de eso. Pendiente para una migración: que la RPC la incluya y este rodeo desaparezca.
 */
export async function obtenerCoberturaSnapshot(snapshotId: string): Promise<CoberturaSnapshot> {
  const PAGINA = 1000;
  const cobertura: CoberturaSnapshot = {};
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from('ranking_snapshot_resultado')
      .select('individuo_id, cobertura')
      .eq('snapshot_id', snapshotId)
      .order('individuo_id')
      .range(desde, desde + PAGINA - 1);
    if (error) throw traducirError(error);
    for (const fila of data ?? []) cobertura[fila.individuo_id] = fila.cobertura as CoberturaSnapshot[string];
    if ((data?.length ?? 0) < PAGINA) return cobertura;
  }
}
