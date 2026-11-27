import { CATEGORIAS_SCORING, type CategoriaScoring } from '@/api/scoring';
import type { OrdenColumna } from './ordenColumnas';

export type OrdenGeneral = OrdenColumna<'global' | CategoriaScoring> | null;
export interface PreferenciasParametro {
  metricas: string[] | null;
  vista: 'tabla' | 'grafico';
  orden: OrdenColumna<string> | null;
  filtroMetrica: string;
  filtroOperador: '>=' | '<=';
  filtroValor: string;
}
export const PARAMETRO_DEFAULT: PreferenciasParametro = {
  metricas: null, vista: 'tabla', orden: null, filtroMetrica: '', filtroOperador: '>=', filtroValor: '',
};
export function valorFinito(valor: string): string {
  return valor.trim() !== '' && Number.isFinite(Number(valor)) ? String(Number(valor)) : '';
}
function leerOrden(p: URLSearchParams, prefijo: string): OrdenColumna<string> | null {
  const columna = p.get(prefijo + '_col');
  const direccion = p.get(prefijo + '_dir');
  return columna && (direccion === 'asc' || direccion === 'desc') ? { columna, direccion } : null;
}
export function leerOrdenGeneral(p: URLSearchParams): OrdenGeneral {
  const orden = leerOrden(p, 'g');
  return orden && ['global', ...CATEGORIAS_SCORING].includes(orden.columna)
    ? orden as OrdenGeneral : null;
}
export function leerPreferenciasParametro(p: URLSearchParams): PreferenciasParametro {
  return {
    metricas: p.has('p_metricas') ? [...new Set((p.get('p_metricas') ?? '').split(',').filter(Boolean))].slice(0, 4) : null,
    vista: p.get('p_vista') === 'grafico' ? 'grafico' : 'tabla',
    orden: leerOrden(p, 'p'), filtroMetrica: p.get('p_filtro') ?? '',
    filtroOperador: p.get('p_op') === '<=' ? '<=' : '>=',
    filtroValor: valorFinito(p.get('p_valor') ?? ''),
  };
}
export function escribirPreferenciasParametro(p: URLSearchParams, valor: PreferenciasParametro): URLSearchParams {
  const next = new URLSearchParams(p);
  const cambios = {
    p_metricas: valor.metricas === null ? null : [...new Set(valor.metricas)].slice(0, 4).join(','),
    p_vista: valor.vista, p_col: valor.orden?.columna ?? null, p_dir: valor.orden?.direccion ?? null,
    p_filtro: valor.filtroMetrica || null, p_op: valor.filtroOperador,
    p_valor: valorFinito(valor.filtroValor) || null,
  };
  for (const [key, value] of Object.entries(cambios)) {
    if (value === null) next.delete(key); else next.set(key, value);
  }
  return next;
}
