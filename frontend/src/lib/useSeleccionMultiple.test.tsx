import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSeleccionMultiple } from './useSeleccionMultiple';

interface ItemPrueba {
  id: string;
  vital: 'vivo' | 'descartado' | 'muerto';
}

const ITEMS: ItemPrueba[] = [
  { id: 'a', vital: 'vivo' },
  { id: 'b', vital: 'descartado' },
  { id: 'c', vital: 'vivo' },
  { id: 'd', vital: 'muerto' },
];

const esVivo = (item: ItemPrueba) => item.vital === 'vivo';

function montar(items: ItemPrueba[] = ITEMS) {
  return renderHook(
    ({ lista }: { lista: ItemPrueba[] }) =>
      useSeleccionMultiple({ items: lista, obtenerId: (i) => i.id, esSeleccionable: esVivo }),
    { initialProps: { lista: items } },
  );
}

describe('useSeleccionMultiple — contrato', () => {
  it('solo considera seleccionables los items que pasan la regla', () => {
    const { result } = montar();
    expect(result.current.seleccionables.map((i) => i.id)).toEqual(['a', 'c']);
    expect(result.current.puedeSeleccionar('a')).toBe(true);
    expect(result.current.puedeSeleccionar('b')).toBe(false);
    expect(result.current.puedeSeleccionar('d')).toBe(false);
  });

  it('alterna un item elegible y lleva el conteo', () => {
    const { result } = montar();
    act(() => result.current.alternar('a'));
    expect(result.current.idsSeleccionados).toEqual(['a']);
    expect(result.current.cantidad).toBe(1);
    expect(result.current.estaSeleccionado('a')).toBe(true);

    act(() => result.current.alternar('a'));
    expect(result.current.cantidad).toBe(0);
    expect(result.current.hayAlgunoSeleccionado).toBe(false);
  });

  it('ignora el intento de seleccionar un item no elegible', () => {
    const { result } = montar();
    act(() => result.current.alternar('b'));
    act(() => result.current.alternar('d'));
    expect(result.current.idsSeleccionados).toEqual([]);
    expect(result.current.estaSeleccionado('b')).toBe(false);
  });

  it('seleccionar todos deja fuera a los no elegibles', () => {
    const { result } = montar();
    act(() => result.current.seleccionarTodos());
    expect(result.current.idsSeleccionados).toEqual(['a', 'c']);
    expect(result.current.cantidad).toBe(2);
    expect(result.current.todosSeleccionados).toBe(true);
  });

  it('conserva el orden de la lista, no el orden de clic', () => {
    const { result } = montar();
    act(() => result.current.alternar('c'));
    act(() => result.current.alternar('a'));
    expect(result.current.idsSeleccionados).toEqual(['a', 'c']);
  });

  it('limpiar vacía la selección', () => {
    const { result } = montar();
    act(() => result.current.seleccionarTodos());
    act(() => result.current.limpiar());
    expect(result.current.cantidad).toBe(0);
    expect(result.current.todosSeleccionados).toBe(false);
  });

  it('un item seleccionado que deja de ser elegible sale solo de la selección', () => {
    const { result, rerender } = montar();
    act(() => result.current.seleccionarTodos());
    expect(result.current.idsSeleccionados).toEqual(['a', 'c']);

    // Alguien marca la baja de "c" mientras estaba seleccionado.
    rerender({ lista: ITEMS.map((i) => (i.id === 'c' ? { ...i, vital: 'muerto' as const } : i)) });
    expect(result.current.idsSeleccionados).toEqual(['a']);
    expect(result.current.cantidad).toBe(1);
    expect(result.current.estaSeleccionado('c')).toBe(false);
  });

  it('un item seleccionado que desaparece de la lista deja de contarse', () => {
    const { result, rerender } = montar();
    act(() => result.current.seleccionarTodos());
    rerender({ lista: ITEMS.filter((i) => i.id !== 'a') });
    expect(result.current.idsSeleccionados).toEqual(['c']);
  });

  it('todosSeleccionados es falso cuando no hay ningún elegible', () => {
    const { result } = montar(ITEMS.filter((i) => i.vital !== 'vivo'));
    expect(result.current.seleccionables).toEqual([]);
    expect(result.current.todosSeleccionados).toBe(false);
  });

  it('sin regla de elegibilidad, todos los items son seleccionables', () => {
    const { result } = renderHook(() =>
      useSeleccionMultiple({ items: ITEMS, obtenerId: (i) => i.id }),
    );
    act(() => result.current.seleccionarTodos());
    expect(result.current.idsSeleccionados).toEqual(['a', 'b', 'c', 'd']);
  });
});

/**
 * `visibles` acota el alcance de "seleccionar todos" al filtro vigente, sin
 * cambiar qué significa estar seleccionado. Es la distinción que hace que
 * buscar un código puntual y apretar el botón no termine marcando la lista
 * entera, y que a la vez lo ya marcado no se pierda al cambiar el filtro.
 */
describe('useSeleccionMultiple — ámbito acotado por filtro (visibles)', () => {
  function montarConVisibles(visibles: ItemPrueba[]) {
    return renderHook(
      ({ aLaVista }: { aLaVista: ItemPrueba[] }) =>
        useSeleccionMultiple({ items: ITEMS, obtenerId: (i) => i.id, esSeleccionable: esVivo, visibles: aLaVista }),
      { initialProps: { aLaVista: visibles } },
    );
  }

  it('"seleccionar todos" abarca solo los elegibles a la vista', () => {
    // Filtro que deja fuera a "c" (vivo) y deja pasar a "b" (descartado).
    const { result } = montarConVisibles([ITEMS[0], ITEMS[1]]);
    expect(result.current.ambitoAcotado).toBe(true);
    expect(result.current.seleccionablesVisibles.map((i) => i.id)).toEqual(['a']);

    act(() => result.current.seleccionarTodos());
    expect(result.current.idsSeleccionados).toEqual(['a']); // no arrastra a "c"
  });

  it('lo seleccionado sobrevive a cambiar y a borrar el filtro', () => {
    const { result, rerender } = montarConVisibles([ITEMS[0]]);
    act(() => result.current.seleccionarTodos());
    expect(result.current.idsSeleccionados).toEqual(['a']);

    // El filtro cambia y "a" sale de la vista: sigue seleccionado y contado.
    rerender({ aLaVista: [ITEMS[2]] });
    expect(result.current.idsSeleccionados).toEqual(['a']);
    expect(result.current.cantidad).toBe(1);
    expect(result.current.estaSeleccionado('a')).toBe(true);

    // Se borra el filtro: sigue marcado solo "a", no se expandió a todo.
    rerender({ aLaVista: ITEMS });
    expect(result.current.idsSeleccionados).toEqual(['a']);
    expect(result.current.ambitoAcotado).toBe(false);
  });

  it('es acumulativo entre filtros: no borra lo marcado en una búsqueda anterior', () => {
    const { result, rerender } = montarConVisibles([ITEMS[0]]);
    act(() => result.current.seleccionarTodos());

    rerender({ aLaVista: [ITEMS[2]] });
    act(() => result.current.seleccionarTodos());
    expect(result.current.idsSeleccionados).toEqual(['a', 'c']);
  });

  it('todosSeleccionados se mide contra lo visible, no contra el universo', () => {
    const { result, rerender } = montarConVisibles([ITEMS[0]]);
    act(() => result.current.seleccionarTodos());
    // "a" es el único elegible a la vista: para este filtro ya está todo.
    expect(result.current.todosSeleccionados).toBe(true);

    // Sin filtro falta "c", así que deja de estar todo seleccionado.
    rerender({ aLaVista: ITEMS });
    expect(result.current.todosSeleccionados).toBe(false);
  });

  it('sin `visibles` el ámbito es el universo completo (comportamiento por defecto)', () => {
    const { result } = renderHook(() =>
      useSeleccionMultiple({ items: ITEMS, obtenerId: (i) => i.id, esSeleccionable: esVivo }),
    );
    expect(result.current.ambitoAcotado).toBe(false);
    act(() => result.current.seleccionarTodos());
    expect(result.current.idsSeleccionados).toEqual(['a', 'c']);
  });
});

describe('useSeleccionMultiple — agregar (escaneo QR)', () => {
  it('agrega sin alternar: leer el mismo código dos veces no lo quita', () => {
    const { result } = montar();
    let resultado = '';
    act(() => { resultado = result.current.agregar('a'); });
    expect(resultado).toBe('agregado');
    act(() => { resultado = result.current.agregar('a'); });
    expect(resultado).toBe('ya_estaba');
    expect(result.current.idsSeleccionados).toEqual(['a']);
  });

  it('informa por qué no agrega: no elegible o fuera de la lista', () => {
    const { result } = montar();
    expect(result.current.agregar('d')).toBe('no_seleccionable');
    expect(result.current.agregar('zz')).toBe('fuera_de_la_lista');
    expect(result.current.cantidad).toBe(0);
  });
});
