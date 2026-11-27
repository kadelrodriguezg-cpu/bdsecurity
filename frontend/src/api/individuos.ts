/**
 * Individuos: plantas físicas con identidad propia, nacidas en la fase
 * Trasplante (satélite de `plantas`, ver docs/BDSecurity_Arquitectura_
 * Definitiva_NorthStar.md sección 2.2).
 *
 * Individualización: única vía es la RPC individualizar_plantas (backend
 * genera codigo_display, nunca el frontend). Evaluación/PCR/baja: INSERT
 * directo a su tabla, a nombre del usuario autenticado (mismo patrón que
 * api/eventos.ts). Nunca hay DELETE físico de un individuo ni de sus rondas.
 *
 * El individuo NO tiene fase/estado propio (North Star v5, principio 5): las
 * acciones se ubican según en qué fase está el CRUCE (`plantas.estado`), no
 * según un estado del individuo. `fase_actual`/`avanzar_fase_individuo`
 * existieron en v4 y se eliminaron — ver North Star v5 sección 0.
 */
import { supabase, traducirError, exigirUsuario } from './client';
import { conIntentoCreacion } from '@/lib/intentoCreacion';
import { compararCodigos } from '@/lib/ordenNatural';
import type { Database } from '@/types/database.types';

export type EstadoVital = Database['public']['Enums']['estado_vital'];
export type CriterioBaja = Database['public']['Enums']['criterio_baja'];

export interface Individuo {
  id: string;
  planta_id: string;
  codigo_display: string;
  clon_de_id: string | null;
  estado_vital: EstadoVital;
  fecha_baja: string | null;
  created_at: string;
}

export const ESTADO_VITAL_LABEL: Record<EstadoVital, string> = {
  vivo: 'Vivo',
  descartado: 'Descartado',
  muerto: 'Muerto',
};

/**
 * Regla de negocio de la descarga de etiquetas: una planta dada de baja
 * (descartada o muerta) no se etiqueta — no hay nada en terreno donde pegar la
 * etiqueta.
 *
 * Vive acá, junto al tipo `Individuo`, y no dentro de una pantalla, porque las
 * dos listas de individuos del sistema (`IndividuosSeccion` y el Explorador de
 * `EvaluacionAnualWorkspace`) tienen que aplicar exactamente la misma regla.
 * Con una copia por pantalla, cambiar el criterio en una y olvidarse de la otra
 * no rompe nada visible: simplemente se imprimen etiquetas de plantas que ya no
 * existen.
 *
 * Se usa como predicado de `useSeleccionMultiple`, donde ninguna ruta puede
 * saltárselo (ni un clic manual, ni "seleccionar todos", ni quedar seleccionado
 * y darse de baja después). El checkbox deshabilitado es la señal visual de
 * esta regla, no la regla.
 *
 * Ojo: NO se filtra en `listarIndividuosDePlanta`. Las listas deben seguir
 * MOSTRANDO los individuos de baja con su badge y su motivo — lo que se excluye
 * es su selección, no su existencia.
 */
export const esEtiquetable = (individuo: Individuo): boolean => individuo.estado_vital === 'vivo';

export const CRITERIO_BAJA_LABEL: Record<CriterioBaja, string> = {
  vigor: 'Vigor',
  arquitectura: 'Arquitectura',
  sanidad: 'Sanidad',
  uniformidad: 'Uniformidad',
  muerte_natural: 'Muerte natural',
};

/**
 * Individuos de un cruce (planta), ordenados por el correlativo numérico de
 * codigo_display (P2 antes que P9, P9 antes que P10/P100...). El orden se
 * resuelve en el cliente con compararCodigos (orden natural, G16), no con `.order()` en la
 * query: PostgREST ordena codigo_display como texto plano, y desde que
 * conviven códigos sin padding fijo (P9 junto a P100) un orden de texto
 * queda mal ("P100" antes que "P99"). Mismo criterio que ya usan las RPCs
 * de ranking (codigo_display_numero, migración 20260902001000).
 */
export async function listarIndividuosDePlanta(plantaId: string): Promise<Individuo[]> {
  const { data, error } = await supabase
    .from('individuos')
    .select('id, planta_id, codigo_display, clon_de_id, estado_vital, fecha_baja, created_at')
    .eq('planta_id', plantaId);
  if (error) throw traducirError(error);
  return (data as Individuo[]).sort((a, b) => compararCodigos(a.codigo_display, b.codigo_display));
}

/** Resumen de un individuo para ResumenFinal, armado en la base (RPC resumen_individuos_cruce, B8). */
export interface ResumenIndividuoCruce {
  individuo_id: string;
  codigo_display: string;
  estado_vital: EstadoVital;
  /** Solo evaluaciones completa/corregida de rondas anuales. */
  evaluaciones_count: number;
  pcr_count: number;
  /** Motivos de baja con nota, del más nuevo al más viejo. */
  observaciones: Array<{ criterio: CriterioBaja; nota: string }>;
  tiene_emplazamiento: boolean;
  predio_nombre: string | null;
  sector_nombre: string | null;
}

/**
 * Una sola consulta para todos los individuos de un cruce. Reemplaza el N+1
 * de ResumenFinal (rondas, evaluaciones y PCR por ronda, bajas y
 * emplazamientos por individuo). Ordenado igual que listarIndividuosDePlanta.
 */
export async function resumenIndividuosDeCruce(plantaId: string): Promise<ResumenIndividuoCruce[]> {
  const { data, error } = await supabase.rpc('resumen_individuos_cruce', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return (data as unknown as ResumenIndividuoCruce[]).sort((a, b) => compararCodigos(a.codigo_display, b.codigo_display));
}

/** Lo mínimo que hace falta para llevar un QR de individuo a su ficha. */
export interface IndividuoResuelto {
  id: string;
  planta_id: string;
  codigo_display: string;
  estado_vital: EstadoVital;
}

/**
 * Resuelve un individuo por su id (el que codifica su etiqueta) al cruce al que
 * pertenece. SELECT directo bajo RLS, sin RPC ni auditoría por escaneo: la tabla
 * `individuos` no tiene columnas de linaje, así que esto no expone nada nuevo, y
 * al no ser SECURITY DEFINER respeta cualquier política de acceso futura (p. ej.
 * asignación operario↔planta). La apertura de la ficha del cruce sigue pasando
 * por `obtener_planta` (auditada y con límite de frecuencia).
 *
 * Un individuo dado de baja SE RESUELVE igual: la lectura nunca se bloquea
 * (migración 20260719001500). Devuelve null si el id no existe.
 */
/**
 * U-11: el individuo de un código escrito a mano, el que dice su etiqueta (`{codigo_sistema}-P{n}`, p. ej. «02-502-P1»).
 * Sin distinguir mayúsculas y tolerando ceros de relleno («P01»). Devuelve lo mismo que `resolverIndividuo`, para
 * llevarlo a la ficha por el mismo camino que la lectura del QR. `codigo_display` es único, así que no hay ambigüedad.
 */
export async function resolverIndividuoPorCodigo(codigo: string): Promise<IndividuoResuelto | null> {
  const limpio = codigo.trim();
  const relleno = /^(.+)-P0*(\d+)$/i.exec(limpio);
  const candidatos = [...new Set([limpio, ...(relleno ? [`${relleno[1]}-P${relleno[2]}`] : [])])];
  for (const candidato of candidatos) {
    const { data, error } = await supabase
      .from('individuos')
      .select('id, planta_id, codigo_display, estado_vital')
      .ilike('codigo_display', candidato.replace(/[\\%_]/g, '\\$&'))
      .maybeSingle();
    if (error) throw traducirError(error);
    if (data) return data as IndividuoResuelto;
  }
  return null;
}

export async function resolverIndividuo(individuoId: string): Promise<IndividuoResuelto | null> {
  const { data, error } = await supabase
    .from('individuos')
    .select('id, planta_id, codigo_display, estado_vital')
    .eq('id', individuoId)
    .maybeSingle();
  if (error) throw traducirError(error);
  return data as IndividuoResuelto | null;
}

export interface ResumenIndividuo {
  count_eval_trasplante: number;
  count_eval_crecimiento: number;
  rondas_count: number;
  rondas_ultima: number | null;
  rondas_multisitio_count: number;
  emplazamiento_count: number;
  emplazamiento_predio_nombre: string | null;
  emplazamiento_sector_nombre: string | null;
}

/**
 * Resumen agregado de TODOS los individuos de un cruce en una sola llamada
 * (RPC `obtener_resumen_individuos`, migración 20260903002000) — reemplaza
 * las 5 queries por fila (evaluación reducida x2 fases, rondas anuales,
 * rondas multisitio, emplazamientos) que antes se disparaban siempre en
 * IndividuosSeccion aunque la fila estuviera colapsada, solo para armar el
 * resumen de una línea. El detalle completo de cada sección se sigue
 * trayendo aparte, solo al expandir la fila (sin cambios ahí).
 */
export async function obtenerResumenIndividuos(plantaId: string): Promise<Record<string, ResumenIndividuo>> {
  const { data, error } = await supabase.rpc('obtener_resumen_individuos', { p_planta_id: plantaId });
  if (error) throw traducirError(error);
  return (data ?? {}) as unknown as Record<string, ResumenIndividuo>;
}

/**
 * Individualiza p_cantidad plantas del cruce dado. Única vía de creación:
 * el backend valida que la planta esté en 'trasplante' y genera codigo_display.
 */
export async function individualizarPlantas(
  plantaId: string,
  cantidad: number,
): Promise<{ cantidad: number; codigos: string[] }> {
  const usuario = await exigirUsuario();
  return conIntentoCreacion(usuario.id, `individualizar:${plantaId}`, { cantidad }, async (clave) => {
    const { data, error } = await supabase.rpc('individualizar_plantas_una_vez', {
      p_planta_id: plantaId, p_cantidad: cantidad, p_clave: clave,
    });
    if (error) throw traducirError(error);
    if (!data || typeof data !== 'object' || !('codigos' in data) || !Array.isArray(data.codigos)
      || !('cantidad' in data) || data.cantidad !== cantidad || data.codigos.length !== cantidad) {
      throw new Error('No se pudo confirmar el resultado del lote. Reintenta la misma cantidad para recuperarlo.');
    }
    return data as unknown as { cantidad: number; codigos: string[] };
  });
}

/** Crea un individuo-clon del individuo dado (ronda "selección secundaria"). */
export async function clonarIndividuo(individuoOrigenId: string, plantaId: string): Promise<Individuo> {
  const usuario = await exigirUsuario();

  return conIntentoCreacion(usuario.id, `clonar:${individuoOrigenId}`, { plantaId, individuoOrigenId }, async (id) => {
    const buscarPrevio = () => supabase.from('individuos')
      .select('id, planta_id, codigo_display, clon_de_id, estado_vital, fecha_baja, created_at')
      .eq('id', id).eq('planta_id', plantaId).eq('clon_de_id', individuoOrigenId).eq('created_by', usuario.id).maybeSingle();
    // Recuperar un envío ya confirmado sigue siendo válido si después se dio
    // de baja el origen o se archivó el cruce: aquí no se crea otra unidad.
    const previo = await buscarPrevio();
    if (previo.error) throw traducirError(previo.error);
    if (previo.data) return previo.data as Individuo;
    const { data, error } = await supabase
      .from('individuos')
      // codigo_display es obligatorio en el tipo generado, pero el trigger
      // trg_individuos_codigo_display lo pisa siempre en el backend (BEFORE
      // INSERT, corre antes de validar NOT NULL/UNIQUE): el valor acá es un
      // placeholder que nunca llega a persistirse tal cual.
      .insert({ id, planta_id: plantaId, clon_de_id: individuoOrigenId, created_by: usuario.id, codigo_display: '' })
      .select('id, planta_id, codigo_display, clon_de_id, estado_vital, fecha_baja, created_at')
      .single();
    if (error) {
      // Otra petición pudo confirmar mientras se esperaba un lock.
      const previa = await buscarPrevio();
      if (previa.error) throw traducirError(previa.error);
      if (previa.data) return previa.data as Individuo;
    }
    if (error) throw traducirError(error);
    if (!data || data.id !== id) throw new Error('No se pudo confirmar el clon. Reintenta para recuperar el mismo envío.');
    return data as Individuo;
  });
}

// Evaluación completa (15 descriptores) y PCR ahora cuelgan de una ronda de
// evaluación anual, no directo del individuo — ver api/rondas.ts
// (North Star v4, Prompt 7).

// --- Baja --------------------------------------------------------------------

/**
 * Marca la baja de un individuo con la RPC marcar_baja_individuo: en una sola
 * transacción actualiza estado_vital/fecha_baja y crea una fila en
 * baja_motivo por cada criterio elegido (junction, no enum-array), con la nota
 * compartida. Antes eran dos escrituras sueltas y no atómicas; desde la
 * migración 20261021160000 el UPDATE/INSERT directo ya no tiene grant.
 *
 * `idempotencyKey`: generada una vez al montar el formulario y conservada
 * hasta que el envío tiene éxito. Si el usuario reenvía tras una red cortada
 * y la baja ya había quedado aplicada, la RPC responde `repetido` y se trata
 * como éxito, sin duplicar. Permiso: autor del individuo o admin.
 */
export async function marcarBaja(input: {
  individuo_id: string;
  estado_vital: Extract<EstadoVital, 'descartado' | 'muerto'>;
  fecha_baja: string; // YYYY-MM-DD
  criterios: CriterioBaja[];
  nota?: string;
}, idempotencyKey: string): Promise<void> {
  if (input.criterios.length === 0) {
    throw new Error('Selecciona al menos un criterio de baja.');
  }
  const { error } = await supabase.rpc('marcar_baja_individuo', {
    p_individuo_id: input.individuo_id,
    p_estado: input.estado_vital,
    p_criterios: input.criterios,
    p_nota: input.nota?.trim() ?? '', // la RPC guarda '' como null
    p_fecha: input.fecha_baja,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw traducirError(error);
}

// --- Baja en lote (solo admin) --------------------------------------------------

export type MotivoExclusionBaja = 'no_existe' | 'ya_de_baja' | 'cruce_archivado';

export const MOTIVO_EXCLUSION_BAJA_LABEL: Record<MotivoExclusionBaja, string> = {
  no_existe: 'No existe',
  ya_de_baja: 'Ya está de baja',
  cruce_archivado: 'Su cruce está archivado',
};

export interface PrevisualizacionBaja {
  /** Tope de individuos por lote que acepta la base. */
  limite: number;
  procesables: Array<{ id: string; codigo_display: string; planta_id: string }>;
  excluidos: Array<{ id: string; codigo_display: string | null; motivo: MotivoExclusionBaja }>;
}

/** Qué individuos de la selección se darían de baja y cuáles no, con su motivo. No escribe nada. */
export async function previsualizarBajaEnLote(ids: string[]): Promise<PrevisualizacionBaja> {
  const { data, error } = await supabase.rpc('previsualizar_baja_individuos', { p_ids: ids });
  if (error) throw traducirError(error);
  return data as unknown as PrevisualizacionBaja;
}

/**
 * Da de baja a todos los individuos en una transacción. La base rechaza el
 * lote completo si alguno no es elegible. Irreversible.
 */
export async function darBajaEnLote(input: {
  ids: string[];
  estado_vital: Extract<EstadoVital, 'descartado' | 'muerto'>;
  fecha_baja: string;
  criterios: CriterioBaja[];
  nota?: string;
}, idempotencyKey: string): Promise<{ procesados: number; repetido: boolean }> {
  const { data, error } = await supabase.rpc('dar_baja_individuos', {
    p_ids: input.ids,
    p_estado: input.estado_vital,
    p_criterios: input.criterios,
    p_nota: input.nota?.trim() ?? '', // la RPC guarda '' como null
    p_fecha: input.fecha_baja,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw traducirError(error);
  return data as unknown as { procesados: number; repetido: boolean };
}

export interface BajaMotivoRow {
  id: string;
  criterio: CriterioBaja;
  nota: string | null;
  created_at: string;
}

export interface ReactivacionRow {
  id: string;
  estado_anterior: Exclude<EstadoVital, 'vivo'>;
  fecha_baja_anterior: string | null;
  motivo: string;
  created_at: string;
}

/** Fase 5 (G4): reactivaciones de una planta (la más reciente primero). */
export async function listarReactivaciones(individuoId: string): Promise<ReactivacionRow[]> {
  const { data, error } = await supabase
    .from('reactivacion_individuo')
    .select('id, estado_anterior, fecha_baja_anterior, motivo, created_at')
    .eq('individuo_id', individuoId)
    .order('created_at', { ascending: false });
  if (error) throw traducirError(error);
  return (data ?? []) as ReactivacionRow[];
}

/** Fase 5 (G4, solo admin): vuelve a «vivo» una planta dada de baja, con motivo obligatorio (queda en su historial y auditado). */
export async function reactivarIndividuo(individuoId: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('reactivar_individuo', { p_individuo_id: individuoId, p_motivo: motivo });
  if (error) throw traducirError(error);
}

export async function listarBajaMotivos(individuoId: string): Promise<BajaMotivoRow[]> {
  const { data, error } = await supabase
    .from('baja_motivo')
    .select('id, criterio, nota, created_at')
    .eq('individuo_id', individuoId)
    .order('created_at', { ascending: false });
  if (error) throw traducirError(error);
  return data as BajaMotivoRow[];
}
