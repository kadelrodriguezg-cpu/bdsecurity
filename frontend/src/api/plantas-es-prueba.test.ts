/**
 * Filtro de cruces de prueba en los listados operativos, y paginación en el
 * servidor (B8).
 *
 * El punto del test es que la exclusión sea el DEFAULT y no una opción que
 * cada pantalla tenga que acordarse de pedir: si mañana alguien agrega un
 * selector de cruce nuevo, hereda el comportamiento correcto sin hacer nada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => {
  // Cadena encadenable que registra cada .eq() aplicado y se resuelve como
  // promesa al final (supabase-js devuelve un thenable, no un array).
  const eqs: Array<[string, unknown]> = [];
  const nots: Array<[string, string, unknown]> = [];
  const ranges: Array<[number, number]> = [];
  // Páginas que devuelve cada respuesta sucesiva; vacía = una respuesta sin filas.
  const paginas: unknown[][] = [];
  const estado = { count: 0 as number | null };
  const cadena: Record<string, unknown> = {};
  cadena.eq = vi.fn((columna: string, valor: unknown) => {
    eqs.push([columna, valor]);
    return cadena;
  });
  cadena.not = vi.fn((columna: string, operador: string, valor: unknown) => {
    nots.push([columna, operador, valor]);
    return cadena;
  });
  cadena.order = vi.fn(() => cadena);
  cadena.range = vi.fn((desde: number, hasta: number) => {
    ranges.push([desde, hasta]);
    return cadena;
  });
  cadena.then = (resolver: (v: unknown) => unknown) =>
    Promise.resolve({ data: paginas.shift() ?? [], error: null, count: estado.count }).then(resolver);
  const select = vi.fn(() => cadena);
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({ data: { cosecha: 3, polinizacion: 2 }, error: null }));
  return { eqs, nots, ranges, paginas, estado, select, from, rpc, cadena };
});

vi.mock('./client', () => ({
  supabase: { from: dobles.from, rpc: dobles.rpc },
  traducirError: (e: unknown) => (e instanceof Error ? e : new Error('Error traducido')),
  esConflictoDeIdempotencia: vi.fn(),
}));

import { conteoPorEstado, listarPlantas, listarPlantasPagina } from './plantas';

beforeEach(() => {
  dobles.eqs.length = 0;
  dobles.nots.length = 0;
  dobles.ranges.length = 0;
  dobles.paginas.length = 0;
  dobles.estado.count = 0;
  dobles.select.mockClear();
  dobles.from.mockClear();
  dobles.rpc.mockClear();
});

describe('listarPlantas — exclusión de cruces de prueba', () => {
  it('por default filtra es_prueba = false', async () => {
    await listarPlantas();
    expect(dobles.eqs).toContainEqual(['es_prueba', false]);
  });

  it('combina el filtro con los demás sin pisarlos', async () => {
    await listarPlantas({ especieId: 'esp-1', estado: 'cosecha' });
    expect(dobles.eqs).toEqual([
      ['especie_id', 'esp-1'],
      ['estado', 'cosecha'],
      ['es_prueba', false],
    ]);
  });

  it('con incluirPruebas no aplica el filtro (toggle de auditoría)', async () => {
    await listarPlantas({ especieId: 'esp-1', incluirPruebas: true });
    expect(dobles.eqs).toEqual([['especie_id', 'esp-1']]);
  });

  it('pide es_prueba en el select, para que la UI pueda etiquetar los de prueba', async () => {
    await listarPlantas({ incluirPruebas: true });
    expect(dobles.select).toHaveBeenCalledWith(expect.stringContaining('es_prueba'), undefined);
  });
});

describe('listarPlantas — no se corta en max_rows (B8)', () => {
  it('con pocos cruces termina cuando la respuesta siguiente vuelve vacía', async () => {
    dobles.paginas.push([{ id: 'a' }, { id: 'b' }]);
    const todas = await listarPlantas();
    expect(todas).toHaveLength(2);
    expect(dobles.ranges).toEqual([[0, 999], [2, 1001]]);
  });

  it('si una página viene llena pide la siguiente hasta agotar', async () => {
    const llena = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` }));
    dobles.paginas.push(llena, [{ id: 'ultimo' }]);
    const todas = await listarPlantas();
    expect(todas).toHaveLength(1001);
    expect(dobles.ranges).toEqual([[0, 999], [1000, 1999], [1001, 2000]]);
  });

  it('con un max_rows menor (500) no confunde la respuesta recortada con la última', async () => {
    const recortada = (n: number) => Array.from({ length: 500 }, (_, i) => ({ id: `p${n}-${i}` }));
    dobles.paginas.push(recortada(0), recortada(1), [{ id: 'ultimo' }]);
    const todas = await listarPlantas();
    expect(todas).toHaveLength(1001);
    expect(new Set(todas.map((p) => p.id)).size).toBe(1001);
    expect(dobles.ranges).toEqual([[0, 999], [500, 1499], [1000, 1999], [1001, 2000]]);
  });
});

describe('listarPlantasPagina — página del servidor con total', () => {
  it('pide un rango, cuenta exacto y devuelve items y total', async () => {
    dobles.paginas.push([{ id: 'a' }]);
    dobles.estado.count = 42;
    const pagina = await listarPlantasPagina({}, { limite: 5 });
    expect(pagina).toEqual({ items: [{ id: 'a' }], total: 42 });
    expect(dobles.ranges).toEqual([[0, 4]]);
    expect(dobles.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
    expect(dobles.eqs).toContainEqual(['es_prueba', false]);
  });

  it('excluye estados en el servidor', async () => {
    await listarPlantasPagina({ excluirEstados: ['sin_empezar', 'proceso_finalizado'] }, { limite: 5, offset: 10 });
    expect(dobles.nots).toEqual([['estado', 'in', '(sin_empezar,proceso_finalizado)']]);
    expect(dobles.ranges).toEqual([[10, 14]]);
  });
});

describe('conteoPorEstado — agregado en la base', () => {
  it('usa la RPC conteo_cruces_por_estado en vez de traer las filas', async () => {
    const conteo = await conteoPorEstado();
    expect(dobles.rpc).toHaveBeenCalledWith('conteo_cruces_por_estado');
    expect(dobles.from).not.toHaveBeenCalled();
    expect(conteo).toEqual({ cosecha: 3, polinizacion: 2 });
  });
});
