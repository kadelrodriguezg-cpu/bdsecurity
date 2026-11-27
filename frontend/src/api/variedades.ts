/**
 * Catálogo estructurado de progenitores (Mamá/Papá), por especie. Reemplaza
 * el texto libre que tenían plantas.mama/plantas.papa (Bloque 3, Parte 3C de
 * la auditoría de UX — ver migración 20260903001000).
 *
 * Alta: cualquier autenticado puede crear una variedad nueva (RLS
 * variedades_insert_autenticados) — decisión explícita: el secreto que este
 * sistema protege es qué progenitores se cruzan en cada cruce (plantas.mama_id/
 * papa_id, con las mismas protecciones que ya tenían mama/papa), no que
 * exista una variedad con determinado nombre en el catálogo. Editar/
 * desactivar sigue siendo admin-only, mismo criterio que contenedor/insumo/
 * predio (api/catalogos.ts).
 */
import { supabase, traducirError, exigirUsuario } from './client';

export interface Variedad {
  id: string;
  especie_id: string;
  nombre: string;
  activo: boolean;
}

export async function listarVariedades(especieId: string, soloActivas = true): Promise<Variedad[]> {
  let query = supabase
    .from('variedades')
    .select('id, especie_id, nombre, activo')
    .eq('especie_id', especieId)
    .order('nombre');
  if (soloActivas) query = query.eq('activo', true);
  const { data, error } = await query;
  if (error) throw traducirError(error);
  return data as Variedad[];
}

/** Alta inline desde el combobox de Mamá/Papá — a nombre del usuario autenticado. */
export async function crearVariedad(especieId: string, nombre: string): Promise<Variedad> {
  const usuario = await exigirUsuario();

  const { data, error } = await supabase
    .from('variedades')
    .insert({ especie_id: especieId, nombre, created_by: usuario.id })
    .select('id, especie_id, nombre, activo')
    .single();
  if (error) throw traducirError(error);
  return data as Variedad;
}
