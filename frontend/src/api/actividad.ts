/**
 * "Actividad reciente" de un cruce — bloque 3 de la jerarquía de la ficha en
 * fase Evaluación anual (Ronda 2 UI). Deliberadamente NO usa `audit_log`:
 * esa tabla es admin-only (RLS `audit_select_admin` + gate en
 * AuditoriaPanel.tsx, CLAUDE.md sección 4) y este bloque lo ve cualquier
 * autenticado. En cambio, arma la actividad más reciente leyendo las 4
 * tablas que YA son legibles por cualquier autenticado hoy (mismas policies
 * `_select_autenticados` que ya usan EvaluacionesLista/PcrLista/BajaInfo/
 * EventosLista): evaluaciones, pcr_analisis, baja_motivo y registros_evento.
 * Sin agregación (no agrupa por sesión/autor) — la más reciente de cada
 * tabla, y de esas cuatro, la más reciente de todas.
 *
 * `evaluaciones`/`pcr_analisis` cuelgan de `ronda_id`, no de `individuo_id`
 * directo (ver ronda_evaluacion_anual): se filtran por el cruce con un embed
 * de dos saltos (!inner). Antes se resolvía con listas de ids en la URL, que
 * en un cruce grande superaban el largo permitido.
 */
import { supabase, traducirError } from './client';
import { nombresDeUsuarios } from './nombres';
import { CRITERIO_BAJA_LABEL, type CriterioBaja } from './individuos';
import { CLAVES_DESCRIPTORES_ANUAL } from '@/lib/esquemaFase/evaluacionAnual';
import { TIPO_EVENTO_LABEL, type TipoEvento } from '@/types/domain';

export type TipoActividad = 'evaluacion' | 'pcr' | 'baja' | 'evento';

export interface UltimaActividad {
  tipo: TipoActividad;
  ocurrioEn: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  detalle: string;
}

interface ConPerfil {
  created_at: string;
  created_by: string | null;
  perfiles: { nombre: string } | null;
}

/** Texto cuando no se puede leer el perfil de quien lo hizo (D13, mismo criterio que D5). */
export const NOMBRE_NO_VISIBLE = 'otra persona';

/** RLS `perfiles_select_propio` solo deja ver el propio perfil a un no-admin: el
 * nombre de OTRO usuario llega null por RLS, no porque la cuenta se haya borrado ni
 * porque falle la consulta. En una evaluación se usa entonces el campo `evaluador`
 * (texto que la planilla ya muestra a cualquier autenticado); si tampoco hay, «otra persona». */
export function nombreOFallback(fila: ConPerfil, evaluador?: string | null): string | null {
  return fila.perfiles?.nombre ?? (evaluador?.trim() || null) ?? (fila.created_by ? NOMBRE_NO_VISIBLE : null);
}

const DESCRIPTORES = CLAVES_DESCRIPTORES_ANUAL;

export async function obtenerUltimaActividadDeCruce(plantaId: string): Promise<UltimaActividad | null> {
  // Sprint 1.1: el cruce se filtra por la relación (!inner), no con listas de
  // ids en la URL. Con 379 individuos la lista superaba el largo de URL que
  // acepta la API (414) y el bloque quedaba sin cargar.
  const [evaluacion, pcr, baja, evento] = await Promise.all([
    supabase
      .from('evaluaciones')
      .select(`created_at, created_by, evaluador, ${DESCRIPTORES.join(', ')}, perfiles:created_by(nombre), ronda:ronda_evaluacion_anual!inner(individuo:individuos!inner(planta_id))`)
      .eq('ronda.individuo.planta_id', plantaId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('pcr_analisis')
      .select('created_at, created_by, realizado, perfiles:created_by(nombre), ronda:ronda_evaluacion_anual!inner(individuo:individuos!inner(planta_id))')
      .eq('ronda.individuo.planta_id', plantaId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('baja_motivo')
      .select('created_at, created_by, criterio, perfiles:created_by(nombre), individuo:individuos!inner(planta_id)')
      .eq('individuo.planta_id', plantaId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('registros_evento')
      .select('created_at, created_by, tipo_evento, perfiles:created_by(nombre)')
      .eq('planta_id', plantaId)
      .is('eliminado_at', null)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  for (const resultado of [evaluacion, pcr, baja, evento]) {
    if (resultado.error) throw traducirError(resultado.error as { code?: string; message?: string });
  }

  const candidatos: UltimaActividad[] = [];

  const filaEval = (evaluacion.data as unknown as (ConPerfil & Record<string, unknown>)[])[0];
  if (filaEval) {
    const cargados = DESCRIPTORES.filter((d) => filaEval[d] != null).length;
    candidatos.push({
      tipo: 'evaluacion',
      ocurrioEn: filaEval.created_at,
      usuarioId: filaEval.created_by,
      usuarioNombre: nombreOFallback(filaEval, filaEval.evaluador as string | null),
      detalle: `${cargados} de ${DESCRIPTORES.length} descriptores registrados`,
    });
  }

  const filaPcr = (pcr.data as unknown as (ConPerfil & { realizado: boolean })[])[0];
  if (filaPcr) {
    candidatos.push({
      tipo: 'pcr',
      ocurrioEn: filaPcr.created_at,
      usuarioId: filaPcr.created_by,
      usuarioNombre: nombreOFallback(filaPcr),
      detalle: filaPcr.realizado ? 'Realizado' : 'No realizado',
    });
  }

  const filaBaja = (baja.data as unknown as (ConPerfil & { criterio: CriterioBaja })[])[0];
  if (filaBaja) {
    candidatos.push({
      tipo: 'baja',
      ocurrioEn: filaBaja.created_at,
      usuarioId: filaBaja.created_by,
      usuarioNombre: nombreOFallback(filaBaja),
      detalle: CRITERIO_BAJA_LABEL[filaBaja.criterio],
    });
  }

  const filaEvento = (evento.data as unknown as (ConPerfil & { tipo_evento: TipoEvento })[])[0];
  if (filaEvento) {
    candidatos.push({
      tipo: 'evento',
      ocurrioEn: filaEvento.created_at,
      usuarioId: filaEvento.created_by,
      usuarioNombre: nombreOFallback(filaEvento),
      detalle: TIPO_EVENTO_LABEL[filaEvento.tipo_evento],
    });
  }

  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => new Date(b.ocurrioEn).getTime() - new Date(a.ocurrioEn).getTime());
  const ultima = candidatos[0];
  // N15: el nombre real de quien lo hizo sale de nombres_de_usuarios (solo id y nombre), también para un operario.
  // Tiene prioridad sobre el evaluador escrito a mano y sobre «otra persona»; sin la función (base vieja) queda el respaldo.
  if (ultima.usuarioId) {
    const nombre = (await nombresDeUsuarios([ultima.usuarioId])).get(ultima.usuarioId);
    if (nombre) return { ...ultima, usuarioNombre: nombre };
  }
  return ultima;
}
