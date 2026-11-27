import { supabase, traducirError } from './client';
import type { RolUsuario } from '@/types/domain';

export interface Perfil {
  id: string;
  nombre: string;
  rol: RolUsuario;
  puede_ver_linaje: boolean;
}

/** Perfil del usuario logueado (el RLS solo deja ver el propio, salvo admin). */
export async function miPerfil(): Promise<Perfil | null> {
  const { data: sesion } = await supabase.auth.getUser();
  if (!sesion.user) return null;
  const { data, error } = await supabase
    .from('perfiles')
    .select('id, nombre, rol, puede_ver_linaje')
    .eq('id', sesion.user.id)
    .maybeSingle();
  if (error) throw traducirError(error);
  return data;
}

/** Actualiza únicamente el nombre visible del usuario autenticado. */
export async function actualizarMiNombre(nombre: string): Promise<void> {
  const { data: sesion } = await supabase.auth.getUser();
  if (!sesion.user) throw new Error('Tu sesión ya no está disponible.');

  const { data, error } = await supabase
    .from('perfiles')
    .update({ nombre: nombre.trim() })
    .eq('id', sesion.user.id)
    .select('id');
  if (error) throw traducirError(error);
  if (!data || data.length === 0) {
    throw new Error('No se pudo actualizar tu nombre.');
  }
}

/** Cambia la contraseña del usuario autenticado mediante Supabase Auth. */
export async function cambiarMiPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw traducirError(error);
}

/** Todos los perfiles (solo admin; a un operario el RLS le devuelve solo el suyo). */
export async function listarPerfiles(): Promise<Perfil[]> {
  const { data, error } = await supabase
    .from('perfiles')
    .select('id, nombre, rol, puede_ver_linaje')
    .order('nombre');
  if (error) throw traducirError(error);
  return data;
}

/**
 * Cambia rol y/o permiso de linaje de OTRO usuario. El trigger del backend
 * (migración 006) rechaza el cambio si quien lo hace no es admin — este código
 * no es la barrera de seguridad, solo el camino feliz.
 */
export async function actualizarPermisos(
  perfilId: string,
  cambios: { rol?: RolUsuario; puede_ver_linaje?: boolean },
): Promise<void> {
  const { data, error } = await supabase
    .from('perfiles')
    .update(cambios)
    .eq('id', perfilId)
    .select('id');
  if (error) throw traducirError(error);
  if (!data || data.length === 0) {
    throw new Error('No se pudo actualizar: el perfil no existe o no tienes permiso.');
  }
}
