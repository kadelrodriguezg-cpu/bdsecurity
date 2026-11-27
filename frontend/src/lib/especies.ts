/**
 * Especie como espacio de trabajo (fase 4, decisiones del 25-10-2026): cómo se nombra una especie en la URL
 * (`?especie=arandano`) y de qué color es su punto. El nombre siempre acompaña al color.
 */
import { COLORES_ESPECIE, COLORES_ESPECIE_RESPALDO } from './colores';

/** «Arándano» → «arandano»: sin tildes, en minúsculas y con guiones. Es lo que va en la URL. */
export function slugEspecie(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Color del punto de la especie [Provisional]; una especie sin color propio recibe uno fijo según su id. */
export function colorEspecie(especie: { id: string; nombre: string }): string {
  const propio = COLORES_ESPECIE[slugEspecie(especie.nombre)];
  if (propio) return propio;
  let suma = 0;
  for (const caracter of especie.id) suma = (suma * 31 + caracter.charCodeAt(0)) >>> 0;
  return COLORES_ESPECIE_RESPALDO[suma % COLORES_ESPECIE_RESPALDO.length];
}

/** Valor del parámetro `especie` para «Todas las especies». */
export const TODAS = 'todas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee el parámetro `especie` de la URL: el nombre en la URL (`arandano`), el id de siempre (los enlaces viejos usan el
 * id: ninguno deja de funcionar) o `todas`. Devuelve el id, `null` para todas, o `undefined` si no se reconoce.
 */
export function resolverParametroEspecie<E extends { id: string; nombre: string }>(valor: string | null, especies: readonly E[]): string | null | undefined {
  if (!valor) return undefined;
  if (valor === TODAS) return null;
  if (UUID_RE.test(valor)) return especies.some((e) => e.id === valor) ? valor : undefined;
  return especies.find((e) => slugEspecie(e.nombre) === valor)?.id;
}
