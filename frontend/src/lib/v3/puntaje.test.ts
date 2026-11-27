import { describe, expect, it } from 'vitest';
import { formatearCambio, formatearCategoria, formatearPeso, formatearPuntos } from './puntaje';

describe('formato del puntaje (N34)', () => {
  it('0–100 con un decimal y coma; «puntos», nunca «%»', () => {
    expect(formatearPuntos(0.70312)).toBe('70,3');
    expect(formatearPuntos(0.70312, { unidad: true })).toBe('70,3 puntos');
    expect(formatearPuntos(1)).toBe('100,0');
    expect(formatearPuntos(0)).toBe('0,0');
    expect(formatearPuntos(null)).toBe('—');
    expect(formatearPuntos(0.5, { unidad: true })).not.toContain('%');
  });

  it('categorías en enteros, cambio con signo y un decimal, peso en entero', () => {
    expect(formatearCategoria(0.7749)).toBe('77');
    expect(formatearCambio(0.081)).toBe('+8,1');
    expect(formatearCambio(-0.075)).toBe('−7,5');
    expect(formatearCambio(0.0001)).toBe('0,0');
    expect(formatearPeso(0.4)).toBe('40');
  });

  it('nunca muestra un valor fuera de 0–100', () => {
    expect(formatearPuntos(1.2)).toBe('100,0');
    expect(formatearPuntos(-0.1)).toBe('0,0');
  });
});
