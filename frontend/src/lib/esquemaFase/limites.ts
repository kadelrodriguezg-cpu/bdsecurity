/**
 * Validación de los descriptores numéricos de la evaluación anual (U-07 de
 * docs/revision_ux/informe.md, rehecho según las decisiones cerradas: Maestro §2.5).
 *
 * Hay dos cosas distintas y no se mezclan:
 *  1. Validación TÉCNICA, que bloquea el guardado: el valor tiene que ser un número finito, no
 *     negativo y entero donde el descriptor cuenta cosas. Es lo mismo que exigen los CHECK de la
 *     base (`evaluaciones_*_check`); la única cota superior es la de `pct_fruta_exportable`
 *     (0–100 %, también un CHECK de la base: un porcentaje no puede pasar de 100).
 *  2. Aviso de RANGO ESPERADO, que nunca bloquea: lo que cae fuera del `rango_referencia` de la
 *     base se destaca en ámbar («fuera del rango esperado: revisa»). Un descriptor sin
 *     `rango_referencia` no tiene aviso: no se inventan rangos.
 *
 * Las escalas 1–5 no están acá: sus botones solo ofrecen valores válidos.
 */
import { ESQUEMA_EVALUACION_ANUAL, type ClaveEvaluacionAnual } from './evaluacionAnual';

export interface ReglaTecnica {
  /** El descriptor cuenta cosas: no admite decimales. */
  entero?: boolean;
  /** Techo técnico (solo `pct_fruta_exportable`: CHECK 0–100 de la base). */
  maximo?: number;
}

/** Descriptores numéricos libres y su regla técnica. Todos son no negativos y finitos. */
export const REGLAS_TECNICAS: Partial<Record<ClaveEvaluacionAnual, ReglaTecnica>> = {
  // Fruto / Calidad
  calibre_mm: {},
  brix: {},
  // Muestra de frutos
  cantidad_frutos: { entero: true },
  peso_total_g: {},
  // Brotes y varas basales
  n_varas_basales: { entero: true },
  n_varas_con_flor: { entero: true },
  n_flores_varas_basales: { entero: true },
  n_frutos_varas_basales: { entero: true },
  altura_brote_mm: {},
  diametro_brote_mm: {},
  // Producción (rend_t_ha está desactivado desde EF11: el formulario ya no lo pide, así que no se valida)
  rend_kg_planta: {},
  // Poscosecha: porcentajes 0–100 (CHECK de la base). El exportable ya no se escribe: se calcula.
  pct_buen_estado_15d: { maximo: 100 },
  pct_buen_estado_30d: { maximo: 100 },
  pct_buen_estado_45d: { maximo: 100 },
};

/**
 * Las claves con validación técnica, en el orden en que el formulario las valida (la primera con
 * error es la que recibe el foco).
 */
export const CLAVES_NUMERICAS: readonly ClaveEvaluacionAnual[] = [
  'calibre_mm', 'brix', 'rend_kg_planta', 'pct_buen_estado_15d', 'pct_buen_estado_30d', 'pct_buen_estado_45d', 'cantidad_frutos', 'peso_total_g',
  'n_varas_basales', 'n_varas_con_flor', 'n_flores_varas_basales', 'n_frutos_varas_basales', 'altura_brote_mm', 'diametro_brote_mm',
];

const CAMPO = new Map(ESQUEMA_EVALUACION_ANUAL.campos.map((campo) => [campo.clave, campo]));

/**
 * Valida el texto de un campo numérico: vacío es válido; si no, debe ser un número finito, no
 * negativo, entero si el descriptor lo es y, en el porcentaje, no pasar de 100. Devuelve el mensaje
 * (bloquea el guardado) o null.
 */
export function validarValorNumerico(clave: ClaveEvaluacionAnual, texto: string): string | null {
  if (texto.trim() === '') return null;
  const campo = CAMPO.get(clave);
  const etiqueta = campo?.etiqueta ?? clave;
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return `${etiqueta} debe ser un número válido.`;
  if (numero < 0) return `${etiqueta} no puede ser negativo.`;
  const regla = REGLAS_TECNICAS[clave];
  if (regla?.entero && !Number.isInteger(numero)) return `${etiqueta} debe ser un entero.`;
  if (regla?.maximo !== undefined && numero > regla.maximo) return `${etiqueta} no puede superar ${regla.maximo}${campo?.unidad ? ` ${campo.unidad}` : ''}.`;
  return null;
}

/** El `rango_referencia` vigente de un descriptor (los campos que usa el aviso). */
export interface RangoEsperado {
  minimo_esperado?: number | null;
  maximo_esperado?: number | null;
  limite_revision_inferior?: number | null;
  limite_revision_superior?: number | null;
}

/** Texto del valor que cae en el límite de revisión: queda marcado y no entra al ranking hasta revisarse. */
export function mensajeLimiteRevision(etiqueta: string, valor: number, unidad: string): string {
  return `${etiqueta} ${valor} ${unidad} está en el límite de revisión: quedará marcado y no entrará al ranking hasta revisarse.`;
}

/**
 * Aviso (nunca bloqueante) de un valor fuera del rango esperado, o null si está dentro o el descriptor
 * no tiene `rango_referencia`. Es el ÚNICO texto del valor: el mismo en el campo y en «Antes de
 * finalizar». En el límite de revisión explica la consecuencia; si no, «fuera del rango esperado: revisa».
 */
export function avisoFueraDeRango(etiqueta: string, valor: number | null, unidad: string, rango: RangoEsperado | null | undefined): string | null {
  if (valor === null || !Number.isFinite(valor) || !rango) return null;
  const { minimo_esperado: minimo, maximo_esperado: maximo, limite_revision_inferior: revInf, limite_revision_superior: revSup } = rango;
  if ((revInf != null && valor <= revInf) || (revSup != null && valor >= revSup)) return mensajeLimiteRevision(etiqueta, valor, unidad);
  const fuera = (minimo != null && valor < minimo) || (maximo != null && valor > maximo);
  if (!fuera) return null;
  const esperado = minimo != null && maximo != null ? ` (${minimo}–${maximo} ${unidad})` : minimo != null ? ` (desde ${minimo} ${unidad})` : ` (hasta ${maximo} ${unidad})`;
  return `${etiqueta} ${valor} ${unidad}: fuera del rango esperado: revisa${esperado}. Se puede guardar.`;
}
