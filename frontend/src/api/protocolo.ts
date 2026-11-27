/**
 * Protocolo de ronda, planilla y estados por descriptor (Fase 2, Sprint 1;
 * migraciones 20261023110000 y 20261023120000). El protocolo lo define un
 * admin; cada evaluación queda con la versión vigente cuando se creó.
 */
import { supabase, traducirError } from './client';
import type { ClaveEvaluacionAnual } from '@/lib/esquemaFase/evaluacionAnual';
import type { TipoRonda } from './rondas';

export type NivelProtocolo = 'obligatorio' | 'opcional';
export type EstadoDescriptor = 'medido' | 'falto' | 'no_evaluado' | 'marcado';
export type DescriptoresProtocolo = Partial<Record<ClaveEvaluacionAnual, NivelProtocolo>>;

export interface ProtocoloRonda {
  id: string;
  version: number;
  nombre: string;
  descriptores: DescriptoresProtocolo;
  created_at: string;
}

export type EstadoFilaPlanilla = 'sin_ronda' | 'sin_iniciar' | 'borrador' | 'completa' | 'no_evaluada';

/** Fase 5 (G3): motivo de «No evaluada en esta ronda». */
export type MotivoNoEvaluada = 'no_alcanzo' | 'sin_fruto' | 'otro';

export interface FilaPlanilla {
  individuo_id: string;
  codigo_display: string;
  numero: number | null;
  ronda_id: string | null;
  estado: EstadoFilaPlanilla;
  evaluacion_id: string | null;
  evaluacion_updated_at: string | null;
  fecha: string | null;
  evaluador: string | null;
  es_mia: boolean;
  /** U-09: la ronda tiene un borrador activo (de una visita nueva si la fila ya está cerrada). Ausente en bases sin la migración 20261024050000. */
  hay_borrador?: boolean;
  /** U-09: ese borrador es de quien consulta. */
  borrador_mio?: boolean;
  protocolo_id: string | null;
  protocolo_distinto: boolean;
  estados: Partial<Record<ClaveEvaluacionAnual, EstadoDescriptor>> | null;
  conteo: Record<EstadoDescriptor, number> | null;
  /** Fase 5 (G3): la ronda quedó «No evaluada» (motivo y texto). Ausente en bases sin la migración 20261026170000. */
  no_evaluada?: { motivo: MotivoNoEvaluada; detalle: string | null } | null;
  /** Fase 5 (G3): en la ronda N, el estado de la ronda N-1 de la planta (para «Pendientes de la ronda anterior»). */
  anterior?: { ronda_id: string; numero: number; estado: Exclude<EstadoFilaPlanilla, 'sin_ronda'> } | null;
}

export interface PlanillaRonda {
  planta_id: string;
  tipo_ronda: 'anual' | 'multisitio';
  numero_ronda: number | null;
  protocolo: ProtocoloRonda | null;
  avance: { vivos: number; sin_ronda: number; sin_iniciar: number; borrador: number; completa: number; con_borrador?: number; no_evaluada?: number };
  individuos: FilaPlanilla[];
}

export interface EstadosEvaluacion {
  evaluacion_id: string;
  protocolo: ProtocoloRonda | null;
  estados: Partial<Record<ClaveEvaluacionAnual, EstadoDescriptor>>;
}

/** La planilla de la serie anual (por defecto) o de la serie multisitio (contador propio). */
export async function obtenerPlanillaRonda(plantaId: string, numeroRonda?: number, tipo: TipoRonda = 'anual'): Promise<PlanillaRonda> {
  const { data, error } = await supabase.rpc('obtener_planilla_ronda', {
    p_planta_id: plantaId,
    p_tipo_ronda: tipo,
    ...(numeroRonda !== undefined ? { p_numero_ronda: numeroRonda } : {}),
  });
  if (error) throw traducirError(error);
  return data as unknown as PlanillaRonda;
}

export async function obtenerEstadosEvaluacion(evaluacionId: string): Promise<EstadosEvaluacion> {
  const { data, error } = await supabase.rpc('obtener_estados_evaluacion', { p_evaluacion_id: evaluacionId });
  if (error) throw traducirError(error);
  return data as unknown as EstadosEvaluacion;
}

export async function obtenerProtocolo(protocoloId: string): Promise<ProtocoloRonda | null> {
  const { data, error } = await supabase
    .from('protocolo_ronda')
    .select('id, version, nombre, descriptores, created_at')
    .eq('id', protocoloId)
    .maybeSingle();
  if (error) throw traducirError(error);
  return data as unknown as ProtocoloRonda | null;
}

/** Versión vigente del protocolo de la ronda N de un cruce (o null si no se definió). */
export async function obtenerProtocoloVigente(plantaId: string, numeroRonda: number, tipo: TipoRonda = 'anual'): Promise<ProtocoloRonda | null> {
  const { data, error } = await supabase
    .from('protocolo_ronda')
    .select('id, version, nombre, descriptores, created_at')
    .eq('planta_id', plantaId)
    .eq('tipo_ronda', tipo)
    .eq('numero_ronda', numeroRonda)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw traducirError(error);
  return data as unknown as ProtocoloRonda | null;
}

export async function definirProtocoloRonda(input: {
  plantaId: string;
  numeroRonda: number;
  nombre: string;
  descriptores: DescriptoresProtocolo;
}): Promise<string> {
  const { data, error } = await supabase.rpc('definir_protocolo_ronda', {
    p_planta_id: input.plantaId,
    p_tipo_ronda: 'anual',
    p_numero_ronda: input.numeroRonda,
    p_nombre: input.nombre,
    p_descriptores: input.descriptores,
  });
  if (error) throw traducirError(error);
  return data as string;
}
