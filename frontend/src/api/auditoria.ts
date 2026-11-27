/**
 * Lectura del log de auditoría. RLS (`audit_select_admin`) ya restringe esto
 * a admins a nivel de base — a un operario esta consulta le devuelve una
 * lista vacía, nunca las filas. El frontend además evita disparar la query
 * si el usuario no es admin (ver features/plantas/Bitacora.tsx).
 */
import { supabase, traducirError } from './client';

export interface EntradaAuditoria {
  id: number;
  usuario_id: string | null;
  usuario_nombre: string | null;
  planta_id: string | null;
  accion: string;
  campos_expuestos: string[];
  detalle: Record<string, unknown>;
  ocurrido_en: string;
}

export interface FiltroAuditoria {
  fechaDesde?: string;
  fechaHasta?: string;
  usuarioId?: string;
  accion?: string;
}

interface FilaAuditoriaCruda {
  id: number;
  usuario_id: string | null;
  planta_id: string | null;
  accion: string;
  campos_expuestos: string[];
  detalle: Record<string, unknown>;
  ocurrido_en: string;
  perfiles: { nombre: string } | null;
}

export async function auditoriaDePlanta(
  plantaId: string,
  filtro: FiltroAuditoria = {},
  limite = 200,
): Promise<EntradaAuditoria[]> {
  let query = supabase
    .from('audit_log')
    .select('id, usuario_id, planta_id, accion, campos_expuestos, detalle, ocurrido_en, perfiles:usuario_id(nombre)')
    .eq('planta_id', plantaId)
    .order('ocurrido_en', { ascending: false })
    .limit(limite);

  if (filtro.fechaDesde) query = query.gte('ocurrido_en', filtro.fechaDesde);
  if (filtro.fechaHasta) query = query.lte('ocurrido_en', `${filtro.fechaHasta}T23:59:59.999`);
  if (filtro.usuarioId) query = query.eq('usuario_id', filtro.usuarioId);
  if (filtro.accion) query = query.eq('accion', filtro.accion);

  const { data, error } = await query;
  if (error) throw traducirError(error);

  return (data as unknown as FilaAuditoriaCruda[]).map((fila) => ({
    id: fila.id,
    usuario_id: fila.usuario_id,
    usuario_nombre: fila.perfiles?.nombre ?? null,
    planta_id: fila.planta_id,
    accion: fila.accion,
    campos_expuestos: fila.campos_expuestos,
    detalle: fila.detalle,
    ocurrido_en: fila.ocurrido_en,
  }));
}
