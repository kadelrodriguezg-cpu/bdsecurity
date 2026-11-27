/**
 * Nombres de compañeros (decisión N15): la RLS de `perfiles` solo deja a un operario leer su propio perfil, así que
 * los nombres ajenos se piden a la RPC `nombres_de_usuarios`, que devuelve SOLO id y nombre (migración 20261024080000,
 * paquete de v3). Si la base todavía no tiene la función (producción antes del despliegue de v3) o falla, devuelve un
 * mapa vacío: quien llama conserva su texto de respaldo y nada se rompe.
 */
import { supabase } from './client';

const MAXIMO_POR_LLAMADA = 200;

export async function nombresDeUsuarios(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((id): id is string => !!id))].slice(0, MAXIMO_POR_LLAMADA);
  const mapa = new Map<string, string>();
  if (unicos.length === 0) return mapa;
  try {
    const { data, error } = await supabase.rpc('nombres_de_usuarios' as never, { p_ids: unicos } as never);
    if (error || !Array.isArray(data)) return mapa;
    for (const fila of data as Array<{ id: string; nombre: string }>) mapa.set(fila.id, fila.nombre);
  } catch {
    // Sin red o sin la función: se queda el texto de respaldo de quien llama.
  }
  return mapa;
}

/** Completa los nombres que la RLS dejó en null, con los de la RPC. No toca los que ya vienen. */
export async function completarNombres<T>(filas: T[], idDe: (fila: T) => string | null | undefined, nombreDe: (fila: T) => string | null, conNombre: (fila: T, nombre: string) => T): Promise<T[]> {
  const faltan = filas.filter((f) => !nombreDe(f) && idDe(f)).map(idDe);
  if (faltan.length === 0) return filas;
  const nombres = await nombresDeUsuarios(faltan);
  return filas.map((f) => {
    const id = idDe(f);
    const nombre = id ? nombres.get(id) : undefined;
    return !nombreDe(f) && nombre ? conNombre(f, nombre) : f;
  });
}
