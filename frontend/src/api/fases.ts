/**
 * Datos estructurados por fase (Polinización, Cosecha, Siembra, Traslado:
 * columnas directas en `plantas`; Germinación: tabla satélite
 * `germinacion_evento`). Reemplaza el textarea de notas libres genérico.
 *
 * Cada escritura acá TAMBIÉN crea una fila en `registros_evento` (datos =
 * snapshot de los campos, notas = null) para que "Historial" siga mostrando
 * la cronología del cruce — la fuente de verdad de los DATOS es la columna/
 * tabla estructurada, `registros_evento` es solo el timeline narrativo
 * (decisión explícita del Prompt 6, para no dejar el historial mudo).
 */
import { supabase, traducirError, exigirUsuario } from './client';
import { hoyChileISO } from '@/lib/fechas';
import { subirBinarioEvento, registrarArchivoDeEvento } from './eventos';
import type { Database, Json } from '@/types/database.types';

export type EscarificacionSubtipo = Database['public']['Enums']['escarificacion_subtipo'];

export const ESCARIFICACION_SUBTIPO_LABEL: Record<EscarificacionSubtipo, string> = {
  quimica: 'Química',
  fisica: 'Física',
  estratificacion: 'Estratificación',
};

export interface DatosFase {
  fecha_cosecha: string | null;
  n_semillas: number | null;
  escarificacion_subtipo: EscarificacionSubtipo | null;
  escarificacion_duracion_dias: number | null;
  contenedor_id: string | null;
  predio_id: string | null;
  semillas_sembradas: number | null;
}

// fecha_polinizacion/n_flores_cruzadas quedaron fuera de este SELECT a
// propósito: siguen existiendo en `plantas` (dual-write, Paso A de la
// migración de polinizacion_evento) pero ya no son la fuente de lectura del
// frontend -- el total real se lee de listarPolinizacionEventos(). Cuando el
// Paso B (DROP COLUMN) se aplique, esas dos columnas dejan de existir.
const COLUMNAS_FASE =
  'fecha_cosecha, n_semillas, escarificacion_subtipo, escarificacion_duracion_dias, contenedor_id, predio_id, semillas_sembradas';

export async function obtenerDatosFase(plantaId: string): Promise<DatosFase> {
  const { data, error } = await supabase.from('plantas').select(COLUMNAS_FASE).eq('id', plantaId).single();
  if (error) throw traducirError(error);
  return data as DatosFase;
}

async function usuarioActual(): Promise<string> {
  return (await exigirUsuario()).id;
}

async function registrarHistorial(input: {
  planta_id: string;
  tipo_evento: Database['public']['Enums']['tipo_evento'];
  fecha: string;
  datos: Record<string, unknown>;
  created_by: string;
  notas?: string | null;
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('registros_evento')
    .insert({
      planta_id: input.planta_id,
      tipo_evento: input.tipo_evento,
      fecha: input.fecha,
      datos: input.datos as Json,
      created_by: input.created_by,
      notas: input.notas ?? null,
    })
    .select('id')
    .single();
  if (error) throw traducirError(error);
  return data;
}

/**
 * Última nota libre cargada para un tipo de evento de este cruce (para
 * precargar el textarea de notas al reabrir un formulario de fase — Siembra/
 * Polinización guardan la nota en registros_evento.notas, no en columna
 * dedicada, para no sumar schema nuevo).
 */
async function obtenerUltimaNotaDeTipo(
  plantaId: string,
  tipoEvento: Database['public']['Enums']['tipo_evento'],
): Promise<string | null> {
  const { data, error } = await supabase
    .from('registros_evento')
    .select('notas')
    .eq('planta_id', plantaId)
    .eq('tipo_evento', tipoEvento)
    .is('eliminado_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw traducirError(error);
  return data?.notas ?? null;
}

export const obtenerUltimaNotaPolinizacion = (plantaId: string) => obtenerUltimaNotaDeTipo(plantaId, 'polinizacion');
export const obtenerUltimaNotaSiembra = (plantaId: string) => obtenerUltimaNotaDeTipo(plantaId, 'siembra_semilla');

/**
 * Sube el archivo (si lo hay) ANTES de escribir nada en la base — mismo
 * orden que EventoForm: si falla la subida, no queda ningún dato a medio
 * guardar. Se vincula al registro_evento recién después de creado (ver
 * vincularArchivoSiHay).
 */
async function subirArchivoSiHay(archivo: File | null | undefined, codigoSistema: string) {
  if (!archivo) return null;
  return subirBinarioEvento({ file: archivo, codigoSistema });
}

async function vincularArchivoSiHay(subido: { path: string; tipo: 'foto' | 'video' } | null, registroId: string): Promise<void> {
  if (!subido) return;
  await registrarArchivoDeEvento({ registroId, path: subido.path, tipo: subido.tipo });
}

const hoy = hoyChileISO;

// --- Polinización ------------------------------------------------------------

export interface PolinizacionEvento {
  id: string;
  planta_id: string;
  fecha: string;
  n_flores_cruzadas: number;
  created_at: string;
}

/** N sesiones de polinización por cruce (polinizacion_evento), ordenadas por fecha. El total se calcula sumando, nunca se guarda como número fijo. */
export async function listarPolinizacionEventos(plantaId: string): Promise<PolinizacionEvento[]> {
  const { data, error } = await supabase
    .from('polinizacion_evento')
    .select('id, planta_id, fecha, n_flores_cruzadas, created_at')
    .eq('planta_id', plantaId)
    .order('fecha')
    .order('created_at');
  if (error) throw traducirError(error);
  return data as PolinizacionEvento[];
}

/**
 * Dual-write (Paso A de la migración): plantas.fecha_polinizacion/
 * n_flores_cruzadas siguen existiendo hasta que el Paso B (DROP COLUMN) se
 * aplique. Se mantienen en sync con la ÚLTIMA sesión registrada -- mismo
 * comportamiento "se sobrescribe" que tenían antes de esta migración, ahora
 * ya no son la fuente de verdad del total (esa es la suma de
 * listarPolinizacionEventos()), solo compatibilidad hacia atrás para lo que
 * todavía las lea/audite directamente (ej. reiniciar_cruzamiento).
 */
async function sincronizarColumnasLegacyPolinizacion(plantaId: string): Promise<void> {
  const eventos = await listarPolinizacionEventos(plantaId);
  const ultimo = eventos[eventos.length - 1] ?? null;
  const { error } = await supabase
    .from('plantas')
    .update({
      fecha_polinizacion: ultimo?.fecha ?? null,
      n_flores_cruzadas: ultimo?.n_flores_cruzadas ?? null,
    })
    .eq('id', plantaId);
  if (error) throw traducirError(error);
}

/** "+ Agregar sesión": nueva fila en polinizacion_evento, nunca sobrescribe una sesión anterior. */
export async function agregarPolinizacionEvento(plantaId: string, input: {
  fecha: string;
  n_flores_cruzadas: number;
  notas?: string | null;
  codigoSistema: string;
  archivo?: File | null;
}): Promise<PolinizacionEvento> {
  const usuario = await usuarioActual();
  const subido = await subirArchivoSiHay(input.archivo, input.codigoSistema);
  const { data, error } = await supabase
    .from('polinizacion_evento')
    .insert({ planta_id: plantaId, fecha: input.fecha, n_flores_cruzadas: input.n_flores_cruzadas, created_by: usuario })
    .select('id, planta_id, fecha, n_flores_cruzadas, created_at')
    .single();
  if (error) throw traducirError(error);
  await sincronizarColumnasLegacyPolinizacion(plantaId);
  const registro = await registrarHistorial({
    planta_id: plantaId,
    tipo_evento: 'polinizacion',
    fecha: input.fecha,
    datos: { fecha_polinizacion: input.fecha, n_flores_cruzadas: input.n_flores_cruzadas },
    created_by: usuario,
    notas: input.notas,
  });
  await vincularArchivoSiHay(subido, registro.id);
  return data as PolinizacionEvento;
}

/** "- Quitar última sesión": borra por id (no reconstruye todo el registro), y re-sincroniza las columnas legacy. */
export async function quitarUltimoPolinizacionEvento(plantaId: string): Promise<void> {
  const eventos = await listarPolinizacionEventos(plantaId);
  const ultimo = eventos[eventos.length - 1];
  if (!ultimo) throw new Error('No hay sesiones de polinización para quitar.');
  const { data, error } = await supabase.from('polinizacion_evento').delete().eq('id', ultimo.id).select('id');
  if (error) throw traducirError(error);
  if (!data?.length) throw new Error('No se pudo quitar la sesión: solo quien la registró o un administrador puede quitarla, y debe seguir existiendo.');
  await sincronizarColumnasLegacyPolinizacion(plantaId);
}

// --- Cosecha -------------------------------------------------------------

export interface CosechaFruto {
  id: string;
  planta_id: string;
  numero_fruto: number;
  cantidad_semillas: number;
  created_at: string;
}

export async function actualizarCosecha(plantaId: string, input: {
  fecha_cosecha?: string | null;
  n_semillas?: number | null;
  codigoSistema: string;
  archivo?: File | null;
}): Promise<void> {
  await usuarioActual();
  const subido = await subirArchivoSiHay(input.archivo, input.codigoSistema);
  const { data: registroId, error } = await supabase.rpc('guardar_cosecha', {
    p_planta_id: plantaId,
    p_cambios: { fecha_cosecha: input.fecha_cosecha ?? null, n_semillas: input.n_semillas ?? null },
    p_fecha_historial: input.fecha_cosecha ?? hoy(),
    p_registrar_archivo: Boolean(subido),
  });
  if (error) throw traducirError(error);
  await vincularArchivoSiHay(subido, registroId);
}

/** Frutos de la cosecha de este cruce (numero_fruto correlativo, generado por trigger). */
export async function listarCosechaFrutos(plantaId: string): Promise<CosechaFruto[]> {
  const { data, error } = await supabase
    .from('cosecha_fruto')
    .select('id, planta_id, numero_fruto, cantidad_semillas, created_at')
    .eq('planta_id', plantaId)
    .order('numero_fruto');
  if (error) throw traducirError(error);
  return data as CosechaFruto[];
}

/** "+ Agregar fruto": numero_fruto lo asigna el trigger (correlativo por planta_id). */
export async function agregarCosechaFruto(plantaId: string, cantidadSemillas: number): Promise<CosechaFruto> {
  const usuario = await usuarioActual();
  const { data, error } = await supabase
    .from('cosecha_fruto')
    // numero_fruto es obligatorio en el tipo generado, pero
    // trg_cosecha_fruto_numero lo pisa siempre en el backend (BEFORE INSERT):
    // el 0 acá es un placeholder que nunca llega a persistirse tal cual.
    .insert({ planta_id: plantaId, cantidad_semillas: cantidadSemillas, created_by: usuario, numero_fruto: 0 })
    .select('id, planta_id, numero_fruto, cantidad_semillas, created_at')
    .single();
  if (error) throw traducirError(error);
  return data as CosechaFruto;
}

/** "- Quitar último fruto": borra por id (no reconstruye todo el registro, como pidió Efraín). */
export async function quitarCosechaFruto(frutoId: string): Promise<void> {
  const { data, error } = await supabase.from('cosecha_fruto').delete().eq('id', frutoId).select('id');
  if (error) throw traducirError(error);
  if (!data?.length) throw new Error('No se pudo quitar el fruto: solo quien lo registró o un administrador puede quitarlo, y debe seguir existiendo.');
}

// --- Siembra ---------------------------------------------------------------

export interface SustratoPorcentaje {
  sustrato_id: string;
  porcentaje: number;
}

export async function actualizarSiembra(plantaId: string, input: {
  escarificacion_subtipo?: EscarificacionSubtipo | null;
  escarificacion_duracion_dias?: number | null;
  contenedor_id?: string | null;
  insumo_ids: string[];
  sustratos: SustratoPorcentaje[];
  semillas_sembradas?: number | null;
  protocoloEscarificacion?: string | null;
  codigoSistema: string;
  archivo?: File | null;
}): Promise<void> {
  await usuarioActual();
  const subido = await subirArchivoSiHay(input.archivo, input.codigoSistema);
  const cambios = {
    escarificacion_subtipo: input.escarificacion_subtipo ?? null,
    escarificacion_duracion_dias:
      input.escarificacion_subtipo === 'estratificacion' ? input.escarificacion_duracion_dias ?? null : null,
    contenedor_id: input.contenedor_id ?? null,
    semillas_sembradas: input.semillas_sembradas ?? null,
  };
  const { data: registroId, error } = await supabase.rpc('guardar_siembra', {
    p_planta_id: plantaId,
    p_cambios: { ...cambios, registrar_archivo: Boolean(subido) },
    p_insumo_ids: input.insumo_ids,
    p_sustratos: input.sustratos as unknown as Json,
    p_nota: input.protocoloEscarificacion ?? '',
    p_fecha: hoy(),
  });
  if (error) throw traducirError(error);
  await vincularArchivoSiHay(subido, registroId);
}

export async function listarInsumoIdsDePlanta(plantaId: string): Promise<string[]> {
  const { data, error } = await supabase.from('plantas_insumo').select('insumo_id').eq('planta_id', plantaId);
  if (error) throw traducirError(error);
  return (data as { insumo_id: string }[]).map((f) => f.insumo_id);
}

export async function listarSustratosDePlanta(plantaId: string): Promise<SustratoPorcentaje[]> {
  const { data, error } = await supabase.from('plantas_sustrato').select('sustrato_id, porcentaje').eq('planta_id', plantaId);
  if (error) throw traducirError(error);
  return data as SustratoPorcentaje[];
}

// --- Germinación (serie temporal) ------------------------------------------

export interface GerminacionEvento {
  id: string;
  planta_id: string;
  fecha: string;
  cantidad_nueva: number;
  created_at: string;
}

export async function listarGerminacionEventos(plantaId: string): Promise<GerminacionEvento[]> {
  const { data, error } = await supabase
    .from('germinacion_evento')
    .select('id, planta_id, fecha, cantidad_nueva, created_at')
    .eq('planta_id', plantaId)
    .order('fecha');
  if (error) throw traducirError(error);
  return data as GerminacionEvento[];
}

export async function crearGerminacionEvento(input: {
  planta_id: string;
  fecha: string;
  cantidad_nueva: number;
  codigoSistema: string;
  archivo?: File | null;
}): Promise<GerminacionEvento> {
  const usuario = await usuarioActual();
  const subido = await subirArchivoSiHay(input.archivo, input.codigoSistema);
  const { data, error } = await supabase
    .from('germinacion_evento')
    .insert({ planta_id: input.planta_id, fecha: input.fecha, cantidad_nueva: input.cantidad_nueva, created_by: usuario })
    .select('id, planta_id, fecha, cantidad_nueva, created_at')
    .single();
  if (error) throw traducirError(error);
  const registro = await registrarHistorial({
    planta_id: input.planta_id,
    tipo_evento: 'germinacion',
    fecha: input.fecha,
    datos: { fecha: input.fecha, cantidad_nueva: input.cantidad_nueva },
    created_by: usuario,
  });
  await vincularArchivoSiHay(subido, registro.id);
  return data as GerminacionEvento;
}
