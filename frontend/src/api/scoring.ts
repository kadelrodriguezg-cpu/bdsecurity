import { supabase, traducirError } from './client';

/** Las 5 categorías del enum categoria_scoring (`brotes` entra con la migración 20261025100000, decisión S1). */
export type CategoriaScoring = 'fenologia' | 'fruto_calidad' | 'produccion' | 'brotes' | 'estres';

/**
 * Orden de presentación: el de los pesos de la versión 2 (EF9: 40 · 30 · 15 · 10 · 5), no el del enum de la base. Quien compare
 * con el `grupo` que devuelve la base (que va en orden del enum) debe hacerlo sin depender del orden (`ordenarGrupo`, `mismoGrupo`).
 */
export const CATEGORIAS_SCORING: readonly CategoriaScoring[] = ['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres'];

/**
 * Las categorías que ya existían con la versión de 4 categorías: sus columnas se muestran siempre. Las demás (`brotes`) solo si
 * algún dato las trae: con la versión v1 activa no hay nada que mostrar y una columna vacía confundiría.
 */
export const CATEGORIAS_BASE: readonly CategoriaScoring[] = ['fenologia', 'fruto_calidad', 'produccion', 'estres'];

export const CATEGORIA_LABEL: Record<CategoriaScoring, string> = {
  fruto_calidad: 'Fruto/Calidad',
  produccion: 'Producción',
  fenologia: 'Fenología',
  brotes: 'Brotes y varas',
  estres: 'Estrés',
};

/** Un grupo de categorías en el orden de presentación (por peso), sin importar en qué orden llegó. Devuelve una copia. */
export function ordenarGrupo<T extends string>(grupo: readonly T[]): T[] {
  const rango = (c: string) => { const i = (CATEGORIAS_SCORING as readonly string[]).indexOf(c); return i === -1 ? CATEGORIAS_SCORING.length : i; };
  return [...grupo].sort((a, b) => rango(a) - rango(b));
}

/** Nombres legibles de las métricas de scoring (claves reales de scoring_metrica / evaluaciones). */
export const METRICA_LABEL: Record<string, string> = {
  brotacion: 'Brotación',
  floracion: 'Floración',
  cuaja: 'Cuaja',
  concentracion_cosecha: 'Concentración de cosecha',
  calibre_mm: 'Calibre (mm)',
  firmeza: 'Firmeza',
  color: 'Color',
  bloom: 'Bloom',
  brix: 'Brix',
  rend_kg_planta: 'Rendimiento (kg/planta)',
  rend_t_ha: 'Rendimiento (t/ha)',
  pct_fruta_exportable: 'Fruta exportable (%)',
  dano_calor: 'Daño por calor',
  golpe_sol: 'Golpe de sol',
  caida_fruto: 'Caída de fruto',
  presencia_yemas_florales: 'Presencia de yemas florales',
  precocidad: 'Precocidad',
  vigor_vegetativo: 'Vigor vegetativo',
  color_follaje: 'Color del follaje',
  pct_flores: 'Cobertura floral (%)',
  pct_frutos: 'Cuaja en varas basales (%)',
};

/**
 * Detalle por métrica del ranking (Sprint 5). Las banderas de rango son
 * NULL (no false) cuando la métrica no tiene rango_referencia configurado
 * (hoy: firmeza y bloom) — "no hay rango contra el cual comparar", no
 * "está dentro de rango".
 */
export interface DetalleMetrica {
  valor: number | null;
  peso: number;
  normalizado: number | null;
  fuera_rango_superior: boolean | null;
  fuera_rango_inferior: boolean | null;
}

export interface RankingItem {
  individuo_id: string;
  codigo_display: string;
  planta_id: string;
  codigo_sistema: string;
  especie_id: string;
  estado_vital?: 'vivo' | 'descartado' | 'muerto';
  evaluacion_id: string | null;
  fecha_evaluacion: string | null;
  evaluacion_updated_at: string | null;
  numero_ronda: number | null;
  estado_evaluacion: 'borrador' | 'completa' | 'corregida' | 'anulada' | null;
  requiere_revision: boolean;
  no_comparable: boolean;
  scoring_version_id: string | null;
  scoring_version_nombre: string | null;
  puntaje_ponderado: number | null;
  elegible: boolean;
  motivo_exclusion: string | null;
  detalle_metricas: Record<string, DetalleMetrica>;
  /**
   * Subpuntaje por categoría; NULL = la categoría no tiene ninguna métrica
   * evaluada (nunca 0). Opcional porque no todas las lecturas lo incluyen.
   */
  detalle_categorias?: Record<CategoriaScoring, number | null>;
  posicion: number | null;
}

export type ScoringRow = RankingItem;

export const MOTIVO_EXCLUSION_LABEL: Record<string, string> = {
  evaluacion_parcial: 'Evaluación parcial',
  sin_ronda: 'Sin ronda',
  sin_evaluacion_completa_en_ronda_actual: 'Sin evaluación completa en la ronda actual',
  requiere_revision: 'Requiere revisión',
  no_comparable: 'No comparable',
  sin_version_scoring: 'Sin puntaje disponible',
  version_sin_metricas: 'Puntaje sin descriptores',
  // El motor vigente ya no lo emite (lo reemplazó evaluacion_parcial_en_curso
  // en 20260922205753), pero se conserva: esa migración podría no estar en
  // producción todavía (docs/archivo/PLAN_ROLLBACK_produccion.md).
  faltan_metricas_scoring: 'Faltan descriptores para el puntaje',
  evaluacion_parcial_en_curso: 'Evaluación parcial en curso',
  contiene_metrica_marcada: 'Contiene un descriptor marcado para revisión',
  individuo_descartado: 'Individuo descartado',
  individuo_muerto: 'Individuo muerto',
};

/**
 * Scoring de TODOS los individuos vivos de un cruce, para consumidores
 * secundarios de la ficha (Explorador de individuos, alertas de "pendiente
 * de evaluación") y para leer los valores crudos de los descriptores en
 * Ranking Parámetro. Sin límite de paginación (obtener_scoring_planta reusa
 * el cálculo de calcular_ranking_operativo sin el techo de 100 filas).
 * No es un ranking: las posiciones salen de obtener_ranking_por_grupos
 * (api/rankingGrupos.ts). Pendiente: el puntaje que aún muestran el Explorador
 * y el Expediente sale de esta lectura (exige las 20 métricas).
 */
export async function listarScoringDePlanta(plantaId: string): Promise<ScoringRow[]> {
  const { data, error } = await supabase.rpc('obtener_scoring_planta', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return data as unknown as ScoringRow[];
}

export async function congelarRanking(input: {
  nombre: string;
  plantaId?: string;
  especieId?: string;
}): Promise<string> {
  if ((input.plantaId === undefined) === (input.especieId === undefined)) {
    throw new Error('Indica exactamente un cruce o una especie.');
  }
  const { data, error } = await supabase.rpc('congelar_ranking', {
    p_nombre: input.nombre,
    p_planta_id: input.plantaId,
    p_especie_id: input.especieId,
  });
  if (error) throw traducirError(error);
  return data;
}
