import { act, cleanup, render, renderHook } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hayCambiosSinGuardar,
  marcarCambiosSinGuardar,
  msDesdeUltimosCambios,
  reiniciarCambiosSinGuardar,
  suscribirCambiosSinGuardar,
  useMarcadorCambiosSinGuardar,
  useMarcarCambiosSinGuardar,
} from './cambiosSinGuardar';

beforeEach(() => {
  reiniciarCambiosSinGuardar();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  reiniciarCambiosSinGuardar();
});

describe('registro de cambios sin guardar', () => {
  it('parte sin cambios y sin historial', () => {
    expect(hayCambiosSinGuardar()).toBe(false);
    expect(msDesdeUltimosCambios()).toBe(Infinity);
  });

  it('cada id lleva su propia marca: solo queda libre cuando todos terminan', () => {
    marcarCambiosSinGuardar('a', true);
    marcarCambiosSinGuardar('b', true);
    marcarCambiosSinGuardar('a', false);
    expect(hayCambiosSinGuardar()).toBe(true);
    marcarCambiosSinGuardar('b', false);
    expect(hayCambiosSinGuardar()).toBe(false);
  });

  it('marcar dos veces el mismo id no acumula', () => {
    marcarCambiosSinGuardar('a', true);
    marcarCambiosSinGuardar('a', true);
    marcarCambiosSinGuardar('a', false);
    expect(hayCambiosSinGuardar()).toBe(false);
  });

  it('mide el tiempo desde que dejó de haber cambios y vale 0 mientras los hay', () => {
    marcarCambiosSinGuardar('a', true);
    vi.advanceTimersByTime(5_000);
    expect(msDesdeUltimosCambios()).toBe(0);
    marcarCambiosSinGuardar('a', false);
    vi.advanceTimersByTime(30_000);
    expect(msDesdeUltimosCambios()).toBe(30_000);
  });

  it('avisa a los suscritos solo cuando cambia el estado global', () => {
    const oyente = vi.fn();
    const cancelar = suscribirCambiosSinGuardar(oyente);
    marcarCambiosSinGuardar('a', true);
    marcarCambiosSinGuardar('b', true);
    expect(oyente).toHaveBeenCalledTimes(1);
    marcarCambiosSinGuardar('a', false);
    marcarCambiosSinGuardar('b', false);
    expect(oyente).toHaveBeenCalledTimes(2);
    cancelar();
    marcarCambiosSinGuardar('c', true);
    expect(oyente).toHaveBeenCalledTimes(2);
  });
});

describe('useMarcarCambiosSinGuardar', () => {
  it('sigue al booleano del componente y se limpia al desmontar', () => {
    const { rerender, unmount } = renderHook(({ hay }) => useMarcarCambiosSinGuardar(hay), { initialProps: { hay: false } });
    expect(hayCambiosSinGuardar()).toBe(false);
    rerender({ hay: true });
    expect(hayCambiosSinGuardar()).toBe(true);
    rerender({ hay: false });
    expect(hayCambiosSinGuardar()).toBe(false);
    rerender({ hay: true });
    unmount();
    expect(hayCambiosSinGuardar()).toBe(false);
  });

  it('dos formularios a la vez no se pisan', () => {
    const a = renderHook(() => useMarcarCambiosSinGuardar(true));
    const b = renderHook(() => useMarcarCambiosSinGuardar(true));
    a.unmount();
    expect(hayCambiosSinGuardar()).toBe(true);
    b.unmount();
    expect(hayCambiosSinGuardar()).toBe(false);
  });

  it('funciona dentro de StrictMode (montaje doble)', () => {
    function Formulario() {
      const [texto, setTexto] = useState('');
      useMarcarCambiosSinGuardar(texto !== '');
      return <input aria-label="campo" value={texto} onChange={(e) => setTexto(e.target.value)} />;
    }
    const { getByLabelText, unmount } = render(<StrictMode><Formulario /></StrictMode>);
    expect(hayCambiosSinGuardar()).toBe(false);
    act(() => {
      const campo = getByLabelText('campo') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(campo, 'hola');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(hayCambiosSinGuardar()).toBe(true);
    unmount();
    expect(hayCambiosSinGuardar()).toBe(false);
  });
});

describe('useMarcadorCambiosSinGuardar', () => {
  it('entrega un callback estable que marca y, al desmontar, borra la marca', () => {
    const { result, rerender, unmount } = renderHook(() => useMarcadorCambiosSinGuardar());
    const primero = result.current;
    act(() => result.current(true));
    expect(hayCambiosSinGuardar()).toBe(true);
    rerender();
    expect(result.current).toBe(primero);
    act(() => result.current(false));
    expect(hayCambiosSinGuardar()).toBe(false);
    act(() => result.current(true));
    unmount();
    expect(hayCambiosSinGuardar()).toBe(false);
  });
});
