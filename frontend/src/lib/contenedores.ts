/**
 * Contenedores (Catálogos → Contenedores; se eligen en Siembra). La capacidad es un dato propio (`capacidad_litros`) y se muestra
 * sola junto al nombre: «Macetero · 10 L». Varios nombres cargados antes repiten la capacidad («Maceteros (10 L)», «Macetero 25
 * lts.») porque la pantalla de Siembra no la mostraba; aquí se reconoce para no mostrarla dos veces y para ofrecer limpiarla.
 */

const fmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 3 });

/** «10 L», «0,5 L». */
export const formatearLitros = (litros: number): string => `${fmt.format(litros)} L`;

// Un número (con coma o punto decimal) seguido de una unidad de litros, con o sin paréntesis: «(10 L)», «(15l)», «25 lts.», «1L».
const CAPACIDAD_EN_NOMBRE = /\(?\s*(\d+(?:[.,]\d+)?)\s*(?:l|lt|lts|litro|litros)\.?\s*\)?(?=\s|$|[),;:-])/i;

/** Capacidad que el nombre dice tener (en litros), o null. */
export function capacidadEnNombre(nombre: string): number | null {
  const m = nombre.match(CAPACIDAD_EN_NOMBRE);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** El nombre sin la capacidad escrita dentro (solo si coincide con la capacidad dada; si no, el nombre tal cual). */
export function nombreSinCapacidad(nombre: string, capacidad: number | null): string {
  const enNombre = capacidadEnNombre(nombre);
  if (enNombre === null || capacidad === null || Math.abs(enNombre - Number(capacidad)) > 1e-9) return nombre.replace(/\s+/g, ' ').trim();
  const limpio = nombre.replace(CAPACIDAD_EN_NOMBRE, ' ').replace(/\s+/g, ' ').replace(/[\s(,;:-]+$/, '').trim();
  return limpio || nombre.trim();
}

/** El nombre repite la capacidad que ya está cargada como dato. */
export const repiteCapacidad = (c: { nombre: string; capacidad_litros: number | null }): boolean =>
  c.capacidad_litros !== null && nombreSinCapacidad(c.nombre, Number(c.capacidad_litros)) !== c.nombre.replace(/\s+/g, ' ').trim();

/** Cómo se muestra un contenedor en listas y selectores: «Macetero · 10 L» (sin repetir la capacidad si el nombre ya la trae). */
export function etiquetaContenedor(c: { nombre: string; capacidad_litros: number | null }): string {
  if (c.capacidad_litros === null) return c.nombre.replace(/\s+/g, ' ').trim();
  return `${nombreSinCapacidad(c.nombre, Number(c.capacidad_litros))} · ${formatearLitros(Number(c.capacidad_litros))}`;
}
