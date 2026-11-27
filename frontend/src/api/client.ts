/**
 * Cliente único de Supabase para toda la app.
 * Usa la ANON key: cada petición viaja con el JWT del usuario logueado y el
 * RLS de la base decide qué puede ver/tocar. La service_role key NUNCA va acá.
 */
import { createClient, isAuthRetryableFetchError, type User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react';
import type { DatabaseConChat } from '@/types/chat';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copia frontend/.env.example a frontend/.env y complétalas.',
  );
}

export const supabase = createClient<DatabaseConChat>(url, anonKey);

/**
 * Mensaje legible por cada CHECK constraint del schema (mantener sincronizado
 * a mano con las migraciones — no hay forma de generarlo automáticamente).
 * Se arma el mensaje ACÁ, con texto propio; nunca se reenvía error.message ni
 * error.detail crudos (ver comentario de traducirError más abajo sobre por
 * qué). El nombre del constraint en sí es seguro de extraer: el formato
 * estándar de Postgres para 23514 es `violates check constraint "NOMBRE"` —
 * nunca incluye el valor real ni nombres de columnas de linaje.
 */
const MENSAJE_POR_CHECK: Record<string, string> = {
  evaluaciones_brix_tecnico_check: 'Brix debe ser un valor numérico no negativo.',
  evaluaciones_rend_kg_tecnico_check: 'El rendimiento por planta debe ser un valor numérico no negativo.',
  evaluaciones_rend_tha_tecnico_check: 'El rendimiento por hectárea debe ser un valor numérico no negativo.',
  evaluaciones_calibre_tecnico_check: 'Calibre debe ser un valor numérico no negativo.',
  evaluaciones_cantidad_frutos_check: 'La cantidad de frutos debe ser un entero no negativo.',
  evaluaciones_peso_total_check: 'El peso total debe ser un valor numérico no negativo.',
  evaluaciones_brotacion_check: 'Brotación debe estar entre 1 y 5.',
  evaluaciones_floracion_check: 'Floración debe estar entre 1 y 5.',
  evaluaciones_cuaja_check: 'Cuaja debe estar entre 1 y 5.',
  evaluaciones_concentracion_cosecha_check: 'Concentración de cosecha debe estar entre 1 y 5.',
  evaluaciones_distribucion_flores_frutos_check: 'La distribución de flores y frutos debe ser uno de los 3 niveles.',
  evaluaciones_firmeza_check: 'Firmeza debe estar entre 1 y 5.',
  evaluaciones_color_check: 'Color debe estar entre 1 y 5.',
  evaluaciones_bloom_check: 'Bloom debe estar entre 1 y 5.',
  evaluaciones_cicatriz_check: 'La cicatriz debe estar entre 1 y 5.',
  evaluaciones_dano_calor_check: 'Daño por calor debe estar entre 1 y 5.',
  evaluaciones_golpe_sol_check: 'Golpe de sol debe estar entre 1 y 5.',
  evaluaciones_caida_fruto_check: 'Caída de fruto debe estar entre 1 y 5.',
  evaluaciones_pct_fruta_exportable_check: 'Fruta exportable debe estar entre 0 y 100%.',
  evaluaciones_pct_buen_estado_15d_check: 'El buen estado a los 15 días debe estar entre 0 y 100%.',
  evaluaciones_pct_buen_estado_30d_check: 'El buen estado a los 30 días debe estar entre 0 y 100%.',
  evaluaciones_pct_buen_estado_45d_check: 'El buen estado a los 45 días debe estar entre 0 y 100%.',
  evaluacion_reducida_vigor_check: 'Vigor debe estar entre 1 y 5.',
  evaluacion_reducida_presencia_raices_check: 'Presencia de raíces debe estar entre 1 y 5.',
  scoring_version_umbrales_delta_check: 'Los umbrales de delta deben estar entre 0 y 1 y en orden creciente.',
  ronda_evaluacion_anual_numero_ronda_check: 'El número de ronda debe estar entre 1 y 3.',
  procedimiento_cultivo_cantidad_check: 'La cantidad/dosis debe ser mayor que 0.',
  plantas_sustrato_porcentaje_check: 'El porcentaje de sustrato debe estar entre 0 y 100.',
  plantas_n_flores_cruzadas_check: 'El número de flores cruzadas no puede ser negativo.',
  polinizacion_evento_n_flores_cruzadas_check: 'El número de flores cruzadas no puede ser negativo.',
  plantas_n_semillas_check: 'El número de semillas no puede ser negativo.',
  plantas_semillas_sembradas_check: 'Las semillas sembradas no pueden ser negativas.',
  plantas_escarificacion_duracion_dias_check: 'La duración de estratificación no puede ser negativa.',
  chk_escarificacion_duracion_solo_estratificacion: 'La duración solo aplica si la escarificación es de tipo estratificación.',
  cosecha_fruto_cantidad_semillas_check: 'La cantidad de semillas del fruto no puede ser negativa.',
  germinacion_evento_cantidad_nueva_check: 'La cantidad germinada no puede ser negativa.',
  evecl_ficha_fecha_chk: 'La fecha de evaluación no puede ser futura.',
  evecl_ficha_rep_chk: 'La repetición debe estar entre 1 y 20.',
  evecl_respuesta_valor_chk: 'El valor numérico debe ser mayor o igual a cero.',
  evecl_respuesta_algo_chk: 'La respuesta debe incluir al menos un dato.',
  evecl_ensayo_lat_chk: 'La latitud debe estar entre -90 y 90.',
  evecl_ensayo_lon_chk: 'La longitud debe estar entre -180 y 180.',
};

/** Extrae el nombre del constraint del mensaje estándar de Postgres para 23514 — nunca expone el valor cargado, solo el identificador del constraint. */
function nombreDeConstraint(mensaje: string | undefined): string | null {
  const m = mensaje?.match(/violates check constraint "([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Detecta si un error 23505 (unique_violation) corresponde exactamente al
 * constraint de idempotency_key indicado — para distinguir "esto es un
 * reintento del mismo intento de guardado" (se resuelve devolviendo la fila
 * ya creada) de cualquier otro duplicado real (ej. código repetido), que sí
 * debe mostrarse como error.
 */
export function esConflictoDeIdempotencia(error: { code?: string; message?: string } | null, nombreConstraint: string): boolean {
  if (!error || error.code !== '23505') return false;
  return error.message?.includes(`"${nombreConstraint}"`) ?? false;
}

/**
 * Patrones de los mensajes que GENERA POSTGRES automáticamente (en inglés,
 * con formato de máquina). Todo lo que matchea acá sigue el camino de
 * traducción genérica de siempre (puede filtrar nombres de tabla/columna o,
 * en el DETAIL, valores reales de linaje — jamás se reenvía).
 *
 * Lo que NO matchea y viene con un código de negocio es un RAISE EXCEPTION
 * escrito por nosotros en una RPC (texto propio en español, ej. "Este predio
 * está inactivo, elige otro destino") — ese mensaje SÍ se muestra tal cual.
 * Antes de este fix (Sprint 6), traducirError descartaba también esos
 * mensajes intencionales y el usuario veía solo el texto genérico del código
 * (hallazgo arrastrado de Sprint 5, ver migración 20260719017000).
 */
const PATRONES_POSTGRES_CRUDOS = [
  /violates/i,
  /duplicate key/i,
  /null value in column/i,
  /permission denied/i,
  /is not present in table/i,
  /does not exist/i,
  /syntax error/i,
  /invalid input/i,
  /out of range/i,
  /row-level security/i,
  /current transaction is aborted/i,
];

/** Códigos que nuestras RPC usan en RAISE EXCEPTION con mensajes de negocio propios. */
const CODIGOS_CON_MENSAJE_DE_NEGOCIO = new Set([
  '23514', // validaciones de negocio (destino inactivo, snapshot sin nombre…)
  '23502', // campos obligatorios ("La fecha de inicio es obligatoria")
  '22023', // parámetros inválidos ("Indica exactamente un cruce o una especie")
  '22007', // fechas inválidas ("La fecha del traslado no puede anteceder…")
  '42501', // permisos con explicación ("Solo un admin puede…")
  'P0002', // no encontrado con contexto ("Cruce no encontrado")
  '23503', // referencias con mensaje propio
  '55000', // estado de objeto ("El historial de emplazamientos es append-only…")
]);

function esMensajeDeNegocio(codigo: string | undefined, mensaje: string | undefined): boolean {
  if (!codigo || !mensaje || !CODIGOS_CON_MENSAJE_DE_NEGOCIO.has(codigo)) return false;
  return !PATRONES_POSTGRES_CRUDOS.some((patron) => patron.test(mensaje));
}

/**
 * Traduce errores de Postgres/Supabase a mensajes útiles para el usuario.
 * Los códigos vienen de los RAISE EXCEPTION de las migraciones y de Postgres:
 *   23514 = CHECK constraint violado (rango de un campo) — se traduce con
 *           MENSAJE_POR_CHECK, nunca con el mensaje crudo de Postgres.
 *   23503 = referencia a una fila que no existe (foreign key)
 *   42501 = permiso insuficiente (grants, triggers de seguridad, policies)
 *   P0002 = no encontrado (obtener_planta / actualizar_linaje)
 *   28000 = no autenticado
 *   23505 = valor duplicado (unique violation, ej. codigo_sistema repetido)
 *
 * El mensaje crudo de Postgres (error.message/detail/hint) NUNCA se devuelve
 * tal cual al llamador ni se manda completo a Sentry: puede filtrar valores
 * reales de linaje genético (sobre todo en el DETAIL de violaciones de FK/
 * UNIQUE). La única excepción es el nombre del CONSTRAINT en un 23514, que el
 * formato estándar de Postgres nunca acompaña con el valor cargado — de ahí
 * se arma un mensaje propio (MENSAJE_POR_CHECK), no se reenvía el texto de
 * Postgres. A console.error y Sentry solo va el código + el nombre de un
 * constraint reconocido (si aplica) — nunca message/detail.
 *
 * Antes de esta corrección, TODO error no listado explícitamente caía en un
 * mensaje genérico ("No se pudo completar la operación") que ocultaba la
 * causa real — eso costó varias rondas de investigación forense en este
 * proyecto. El fallback ahora sigue sin filtrar datos, pero muestra el código
 * de error real para que se pueda diagnosticar sin adivinar.
 */
export type TipoErrorApi = 'no_encontrado' | 'sin_permiso' | 'sin_sesion' | 'red' | 'desconocido';

export class ErrorApi extends Error {
  constructor(message: string, readonly tipo: TipoErrorApi, readonly code?: string) {
    super(message);
    this.name = 'ErrorApi';
  }
}

export const MENSAJE_SIN_CONEXION_EVALUACION = 'Sin conexión: tu evaluación sigue aquí.';
const MENSAJE_SIN_CONEXION = 'Sin conexión: lo que escribiste sigue aquí.';
const MENSAJE_SESION_EXPIRADA = 'Tu sesión expiró. Vuelve a iniciar sesión.';

/**
 * Usuario de la sesión para firmar una escritura (U-04). `getUser()` va a la
 * red: sin conexión falla y antes se leía como «sesión expirada», lo que
 * empujaba a cerrar sesión. Ahora la falta de red es un ErrorApi de tipo
 * `red` (se puede reintentar; las escrituras con clave de idempotencia no
 * duplican) y solo la falta real de sesión dice que expiró.
 */
export async function exigirUsuario(mensajeSinConexion = MENSAJE_SIN_CONEXION): Promise<User> {
  const { data, error } = await supabase.auth.getUser();
  if (data.user) return data.user;
  const sinRed = (error && isAuthRetryableFetchError(error)) || (typeof navigator !== 'undefined' && navigator.onLine === false);
  if (sinRed) throw new ErrorApi(mensajeSinConexion, 'red');
  throw new ErrorApi(MENSAJE_SESION_EXPIRADA, 'sin_sesion');
}

export function tipoErrorApi(error: unknown): TipoErrorApi {
  if (error instanceof ErrorApi) return error.tipo;
  // Los rechazos de fetch pueden ocurrir antes de que Supabase traduzca el error.
  if (error instanceof TypeError && /failed to fetch|fetch failed|network/i.test(error.message)) return 'red';
  return 'desconocido';
}

export function traducirError(error: { code?: string; message?: string } | null): ErrorApi {
  if (!error) return new ErrorApi('No se pudo completar la operación. Intenta de nuevo.', 'desconocido');
  const code = error.code && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code) ? error.code : undefined;
  const tipo: TipoErrorApi = code === 'P0002' ? 'no_encontrado'
    : code === '42501' ? 'sin_permiso'
    : ['28000', '28P01', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code ?? '') ? 'sin_sesion'
    : !code && /failed to fetch|fetch failed|networkerror|network request failed/i.test(error.message ?? '') ? 'red'
    : 'desconocido';
  const crear = (mensaje: string) => new ErrorApi(mensaje, tipo, code);

  const extraido = code === '23514' ? nombreDeConstraint(error.message) : null;
  const constraint = extraido && Object.prototype.hasOwnProperty.call(MENSAJE_POR_CHECK, extraido) ? extraido : null;

  // eslint-disable-next-line no-console
  console.error('[Supabase error]', { code: code ?? 'unknown', ...(constraint ? { constraint } : {}) });

  // A Sentry va el código + el nombre del constraint (seguro, sin datos) —
  // nunca error.message/detail crudos.
  Sentry.captureException(new Error(`Supabase error: ${code ?? 'sin_codigo'}${constraint ? ` (${constraint})` : ''}`), {
    tags: { supabase_error_code: code ?? 'unknown', ...(constraint ? { constraint } : {}) },
  });

  // Mensaje de negocio explícito de una RPC nuestra (RAISE EXCEPTION con
  // texto propio): se muestra tal cual. Solo se filtra lo que generó
  // Postgres automáticamente (ver PATRONES_POSTGRES_CRUDOS).
  if (esMensajeDeNegocio(error.code, error.message)) {
    return crear(error.message!);
  }

  switch (error.code) {
    case '23514': {
      const mensaje = constraint ? MENSAJE_POR_CHECK[constraint] : null;
      return crear(mensaje ?? 'Uno de los valores cargados no cumple una validación.');
    }
    case '23503':
      return crear('No se pudo completar: hace referencia a un registro relacionado que no existe o fue eliminado.');
    case '42501':
      return crear(error.message?.includes('linaje')
        ? 'No tienes permiso para acceder al linaje genético.'
        : 'No tienes permiso para hacer esta operación (revisa tu rol o si el registro sigue vivo/disponible).');
    case 'P0002':
      return crear('La planta no existe o fue eliminada.');
    case '28000':
      return crear('Tu sesión expiró. Vuelve a iniciar sesión.');
    case '23505':
      if (error.message?.includes('"cosecha_fruto_planta_id_numero_fruto_key"')) {
        return crear('Otro registro de fruto ocupó ese número. Recarga los frutos e intenta de nuevo.');
      }
      return crear('Ya existe un registro con ese valor (¿código de sistema duplicado?).');
    default:
      return crear(tipo === 'red' ? 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.' : `No se pudo completar la operación (código ${code ?? 'desconocido'}). Intenta de nuevo.`);
  }
}
