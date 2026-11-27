/**
 * Registros de evento (historial de cada planta) y sus archivos adjuntos.
 * Los binarios van a Supabase Storage (bucket privado media-plantas); en la
 * tabla evento_archivos solo se guarda la ruta. La lectura de archivos usa
 * URLs firmadas temporales (el bucket NO es público).
 */
import { supabase, traducirError, exigirUsuario } from './client';
import type { TipoEvento } from '@/types/domain';

export interface RegistroEvento {
  id: string;
  planta_id: string;
  tipo_evento: TipoEvento;
  fecha: string;
  datos: Record<string, unknown>;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  archivos: ArchivoEvento[];
}

export interface ArchivoEvento {
  id: string;
  storage_path: string;
  tipo: 'foto' | 'video';
}

export async function listarEventosDePlanta(plantaId: string): Promise<RegistroEvento[]> {
  const { data, error } = await supabase
    .from('registros_evento')
    .select('id, planta_id, tipo_evento, fecha, datos, notas, created_by, created_at, archivos:evento_archivos(id, storage_path, tipo)')
    .eq('planta_id', plantaId)
    .is('eliminado_at', null) // los borrados (soft-delete) no se muestran en el historial normal
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw traducirError(error);
  return data as unknown as RegistroEvento[];
}

/** Edita un registro existente (autor u admin, según RLS). No toca archivos adjuntos. */
export async function actualizarEvento(input: {
  id: string;
  tipo_evento: TipoEvento;
  fecha: string; // YYYY-MM-DD
  notas?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('registros_evento')
    .update({
      tipo_evento: input.tipo_evento,
      fecha: input.fecha,
      notas: input.notas ?? null,
    })
    .eq('id', input.id);
  if (error) throw traducirError(error);
}

/** Borra (soft-delete) un registro. Solo un admin puede hacerlo (RLS + trigger de bloqueo). */
export async function eliminarEvento(id: string): Promise<void> {
  const { error } = await supabase
    .from('registros_evento')
    .update({ eliminado_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw traducirError(error);
}

/**
 * Sube el binario al bucket privado, ANTES de que exista el registro_evento.
 * La carpeta usa un id generado en el cliente (no el registroId, que todavía
 * no existe en este punto) — las políticas de Storage (migración 005) solo
 * validan bucket_id/owner, no parsean la ruta, así que esto es seguro.
 * Si esto falla (típico: sin conexión en terreno), no se creó nada más
 * todavía, así que un reintento no puede duplicar ninguna nota.
 */
export async function subirBinarioEvento(input: {
  file: File;
  codigoSistema: string;
}): Promise<{ path: string; tipo: 'foto' | 'video' }> {
  const esVideo = input.file.type.startsWith('video/');
  const nombreLimpio = input.file.name.replace(/[^\w.\-]+/g, '_');
  const idSubida = crypto.randomUUID();
  const path = `plantas/${input.codigoSistema}/${idSubida}/${Date.now()}-${nombreLimpio}`;

  const { error: upErr } = await supabase.storage.from('media-plantas').upload(path, input.file);
  if (upErr) throw new Error(`No se pudo subir el archivo: ${upErr.message}`);

  return { path, tipo: esVideo ? 'video' : 'foto' };
}

/**
 * Registra el metadato del binario ya subido, vinculado al registro_evento
 * real (que para este punto ya existe). Si falla, borra el binario recién
 * subido para no dejarlo huérfano en Storage.
 */
export async function registrarArchivoDeEvento(input: {
  registroId: string;
  path: string;
  tipo: 'foto' | 'video';
}): Promise<ArchivoEvento> {
  const usuario = await exigirUsuario();

  const { data, error } = await supabase
    .from('evento_archivos')
    .insert({
      registro_id: input.registroId,
      storage_path: input.path,
      tipo: input.tipo,
      created_by: usuario.id,
    })
    .select('id, storage_path, tipo')
    .single();
  if (error) {
    // El binario subió pero el metadato falló: intentamos limpiar para no dejar huérfanos.
    await supabase.storage.from('media-plantas').remove([input.path]);
    throw traducirError(error);
  }
  return data as ArchivoEvento;
}

/**
 * Quita un adjunto ya guardado (metadato + binario). RLS: autor del archivo
 * o admin (policy archivos_delete_autor_o_admin, migración 20260702000003).
 * El borrado del binario es best-effort: si el bucket falla, el metadato ya
 * se borró y el adjunto deja de aparecer, que es lo que importa para el
 * usuario — no vale la pena revertir el DELETE por eso.
 */
export async function eliminarArchivoDeEvento(archivo: Pick<ArchivoEvento, 'id' | 'storage_path'>): Promise<void> {
  const { error } = await supabase.from('evento_archivos').delete().eq('id', archivo.id);
  if (error) throw traducirError(error);
  await supabase.storage.from('media-plantas').remove([archivo.storage_path]);
}

/** URL firmada temporal (1 hora) para ver un archivo del bucket privado. */
export async function urlFirmada(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('media-plantas')
    .createSignedUrl(storagePath, 3600);
  if (error) throw new Error(`No se pudo generar el enlace del archivo: ${error.message}`);
  return data.signedUrl;
}
