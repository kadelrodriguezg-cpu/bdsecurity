import { describe, expect, it } from 'vitest';
import { construirFilas, proponerAsignacion } from './mapeoColumnas';

describe('proponerAsignacion', () => {
  it('reconoce cabeceras con tildes, mayúsculas y sinónimos', () => {
    expect(proponerAsignacion(['Código', 'ESPECIE', 'Madre', 'Padre', 'Cruzamiento', 'Notas'])).toEqual({
      codigo_sistema: 0,
      especie: 1,
      mama: 2,
      papa: 3,
      cruzamiento: 4,
    });
  });

  it('deja sin asignar lo que no reconoce', () => {
    expect(proponerAsignacion(['columna rara', 'otra'])).toEqual({});
  });
});

describe('construirFilas', () => {
  it('toma solo las columnas asignadas y completa con vacío las celdas faltantes', () => {
    expect(construirFilas([['02-001', 'Arándano', 'Duke'], ['02-002']], { codigo_sistema: 0, especie: 1, mama: 2 })).toEqual([
      { codigo_sistema: '02-001', especie: 'Arándano', mama: 'Duke' },
      { codigo_sistema: '02-002', especie: '', mama: '' },
    ]);
  });
});
