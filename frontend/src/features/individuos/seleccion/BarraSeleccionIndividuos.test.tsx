import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Individuo } from '@/api/individuos';
import { useSeleccionMultiple } from '@/lib/useSeleccionMultiple';
import { BarraSeleccionIndividuos } from './BarraSeleccionIndividuos';
import { aplicarLecturaQR } from './EscanearParaSeleccion';

afterEach(() => cleanup());

const individuo = (n: number, estado_vital: Individuo['estado_vital'] = 'vivo'): Individuo => ({
  id: `id-${n}`, planta_id: 'p1', codigo_display: `X-P${n}`, clon_de_id: null, estado_vital, fecha_baja: null, created_at: '2026-01-01T00:00:00Z',
});
const INDIVIDUOS = [individuo(1), individuo(2), individuo(3, 'muerto'), individuo(4)];

function usarSeleccion(visibles = INDIVIDUOS) {
  return renderHook(() =>
    useSeleccionMultiple<Individuo>({ items: INDIVIDUOS, obtenerId: (i) => i.id, esSeleccionable: (i) => i.estado_vital === 'vivo', visibles }),
  );
}

function renderBarra(seleccion: ReturnType<typeof usarSeleccion>['result']['current'], esAdmin: boolean, handlers = {}) {
  const props = { onEtiquetas: vi.fn(), onDarBaja: vi.fn(), onEscanear: vi.fn(), onSalir: vi.fn(), ...handlers };
  render(<BarraSeleccionIndividuos seleccion={seleccion} esAdmin={esAdmin} {...props} />);
  return props;
}

describe('BarraSeleccionIndividuos', () => {
  it('«Dar de baja» solo aparece para admin; «Etiquetas» para todos', () => {
    const { result } = usarSeleccion();
    renderBarra(result.current, false);
    expect(screen.getByRole('button', { name: /^etiquetas$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dar de baja/i })).not.toBeInTheDocument();
    cleanup();
    renderBarra(result.current, true);
    expect(screen.getByRole('button', { name: /dar de baja/i })).toBeInTheDocument();
  });

  it('sin selección las acciones están deshabilitadas y el contador indica los vivos disponibles', () => {
    const { result } = usarSeleccion();
    renderBarra(result.current, true);
    expect(screen.getByText('Marca los individuos (3 vivos disponibles)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^etiquetas$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dar de baja/i })).toBeDisabled();
  });

  it('con selección muestra el contador y habilita las acciones', () => {
    const { result } = usarSeleccion();
    act(() => result.current.alternar('id-1'));
    const props = renderBarra(result.current, true);
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /dar de baja/i }));
    expect(props.onDarBaja).toHaveBeenCalled();
  });

  it('con filtro, «seleccionar» dice a cuántos alcanza y explica que no es solo lo visible en pantalla', () => {
    const { result } = usarSeleccion([INDIVIDUOS[0], INDIVIDUOS[2]]);
    renderBarra(result.current, false);
    expect(screen.getByText(/El filtro deja 1 de 3 vivos a la vista\. «Seleccionar» agrega todos los que cumplen el filtro, aunque no se vean en pantalla\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar los 1 vivos a la vista' })).toBeEnabled();
  });
});

describe('aplicarLecturaQR', () => {
  it('agrega el individuo escaneado del cruce y avisa si ya estaba', () => {
    const { result } = usarSeleccion();
    let mensaje = { tipo: '', texto: '' };
    act(() => { mensaje = aplicarLecturaQR({ tipo: 'individuo', valor: 'id-2' }, result.current, INDIVIDUOS); });
    expect(mensaje).toEqual({ tipo: 'ok', texto: 'X-P2 agregado.' });
    act(() => { mensaje = aplicarLecturaQR({ tipo: 'individuo', valor: 'id-2' }, result.current, INDIVIDUOS); });
    expect(mensaje).toEqual({ tipo: 'ok', texto: 'X-P2 ya estaba seleccionado.' });
    expect(result.current.idsSeleccionados).toEqual(['id-2']);
  });

  it('explica cada caso que no agrega', () => {
    const { result } = usarSeleccion();
    expect(aplicarLecturaQR({ tipo: 'id', valor: 'cruce' }, result.current, INDIVIDUOS).texto).toMatch(/no es de un individuo/);
    expect(aplicarLecturaQR({ tipo: 'individuo', valor: 'id-3' }, result.current, INDIVIDUOS).texto).toMatch(/X-P3 está de baja/);
    expect(aplicarLecturaQR({ tipo: 'individuo', valor: 'otro' }, result.current, INDIVIDUOS).texto).toMatch(/no es de este cruce/);
  });
});
