/**
 * Auditoría integral, Corrida 1, grupo G11: réplica de la capa de datos del
 * frontend (`frontend/src/api/*.ts`) para poder ejecutar «la misma llamada que
 * hace la app» desde Node con un cliente logueado (sujeto al RLS).
 *
 * Cada función respeta la secuencia exacta del original (inserts directos, RPC,
 * dual-write, historial) y los mismos select explícitos. Difiere en una sola
 * cosa: los errores conservan el `code` de Postgres/PostgREST (la app los pasa
 * por `traducirError`, que reemplaza el texto) para poder afirmar sobre ellos.
 *
 * Referencias: plantas.ts, fases.ts, individuos.ts, rondas.ts, scoring.ts,
 * snapshots.ts, comparacion.ts, visualizacion.ts, dashboard.ts,
 * cruzamientosAdmin.ts, emplazamientos.ts, catalogos.ts, variedades.ts.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { siguienteNumeroRonda } from '../envolturas';

export class ErrorBd extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'ErrorBd';
  }
}

/** Equivale a `if (error) throw traducirError(error)` pero conservando el code. */
export function lanzar(error: { code?: string; message?: string } | null): void {
  if (error) throw new ErrorBd(error.message ?? 'error', error.code);
}

/** Ejecuta una llamada y devuelve el error (o null si salió bien). */
export async function falla(f: () => Promise<unknown>): Promise<ErrorBd | null> {
  try {
    await f();
    return null;
  } catch (e) {
    if (e instanceof ErrorBd) return e;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Variedades, cruces, estado
// ---------------------------------------------------------------------------

export async function crearVariedad(c: SupabaseClient, userId: string, especieId: string, nombre: string) {
  const { data, error } = await c
    .from('variedades')
    .insert({ especie_id: especieId, nombre, created_by: userId })
    .select('id, especie_id, nombre, activo')
    .single();
  lanzar(error);
  return data as { id: string; especie_id: string; nombre: string; activo: boolean };
}

export async function crearPlanta(c: SupabaseClient, input: {
  codigo_sistema: string; especie_id: string; cruzamiento?: string; mamaId?: string; papaId?: string; estado?: string; esPrueba?: boolean;
}) {
  const { data, error } = await c
    .from('plantas')
    .insert({
      codigo_sistema: input.codigo_sistema, especie_id: input.especie_id, cruzamiento: input.cruzamiento,
      mama_id: input.mamaId, papa_id: input.papaId, estado: input.estado, es_prueba: input.esPrueba ?? false,
    })
    .select('id, codigo_sistema')
    .single();
  lanzar(error);
  return data as { id: string; codigo_sistema: string };
}

export async function actualizarEstado(c: SupabaseClient, plantaId: string, nuevoEstado: string) {
  const { data, error } = await c.from('plantas').update({ estado: nuevoEstado }).eq('id', plantaId).select('id, estado');
  lanzar(error);
  if (!data || data.length === 0) throw new ErrorBd('No se pudo actualizar el estado: la planta no existe o no tienes permiso.');
}

export async function obtenerFicha(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.rpc('obtener_planta', { p_planta_id: plantaId });
  lanzar(error);
  return data as Record<string, any>;
}

export async function actualizarLinaje(c: SupabaseClient, input: { plantaId: string; cruzamiento: string | null; mamaId: string | null; papaId: string | null }) {
  const { error } = await c.rpc('actualizar_linaje', {
    p_planta_id: input.plantaId, p_cruzamiento: input.cruzamiento, p_mama_id: input.mamaId, p_papa_id: input.papaId,
  });
  lanzar(error);
}

// ---------------------------------------------------------------------------
// Historial (registros_evento) y fases
// ---------------------------------------------------------------------------

async function registrarHistorial(c: SupabaseClient, input: {
  planta_id: string; tipo_evento: string; fecha: string; datos: Record<string, unknown>; created_by: string; notas?: string | null;
}): Promise<{ id: string }> {
  const { data, error } = await c
    .from('registros_evento')
    .insert({
      planta_id: input.planta_id, tipo_evento: input.tipo_evento, fecha: input.fecha,
      datos: input.datos, created_by: input.created_by, notas: input.notas ?? null,
    })
    .select('id')
    .single();
  lanzar(error);
  return data as { id: string };
}

export async function listarPolinizacionEventos(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c
    .from('polinizacion_evento')
    .select('id, planta_id, fecha, n_flores_cruzadas, created_at')
    .eq('planta_id', plantaId)
    .order('fecha')
    .order('created_at');
  lanzar(error);
  return data as Array<{ id: string; planta_id: string; fecha: string; n_flores_cruzadas: number; created_at: string }>;
}

async function sincronizarColumnasLegacyPolinizacion(c: SupabaseClient, plantaId: string) {
  const eventos = await listarPolinizacionEventos(c, plantaId);
  const ultimo = eventos[eventos.length - 1] ?? null;
  const { error } = await c
    .from('plantas')
    .update({ fecha_polinizacion: ultimo?.fecha ?? null, n_flores_cruzadas: ultimo?.n_flores_cruzadas ?? null })
    .eq('id', plantaId);
  lanzar(error);
}

export async function agregarPolinizacionEvento(c: SupabaseClient, userId: string, plantaId: string, input: { fecha: string; n_flores_cruzadas: number; notas?: string | null }) {
  const { data, error } = await c
    .from('polinizacion_evento')
    .insert({ planta_id: plantaId, fecha: input.fecha, n_flores_cruzadas: input.n_flores_cruzadas, created_by: userId })
    .select('id, planta_id, fecha, n_flores_cruzadas, created_at')
    .single();
  lanzar(error);
  await sincronizarColumnasLegacyPolinizacion(c, plantaId);
  await registrarHistorial(c, {
    planta_id: plantaId, tipo_evento: 'polinizacion', fecha: input.fecha,
    datos: { fecha_polinizacion: input.fecha, n_flores_cruzadas: input.n_flores_cruzadas },
    created_by: userId, notas: input.notas,
  });
  return data as { id: string; planta_id: string; fecha: string; n_flores_cruzadas: number };
}

export async function quitarUltimoPolinizacionEvento(c: SupabaseClient, plantaId: string) {
  const eventos = await listarPolinizacionEventos(c, plantaId);
  const ultimo = eventos[eventos.length - 1];
  if (!ultimo) throw new ErrorBd('No hay sesiones de polinización para quitar.');
  const { error } = await c.from('polinizacion_evento').delete().eq('id', ultimo.id);
  lanzar(error);
  await sincronizarColumnasLegacyPolinizacion(c, plantaId);
  return ultimo;
}

export async function actualizarCosecha(c: SupabaseClient, _userId: string, plantaId: string, input: { fecha_cosecha?: string | null; n_semillas?: number | null; hoy: string }) {
  const cambios = { fecha_cosecha: input.fecha_cosecha ?? null, n_semillas: input.n_semillas ?? null };
  const { error } = await c.rpc('guardar_cosecha', { p_planta_id: plantaId, p_cambios: cambios, p_fecha_historial: input.fecha_cosecha ?? input.hoy });
  lanzar(error);
}

export async function agregarCosechaFruto(c: SupabaseClient, userId: string, plantaId: string, cantidadSemillas: number) {
  const { data, error } = await c
    .from('cosecha_fruto')
    .insert({ planta_id: plantaId, cantidad_semillas: cantidadSemillas, created_by: userId, numero_fruto: 0 })
    .select('id, planta_id, numero_fruto, cantidad_semillas, created_at')
    .single();
  lanzar(error);
  return data as { id: string; planta_id: string; numero_fruto: number; cantidad_semillas: number };
}

export async function listarCosechaFrutos(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.from('cosecha_fruto').select('id, planta_id, numero_fruto, cantidad_semillas, created_at').eq('planta_id', plantaId).order('numero_fruto');
  lanzar(error);
  return data as Array<{ id: string; numero_fruto: number; cantidad_semillas: number }>;
}

export async function quitarCosechaFruto(c: SupabaseClient, frutoId: string) {
  const { error } = await c.from('cosecha_fruto').delete().eq('id', frutoId);
  lanzar(error);
}

export async function actualizarSiembra(c: SupabaseClient, _userId: string, plantaId: string, input: {
  escarificacion_subtipo?: string | null; escarificacion_duracion_dias?: number | null; contenedor_id?: string | null;
  insumo_ids: string[]; sustratos: Array<{ sustrato_id: string; porcentaje: number }>; semillas_sembradas?: number | null;
  protocoloEscarificacion?: string | null; hoy: string;
}) {
  const cambios = {
    escarificacion_subtipo: input.escarificacion_subtipo ?? null,
    escarificacion_duracion_dias: input.escarificacion_subtipo === 'estratificacion' ? input.escarificacion_duracion_dias ?? null : null,
    contenedor_id: input.contenedor_id ?? null,
    semillas_sembradas: input.semillas_sembradas ?? null,
  };
  const { error } = await c.rpc('guardar_siembra', {
    p_planta_id: plantaId, p_cambios: cambios, p_insumo_ids: input.insumo_ids,
    p_sustratos: input.sustratos, p_nota: input.protocoloEscarificacion ?? '', p_fecha: input.hoy,
  });
  lanzar(error);
}

export async function listarInsumoIdsDePlanta(c: SupabaseClient, plantaId: string): Promise<string[]> {
  const { data, error } = await c.from('plantas_insumo').select('insumo_id').eq('planta_id', plantaId);
  lanzar(error);
  return (data as Array<{ insumo_id: string }>).map((f) => f.insumo_id);
}

export async function listarSustratosDePlanta(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.from('plantas_sustrato').select('sustrato_id, porcentaje').eq('planta_id', plantaId);
  lanzar(error);
  return data as Array<{ sustrato_id: string; porcentaje: number }>;
}

export async function crearGerminacionEvento(c: SupabaseClient, userId: string, input: { planta_id: string; fecha: string; cantidad_nueva: number }) {
  const { data, error } = await c
    .from('germinacion_evento')
    .insert({ planta_id: input.planta_id, fecha: input.fecha, cantidad_nueva: input.cantidad_nueva, created_by: userId })
    .select('id, planta_id, fecha, cantidad_nueva, created_at')
    .single();
  lanzar(error);
  await registrarHistorial(c, {
    planta_id: input.planta_id, tipo_evento: 'germinacion', fecha: input.fecha,
    datos: { fecha: input.fecha, cantidad_nueva: input.cantidad_nueva }, created_by: userId,
  });
  return data as { id: string; planta_id: string; fecha: string; cantidad_nueva: number };
}

export async function listarGerminacionEventos(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.from('germinacion_evento').select('id, planta_id, fecha, cantidad_nueva, created_at').eq('planta_id', plantaId).order('fecha');
  lanzar(error);
  return data as Array<{ id: string; fecha: string; cantidad_nueva: number }>;
}

// ---------------------------------------------------------------------------
// Individuos
// ---------------------------------------------------------------------------

export async function individualizarPlantas(c: SupabaseClient, plantaId: string, cantidad: number) {
  // Paso 39: la firma vieja ya no es ejecutable por authenticated; la app usa la envoltura con clave de intento.
  const { data, error } = await c.rpc('individualizar_plantas_una_vez', { p_planta_id: plantaId, p_cantidad: cantidad, p_clave: randomUUID() });
  lanzar(error);
  return data as { cantidad: number; codigos: string[] };
}

export async function clonarIndividuo(c: SupabaseClient, userId: string, individuoOrigenId: string, plantaId: string) {
  const { data, error } = await c
    .from('individuos')
    .insert({ planta_id: plantaId, clon_de_id: individuoOrigenId, created_by: userId, codigo_display: '' })
    .select('id, planta_id, codigo_display, clon_de_id, estado_vital, fecha_baja, created_at')
    .single();
  lanzar(error);
  return data as { id: string; planta_id: string; codigo_display: string; clon_de_id: string | null; estado_vital: string; fecha_baja: string | null };
}

export async function listarIndividuosDePlanta(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c
    .from('individuos')
    .select('id, planta_id, codigo_display, clon_de_id, estado_vital, fecha_baja, created_at')
    .eq('planta_id', plantaId);
  lanzar(error);
  return data as Array<{ id: string; planta_id: string; codigo_display: string; clon_de_id: string | null; estado_vital: string; fecha_baja: string | null; created_by?: string }>;
}

export async function resolverIndividuo(c: SupabaseClient, individuoId: string) {
  const { data, error } = await c.from('individuos').select('id, planta_id, codigo_display, estado_vital').eq('id', individuoId).maybeSingle();
  lanzar(error);
  return data as { id: string; planta_id: string; codigo_display: string; estado_vital: string } | null;
}

export async function resumenIndividuosDeCruce(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.rpc('resumen_individuos_cruce', { p_planta_id: plantaId });
  lanzar(error);
  return data as Array<Record<string, any>>;
}

export async function marcarBaja(c: SupabaseClient, input: {
  individuo_id: string; estado_vital: 'descartado' | 'muerto'; fecha_baja: string; criterios: string[]; nota?: string;
}, idempotencyKey: string) {
  const { data, error } = await c.rpc('marcar_baja_individuo', {
    p_individuo_id: input.individuo_id, p_estado: input.estado_vital, p_criterios: input.criterios,
    p_nota: input.nota?.trim() ?? '', p_fecha: input.fecha_baja, p_idempotency_key: idempotencyKey,
  });
  lanzar(error);
  return data as { individuo_id: string; repetido: boolean };
}

export async function previsualizarBajaEnLote(c: SupabaseClient, ids: string[]) {
  const { data, error } = await c.rpc('previsualizar_baja_individuos', { p_ids: ids });
  lanzar(error);
  return data as { limite: number; procesables: Array<{ id: string; codigo_display: string; planta_id: string }>; excluidos: Array<{ id: string; codigo_display: string | null; motivo: string }> };
}

export async function darBajaEnLote(c: SupabaseClient, input: {
  ids: string[]; estado_vital: 'descartado' | 'muerto'; fecha_baja: string; criterios: string[]; nota?: string;
}, idempotencyKey: string) {
  const { data, error } = await c.rpc('dar_baja_individuos', {
    p_ids: input.ids, p_estado: input.estado_vital, p_criterios: input.criterios,
    p_nota: input.nota?.trim() ?? '', p_fecha: input.fecha_baja, p_idempotency_key: idempotencyKey,
  });
  lanzar(error);
  return data as { procesados: number; repetido: boolean };
}

// ---------------------------------------------------------------------------
// Rondas, evaluaciones y PCR
// ---------------------------------------------------------------------------

export async function iniciarRonda(c: SupabaseClient, individuoId: string) {
  // Paso 39: la app usa iniciar_ronda_esperada (serie anual, siguiente número); la firma vieja está cerrada.
  const esperado = await siguienteNumeroRonda(individuoId, 'anual');
  const { data, error } = await c.rpc('iniciar_ronda_esperada', { p_individuo_id: individuoId, p_tipo: 'anual', p_numero_esperado: esperado });
  lanzar(error);
  return data as { ronda_id: string; numero_ronda: number };
}

export async function listarRondas(c: SupabaseClient, individuoId: string, tipo: 'anual' | 'multisitio' = 'anual') {
  const { data, error } = await c
    .from('ronda_evaluacion_anual')
    .select('id, individuo_id, tipo_ronda, numero_ronda, anio, predio_id, fecha_inicio, created_at, scoring_version_id')
    .eq('individuo_id', individuoId)
    .eq('tipo_ronda', tipo)
    .order('numero_ronda');
  lanzar(error);
  return data as Array<{ id: string; individuo_id: string; numero_ronda: number; anio: number | null; scoring_version_id: string | null }>;
}

/** Réplica de `crearEvaluacion`: un 23505 de la clave de idempotencia se trata como éxito y devuelve la fila vieja. */
export async function crearEvaluacion(c: SupabaseClient, userId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<{ id: string }> {
  const { data, error } = await c
    .from('evaluaciones')
    .insert({ ...input, created_by: userId, idempotency_key: idempotencyKey })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505' && (error.message ?? '').includes('evaluaciones_idempotency_key_key')) {
      const { data: existente, error: errorExistente } = await c.from('evaluaciones').select('id').eq('idempotency_key', idempotencyKey).single();
      if (!errorExistente && existente) return existente as { id: string };
    }
    lanzar(error);
  }
  return data as { id: string };
}

export async function actualizarEvaluacion(c: SupabaseClient, evaluacionId: string, cambios: Record<string, unknown>) {
  const { data, error } = await c.from('evaluaciones').update(cambios).eq('id', evaluacionId).select('*').single();
  lanzar(error);
  return data as Record<string, any>;
}

export async function listarEvaluacionesDeRonda(c: SupabaseClient, rondaId: string) {
  const { data, error } = await c.from('evaluaciones').select('*').eq('ronda_id', rondaId).in('estado', ['completa', 'corregida']).order('fecha', { ascending: false });
  lanzar(error);
  return data as Array<Record<string, any>>;
}

export async function buscarBorradorDeRonda(c: SupabaseClient, rondaId: string) {
  const { data, error } = await c.from('evaluaciones').select('*').eq('ronda_id', rondaId).eq('estado', 'borrador').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  lanzar(error);
  return data as Record<string, any> | null;
}

export async function crearPcr(c: SupabaseClient, userId: string, input: { ronda_id: string; realizado: boolean; fecha?: string | null; informe_pdf_url?: string | null }, idempotencyKey: string) {
  const { data, error } = await c
    .from('pcr_analisis')
    .insert({
      ronda_id: input.ronda_id, realizado: input.realizado,
      fecha: input.realizado ? input.fecha ?? null : null,
      informe_pdf_url: input.realizado ? input.informe_pdf_url ?? null : null,
      created_by: userId, idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505' && (error.message ?? '').includes('pcr_analisis_idempotency_key_key')) {
      const { data: existente, error: errorExistente } = await c.from('pcr_analisis').select('id').eq('idempotency_key', idempotencyKey).single();
      if (!errorExistente && existente) return existente as { id: string };
    }
    lanzar(error);
  }
  return data as { id: string };
}

// ---------------------------------------------------------------------------
// Scoring, snapshots, comparación, series, dashboard
// ---------------------------------------------------------------------------

export async function obtenerRanking(c: SupabaseClient, q: { plantaId?: string; especieId?: string; limite?: number; offset?: number; orden?: string }) {
  const { data, error } = await c.rpc('obtener_ranking_operativo', {
    p_planta_id: q.plantaId, p_especie_id: q.especieId, p_limite: q.limite ?? 25, p_offset: q.offset ?? 0, p_orden: q.orden ?? 'puntaje_desc',
  });
  lanzar(error);
  return data as { items: Array<Record<string, any>>; total: number; poblacion_comparada: number; scoring_version_id: string | null; scoring_version_nombre: string | null; criterios: Record<string, any> };
}

export async function listarScoringDePlanta(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.rpc('obtener_scoring_planta', { p_planta_id: plantaId });
  lanzar(error);
  return data as Array<Record<string, any>>;
}

export async function congelarRanking(c: SupabaseClient, input: { nombre: string; plantaId?: string; especieId?: string }) {
  const { data, error } = await c.rpc('congelar_ranking', { p_nombre: input.nombre, p_planta_id: input.plantaId, p_especie_id: input.especieId });
  lanzar(error);
  return data as string;
}

export async function obtenerDetalleSnapshot(c: SupabaseClient, snapshotId: string) {
  const { data, error } = await c.rpc('obtener_detalle_snapshot', { p_snapshot_id: snapshotId });
  lanzar(error);
  return data as { snapshot: Record<string, any>; resultados: Array<Record<string, any>> };
}

export async function compararSnapshotVivo(c: SupabaseClient, snapshotId: string) {
  const { data, error } = await c.rpc('comparar_snapshot_vivo', { p_snapshot_id: snapshotId });
  lanzar(error);
  return data as { snapshot_id: string; scoring_version_snapshot_id: string; scoring_version_viva_id: string | null; version_cambio: boolean; umbrales: { leve: number; marcado: number }; individuos: Array<Record<string, any>> };
}

export async function listarSnapshotsRanking(c: SupabaseClient, q: { plantaId?: string; especieId?: string }) {
  const { data, error } = await c.rpc('listar_snapshots_ranking', { p_planta_id: q.plantaId, p_especie_id: q.especieId, p_limite: 25, p_offset: 0 });
  lanzar(error);
  return data as { items: Array<Record<string, any>>; total: number };
}

export async function obtenerComparacionRondas(c: SupabaseClient, q: { individuoId?: string; plantaId?: string }) {
  const { data, error } = await c.rpc('obtener_comparacion_rondas', { p_individuo_id: q.individuoId, p_planta_id: q.plantaId });
  lanzar(error);
  return data as { individuos: Array<Record<string, any>>; umbrales: { leve: number; marcado: number } | null };
}

export async function obtenerSeriesHistoricas(c: SupabaseClient, q: { especieId: string; plantaId?: string; fechaDesde?: string; fechaHasta?: string }) {
  const { data, error } = await c.rpc('obtener_series_historicas_cientificas', {
    p_especie_id: q.especieId, p_planta_id: q.plantaId, p_fecha_desde: q.fechaDesde, p_fecha_hasta: q.fechaHasta,
  });
  lanzar(error);
  return data as { scoring: Array<{ periodo: string; evaluaciones_elegibles: number; puntaje_promedio: number | null }>; individuos_vivos: Array<{ periodo: string; cantidad: number }>; procedimientos: Array<{ periodo: string; cantidad: number }> };
}

export async function obtenerDashboardCientifico(c: SupabaseClient, especieId?: string, limite = 8) {
  const { data, error } = await c.rpc('obtener_dashboard_cientifico', { p_especie_id: especieId || undefined, p_limite: limite });
  lanzar(error);
  return data as { resumen: Record<string, number>; cambios_recientes: Array<Record<string, any>>; destacados: Array<Record<string, any>>; pendientes: Array<Record<string, any>>; scoring_version_id: string | null; scoring_version_nombre: string | null };
}

export async function listarCrucesAnaliticos(c: SupabaseClient, q: { especieId?: string; limite?: number; offset?: number; orden?: string } = {}) {
  const { data, error } = await c.rpc('listar_cruces_analiticos', {
    p_especie_id: q.especieId, p_estado: undefined, p_busqueda: undefined, p_orden: q.orden ?? 'actividad_desc', p_limite: q.limite ?? 25, p_offset: q.offset ?? 0,
  });
  lanzar(error);
  return data as { items: Array<Record<string, any>>; total: number };
}

// ---------------------------------------------------------------------------
// Administración de cruces, territorio y catálogos
// ---------------------------------------------------------------------------

export async function borrarCruzamiento(c: SupabaseClient, plantaId: string, tipo: 'soft' | 'hard') {
  const { error } = await c.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: tipo });
  lanzar(error);
}

export async function restaurarCruzamiento(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.rpc('restaurar_cruzamiento', { p_planta_id: plantaId });
  lanzar(error);
  return data as Record<string, any>;
}

export async function crearPredio(c: SupabaseClient, input: { nombre: string }) {
  const { data, error } = await c.from('predio').insert(input).select().single();
  lanzar(error);
  return data as { id: string; nombre: string; activo: boolean };
}

export async function listarSectoresOperativos(c: SupabaseClient) {
  const { data, error } = await c
    .from('sector')
    .select('id, nombre, predio_id, predio:predio_id!inner(nombre, activo, sitio:sitio_id!inner(nombre, activo))')
    .eq('activo', true)
    .eq('predio.activo', true)
    .eq('predio.sitio.activo', true)
    .order('nombre');
  lanzar(error);
  return data as unknown as Array<{ id: string; nombre: string; predio_id: string; predio: { nombre: string } }>;
}

export async function registrarTraslado(c: SupabaseClient, input: { individuoId: string; sectorId: string; fechaInicio: string }) {
  const { data, error } = await c.rpc('registrar_traslado_individuo', {
    p_individuo_id: input.individuoId, p_sector_id: input.sectorId, p_fecha_inicio: input.fechaInicio,
  });
  lanzar(error);
  return data as string;
}

export async function listarEmplazamientos(c: SupabaseClient, individuoId: string) {
  const { data, error } = await c
    .from('emplazamiento_individuo')
    .select('id, individuo_id, sector_id, fecha_inicio, fecha_fin')
    .eq('individuo_id', individuoId)
    .order('fecha_inicio', { ascending: false });
  lanzar(error);
  return data as Array<{ id: string; individuo_id: string; sector_id: string; fecha_inicio: string; fecha_fin: string | null }>;
}

export async function obtenerMapaCruce(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.rpc('obtener_mapa_cruce', { p_planta_id: plantaId });
  lanzar(error);
  return data as Record<string, any>;
}

export async function obtenerMapaAgregado(c: SupabaseClient, especieId: string) {
  const { data, error } = await c.rpc('obtener_resumen_mapa_territorial', { p_especie_id: especieId, p_predio_id: undefined, p_sector_id: undefined, p_limite: 100, p_offset: 0 });
  lanzar(error);
  return data as Record<string, any>;
}

export async function crearContenedor(c: SupabaseClient, input: { nombre: string; capacidad_litros?: number | null }) {
  const { data, error } = await c.from('contenedor').insert(input).select().single();
  lanzar(error);
  return data as { id: string };
}

export async function crearInsumo(c: SupabaseClient, input: { nombre: string; tipo: string }) {
  const { data, error } = await c.from('insumo').insert(input).select().single();
  lanzar(error);
  return data as { id: string };
}

export async function crearSustrato(c: SupabaseClient, input: { nombre: string }) {
  const { data, error } = await c.from('sustrato').insert(input).select().single();
  lanzar(error);
  return data as { id: string };
}

export async function listarSustratos(c: SupabaseClient) {
  const { data, error } = await c.from('sustrato').select('*').eq('activo', true).order('nombre');
  lanzar(error);
  return data as Array<{ id: string; nombre: string }>;
}

// ---------------------------------------------------------------------------
// Scoring: gestión de versiones (sin pantalla; el admin lo hace por API)
// ---------------------------------------------------------------------------

export async function nuevaVersionScoring(c: SupabaseClient, input: { baseId: string; nombre: string; vigenteDesde: string; nota?: string }) {
  const { data, error } = await c.rpc('nueva_version_scoring', {
    p_version_base_id: input.baseId, p_nombre: input.nombre, p_vigente_desde: input.vigenteDesde, p_nota: input.nota,
  });
  lanzar(error);
  return data as string;
}

export async function activarVersionScoring(c: SupabaseClient, versionId: string) {
  const { data, error } = await c.rpc('activar_version_scoring', { p_version_id: versionId });
  lanzar(error);
  return data as string;
}

// ---------------------------------------------------------------------------
// Ranking de polinización varietal (solo admin)
// ---------------------------------------------------------------------------

export async function obtenerRankingPolinizacionVarietal(c: SupabaseClient, especieId: string, rol: 'ambos' | 'mama' | 'papa' = 'ambos') {
  const { data, error } = await c.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieId, p_rol: rol });
  lanzar(error);
  const filas = (data ?? []) as Array<Record<string, any>>;
  return {
    filas: filas.filter((f) => f.tipo_fila === 'variedad') as Array<{ variedad_id: string; variedad_nombre: string; flores_totales: number; sesiones_polinizacion: number; cruces_distintos: number }>,
    floresReales: Number(filas.find((f) => f.tipo_fila === 'resumen')?.flores_reales ?? 0),
  };
}

export async function obtenerResumenIndividuos(c: SupabaseClient, plantaId: string) {
  const { data, error } = await c.rpc('obtener_resumen_individuos', { p_planta_id: plantaId });
  lanzar(error);
  return (data ?? {}) as Record<string, {
    count_eval_trasplante: number; count_eval_crecimiento: number; rondas_count: number; rondas_ultima: number | null;
    rondas_multisitio_count: number; emplazamiento_count: number; emplazamiento_predio_nombre: string | null; emplazamiento_sector_nombre: string | null;
  }>;
}

export async function obtenerRankingGlobal(c: SupabaseClient, q: { especieId: string; plantaId?: string; fechaDesde?: string; fechaHasta?: string; estadoVital?: 'vivo' | 'descartado' | 'muerto' | null; limite?: number; offset?: number; orden?: string }) {
  const { data, error } = await c.rpc('obtener_ranking_global_filtrado', {
    p_especie_id: q.especieId, p_planta_id: q.plantaId, p_fecha_desde: q.fechaDesde, p_fecha_hasta: q.fechaHasta,
    p_estado_vital: q.estadoVital === undefined ? 'vivo' : q.estadoVital,
    p_limite: q.limite ?? 25, p_offset: q.offset ?? 0, p_orden: q.orden ?? 'puntaje_desc',
  });
  lanzar(error);
  return data as { items: Array<Record<string, any>>; total: number; poblacion_comparada: number; scoring_version_id: string | null };
}
