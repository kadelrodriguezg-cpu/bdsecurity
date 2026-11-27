import { describe, expect, it } from 'vitest';
import { capacidadEnNombre, etiquetaContenedor, nombreSinCapacidad, repiteCapacidad } from './contenedores';

describe('contenedores: la capacidad se muestra una sola vez', () => {
  it.each([
    ['Maceteros  (10 L)', 10, 'Maceteros'],
    ['Bolsas GrowinBag (11 l)', 11, 'Bolsas GrowinBag'],
    ['Bolsas GrowinBag (15l)', 15, 'Bolsas GrowinBag'],
    ['Macetero 25 lts.', 25, 'Macetero'],
    ['Macetero 1L', 1, 'Macetero'],
    ['Maceteros  5 L', 5, 'Maceteros'],
  ])('«%s» con %s L se muestra sin repetir: «%s · …»', (nombre, capacidad, limpio) => {
    expect(nombreSinCapacidad(nombre, capacidad)).toBe(limpio);
    expect(repiteCapacidad({ nombre, capacidad_litros: capacidad })).toBe(true);
    expect(etiquetaContenedor({ nombre, capacidad_litros: capacidad })).toBe(`${limpio} · ${String(capacidad)} L`);
  });

  it('un nombre sin capacidad escrita queda igual y suma la capacidad', () => {
    expect(etiquetaContenedor({ nombre: 'Macetero', capacidad_litros: 0.5 })).toBe('Macetero · 0,5 L');
    expect(repiteCapacidad({ nombre: 'Macetero', capacidad_litros: 0.5 })).toBe(false);
  });

  it('si el nombre dice otra capacidad que la cargada, no se toca (es un dato a revisar, no una repetición)', () => {
    expect(nombreSinCapacidad('Macetero 25 lts.', 20)).toBe('Macetero 25 lts.');
    expect(repiteCapacidad({ nombre: 'Macetero 25 lts.', capacidad_litros: 20 })).toBe(false);
  });

  it('reconoce la capacidad escrita en el nombre (también con coma decimal) aunque no esté cargada', () => {
    expect(capacidadEnNombre('Bandeja 288 (0,005 L)')).toBe(0.005);
    expect(capacidadEnNombre('Bandeja 72 alv')).toBeNull();
    expect(capacidadEnNombre('Bandeja 288')).toBeNull();
    expect(etiquetaContenedor({ nombre: 'Bandeja 288 (0,005 L)', capacidad_litros: null })).toBe('Bandeja 288 (0,005 L)');
  });

  it('no confunde un número suelto con litros', () => {
    expect(capacidadEnNombre('Bandeja 288 alveolos')).toBeNull();
    expect(capacidadEnNombre('Lote 12 largo')).toBeNull();
  });
});
