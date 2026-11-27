import { describe, expect, it } from 'vitest';
import { leerOrdenGeneral, leerPreferenciasParametro, escribirPreferenciasParametro, valorFinito } from './rankingPreferencias';
describe('preferencias de ranking desde URL', () => {
  it('valida enums, deduplica y limita métricas y rechaza números no finitos', () => {
    const p = new URLSearchParams('g_col=intrusa&g_dir=asc&p_metricas=a,a,b,c,d,e&p_vista=otra&p_dir=up&p_col=a&p_op=otro&p_valor=Infinity');
    expect(leerOrdenGeneral(p)).toBeNull();
    expect(leerPreferenciasParametro(p)).toMatchObject({ metricas: ['a','b','c','d'], vista: 'tabla', orden: null, filtroOperador: '>=', filtroValor: '' });
    expect(valorFinito('NaN')).toBe('');
    expect(valorFinito(' ')).toBe('');
    expect(valorFinito('0')).toBe('0');
  });
  it('conserva cero y ninguna métrica explícita sin borrar parámetros de otros tabs', () => {
    const p = new URLSearchParams('extra=x&g_col=global&g_dir=desc&p_metricas=&p_valor=0');
    const valor = leerPreferenciasParametro(p);
    expect(valor.metricas).toEqual([]);
    expect(valor.filtroValor).toBe('0');
    const next = escribirPreferenciasParametro(p, valor);
    expect(next.get('p_valor')).toBe('0');
    expect(next.get('p_metricas')).toBe('');
    expect(next.get('extra')).toBe('x');
    expect(leerOrdenGeneral(next)).toEqual({ columna: 'global', direccion: 'desc' });
  });
});
