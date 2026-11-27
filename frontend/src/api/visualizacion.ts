import { supabase, traducirError } from './client';

export interface PuntoSerieScoring { periodo: string; evaluaciones_elegibles: number; puntaje_promedio: number | null; }
export interface PuntoSerieCantidad { periodo: string; cantidad: number; }

export interface SeriesHistoricasCientificas {
  especie_id: string;
  planta_id: string | null;
  fecha_desde: string;
  fecha_hasta: string;
  scoring: PuntoSerieScoring[];
  individuos_vivos: PuntoSerieCantidad[];
  procedimientos: PuntoSerieCantidad[];
}

export interface CruceEnCluster { planta_id: string; codigo_sistema: string; individuos: number; individuos_vivos: number; }

export interface ClusterTerritorial {
  sitio_id: string; sitio_nombre: string; predio_id: string; predio_nombre: string;
  sector_id: string; sector_nombre: string; individuos: number; individuos_vivos: number;
  /**
   * Coordenada del PREDIO (mid-fix Sprint 7.5, Parte D) — mismo dato no
   * sensible que ya expone obtener_mapa_cruce; null si el predio no fue
   * geolocalizado todavía. Nunca la coordenada fina (emplazamiento_coordenada,
   * admin-only).
   */
  latitud: number | null; longitud: number | null; tiene_coordenada: boolean;
  /** Desglose por cruzamiento dentro de esta ubicación (mid-fix): este mapa es de cruzamientos, no de individuos sueltos. */
  cruces: CruceEnCluster[];
}

export interface MapaAgregado { precision: 'agregada'; total: number; limite: number; offset: number; clusters: ClusterTerritorial[]; }

export interface PuntoViewportAdmin {
  emplazamiento_id: string; sitio_id: string; sitio_nombre: string; predio_id: string; predio_nombre: string;
  sector_id: string; sector_nombre: string; planta_id: string; codigo_sistema: string;
  latitud: number; longitud: number; precision_metros: number | null;
  /** 'exacta' = emplazamiento_coordenada; 'predio' = fallback a predio.latitud/longitud (mid-fix Sprint 7.5). */
  fuente: 'exacta' | 'predio';
}

export interface ViewportAdmin { precision: string; total: number; limite: number; offset: number; puntos: PuntoViewportAdmin[]; }

export async function obtenerSeriesHistoricas(input: { especieId: string; plantaId?: string; fechaDesde?: string; fechaHasta?: string }): Promise<SeriesHistoricasCientificas> {
  if (!input.especieId) throw new Error('Selecciona una especie antes de comparar tendencias.');
  const { data, error } = await supabase.rpc('obtener_series_historicas_cientificas', {
    p_especie_id: input.especieId, p_planta_id: input.plantaId, p_fecha_desde: input.fechaDesde, p_fecha_hasta: input.fechaHasta,
  });
  if (error) throw traducirError(error);
  return data as unknown as SeriesHistoricasCientificas;
}

/** v3 paso 8 (N35): sin `incluirPruebas` la base deja fuera los cruces de prueba; solo un admin puede pedirlos. */
export async function obtenerMapaAgregado(input: { especieId?: string; predioId?: string; sectorId?: string; limite?: number; offset?: number; incluirPruebas?: boolean } = {}): Promise<MapaAgregado> {
  const { data, error } = await supabase.rpc('obtener_resumen_mapa_territorial', {
    p_especie_id: input.especieId, p_predio_id: input.predioId, p_sector_id: input.sectorId, p_limite: input.limite ?? 100, p_offset: input.offset ?? 0,
    ...(input.incluirPruebas ? { p_incluir_pruebas: true } : {}),
  } as never);
  if (error) throw traducirError(error);
  return data as unknown as MapaAgregado;
}

export async function consultarMapaViewport(input: { latitudMinima: number; latitudMaxima: number; longitudMinima: number; longitudMaxima: number; especieId?: string; limite?: number; offset?: number; incluirPruebas?: boolean }): Promise<ViewportAdmin> {
  const { data, error } = await supabase.rpc('consultar_mapa_viewport', {
    p_latitud_minima: input.latitudMinima, p_latitud_maxima: input.latitudMaxima,
    p_longitud_minima: input.longitudMinima, p_longitud_maxima: input.longitudMaxima,
    p_especie_id: input.especieId, p_limite: input.limite ?? 250, p_offset: input.offset ?? 0,
    ...(input.incluirPruebas ? { p_incluir_pruebas: true } : {}),
  } as never);
  if (error) throw traducirError(error);
  return data as unknown as ViewportAdmin;
}
