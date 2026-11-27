/**
 * Qué descriptores usa cada especie (fase 4, migración 20261026120000): `esquema_campo_especie` guarda solo lo que cambia para
 * una especie (sin fila = activo y con las etiquetas del esquema). Escribe solo un admin (RLS); cada cambio queda auditado.
 */
import { supabase, traducirError } from './client';

export interface ConfigDescriptorEspecie {
  fase: string;
  clave: string;
  especie_id: string;
  activo: boolean;
  etiquetas_nivel: string[] | null;
}

const tabla = () => supabase.from('esquema_campo_especie');

export async function listarConfigDescriptores(especieId?: string): Promise<ConfigDescriptorEspecie[]> {
  let consulta = tabla().select('fase, clave, especie_id, activo, etiquetas_nivel').eq('fase', 'evaluacion_anual');
  if (especieId) consulta = consulta.eq('especie_id', especieId);
  const { data, error } = await consulta;
  // Contra una base sin la migración, no hay configuración: todo sigue activo.
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw traducirError(error);
  }
  return data ?? [];
}

/** Guarda la configuración de un descriptor para una especie. Activo y con las etiquetas del esquema = se borra la fila. */
export async function guardarConfigDescriptor(input: { especieId: string; clave: string; activo: boolean; etiquetasNivel: string[] | null }): Promise<void> {
  const t = tabla();
  if (input.activo && !input.etiquetasNivel) {
    const { error } = await t.delete().eq('fase', 'evaluacion_anual').eq('clave', input.clave).eq('especie_id', input.especieId);
    if (error) throw traducirError(error);
    return;
  }
  const { error } = await t.upsert({ fase: 'evaluacion_anual', clave: input.clave, especie_id: input.especieId, activo: input.activo, etiquetas_nivel: input.etiquetasNivel });
  if (error) throw traducirError(error);
}

/** Evaluaciones cerradas de la especie que ya traen valor del descriptor (para advertir antes de guardar). */
export async function contarValoresDescriptor(especieId: string, clave: string): Promise<number> {
  const { data, error } = await supabase.rpc('contar_valores_descriptor', { p_especie_id: especieId, p_clave: clave });
  if (error) throw traducirError(error);
  return Number(data ?? 0);
}

/** Especie de un cruce, desde la vista sin linaje (no pasa por la lectura auditada de la ficha: solo se pide la especie). */
export async function especieDeCruce(plantaId: string): Promise<string | null> {
  const { data, error } = await supabase.from('plantas_operativas').select('especie_id').eq('id', plantaId).maybeSingle();
  if (error) throw traducirError(error);
  return data?.especie_id ?? null;
}
