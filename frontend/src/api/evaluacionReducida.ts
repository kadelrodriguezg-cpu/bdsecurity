/**
 * Evaluación reducida (Trasplante: talla+entrenudos+vigor; Crecimiento:
 * + multibrotes + presencia_raices). Set de campos distinto y más chico que
 * `evaluaciones` (15 descriptores), que solo aplica desde "Primer año de
 * evaluación" (North Star v4, sección 2.3).
 */
import { supabase, traducirError, exigirUsuario, MENSAJE_SIN_CONEXION_EVALUACION } from './client';
import type { Database } from '@/types/database.types';
import { completarNombres } from './nombres';

export type FaseEvaluacionReducida = Database['public']['Enums']['fase_evaluacion_reducida'];

export interface EvaluacionReducidaInput {
  individuo_id: string;
  fase: FaseEvaluacionReducida;
  talla?: number;
  numero_entrenudos?: number;
  vigor?: number;
  multibrotes?: number; // solo aplica si fase='crecimiento'
  presencia_raices?: number; // solo aplica si fase='crecimiento'
  observaciones?: string;
}

export interface EvaluacionReducidaRow extends EvaluacionReducidaInput {
  id: string;
  created_at: string;
}

/** Trae solo las evaluaciones de la fase pedida (Trasplante o Crecimiento son listas independientes — un individuo puede tener evaluaciones de ambas, y no deben mezclarse). */
export async function listarEvaluacionesReducidas(individuoId: string, fase: FaseEvaluacionReducida): Promise<EvaluacionReducidaRow[]> {
  const { data, error } = await supabase
    .from('evaluacion_reducida')
    .select('*')
    .eq('individuo_id', individuoId)
    .eq('fase', fase)
    .order('created_at', { ascending: false });
  if (error) throw traducirError(error);
  return data as unknown as EvaluacionReducidaRow[];
}

export async function crearEvaluacionReducida(input: EvaluacionReducidaInput): Promise<{ id: string }> {
  const usuario = await exigirUsuario(MENSAJE_SIN_CONEXION_EVALUACION);

  const fila = {
    ...input,
    // multibrotes/presencia_raices solo tienen sentido en Crecimiento; si el
    // formulario los manda estando en Trasplante (no debería pasar por UI,
    // pero se refuerza acá), se descartan.
    multibrotes: input.fase === 'crecimiento' ? input.multibrotes ?? null : null,
    presencia_raices: input.fase === 'crecimiento' ? input.presencia_raices ?? null : null,
  };

  const { data, error } = await supabase
    .from('evaluacion_reducida')
    .insert({ ...fila, created_by: usuario.id })
    .select('id')
    .single();
  if (error) throw traducirError(error);
  return data;
}

export interface EvaluacionReducidaDeCruce extends EvaluacionReducidaRow {
  created_by: string | null;
  /** Nombre de quien la cargó (N15: también el de un compañero, vía nombres_de_usuarios); null si no se pudo leer. */
  autor_nombre: string | null;
}

/**
 * Evaluaciones reducidas de UNA fase para todo un cruce (planilla de avance de
 * Crecimiento). El cruce se filtra con la relación (!inner), no con una lista de
 * ids en la URL. Orden: la más reciente primero, así la primera de cada
 * individuo es su última evaluación.
 */
export async function listarEvaluacionesReducidasDeCruce(plantaId: string, fase: FaseEvaluacionReducida): Promise<EvaluacionReducidaDeCruce[]> {
  const { data, error } = await supabase
    .from('evaluacion_reducida')
    .select('id, individuo_id, fase, talla, numero_entrenudos, vigor, multibrotes, presencia_raices, observaciones, created_at, created_by, autor:perfiles!created_by(nombre), individuo:individuos!inner(planta_id)')
    .eq('individuo.planta_id', plantaId)
    .eq('fase', fase)
    .order('created_at', { ascending: false });
  if (error) throw traducirError(error);
  const filas = (data as unknown as Array<EvaluacionReducidaRow & { created_by: string | null; autor: { nombre: string } | null }>).map(({ autor, ...fila }) => ({
    ...fila,
    autor_nombre: autor?.nombre ?? null,
  }));
  // N15: los nombres que la RLS de perfiles deja en null (un operario no lee perfiles ajenos) se piden a nombres_de_usuarios.
  return completarNombres(filas, (f) => f.created_by, (f) => f.autor_nombre, (f, nombre) => ({ ...f, autor_nombre: nombre }));
}
