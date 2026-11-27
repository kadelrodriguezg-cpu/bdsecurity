/**
 * Administración de cruzamientos (solo admin): reiniciar y borrar
 * (soft/hard). North Star v4, sección 9. Ambas acciones son RPCs
 * SECURITY DEFINER que validan es_admin() en el backend — esta capa no
 * agrega ninguna restricción propia, es UX, no seguridad.
 */
import { supabase, traducirError } from './client';
import type { EstadoPlanta } from '@/types/domain';
import { compararCodigos } from '@/lib/ordenNatural';

export interface CruceAdmin {
  id: string;
  codigo_sistema: string;
  estado: EstadoPlanta;
  eliminado_at: string | null;
  /**
   * Marca de cruce de prueba. Es la única puerta que habilita la purga
   * irreversible: `borrar_cruzamiento(..., 'hard')` rechaza cualquier cruce
   * con `es_prueba = false`, y la UI ni siquiera ofrece el control.
   */
  es_prueba: boolean;
}

/** Todos los cruces, INCLUIDOS los soft-deleted y los de prueba (a diferencia de plantas_operativas). Solo para la pantalla admin. */
export async function listarTodosLosCruces(): Promise<CruceAdmin[]> {
  const { data, error } = await supabase
    .from('plantas')
    .select('id, codigo_sistema, estado, eliminado_at, es_prueba')
    .order('codigo_sistema');
  if (error) throw traducirError(error);
  // G16: orden natural (02-1000 después de 02-999, no antes como en el texto).
  return (data as CruceAdmin[]).sort((a, b) => compararCodigos(a.codigo_sistema, b.codigo_sistema));
}

export interface ResumenBorrado {
  n_individuos: number;
  n_evaluaciones: number;
  n_pcr: number;
  n_registros_evento: number;
  /**
   * Historial territorial (traslados/multisitio) de los individuos de este
   * cruce. emplazamiento_individuo nunca se elimina por diseño (trigger
   * bloquear_borrado_emplazamiento, invariante absoluto de Sprint 4) — si
   * hay alguno, un hard delete es irrealizable y borrar_cruzamiento lo
   * rechaza. Se calcula acá ANTES de ofrecer el botón, para no dejar
   * avanzar hacia un estado que el backend va a rechazar de todos modos
   * (mid-fix: antes el botón quedaba habilitado incluso después de que el
   * backend ya había mostrado ese mismo error).
   */
  n_emplazamientos: number;
  /**
   * Evaluaciones en estado 'completa' o 'corregida' — la señal de que alguien
   * registró datos científicos REALES sobre un cruce marcado como prueba. Es
   * exactamente la PUERTA 2 de `borrar_cruzamiento` (migración
   * 20260907001000): si esto es > 0, el backend rechaza la purga. Se cuenta
   * acá también para poder decírselo al humano ANTES de que escriba el
   * código de confirmación, en vez de dejarlo chocar contra el error.
   * 'borrador' (trabajo a medias) y 'anulada' (ya descartada) no cuentan.
   * Si cambia la heurística, hay que cambiarla en los dos lados.
   */
  n_evaluaciones_terminadas: number;
}

/**
 * Resumen de lo que se perdería con un hard delete — consultado ANTES de
 * habilitar el botón de confirmación final (salvaguarda obligatoria, Prompt 7
 * Parte E). Query directa, no la RPC (que solo cuenta puertas adentro para
 * el audit_log; esto es para que el admin decida ANTES de ejecutar nada).
 */
export async function resumenParaBorrado(plantaId: string): Promise<ResumenBorrado> {
  // Filtros anidados (!inner) en vez de listas IN de ids: un cruce de cientos de
  // individuos arma una URL demasiado larga (414) y el conteo saldría en cero.
  const porRonda = 'id, ronda:ronda_evaluacion_anual!inner(individuo:individuos!inner(planta_id))';
  const [individuos, eventos, emplazamientos, evaluaciones, terminadas, pcr] = await Promise.all([
    supabase.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId),
    supabase.from('registros_evento').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId),
    supabase
      .from('emplazamiento_individuo')
      .select('id, individuo:individuos!inner(planta_id)', { count: 'exact', head: true })
      .eq('individuo.planta_id', plantaId),
    supabase.from('evaluaciones').select(porRonda, { count: 'exact', head: true }).eq('ronda.individuo.planta_id', plantaId),
    supabase
      .from('evaluaciones')
      .select(porRonda, { count: 'exact', head: true })
      .eq('ronda.individuo.planta_id', plantaId)
      .in('estado', ['completa', 'corregida']),
    supabase.from('pcr_analisis').select(porRonda, { count: 'exact', head: true }).eq('ronda.individuo.planta_id', plantaId),
  ]);
  for (const r of [individuos, eventos, emplazamientos, evaluaciones, terminadas, pcr]) {
    if (r.error) throw traducirError(r.error);
  }

  return {
    n_individuos: individuos.count ?? 0,
    n_evaluaciones: evaluaciones.count ?? 0,
    n_pcr: pcr.count ?? 0,
    n_registros_evento: eventos.count ?? 0,
    n_emplazamientos: emplazamientos.count ?? 0,
    n_evaluaciones_terminadas: terminadas.count ?? 0,
  };
}

export interface ReinicioResultado {
  planta_id: string;
  n_individuos_preexistentes: number;
}

/** Vuelve el cruce a sin_empezar y borra los datos de fase. NO toca individuos. */
export async function reiniciarCruzamiento(plantaId: string): Promise<ReinicioResultado> {
  const { data, error } = await supabase.rpc('reiniciar_cruzamiento', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return data as unknown as ReinicioResultado;
}

/**
 * soft (archivar): marca eliminado_at, recuperable, sirve para cualquier cruce.
 * hard (purgar): borra todo, irreversible, y SOLO funciona sobre cruces con
 * `es_prueba = true`. El backend rechaza el resto — esta capa no agrega la
 * restricción, solo evita ofrecer un botón que iba a fallar.
 */
export async function borrarCruzamiento(plantaId: string, tipo: 'soft' | 'hard'): Promise<void> {
  const { error } = await supabase.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: tipo });
  if (error) throw traducirError(error);
}

export interface RestauracionResultado {
  planta_id: string;
  codigo_sistema: string;
  eliminado_at_anterior: string;
  n_individuos: number;
  n_evaluaciones: number;
  n_emplazamientos: number;
  restaurado_at: string;
}

/** Revierte solo eliminado_at; las relaciones históricas nunca se reconstruyen ni alteran. */
export async function restaurarCruzamiento(plantaId: string): Promise<RestauracionResultado> {
  const { data, error } = await supabase.rpc('restaurar_cruzamiento', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return data as unknown as RestauracionResultado;
}
