/**
 * Rondas de evaluación anual (North Star v4, sección 2.3): "Primer año de
 * evaluación" se repite 1-3 veces como ronda completa. Cada ronda agrupa su
 * propia evaluación de 15 descriptores + PCR. Solo disponible cuando el
 * individuo está en fase 'evaluacion_anual' (ver api/individuos.ts).
 */
import { supabase, traducirError, esConflictoDeIdempotencia, exigirUsuario, MENSAJE_SIN_CONEXION_EVALUACION } from './client';
import type { MotivoNoEvaluada } from './protocolo';

export type TipoRonda = 'anual' | 'multisitio';

export interface Ronda {
  id: string;
  individuo_id: string;
  tipo_ronda: TipoRonda;
  numero_ronda: number;
  /** NULL en rondas multisitio (se ubican por predio/fecha, no por año). */
  anio: number | null;
  predio_id: string | null;
  fecha_inicio: string | null;
  created_at: string;
  /** Fase 5 (G3): «No evaluada en esta ronda» (nulo = no marcada). */
  no_evaluada_motivo?: MotivoNoEvaluada | null;
  no_evaluada_detalle?: string | null;
}

/**
 * Lista UNA serie (anual O multisitio) — nunca mezcladas: los contadores son
 * independientes por tipo desde Sprint 3 y la UI los presenta como secciones
 * separadas (2.3 del documento maestro).
 */
export async function listarRondas(individuoId: string, tipo: TipoRonda = 'anual'): Promise<Ronda[]> {
  const { data, error } = await supabase
    .from('ronda_evaluacion_anual')
    .select('id, individuo_id, tipo_ronda, numero_ronda, anio, predio_id, fecha_inicio, created_at, no_evaluada_motivo, no_evaluada_detalle')
    .eq('individuo_id', individuoId)
    .eq('tipo_ronda', tipo)
    .order('numero_ronda');
  if (error) throw traducirError(error);
  return data as Ronda[];
}

/** Única vía de creación de rondas ANUALES. Asigna el siguiente numero_ronda (1-3) de la serie anual; rechaza la 4ª. */
export async function iniciarRonda(individuoId: string, numeroEsperado: number): Promise<{ ronda_id: string; numero_ronda: number }> {
  const { data, error } = await supabase.rpc('iniciar_ronda_esperada', { p_individuo_id: individuoId, p_tipo: 'anual', p_numero_esperado: numeroEsperado });
  if (error) throw traducirError(error);
  return data as unknown as { ronda_id: string; numero_ronda: number };
}

/**
 * Fase 5 (G3, solo admin): la planta queda «No evaluada en esta ronda» con motivo. Cuenta como cerrada para abrir la ronda
 * siguiente y deja de ser pendiente; no entra al ranking de esa ronda. La base valida y sus mensajes llegan tal cual.
 */
export async function marcarRondaNoEvaluada(rondaId: string, motivo: MotivoNoEvaluada, detalle: string | null): Promise<void> {
  const { error } = await supabase.rpc('marcar_ronda_no_evaluada', { p_ronda_id: rondaId, p_motivo: motivo, p_detalle: detalle ?? undefined });
  if (error) throw traducirError(error);
}

/** Fase 5 (G3, solo admin): quita la marca si la planta no empezó la ronda siguiente. */
export async function quitarRondaNoEvaluada(rondaId: string): Promise<void> {
  const { error } = await supabase.rpc('quitar_ronda_no_evaluada', { p_ronda_id: rondaId });
  if (error) throw traducirError(error);
}

/** Única vía de creación de rondas MULTISITIO (contador propio 1-3, independiente de la serie anual). */
export async function iniciarRondaMultisitio(individuoId: string, numeroEsperado: number): Promise<{ ronda_id: string; numero_ronda: number }> {
  const { data, error } = await supabase.rpc('iniciar_ronda_esperada', { p_individuo_id: individuoId, p_tipo: 'multisitio', p_numero_esperado: numeroEsperado });
  if (error) throw traducirError(error);
  return data as unknown as { ronda_id: string; numero_ronda: number };
}

// --- Evaluación detallada (26 descriptores capturables), ahora por ronda ----

export type EstadoEvaluacion = 'borrador' | 'completa' | 'corregida' | 'anulada';

export interface EvaluacionInput {
  ronda_id: string;
  fecha: string; // YYYY-MM-DD
  estado: Extract<EstadoEvaluacion, 'borrador' | 'completa'>;
  evaluador?: string;
  observaciones?: string;
  sin_muestra?: boolean;
  no_comparable?: boolean;
  cantidad_frutos?: number | null;
  peso_total_g?: number | null;
  brotacion?: number | null;
  floracion?: number | null;
  cuaja?: number | null;
  concentracion_cosecha?: number | null;
  /** Brotes y varas, 1 a 3: 1 solo en la punta, 2 hasta la mitad, 3 toda la vara. Opcional; no entra al puntaje (EF12). */
  distribucion_flores_frutos?: number | null;
  calibre_mm?: number | null;
  firmeza?: number | null;
  color?: number | null;
  bloom?: number | null;
  brix?: number | null;
  cicatriz?: number | null;
  rend_kg_planta?: number | null;
  /** Desactivado (EF11): el formulario ya no lo pide ni lo envía; las evaluaciones históricas conservan su valor. */
  rend_t_ha?: number | null;
  /** Poscosecha (fase 4): % de frutos en buen estado a los 15, 30 y 45 días de refrigerador. */
  pct_buen_estado_15d?: number | null;
  pct_buen_estado_30d?: number | null;
  pct_buen_estado_45d?: number | null;
  /** Calculado desde la fase 4 (la base lo calcula en la fotografía de la ronda); en una visita suelta, solo el valor histórico escrito a mano. */
  pct_fruta_exportable?: number | null;
  dano_calor?: number | null;
  golpe_sol?: number | null;
  caida_fruto?: number | null;
  n_varas_basales?: number | null;
  n_varas_con_flor?: number | null;
  n_flores_varas_basales?: number | null;
  n_frutos_varas_basales?: number | null;
  altura_brote_mm?: number | null;
  diametro_brote_mm?: number | null;
  vigor_vegetativo?: number | null;
  color_follaje?: number | null;
  presencia_yemas_florales?: number | null;
  fecha_inicio_floracion?: string | null;
  precocidad?: number | null;
}

export interface EvaluacionRow extends Omit<EvaluacionInput, 'estado'> {
  id: string;
  anio: number;
  estado: EstadoEvaluacion;
  peso_promedio_g: number | null;
  pct_flores: number | null;
  pct_frutos: number | null;
  requiere_revision: boolean;
  motivo_cambio: string | null;
  /** Autor del registro (lo fija la base). */
  created_by?: string | null;
  /** Fase 2: versión del protocolo con que se creó (la fija un trigger). */
  protocolo_id?: string | null;
  updated_at: string;
  created_at: string;
}

export interface RangoReferencia {
  id: string;
  metrica: string;
  especie_id: string | null;
  fase: string | null;
  minimo_esperado: number | null;
  maximo_esperado: number | null;
  limite_revision_inferior: number | null;
  limite_revision_superior: number | null;
  vigente_desde: string;
  vigente_hasta: string | null;
  activo: boolean;
  nota: string | null;
  created_at: string;
  updated_at: string;
}

export type ReferenciasEvaluacion = Record<string, RangoReferencia>;

export async function obtenerReferenciasEvaluacion(
  rondaId: string,
  fecha: string,
): Promise<ReferenciasEvaluacion> {
  const { data, error } = await supabase.rpc('obtener_referencias_evaluacion', {
    p_ronda_id: rondaId,
    p_fecha: fecha,
  });
  if (error) throw traducirError(error);
  return (data ?? {}) as unknown as ReferenciasEvaluacion;
}

/**
 * Historial de evaluaciones REALES de una ronda: solo completa/corregida.
 * Un borrador a medio llenar o una evaluación anulada no son un hecho
 * consumado y no deben mezclarse con el historial (se confundió una vez con
 * "el sistema ya soporta evaluaciones parciales" cuando en realidad era esto).
 * Para detectar un borrador en curso usar buscarBorradorDeRonda, no esta función.
 */
export async function listarEvaluacionesDeRonda(rondaId: string): Promise<EvaluacionRow[]> {
  const { data, error } = await supabase
    .from('evaluaciones')
    .select('*')
    .eq('ronda_id', rondaId)
    .in('estado', ['completa', 'corregida'])
    .order('fecha', { ascending: false });
  if (error) throw traducirError(error);
  return data as unknown as EvaluacionRow[];
}

export interface EvaluacionConContexto extends EvaluacionRow {
  ronda: {
    numero_ronda: number;
    tipo_ronda: TipoRonda;
    anio: number | null;
    /** Fase 5 (G2): para la etiqueta de temporada (julio a junio). */
    fecha_inicio?: string | null;
    created_at?: string | null;
    individuo: { id: string; codigo_display: string; planta_id: string };
  };
}

/** Una evaluación con su ronda e individuo, para la evaluación pasada a pantalla completa (RLS de evaluaciones). */
export async function obtenerEvaluacion(evaluacionId: string): Promise<EvaluacionConContexto> {
  const { data, error } = await supabase
    .from('evaluaciones')
    .select('*, ronda:ronda_evaluacion_anual!inner(numero_ronda, tipo_ronda, anio, fecha_inicio, created_at, individuo:individuos!inner(id, codigo_display, planta_id))')
    .eq('id', evaluacionId)
    .single();
  if (error) throw traducirError(error);
  return data as unknown as EvaluacionConContexto;
}

/**
 * Único borrador activo de una ronda (o null). Separada del historial de
 * arriba a propósito: el formulario necesita ver un borrador en curso para
 * ofrecer "continuar/descartar" aunque el historial nunca deba mostrarlo.
 */
export async function buscarBorradorDeRonda(rondaId: string): Promise<EvaluacionRow | null> {
  const { data, error } = await supabase
    .from('evaluaciones')
    .select('*')
    .eq('ronda_id', rondaId)
    .eq('estado', 'borrador')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw traducirError(error);
  return data as unknown as EvaluacionRow | null;
}

/**
 * `idempotencyKey`: generada una vez al montar el formulario (no en cada
 * click de guardar) — identifica el INTENTO de guardado, no el contenido.
 * Un reintento (red, doble-tap) con la misma key nunca duplica: se detecta
 * el 23505 del UNIQUE de la columna y se devuelve la fila ya creada como si
 * el insert hubiera tenido éxito. No limita cuántas evaluaciones reales
 * puede tener una ronda -- cada montaje nuevo del formulario trae una key
 * distinta.
 */
export async function crearEvaluacion(input: EvaluacionInput, idempotencyKey: string): Promise<{ id: string }> {
  const usuario = await exigirUsuario(MENSAJE_SIN_CONEXION_EVALUACION);

  const { data, error } = await supabase
    .from('evaluaciones')
    .insert({ ...input, created_by: usuario.id, idempotency_key: idempotencyKey })
    .select('id')
    .single();
  if (error) {
    if (esConflictoDeIdempotencia(error, 'evaluaciones_idempotency_key_key')) {
      const { data: existente, error: errorExistente } = await supabase
        .from('evaluaciones')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .single();
      if (!errorExistente && existente) {
        // A1-062: un reintento con la misma clave solo es «el mismo guardado»
        // si trae los mismos valores; si no, se avisa en vez de descartarlos.
        if (!mismoContenido(input, existente as unknown as Record<string, unknown>)) {
          const distinto = new Error(
            'Este intento ya se había guardado con otros valores. Revisa la evaluación guardada antes de volver a enviar los cambios.',
          );
          distinto.name = 'ConflictoIdempotenciaContenidoError';
          throw distinto;
        }
        return { id: (existente as { id: string }).id };
      }
    }
    if (esConflictoDeBorradorActivo(error)) {
      const conflicto = new Error(
        'Esta ronda ya tiene un borrador abierto. Continúalo o descártalo antes de empezar otro.',
      );
      conflicto.name = 'ConflictoBorradorActivoError';
      throw conflicto;
    }
    throw traducirError(error);
  }
  return data;
}

/** Compara lo enviado con la fila guardada (null y ausente cuentan igual). */
export function mismoContenido(input: EvaluacionInput, guardada: Record<string, unknown>): boolean {
  const normalizar = (v: unknown) => (v === undefined || v === null || v === '' ? null : typeof v === 'number' ? v : String(v));
  return Object.entries(input).every(([clave, valor]) => {
    const enviado = normalizar(valor);
    const actual = normalizar(guardada[clave]);
    if (typeof enviado === 'number' && actual !== null) return Number(actual) === enviado;
    return enviado === actual;
  });
}

/** Distingue la carrera legítima de dos clientes creando el borrador inicial. */
export function esConflictoDeBorradorActivo(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error?.code === '23505'
      && error.message?.includes('"evaluaciones_un_borrador_activo_por_ronda_uidx"'),
  );
}

export async function actualizarEvaluacion(
  evaluacionId: string,
  cambios: Partial<Omit<EvaluacionInput, 'ronda_id' | 'estado'>> & {
    estado?: EstadoEvaluacion;
    motivo_cambio?: string;
  },
  versionEsperada: string,
): Promise<EvaluacionRow> {
  if (!versionEsperada) throw new Error('Falta la versión del borrador. Vuelve a abrirlo antes de guardar.');
  const { data, error } = await supabase
    .from('evaluaciones')
    .update(cambios)
    .eq('id', evaluacionId)
    .eq('updated_at', versionEsperada)
    .select('*')
    .maybeSingle();
  if (error) throw traducirError(error);
  if (!data) {
    const conflicto = new Error('El borrador cambió en otra sesión o ya no está disponible. Tus cambios no se guardaron. Conserva lo que necesites y vuelve a abrirlo para revisar la versión actual.');
    conflicto.name = 'ConflictoVersionEvaluacionError';
    throw conflicto;
  }
  return data as unknown as EvaluacionRow;
}

// --- PCR, ahora por ronda ----------------------------------------------------

export interface PcrRow {
  id: string;
  ronda_id: string;
  realizado: boolean;
  informe_pdf_url: string | null;
  fecha: string | null;
  created_at: string;
}

export async function listarPcrDeRonda(rondaId: string): Promise<PcrRow[]> {
  const { data, error } = await supabase
    .from('pcr_analisis')
    .select('id, ronda_id, realizado, informe_pdf_url, fecha, created_at')
    .eq('ronda_id', rondaId)
    .order('created_at', { ascending: false });
  if (error) throw traducirError(error);
  return data as PcrRow[];
}

/** Sube el PDF del informe al bucket privado media-plantas (reutilizado, no se crea bucket nuevo). */
export async function subirPdfPcr(file: File, codigoDisplay: string): Promise<string> {
  const nombreLimpio = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `pcr/${codigoDisplay}/${crypto.randomUUID()}/${Date.now()}-${nombreLimpio}`;
  const { error } = await supabase.storage.from('media-plantas').upload(path, file);
  if (error) throw new Error(`No se pudo subir el PDF: ${error.message}`);
  return path;
}

/** `idempotencyKey`: mismo patrón que crearEvaluacion -- ver comentario ahí. */
export async function crearPcr(input: {
  ronda_id: string;
  realizado: boolean;
  fecha?: string | null;
  informe_pdf_url?: string | null;
}, idempotencyKey: string): Promise<{ id: string }> {
  const usuario = await exigirUsuario();

  const { data, error } = await supabase
    .from('pcr_analisis')
    .insert({
      ronda_id: input.ronda_id,
      realizado: input.realizado,
      fecha: input.realizado ? input.fecha ?? null : null,
      informe_pdf_url: input.realizado ? input.informe_pdf_url ?? null : null,
      created_by: usuario.id,
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();
  if (error) {
    if (esConflictoDeIdempotencia(error, 'pcr_analisis_idempotency_key_key')) {
      const { data: existente, error: errorExistente } = await supabase
        .from('pcr_analisis')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .single();
      if (!errorExistente && existente) return existente;
    }
    throw traducirError(error);
  }
  return data;
}

/** URL firmada temporal (1 hora) para ver el PDF del bucket privado. */
export async function urlFirmadaPdfPcr(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('media-plantas').createSignedUrl(storagePath, 3600);
  if (error) throw new Error(`No se pudo generar el enlace del PDF: ${error.message}`);
  return data.signedUrl;
}
