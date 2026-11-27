/**
 * Formato del puntaje que ve el usuario (decisión N34, a confirmar con Efraín): escala 0–100 con un decimal, coma
 * decimal y la palabra «puntos» (nunca «%»). Por dentro y en la exportación el puntaje sigue en 0–1 con precisión
 * completa; ordenar y calcular puestos usa ese valor, no el texto.
 *
 * ÚNICO punto de formato: si Efraín prefiere la escala 0–1, se cambia `ESCALA_VISIBLE` (y los decimales) aquí y toda la
 * app cambia junta.
 */
export const ESCALA_VISIBLE: 100 | 1 = 100;
const DECIMALES_PUNTAJE = ESCALA_VISIBLE === 100 ? 1 : 4;
const SIN_VALOR = '—';

const numero = (decimales: number) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: false });
const formatoPuntaje = numero(DECIMALES_PUNTAJE);
const formatoCategoria = numero(0);

const vacio = (valor: number | null | undefined): valor is null | undefined => valor === null || valor === undefined || !Number.isFinite(Number(valor));
/** El motor ya normaliza a 0–1; el recorte es solo una red de seguridad para no mostrar un valor imposible. */
const recortar = (valor: number) => Math.min(1, Math.max(0, valor));

/** «70,3» (o «70,3 puntos» con `unidad`). Recibe el puntaje en 0–1. */
export function formatearPuntos(valor01: number | null | undefined, opciones: { unidad?: boolean } = {}): string {
  if (vacio(valor01)) return SIN_VALOR;
  const texto = formatoPuntaje.format(recortar(Number(valor01)) * ESCALA_VISIBLE);
  return opciones.unidad ? `${texto} ${ESCALA_VISIBLE === 100 ? 'puntos' : ''}`.trimEnd() : texto;
}

/** Subpuntaje de una categoría: entero 0–100 («77»). Recibe 0–1. */
export function formatearCategoria(valor01: number | null | undefined): string {
  if (vacio(valor01)) return SIN_VALOR;
  return ESCALA_VISIBLE === 100 ? formatoCategoria.format(recortar(Number(valor01)) * 100) : formatoPuntaje.format(recortar(Number(valor01)));
}

/** Cambio entre dos puntajes, en puntos con signo y un decimal: «+8,1», «−7,5», «0,0». Recibe la diferencia en 0–1. */
export function formatearCambio(delta01: number | null | undefined): string {
  if (vacio(delta01)) return SIN_VALOR;
  const n = Number(delta01) * ESCALA_VISIBLE;
  const texto = formatoPuntaje.format(Math.abs(n));
  if (Number(texto.replace(',', '.')) === 0) return formatoPuntaje.format(0);
  return n > 0 ? `+${texto}` : `−${texto}`;
}

/** Peso de una categoría como porcentaje entero: 0,4 → «40». */
export function formatearPeso(peso01: number): string {
  return formatoCategoria.format(peso01 * 100);
}

/** Valor visible (0–100) de un puntaje, para barras y medianas. */
export const aEscalaVisible = (valor01: number) => recortar(valor01) * ESCALA_VISIBLE;
