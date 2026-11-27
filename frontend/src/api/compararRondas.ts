/**
 * Lecturas de «Comparar rondas» de un individuo (Fase 2, S3-3). Solo lectura,
 * sin migraciones: las rondas con su evaluación cerrada salen de las tablas
 * (RLS de siempre) y los puntajes de rondas pasadas salen de los rankings
 * congelados, porque ninguna RPC calcula el puntaje y el grupo de una
 * evaluación que ya no es la vigente. Nada de esto expone linaje.
 */
import { supabase, traducirError } from './client';
import type { EvaluacionRow } from './rondas';
import type { CategoriaScoring } from './scoring';

export interface RondaComparable {
  id: string;
  numero_ronda: number;
  anio: number | null;
  fecha_inicio: string | null;
  created_at?: string | null;
  /** Evaluación cerrada (completa o corregida) más reciente de la ronda; null si aún no hay. */
  evaluacion: EvaluacionRow | null;
}

export interface IndividuoComparable {
  id: string;
  codigo_display: string;
  planta_id: string;
}

export interface RondasDeIndividuo {
  individuo: IndividuoComparable;
  rondas: RondaComparable[];
}

type FilaRonda = Omit<RondaComparable, 'evaluacion'> & {
  individuo: IndividuoComparable;
  evaluaciones: EvaluacionRow[];
};

/** Misma elección que la comparación de la base: la más reciente por fecha, luego por actualización. */
export function evaluacionCerradaDeRonda(evaluaciones: readonly EvaluacionRow[]): EvaluacionRow | null {
  const cerradas = evaluaciones.filter((e) => e.estado === 'completa' || e.estado === 'corregida');
  cerradas.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
  return cerradas[0] ?? null;
}

/** Rondas anuales del individuo (serie propia; la multisitio no se mezcla) con su evaluación cerrada. */
export async function listarRondasDeIndividuo(individuoId: string): Promise<RondasDeIndividuo | null> {
  const { data, error } = await supabase
    .from('ronda_evaluacion_anual')
    .select('id, numero_ronda, anio, fecha_inicio, created_at, individuo:individuos!inner(id, codigo_display, planta_id), evaluaciones(*)')
    .eq('individuo_id', individuoId)
    .eq('tipo_ronda', 'anual')
    .order('numero_ronda');
  if (error) throw traducirError(error);
  const filas = (data ?? []) as unknown as FilaRonda[];
  if (filas.length === 0) return null;
  return {
    individuo: filas[0].individuo,
    rondas: filas.map(({ evaluaciones, individuo: _individuo, ...ronda }) => ({ ...ronda, evaluacion: evaluacionCerradaDeRonda(evaluaciones) })),
  };
}

export interface PuntajeCongelado {
  evaluacion_id: string;
  puntaje: number;
  /** Solo en rankings por grupos; los congelados antes de la Fase 2 no lo traen. */
  grupo: CategoriaScoring[] | null;
  posicion_grupo: number | null;
  tamano_grupo: number | null;
  scoring_version_nombre: string | null;
  snapshot_nombre: string;
  congelado_at: string;
}

interface FilaCongelada {
  evaluacion_id: string;
  puntaje: number;
  grupo: string[] | null;
  posicion_grupo: number | null;
  detalle: { tamano_grupo?: number; scoring_version_nombre?: string } | null;
  snapshot: { nombre: string; created_at: string };
}

/**
 * Puntajes con que quedó cada evaluación del individuo en los rankings que se
 * congelaron (el más reciente primero). Es la única fuente del puntaje de una
 * ronda que ya no es la vigente.
 */
export async function listarPuntajesCongelados(individuoId: string): Promise<PuntajeCongelado[]> {
  const { data, error } = await supabase
    .from('ranking_snapshot_resultado')
    .select('evaluacion_id, puntaje, grupo, posicion_grupo, detalle, snapshot:ranking_snapshot!inner(nombre, created_at)')
    .eq('individuo_id', individuoId);
  if (error) throw traducirError(error);
  return ((data ?? []) as unknown as FilaCongelada[])
    .map((fila): PuntajeCongelado => ({
      evaluacion_id: fila.evaluacion_id,
      puntaje: Number(fila.puntaje),
      grupo: fila.grupo as CategoriaScoring[] | null,
      posicion_grupo: fila.posicion_grupo,
      tamano_grupo: fila.detalle?.tamano_grupo ?? null,
      scoring_version_nombre: fila.detalle?.scoring_version_nombre ?? null,
      snapshot_nombre: fila.snapshot.nombre,
      congelado_at: fila.snapshot.created_at,
    }))
    .sort((a, b) => b.congelado_at.localeCompare(a.congelado_at));
}
