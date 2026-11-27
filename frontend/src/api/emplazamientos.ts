import { supabase, traducirError } from './client';

export interface Emplazamiento {
  id: string;
  individuo_id: string;
  sector_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  sector_nombre: string;
  predio_nombre: string;
  sitio_nombre: string;
}

export interface SectorOperativo {
  id: string;
  nombre: string;
  predio_id: string;
  predio_nombre: string;
  sitio_nombre: string;
}

type EmplazamientoFila = Omit<Emplazamiento, 'sector_nombre' | 'predio_nombre' | 'sitio_nombre'> & {
  sector: {
    nombre: string;
    predio: { nombre: string; sitio: { nombre: string } | null } | null;
  } | null;
};

export async function listarEmplazamientos(individuoId: string): Promise<Emplazamiento[]> {
  const { data, error } = await supabase
    .from('emplazamiento_individuo')
    .select('id, individuo_id, sector_id, fecha_inicio, fecha_fin, sector:sector_id(nombre, predio:predio_id(nombre, sitio:sitio_id(nombre)))')
    .eq('individuo_id', individuoId)
    .order('fecha_inicio', { ascending: false });
  if (error) throw traducirError(error);
  return (data as unknown as EmplazamientoFila[]).map((fila) => ({
    id: fila.id,
    individuo_id: fila.individuo_id,
    sector_id: fila.sector_id,
    fecha_inicio: fila.fecha_inicio,
    fecha_fin: fila.fecha_fin,
    sector_nombre: fila.sector?.nombre ?? '—',
    predio_nombre: fila.sector?.predio?.nombre ?? '—',
    sitio_nombre: fila.sector?.predio?.sitio?.nombre ?? '—',
  }));
}

/**
 * Solo destinos completamente válidos: sector activo Y predio activo Y sitio
 * activo (los `!inner` excluyen la fila si el padre no cumple). Antes solo se
 * filtraba sector.activo, así que el dropdown de traslado ofrecía sectores de
 * predios inactivos que el RPC después rechazaba — hallazgo Grave E2E 4.3:
 * la mejora es no ofrecer un destino inválido en primer lugar.
 */
export async function listarSectoresOperativos(): Promise<SectorOperativo[]> {
  const { data, error } = await supabase
    .from('sector')
    .select('id, nombre, predio_id, predio:predio_id!inner(nombre, activo, sitio:sitio_id!inner(nombre, activo))')
    .eq('activo', true)
    .eq('predio.activo', true)
    .eq('predio.sitio.activo', true)
    .order('nombre');
  if (error) throw traducirError(error);
  const filas = (data ?? []) as unknown as Array<{
    id: string;
    nombre: string;
    predio_id: string;
    predio: { nombre: string; sitio: { nombre: string } };
  }>;
  return filas.map((sector) => ({
    id: sector.id,
    nombre: sector.nombre,
    predio_id: sector.predio_id,
    predio_nombre: sector.predio.nombre,
    sitio_nombre: sector.predio.sitio.nombre,
  }));
}

// --- Mapa por cruce (Sprint 5, obtener_mapa_cruce) ---------------------------

export interface CodigoIndividuoMapa {
  codigo_corto: string;
  vivo: boolean;
}

/**
 * Forma real verificada contra la RPC (Sprint 7): un cluster por predio con
 * conteo; la coordenada viene de predio.latitud/longitud (Sprint 4) y puede
 * ser null — tiene_coordenada lo dice explícitamente. codigos_individuos
 * (mid-fix): código corto (sin repetir el código del cruce, ya redundante
 * en un mapa acotado a un solo cruce) de cada individuo emplazado ahí.
 */
export interface ClusterMapaCruce {
  predio_id: string;
  predio_nombre: string;
  latitud: number | null;
  longitud: number | null;
  tiene_coordenada: boolean;
  individuos: number;
  individuos_vivos: number;
  codigos_individuos: CodigoIndividuoMapa[];
}

export interface MapaCruce {
  planta_id: string;
  total_individuos_emplazados: number;
  clusters: ClusterMapaCruce[];
}

export async function obtenerMapaCruce(plantaId: string): Promise<MapaCruce> {
  const { data, error } = await supabase.rpc('obtener_mapa_cruce', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return data as unknown as MapaCruce;
}

// --- Clima histórico por predio (Sprint 7.5.1, 2.8, obtener_clima_predio) ---

export interface MesClimaPredio {
  anio: number;
  mes: number;
  temp_max_promedio: number | null;
  temp_min_promedio: number | null;
  horas_sol_acumuladas: number | null;
  precipitacion_mm: number | null;
  dias_helada: number | null;
}

export interface ClimaPredio {
  predio_id: string;
  predio_nombre: string;
  tiene_coordenada: boolean;
  sincronizando: boolean;
  meses: MesClimaPredio[];
}

export interface ResumenClimaPredios {
  predios: ClimaPredio[];
}

/** p_predioId XOR p_plantaId — exactamente uno de los dos, igual que obtener_mapa_cruce. */
export async function obtenerClimaPredio(args: { predioId?: string; plantaId?: string }): Promise<ResumenClimaPredios> {
  const { data, error } = await supabase.rpc('obtener_clima_predio', {
    p_predio_id: args.predioId,
    p_planta_id: args.plantaId,
  });
  if (error) throw traducirError(error);
  return data as unknown as ResumenClimaPredios;
}

export async function registrarTraslado(input: {
  individuoId: string;
  sectorId: string;
  fechaInicio: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_traslado_individuo', {
    p_individuo_id: input.individuoId,
    p_sector_id: input.sectorId,
    p_fecha_inicio: input.fechaInicio,
  });
  if (error) throw traducirError(error);
  return data;
}
