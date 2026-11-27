import { supabase, traducirError } from './client';

export interface Especie {
  id: string;
  nombre: string;
  nombre_cientifico: string | null;
}

export async function listarEspecies(): Promise<Especie[]> {
  const { data, error } = await supabase
    .from('especies')
    .select('id, nombre, nombre_cientifico')
    .order('nombre');
  if (error) throw traducirError(error);
  return data;
}

/** Solo admin (lo garantiza el RLS, no este código). */
export async function crearEspecie(nombre: string, nombreCientifico?: string): Promise<Especie> {
  const { data, error } = await supabase
    .from('especies')
    .insert({ nombre, nombre_cientifico: nombreCientifico ?? null })
    .select('id, nombre, nombre_cientifico')
    .single();
  if (error) throw traducirError(error);
  return data;
}

/** Corrige un valor ya cargado (ej. typo de mayúscula/minúscula) — solo admin (RLS). */
export async function actualizarEspecie(id: string, input: { nombre: string; nombreCientifico?: string | null }): Promise<Especie> {
  const { data, error } = await supabase
    .from('especies')
    .update({ nombre: input.nombre, nombre_cientifico: input.nombreCientifico ?? null })
    .eq('id', id)
    .select('id, nombre, nombre_cientifico')
    .single();
  if (error) throw traducirError(error);
  return data;
}

/** Una especie en el panorama («Todas las especies»; migración 20261026110000). Se cuenta como la planilla. */
export interface PanoramaEspecie {
  id: string;
  nombre: string;
  /** Todos los cruces (también Sin empezar y Fin), sin los de prueba salvo que un admin los pida. */
  cruces: number;
  cruces_activos: number;
  individuos_vivos: number;
  /** Individuos vivos sin evaluación cerrada en la ronda actual de su cruce. */
  sin_evaluacion_cerrada: number;
  evaluaciones_cerradas: number;
  cruces_con_pendientes: number;
  /** Cruces por fase (solo las fases con alguno). */
  cruces_por_fase: Partial<Record<string, number>>;
  /** Cruces con pendientes, por fase. */
  fases_con_pendientes: Partial<Record<string, number>>;
  ultima_actividad: string | null;
  ultima_actividad_por: string | null;
}

export async function obtenerPanoramaEspecies(opciones: { especieId?: string; incluirPruebas?: boolean } = {}): Promise<PanoramaEspecie[]> {
  const { data, error } = await supabase.rpc('panorama_especies', {
    ...(opciones.especieId ? { p_especie_id: opciones.especieId } : {}),
    p_incluir_pruebas: opciones.incluirPruebas ?? false,
  });
  if (error) throw traducirError(error);
  return (data ?? []) as unknown as PanoramaEspecie[];
}
