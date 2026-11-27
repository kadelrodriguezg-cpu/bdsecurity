import type { Database } from '@/types/database.types';

export type RegionChile = Database['public']['Enums']['region_chile'];

export const REGIONES_CHILE: readonly RegionChile[] = [
  'Arica y Parinacota', 'Tarapacá', 'Antofagasta', 'Atacama', 'Coquimbo',
  'Valparaíso', 'Metropolitana de Santiago', 'Libertador General Bernardo O\'Higgins',
  'Maule', 'Ñuble', 'Biobío', 'La Araucanía', 'Los Ríos', 'Los Lagos',
  'Aysén del General Carlos Ibáñez del Campo', 'Magallanes y de la Antártica Chilena',
];

function normalizarRegion(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CL')
    .replace(/\bregion\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const REGION_POR_ESTADO = new Map<string, RegionChile>(REGIONES_CHILE.map((region) => [normalizarRegion(region), region]));

// Nominatim suele incluir artículos tras quitar «Región» (p. ej. «del Maule»).
// Los alias son deliberadamente explícitos: si llega otro valor no se adivina ni
// se persiste, para que la persona elija el catálogo oficial manualmente.
for (const [alias, region] of [
  ['del maule', 'Maule'], ['del nuble', 'Ñuble'], ['del biobio', 'Biobío'],
  ['de la araucania', 'La Araucanía'], ['de los rios', 'Los Ríos'], ['de los lagos', 'Los Lagos'],
  ['del libertador general bernardo ohiggins', 'Libertador General Bernardo O\'Higgins'],
  ['de aysen del general carlos ibanez del campo', 'Aysén del General Carlos Ibáñez del Campo'],
  ['de magallanes y de la antartica chilena', 'Magallanes y de la Antártica Chilena'],
] as const) REGION_POR_ESTADO.set(alias, region);

export function regionDesdeEstadoNominatim(estado: string | undefined): RegionChile | null {
  const estadoNormalizado = estado ? normalizarRegion(estado) : '';
  const region = REGION_POR_ESTADO.get(estadoNormalizado) ?? null;
  if (estadoNormalizado && !region) console.warn('Estado de Nominatim sin región oficial equivalente.', { estado });
  return region;
}
