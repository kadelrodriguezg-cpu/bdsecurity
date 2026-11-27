/**
 * Contrato v3 (docs/rediseno_v3/contrato.md, §3): los formatos de puntaje, puesto, fecha, cobertura y plural, en un solo lugar.
 *
 * Reutiliza las implementaciones que ya existen (no las duplica) y fija los nombres que las pantallas v3 deben importar. Lo que hoy
 * es incoherente entre pantallas figura como diferencia a migrar en el contrato (§3); acá solo está lo que ya tiene una regla.
 */
import { formatearFechaCivil, formatearFechaHora, formatearHoraChile, hoyChileISO } from '@/lib/fechas';
import { formatearPuntaje01 } from '@/features/ranking/formato';

/** Guion que se muestra donde no hay valor. */
export const SIN_VALOR = '—';

/**
 * Puntaje de ranking: escala 0–1 a 4 decimales («0.4650»), recortado a la escala (DESIGN.md: «no mostrar puntajes fuera de la
 * escala 0–1») y «—» si no hay. El 4 viene de la decisión D1 (provisional, docs/decisiones_cerradas.md).
 */
export const DECIMALES_PUNTAJE = 4;
export const formatearPuntaje = (valor: number | null | undefined): string => formatearPuntaje01(valor, DECIMALES_PUNTAJE);

/**
 * Puesto dentro del grupo, para una celda o una etiqueta corta: «3», «3=» si comparte puesto con otro del grupo (mismo puntaje
 * publicado), «Sin puesto» si el grupo no alcanza el mínimo o la evaluación no compite.
 */
export function formatearPuesto(posicion: number | null | undefined, empatado = false): string {
  if (posicion === null || posicion === undefined) return 'Sin puesto';
  return `${posicion}${empatado ? '=' : ''}`;
}

/** Puesto en una frase: «puesto 3 de 12 en su grupo» (con «, empatado» si comparte puesto). */
export function describirPuesto(posicion: number | null | undefined, tamanoGrupo: number | null | undefined, empatado = false): string {
  if (posicion === null || posicion === undefined) return 'Sin puesto';
  const de = tamanoGrupo === null || tamanoGrupo === undefined ? '' : ` de ${tamanoGrupo}`;
  return `puesto ${posicion}${de} en su grupo${empatado ? ', empatado' : ''}`;
}

/** Fecha civil (sin hora), en Chile y sin correrla de día por la conversión UTC: «23-10-2026». «Sin fecha registrada» si no hay. */
export const formatearFecha = formatearFechaCivil;

/** Mes de un período (ejes de gráficos): «10-2026». Nunca el nombre del mes ni el año de dos cifras. */
export const formatearMesAnio = (anio: number, mes: number): string => `${String(mes).padStart(2, '0')}-${anio}`;

/**
 * Instante con fecha y hora de Chile: «23-10-2026, 16:39» (fecha `dd-mm-aaaa` y hora de 24 h). Es el mismo formateador que
 * `formatearFechaHora` de `lib/fechas` (una sola fuente de verdad; antes ese daba la hora en 12 horas, «4:39 p. m.»).
 */
export const formatearFechaHoraChile = formatearFechaHora;

/**
 * Instante en una **lista de actividad** (decisión N9): «hoy 16:39», «ayer 16:39» y, de ahí hacia atrás, la fecha absoluta con su hora
 * («22-10-2026, 16:39»). Es el ÚNICO lugar donde se usa «hoy» o «ayer»; fuera de una lista de actividad las fechas son siempre
 * `dd-mm-aaaa` (`formatearFecha`) y nunca ISO crudo. El día se decide en la zona horaria de Chile.
 */
export function formatearActividad(instante: string | null | undefined, ahora: Date = new Date(), vacio = 'Sin fecha registrada'): string {
  if (!instante) return vacio;
  const t = new Date(instante);
  if (Number.isNaN(t.getTime())) return vacio;
  const dia = hoyChileISO(t);
  const hoy = hoyChileISO(ahora);
  const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (dia === hoy) return `hoy ${formatearHoraChile(t)}`;
  if (dia === ayer) return `ayer ${formatearHoraChile(t)}`;
  return formatearFechaHoraChile(instante, vacio);
}


/** Cobertura de obligatorios: «10/15». */
export const formatearCobertura = (llenos: number, total: number): string => `${llenos}/${total}`;

/** Cuenta con su palabra: «1 borrador», «2 borradores». */
export const formatearCantidad = (n: number, singular: string, plural: string): string => `${n} ${n === 1 ? singular : plural}`;

/**
 * «Última actividad» en una tabla (Cruces, fase 4): «hoy 16:39», «ayer 16:39» y, más atrás, solo la fecha («22-10-2026»): la
 * hora de un día viejo no ayuda a decidir y ensancha la columna.
 */
export function formatearActividadCorta(instante: string | null | undefined, ahora: Date = new Date(), vacio = 'Sin registro'): string {
  const texto = formatearActividad(instante, ahora, vacio);
  if (texto === vacio || texto.startsWith('hoy') || texto.startsWith('ayer')) return texto;
  return formatearFecha(String(instante));
}
