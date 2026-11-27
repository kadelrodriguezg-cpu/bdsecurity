/**
 * Acceso a plantas. REGLA CENTRAL: la lectura de una ficha individual pasa
 * SIEMPRE por la RPC obtener_planta() (que audita la lectura en el backend),
 * nunca por SELECT directo a la tabla plantas. Los listados usan la vista
 * plantas_operativas, que no expone linaje.
 */
import { supabase, traducirError } from './client';
import type { EstadoPlanta, FichaPlanta } from '@/types/domain';

export interface PlantaListada {
  id: string;
  codigo_sistema: string;
  especie_id: string;
  especie_nombre: string;
  estado: EstadoPlanta;
  updated_at: string;
  fecha_cambio_estado: string;
  es_prueba: boolean;
}

export interface FiltrosPlantas {
  especieId?: string;
  estado?: EstadoPlanta;
  /**
   * Los cruces marcados como prueba (`plantas.es_prueba`) se excluyen por
   * DEFAULT de todo listado operativo: mezclados con población real, confunden
   * sobre qué es dato científico y qué no (era el problema visible en el
   * selector de cruce del Ranking, compartido por la pestaña Snapshots).
   * Se pide `true` solo donde ver la población completa es el punto: la
   * pantalla de administración, el sugeridor de código correlativo, y el
   * toggle "Incluir pruebas" del Ranking.
   */
  incluirPruebas?: boolean;
}

export type OrdenCrucesAnaliticos =
  | 'actividad_desc'
  | 'codigo_asc'
  | 'estado_asc'
  | 'especie_asc'
  | 'vivos_desc'
  | 'scoring_desc';

export interface CruceAnalitico {
  id: string;
  codigo_sistema: string;
  especie_id: string;
  especie_nombre: string;
  estado: EstadoPlanta;
  individuos_vivos: number;
  ultima_actividad: string;
  scoring_version_id: string | null;
  scoring_version_nombre: string | null;
  individuos_elegibles: number;
  mejor_puntaje: number | null;
  /** v3 (20261024090000): marca por fila; solo llega en true si un admin pidió incluir las pruebas. */
  es_prueba?: boolean;
  /** Fase 4 (20261026110000): ronda actual del cruce (solo en Evaluación anual y Multisitio) con cuántos vivos la tienen cerrada. */
  ronda_actual?: RondaActualCruce | null;
  /** Fase 4: individuos vivos sin evaluación cerrada en la ronda actual (como la planilla). */
  sin_evaluacion_cerrada?: number;
  /** Fase 4: quién hizo lo último (id; el nombre lo da `nombres_de_usuarios`). */
  ultima_actividad_por?: string | null;
}

export interface RondaActualCruce {
  tipo: 'anual' | 'multisitio';
  numero: number;
  anio: number | null;
  cerradas: number;
  vivos: number;
}

export interface CrucesAnaliticosResponse {
  items: CruceAnalitico[];
  total: number;
  limite: number;
  offset: number;
  orden: OrdenCrucesAnaliticos;
}

export interface ConsultaCrucesAnaliticos extends FiltrosPlantas {
  busqueda?: string;
  /** v3 paso 7: solo cruces con individuos vivos sin evaluación cerrada en la última ronda (como la planilla). */
  soloPendientes?: boolean;
  orden?: OrdenCrucesAnaliticos;
  limite?: number;
  offset?: number;
}

const COLUMNAS_PLANTA_LISTADA = 'id, codigo_sistema, especie_id, especie_nombre, estado, updated_at, fecha_cambio_estado, es_prueba';

/**
 * Filas que se piden por consulta. `max_rows` de PostgREST puede ser menor (en
 * el proyecto hosted se configura en el dashboard, no en config.toml), así que
 * no se supone que una respuesta corta sea la última.
 */
const FILAS_POR_CONSULTA = 1000;

export interface FiltrosPlantasPagina extends FiltrosPlantas {
  /** Estados que no se quieren en la página (p. ej. los cruces sin empezar o finalizados). */
  excluirEstados?: EstadoPlanta[];
}

export interface PaginaPlantas {
  items: PlantaListada[];
  total: number;
}

function consultaPlantas(filtros: FiltrosPlantasPagina, opciones: { contar?: boolean } = {}) {
  // Orden total (codigo_sistema es único): sin eso, paginar con range podría
  // repetir u omitir cruces entre una página y la siguiente.
  let query = supabase
    .from('plantas_operativas')
    .select(COLUMNAS_PLANTA_LISTADA, opciones.contar ? { count: 'exact' } : undefined)
    .order('fecha_cambio_estado', { ascending: false })
    .order('codigo_sistema');
  if (filtros.especieId) query = query.eq('especie_id', filtros.especieId);
  if (filtros.estado) query = query.eq('estado', filtros.estado);
  if (!filtros.incluirPruebas) query = query.eq('es_prueba', false);
  if (filtros.excluirEstados?.length) query = query.not('estado', 'in', `(${filtros.excluirEstados.join(',')})`);
  return query;
}

/**
 * Listado COMPLETO para selectores y para el sugeridor de código correlativo,
 * que necesitan todos los cruces. Consume la vista SIN linaje. Sigue pidiendo
 * desde la última fila recibida hasta que una respuesta vuelve vacía: una sola
 * consulta se cortaba en silencio en `max_rows` cruces (B8), y cortar cuando
 * una página trae menos de lo pedido falla igual si `max_rows` es menor.
 */
export async function listarPlantas(filtros: FiltrosPlantas = {}): Promise<PlantaListada[]> {
  const todas: PlantaListada[] = [];
  for (;;) {
    const desde = todas.length;
    const { data, error } = await consultaPlantas(filtros).range(desde, desde + FILAS_POR_CONSULTA - 1);
    if (error) throw traducirError(error);
    if (data.length === 0) return todas;
    todas.push(...(data as PlantaListada[]));
  }
}

/** Una página del listado, paginada en el servidor, con el total de cruces que cumplen el filtro. */
export async function listarPlantasPagina(
  filtros: FiltrosPlantasPagina = {},
  pagina: { limite: number; offset?: number },
): Promise<PaginaPlantas> {
  const offset = pagina.offset ?? 0;
  const { data, error, count } = await consultaPlantas(filtros, { contar: true }).range(offset, offset + pagina.limite - 1);
  if (error) throw traducirError(error);
  return { items: data as PlantaListada[], total: count ?? 0 };
}

export async function listarCrucesAnaliticos(
  consulta: ConsultaCrucesAnaliticos = {},
): Promise<CrucesAnaliticosResponse> {
  const { data, error } = await supabase.rpc('listar_cruces_analiticos', {
    p_especie_id: consulta.especieId,
    p_estado: consulta.estado,
    p_busqueda: consulta.busqueda,
    p_orden: consulta.orden ?? 'actividad_desc',
    p_limite: consulta.limite ?? 25,
    p_offset: consulta.offset ?? 0,
    // v3 (migración 20261024090000): los cruces de prueba solo si un admin los pide; la base ignora el pedido de un operario.
    p_incluir_pruebas: consulta.incluirPruebas ?? false,
    ...(consulta.soloPendientes ? { p_solo_pendientes: true } : {}),
  } as never);
  if (error) throw traducirError(error);
  return data as unknown as CrucesAnaliticosResponse;
}

/**
 * Ficha individual, vía RPC auditada. La forma de la respuesta depende del rol:
 * con permiso de linaje incluye cruzamiento/mama/papa; sin permiso, no.
 */
export async function obtenerFicha(plantaId: string): Promise<FichaPlanta> {
  const { data, error } = await supabase.rpc('obtener_planta', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return data as unknown as FichaPlanta;
}

/**
 * Alta de planta (solo admin; el RLS rechaza a otros). mamaId/papaId
 * reemplazan a los antiguos mama/papa de texto libre (Bloque 3, Parte 3C de
 * la auditoría de UX) — referencian el catálogo `variedades`.
 */
export async function crearPlanta(input: {
  intentoId: string;
  codigo_sistema: string;
  especie_id: string;
  cruzamiento?: string;
  mamaId?: string;
  papaId?: string;
  estado?: EstadoPlanta;
  /**
   * Marca de cruce de prueba. Se fija SOLO acá, al crear: la columna no tiene
   * grant de UPDATE para `authenticated`, así que ni siquiera un admin puede
   * re-marcar un cruce real como prueba para habilitar su purga.
   */
  esPrueba?: boolean;
}): Promise<{ id: string; codigo_sistema: string }> {
  const { data, error } = await supabase
    .from('plantas')
    .insert({
      id: input.intentoId,
      codigo_sistema: input.codigo_sistema,
      especie_id: input.especie_id,
      cruzamiento: input.cruzamiento,
      mama_id: input.mamaId,
      papa_id: input.papaId,
      estado: input.estado,
      es_prueba: input.esPrueba ?? false,
    })
    // OJO: select explícito de columnas NO sensibles. Un select('*') fallaría
    // porque el grant de columna niega leer el linaje directo de la tabla.
    .select('id, codigo_sistema')
    .single();
  if (error?.code === '23505') {
    // Solo recuperar por el UUID de ESTE intento, nunca por un código ajeno.
    // No actualizar: el primer envío puede haber guardado linaje sensible que
    // un formulario recuperado deliberadamente no conserva en localStorage.
    const previa = await supabase.from('plantas').select('id, codigo_sistema').eq('id', input.intentoId).maybeSingle();
    if (previa.error) throw traducirError(previa.error);
    if (previa.data) return previa.data;
  }
  if (error) throw traducirError(error);
  return data;
}

/**
 * Avanza/cambia el estado. El trigger del backend (migración 007) audita el
 * cambio automáticamente; acá no hay que hacer nada extra.
 */
export async function actualizarEstado(plantaId: string, nuevoEstado: EstadoPlanta, estadoEsperado: EstadoPlanta): Promise<void> {
  const { data, error } = await supabase
    .from('plantas')
    .update({ estado: nuevoEstado })
    .eq('id', plantaId)
    .eq('estado', estadoEsperado)
    .select('id, estado'); // select explícito por el grant de columnas
  if (error) throw traducirError(error);
  if (!data || data.length === 0) {
    // RLS puede "negar en silencio" (0 filas afectadas) en vez de dar error.
    throw new Error('La ficha cambió desde otra sesión o ya no está disponible. Recarga sus datos antes de cambiar el estado.');
  }
}

/**
 * Fase 5 (G1): el admin vuelve una fase el cruce, con motivo obligatorio. La base valida el permiso, la fase que el admin
 * tenía a la vista (concurrencia) y que no queden datos huérfanos; sus mensajes de negocio llegan tal cual.
 */
export async function retrocederFase(plantaId: string, estadoActual: EstadoPlanta, motivo: string): Promise<EstadoPlanta> {
  const { data, error } = await supabase.rpc('retroceder_fase_cruce', { p_planta_id: plantaId, p_estado_actual: estadoActual, p_motivo: motivo });
  if (error) throw traducirError(error);
  return data as EstadoPlanta;
}

/** Plantas vivas con la poscosecha de su última ronda anual sin terminar (aviso antes de pasar a Multisitio). */
export async function contarPoscosechaIncompleta(plantaId: string): Promise<number> {
  const { data, error } = await supabase.rpc('poscosecha_incompleta_cruce', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return Number(data ?? 0);
}

/** Resuelve codigo_sistema -> id de planta. Usado para los QR físicos viejos
 * migrados desde Notion, que codifican el codigo_sistema y no el UUID. Lee de
 * la vista sin linaje (igual que listarPlantas): no hace falta pasar por la
 * RPC auditada acá, la lectura real de la ficha sigue yendo por obtener_planta(). */
export async function buscarIdPorCodigoSistema(codigoSistema: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('plantas_operativas')
    .select('id')
    .eq('codigo_sistema', codigoSistema)
    .maybeSingle();
  if (error) throw traducirError(error);
  return data?.id ?? null;
}

/** Conteo de cruces por estado para el inicio, agregado en la base (RPC
 * conteo_cruces_por_estado, B8) en vez de traer todas las filas. La RPC
 * excluye los cruces de prueba, igual que `listarPlantas`: si el conteo los
 * incluyera, el total del inicio no cuadraría con la lista de abajo. */
export async function conteoPorEstado(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('conteo_cruces_por_estado');
  if (error) throw traducirError(error);
  return (data ?? {}) as Record<string, number>;
}
