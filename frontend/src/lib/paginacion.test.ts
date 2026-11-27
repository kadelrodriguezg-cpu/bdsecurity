import { describe, expect, it } from 'vitest';
import { acotarPagina, paginaDeIndice, paginasVisibles, rangoPagina, totalPaginas } from './paginacion';

describe('paginasVisibles', () => {
  it('con pocas páginas las muestra todas', () => {
    expect(paginasVisibles(1, 1)).toEqual([1]);
    expect(paginasVisibles(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('cerca del principio: 1 2 3 … 8', () => {
    expect(paginasVisibles(1, 8)).toEqual([1, 2, 3, 'hueco', 8]);
    expect(paginasVisibles(2, 8)).toEqual([1, 2, 3, 'hueco', 8]);
    expect(paginasVisibles(3, 8)).toEqual([1, 2, 3, 4, 'hueco', 8]);
  });

  it('en el medio: la actual y sus vecinas entre puntos suspensivos', () => {
    expect(paginasVisibles(5, 10)).toEqual([1, 'hueco', 4, 5, 6, 'hueco', 10]);
  });

  it('cerca del final: 1 … 6 7 8', () => {
    expect(paginasVisibles(8, 8)).toEqual([1, 'hueco', 6, 7, 8]);
    expect(paginasVisibles(6, 8)).toEqual([1, 'hueco', 5, 6, 7, 8]);
  });

  it('un salto de una sola página se dibuja como número', () => {
    expect(paginasVisibles(4, 8)).toEqual([1, 2, 3, 4, 5, 'hueco', 8]);
  });
});

describe('rango, total y página de una fila', () => {
  it('«Mostrando 251–300 de 378» y la última página corta', () => {
    expect(rangoPagina(6, 50, 378)).toEqual({ desde: 251, hasta: 300 });
    expect(rangoPagina(8, 50, 378)).toEqual({ desde: 351, hasta: 378 });
    expect(rangoPagina(1, 50, 0)).toEqual({ desde: 0, hasta: 0 });
  });

  it('total de páginas (al menos una) y página acotada', () => {
    expect(totalPaginas(378, 50)).toBe(8);
    expect(totalPaginas(0, 50)).toBe(1);
    expect(acotarPagina(12, 8)).toBe(8);
    expect(acotarPagina(0, 8)).toBe(1);
    expect(acotarPagina(Number.NaN, 8)).toBe(1);
  });

  it('la fila 75 (índice 74) queda en la página 2 de a 50', () => {
    expect(paginaDeIndice(74, 50)).toBe(2);
    expect(paginaDeIndice(49, 50)).toBe(1);
    expect(paginaDeIndice(50, 50)).toBe(2);
  });
});
