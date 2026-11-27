/**
 * «Corregir» una evaluación cerrada (decisión A8; docs/rediseno_v3/corregir.md). La corrección es un UPDATE de la
 * misma fila (se conserva el ID) que la deja `corregida` con su motivo; la base decide quién puede (solo el admin,
 * triggers de integridad + RLS). El historial sale de `obtener_correcciones_individuo` (migración 20261024100000).
 */
import { supabase, traducirError } from './client';
import type { EvaluacionRow } from './rondas';

export interface Correccion {
  evaluacion_id: string;
  fecha: string;
  /** Solo el nombre de quien corrigió (N15). */
  corregido_por: string;
  motivo: string | null;
  /** Nombres de las columnas que cambiaron (no los valores). */
  campos: string[];
}

export async function obtenerCorrecciones(individuoId: string): Promise<Correccion[]> {
  const { data, error } = await supabase.rpc('obtener_correcciones_individuo' as never, { p_individuo_id: individuoId } as never);
  if (error) throw traducirError(error);
  return (data ?? []) as unknown as Correccion[];
}

/** Valores que se pueden corregir: los de la fila de la evaluación, salvo identidad, estado y columnas de control. */
export type CambiosCorreccion = Partial<Record<string, string | number | boolean | null>>;

export async function corregirEvaluacion(
  evaluacionId: string,
  cambios: CambiosCorreccion,
  motivo: string,
  versionEsperada: string,
): Promise<EvaluacionRow> {
  const texto = motivo.trim();
  if (!texto) throw new Error('Escribe el motivo de la corrección.');
  const { data, error } = await supabase
    .from('evaluaciones')
    .update({ ...cambios, estado: 'corregida', motivo_cambio: texto } as never)
    .eq('id', evaluacionId)
    .eq('updated_at', versionEsperada)
    .select('*')
    .maybeSingle();
  if (error) throw traducirError(error);
  if (!data) {
    const conflicto = new Error('La evaluación cambió en otra sesión mientras la corregías. No se guardó nada: vuelve a abrirla y corrige sobre la versión actual.');
    conflicto.name = 'ConflictoVersionEvaluacionError';
    throw conflicto;
  }
  return data as unknown as EvaluacionRow;
}

/** Fase 5 (G15): pedido de corrección de una evaluación cerrada, hecho por su autor (migración 20261026210000). */
export interface PedidoCorreccion {
  id: string;
  nota: string;
  /** Solo el nombre (N15). */
  pedido_por: string;
  pedido_en: string;
  estado: 'abierto' | 'resuelto';
  resuelto_en: string | null;
  resuelto_por: string | null;
}

/** Un pedido abierto, para el Inicio del admin. Sin linaje. */
export interface CorreccionPedida {
  id: string;
  evaluacion_id: string;
  planta_id: string;
  especie_id: string;
  codigo_sistema: string;
  individuo_id: string;
  codigo_display: string;
  numero_ronda: number;
  tipo_ronda: 'anual' | 'multisitio';
  nota: string;
  pedido_por: string;
  pedido_en: string;
}

/** Solo el autor de la evaluación cerrada; la base valida y sus mensajes se muestran tal cual. */
export async function pedirCorreccion(evaluacionId: string, nota: string): Promise<string> {
  const texto = nota.trim();
  if (!texto) throw new Error('Escribe qué hay que corregir.');
  const { data, error } = await supabase.rpc('pedir_correccion' as never, { p_evaluacion_id: evaluacionId, p_nota: texto } as never);
  if (error) throw traducirError(error);
  return data as unknown as string;
}

/** Historial de pedidos de una evaluación: el admin ve todos; los demás, los suyos. */
export async function pedidosDeEvaluacion(evaluacionId: string): Promise<PedidoCorreccion[]> {
  const { data, error } = await supabase.rpc('pedidos_correccion_evaluacion' as never, { p_evaluacion_id: evaluacionId } as never);
  if (error) throw traducirError(error);
  return (data ?? []) as unknown as PedidoCorreccion[];
}

/** Solo admin: los pedidos abiertos de todas las especies. */
export async function listarCorreccionesPedidas(): Promise<CorreccionPedida[]> {
  const { data, error } = await supabase.rpc('listar_correcciones_pedidas' as never);
  if (error) throw traducirError(error);
  return (data ?? []) as unknown as CorreccionPedida[];
}
