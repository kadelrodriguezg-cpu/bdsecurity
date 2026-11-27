import { describe, expect, it } from 'vitest';
import { cicloOrden, compararConNulosAlFinal, type OrdenColumna } from './ordenColumnas';

type Col = 'global' | 'fenologia';

describe('cicloOrden', () => {
  it('cicla asc → desc → sin orden sobre la misma columna', () => {
    let orden: OrdenColumna<Col> | null = null;
    orden = cicloOrden(orden, 'global');
    expect(orden).toEqual({ columna: 'global', direccion: 'asc' });
    orden = cicloOrden(orden, 'global');
    expect(orden).toEqual({ columna: 'global', direccion: 'desc' });
    orden = cicloOrden(orden, 'global');
    expect(orden).toBeNull();
  });

  it('cambiar de columna reinicia en asc (una columna activa a la vez)', () => {
    const orden = cicloOrden({ columna: 'global', direccion: 'desc' }, 'fenologia');
    expect(orden).toEqual({ columna: 'fenologia', direccion: 'asc' });
  });
});

describe('compararConNulosAlFinal', () => {
  const filas: Array<{ codigo: string; valor: number | null }> = [
    { codigo: 'B', valor: 0.5 },
    { codigo: 'D', valor: null },
    { codigo: 'A', valor: 0.9 },
    { codigo: 'C', valor: null },
  ];

  const ordenar = (direccion: 'asc' | 'desc') =>
    [...filas]
      .sort((a, b) => compararConNulosAlFinal(a.valor, b.valor, direccion, a.codigo.localeCompare(b.codigo)))
      .map((f) => f.codigo);

  it('asc: valores primero, NULL siempre al final', () => {
    expect(ordenar('asc')).toEqual(['B', 'A', 'C', 'D']);
  });

  it('desc: valores primero, NULL sigue al final (no se invierte)', () => {
    expect(ordenar('desc')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('empates y NULLs se resuelven por el desempate (determinista)', () => {
    const empatados = [
      { codigo: 'Z', valor: 0.4 },
      { codigo: 'A', valor: 0.4 },
    ];
    const resultado = [...empatados]
      .sort((a, b) => compararConNulosAlFinal(a.valor, b.valor, 'desc', a.codigo.localeCompare(b.codigo)))
      .map((f) => f.codigo);
    expect(resultado).toEqual(['A', 'Z']);
  });
});
