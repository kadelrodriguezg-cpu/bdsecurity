import { supabase, traducirError } from './client';
import type { Database, Json } from '@/types/database.types';

export type EstadoProcedimiento = Database['public']['Enums']['estado_procedimiento'];
export type TipoObjetivoProcedimiento = Database['public']['Enums']['tipo_objetivo_procedimiento'];

export const ESTADO_PROCEDIMIENTO_LABEL: Record<EstadoProcedimiento, string> = {
  planificado: 'Planificado',
  en_curso: 'En curso',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

export interface ObjetivoProcedimientoInput {
  tipo: TipoObjetivoProcedimiento;
  id: string;
  nota?: string;
  /** Solo presente al leer (no se manda al crear/actualizar): código del individuo o nombre del predio, para mostrar en "Registrados". */
  etiqueta?: string;
}

export interface InsumoProcedimientoInput {
  insumo_id: string;
  cantidad: number;
  unidad?: string;
}

export interface Procedimiento {
  id: string;
  nombre: string;
  tipo: string;
  estado: EstadoProcedimiento;
  fecha_inicio: string;
  fecha_fin: string | null;
  notas: string | null;
  responsable_id: string;
  created_by: string;
  objetivos: ObjetivoProcedimientoInput[];
  insumos: InsumoProcedimientoInput[];
}

export interface PredioActivoCruce {
  predio_id: string;
  predio_nombre: string;
  individuos_activos: number;
}

export async function listarProcedimientos(plantaId: string): Promise<Procedimiento[]> {
  const { data, error } = await supabase
    .from('procedimiento_objetivos')
    .select('procedimiento:procedimiento_id(id, nombre, tipo, estado, fecha_inicio, fecha_fin, notas, responsable_id, created_by, objetivos:procedimiento_objetivos(tipo, planta_id, predio_id, individuo_id, nota, individuo:individuo_id(codigo_display), predio:predio_id(nombre)), insumos:procedimiento_insumos(insumo_id, cantidad, unidad))')
    .eq('tipo', 'cruzamiento')
    .eq('planta_id', plantaId);
  if (error) throw traducirError(error);
  return (data ?? []).flatMap((fila) => {
    const procedimiento = fila.procedimiento as unknown as Omit<Procedimiento, 'objetivos' | 'insumos'> & {
      objetivos: Array<{
        tipo: TipoObjetivoProcedimiento;
        planta_id: string | null;
        predio_id: string | null;
        individuo_id: string | null;
        nota: string | null;
        individuo: { codigo_display: string } | null;
        predio: { nombre: string } | null;
      }>;
      insumos: InsumoProcedimientoInput[];
    } | null;
    if (!procedimiento) return [];
    return [{
      ...procedimiento,
      objetivos: procedimiento.objetivos.map((objetivo) => ({
        tipo: objetivo.tipo,
        id: objetivo.planta_id ?? objetivo.predio_id ?? objetivo.individuo_id!,
        nota: objetivo.nota ?? undefined,
        etiqueta: objetivo.individuo?.codigo_display ?? objetivo.predio?.nombre ?? undefined,
      })),
      insumos: procedimiento.insumos,
    }];
  });
}

export async function listarPrediosActivosCruce(plantaId: string): Promise<PredioActivoCruce[]> {
  const { data, error } = await supabase.rpc('listar_predios_activos_cruzamiento', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return data as PredioActivoCruce[];
}

/**
 * `idempotencyKey`: generada una vez al montar el formulario -- un reintento
 * con la misma key devuelve el id ya creado (manejado dentro de la RPC), sin
 * duplicar el procedimiento. Ver crearEvaluacion (api/rondas.ts) para el
 * mismo patrón en los otros 3 formularios afectados.
 */
export async function crearProcedimiento(input: {
  nombre: string;
  tipo: string;
  fechaInicio: string;
  fechaFin?: string | null;
  notas?: string | null;
  objetivos: ObjetivoProcedimientoInput[];
  insumos?: InsumoProcedimientoInput[];
  responsableId?: string;
}, idempotencyKey: string): Promise<string> {
  const args: Database['public']['Functions']['crear_procedimiento']['Args'] = {
    p_nombre: input.nombre,
    p_tipo: input.tipo,
    p_fecha_inicio: input.fechaInicio,
    p_objetivos: input.objetivos as unknown as Json,
    p_insumos: (input.insumos ?? []) as unknown as Json,
    p_idempotency_key: idempotencyKey,
  };
  if (input.fechaFin !== undefined && input.fechaFin !== null) args.p_fecha_fin = input.fechaFin;
  if (input.notas !== undefined && input.notas !== null) args.p_notas = input.notas;
  if (input.responsableId !== undefined) args.p_responsable_id = input.responsableId;
  const { data, error } = await supabase.rpc('crear_procedimiento', args);
  if (error) throw traducirError(error);
  return data;
}

export async function actualizarProcedimiento(input: {
  id: string;
  nombre: string;
  tipo: string;
  estado: EstadoProcedimiento;
  fechaInicio: string;
  fechaFin?: string | null;
  notas?: string | null;
  objetivos: ObjetivoProcedimientoInput[];
  insumos?: InsumoProcedimientoInput[];
}): Promise<void> {
  const args: Database['public']['Functions']['actualizar_procedimiento']['Args'] = {
    p_procedimiento_id: input.id,
    p_nombre: input.nombre,
    p_tipo: input.tipo,
    p_estado: input.estado,
    p_fecha_inicio: input.fechaInicio,
    p_objetivos: input.objetivos as unknown as Json,
    p_insumos: (input.insumos ?? []) as unknown as Json,
  };
  if (input.fechaFin !== undefined && input.fechaFin !== null) args.p_fecha_fin = input.fechaFin;
  if (input.notas !== undefined && input.notas !== null) args.p_notas = input.notas;
  const { error } = await supabase.rpc('actualizar_procedimiento', args);
  if (error) throw traducirError(error);
}

export async function reasignarProcedimiento(id: string, responsableId: string, motivo?: string): Promise<void> {
  const args: Database['public']['Functions']['reasignar_procedimiento']['Args'] = {
    p_procedimiento_id: id,
    p_responsable_nuevo_id: responsableId,
  };
  if (motivo) args.p_motivo = motivo;
  const { error } = await supabase.rpc('reasignar_procedimiento', args);
  if (error) throw traducirError(error);
}
