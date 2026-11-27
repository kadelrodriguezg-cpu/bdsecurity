import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBorradorLocal } from './useBorradorLocal';

interface BorradorPrueba {
  nombre: string;
  cantidad: string;
  [key: string]: unknown;
}

const inicial: BorradorPrueba = { nombre: '', cantidad: '' };

describe('useBorradorLocal — contrato', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('hidrata sincrónicamente el valor y expone la fecha recuperada', () => {
    localStorage.setItem('borrador:prueba', JSON.stringify({
      valor: { nombre: 'Poda de formación', cantidad: '2' },
      guardadoEn: 1_700_000_000_000,
    }));

    const { result } = renderHook(() => useBorradorLocal('borrador:prueba', inicial));

    expect(result.current.valor).toEqual({ nombre: 'Poda de formación', cantidad: '2' });
    expect(result.current.recuperadoEn).toBe(1_700_000_000_000);
    expect(result.current.hayContenido).toBe(true);
  });

  it('guardarAhora persiste antes de devolver y cancela un debounce anterior', () => {
    const { result } = renderHook(() => useBorradorLocal('borrador:prueba', inicial));
    act(() => result.current.setValor({ nombre: 'anterior', cantidad: '' }));
    act(() => expect(result.current.guardarAhora({ nombre: 'intento conservado', cantidad: '3' })).toBe(true));
    expect(JSON.parse(localStorage.getItem('borrador:prueba')!).valor.nombre).toBe('intento conservado');
    act(() => vi.advanceTimersByTime(2000));
    expect(JSON.parse(localStorage.getItem('borrador:prueba')!).valor.nombre).toBe('intento conservado');
  });

  it('guarda con debounce de 1,5 segundos y reinicia el plazo al editar', () => {
    const { result } = renderHook(() => useBorradorLocal('borrador:prueba', inicial));

    act(() => result.current.setValor({ nombre: 'Poda', cantidad: '' }));
    expect(result.current.estado).toBe('guardando');
    act(() => vi.advanceTimersByTime(1_000));
    expect(localStorage.getItem('borrador:prueba')).toBeNull();

    act(() => result.current.setValor({ nombre: 'Poda', cantidad: '3' }));
    act(() => vi.advanceTimersByTime(1_499));
    expect(localStorage.getItem('borrador:prueba')).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    const guardado = JSON.parse(localStorage.getItem('borrador:prueba')!);
    expect(guardado.valor).toEqual({ nombre: 'Poda', cantidad: '3' });
    expect(guardado.guardadoEn).toBe(Date.now());
    expect(result.current.estado).toBe('guardado');
  });

  it('limpiar elimina la persistencia sin cambiar el valor en memoria', () => {
    const { result } = renderHook(() => useBorradorLocal('borrador:prueba', inicial));
    act(() => result.current.setValor({ nombre: 'Poda', cantidad: '3' }));
    act(() => vi.advanceTimersByTime(1_500));

    act(() => result.current.limpiar());

    expect(localStorage.getItem('borrador:prueba')).toBeNull();
    expect(result.current.valor).toEqual({ nombre: 'Poda', cantidad: '3' });
    expect(result.current.recuperadoEn).toBeNull();
    expect(result.current.estado).toBe('idle');
  });

  it('descartarRecuperado elimina la persistencia y restaura el valor inicial', () => {
    localStorage.setItem('borrador:prueba', JSON.stringify({
      valor: { nombre: 'Poda', cantidad: '3' },
      guardadoEn: 1_700_000_000_000,
    }));
    const { result } = renderHook(() => useBorradorLocal('borrador:prueba', inicial));

    act(() => result.current.descartarRecuperado());

    expect(localStorage.getItem('borrador:prueba')).toBeNull();
    expect(result.current.valor).toEqual(inicial);
    expect(result.current.recuperadoEn).toBeNull();
    expect(result.current.hayContenido).toBe(false);
  });
});

// Regresiones de carreras de persistencia y cambios de entidad.
describe('useBorradorLocal — persistencia segura', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

  it('no considera fecha, false y cero iniciales como cambios ni los guarda', () => {
    const defaults = { fecha: '2026-10-03', activo: false, cantidad: 0 };
    const { result } = renderHook(() => useBorradorLocal('borrador:defaults', defaults));
    expect(result.current.hayContenido).toBe(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(localStorage.getItem('borrador:defaults')).toBeNull();
    expect(result.current.estado).toBe('idle');
    act(() => result.current.setValor({ ...defaults, cantidad: 1 }));
    expect(result.current.hayContenido).toBe(true);
  });

  it('limpiar cancela el debounce y no recrea datos guardados con éxito', () => {
    const { result, rerender } = renderHook(() => useBorradorLocal('borrador:a', inicial));
    act(() => result.current.setValor({ nombre: 'Poda', cantidad: '0' }));
    act(() => result.current.limpiar());
    rerender();
    act(() => vi.advanceTimersByTime(2000));
    expect(localStorage.getItem('borrador:a')).toBeNull();
    expect(result.current.valor.nombre).toBe('Poda');
    act(() => result.current.setValor({ nombre: 'Poda nueva', cantidad: '0' }));
    act(() => vi.advanceTimersByTime(1500));
    expect(JSON.parse(localStorage.getItem('borrador:a')!).valor.nombre).toBe('Poda nueva');
  });

  it('recupera sin reescribir ni cambiar la fecha del borrador', () => {
    const original = JSON.stringify({ valor: { nombre: 'Poda' }, guardadoEn: 123 });
    localStorage.setItem('borrador:a', original);
    const { result } = renderHook(() => useBorradorLocal('borrador:a', inicial));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.recuperadoEn).toBe(123);
    expect(localStorage.getItem('borrador:a')).toBe(original);
  });

  it.each(['null', '[]', '{"valor":null,"guardadoEn":123}', '{"valor":"hola","guardadoEn":123}', '{"valor":{},"guardadoEn":"ayer"}', '{"valor":{},"guardadoEn":1e100}', '{'])('ignora envelope inválido %s', (raw) => {
    localStorage.setItem('borrador:a', raw);
    const { result } = renderHook(() => useBorradorLocal('borrador:a', inicial));
    expect(result.current.valor).toEqual(inicial);
    expect(result.current.recuperadoEn).toBeNull();
  });

  it('aísla A→B→A sin escribir datos de A bajo B', () => {
    localStorage.setItem('borrador:b', JSON.stringify({ valor: { nombre: 'B' }, guardadoEn: 123 }));
    const { result, rerender } = renderHook(({ clave }) => useBorradorLocal(clave, inicial), { initialProps: { clave: 'borrador:a' } });
    act(() => result.current.setValor({ nombre: 'A pendiente', cantidad: '' }));
    rerender({ clave: 'borrador:b' });
    expect(result.current.valor.nombre).toBe('B');
    act(() => vi.advanceTimersByTime(2000));
    expect(JSON.parse(localStorage.getItem('borrador:b')!).valor.nombre).toBe('B');
    expect(localStorage.getItem('borrador:a')).toBeNull();
    rerender({ clave: 'borrador:a' });
    expect(result.current.valor).toEqual(inicial);
    expect(result.current.recuperadoEn).toBeNull();
  });

  it('ignora callbacks asíncronos de A cuando el formulario ya corresponde a B', () => {
    const { result, rerender } = renderHook(({ clave }) => useBorradorLocal(clave, inicial), { initialProps: { clave: 'borrador:a' } });
    const callbacksA = result.current;
    rerender({ clave: 'borrador:b' });
    act(() => result.current.setValor({ nombre: 'B pendiente', cantidad: '' }));
    act(() => {
      callbacksA.setValor({ nombre: 'Resultado tardío A', cantidad: '' });
      callbacksA.limpiar();
      callbacksA.descartarRecuperado();
    });
    expect(result.current.valor.nombre).toBe('B pendiente');
    expect(result.current.estado).toBe('guardando');
    act(() => vi.advanceTimersByTime(1500));
    expect(JSON.parse(localStorage.getItem('borrador:b')!).valor.nombre).toBe('B pendiente');
  });

  it('ignora callbacks de la primera visita a A después de A→B→A', () => {
    const { result, rerender } = renderHook(({ clave }) => useBorradorLocal(clave, inicial), { initialProps: { clave: 'borrador:a' } });
    const primeraVisita = result.current;
    const updaterObsoleto = vi.fn(() => ({ nombre: 'Obsoleto', cantidad: '' }));
    rerender({ clave: 'borrador:b' });
    rerender({ clave: 'borrador:a' });
    act(() => result.current.setValor({ nombre: 'Nueva visita A', cantidad: '' }));
    act(() => {
      primeraVisita.setValor(updaterObsoleto);
      primeraVisita.setValor({ nombre: 'Resultado de visita obsoleta', cantidad: '' });
      primeraVisita.limpiar();
      primeraVisita.descartarRecuperado();
    });
    expect(updaterObsoleto).not.toHaveBeenCalled();
    expect(result.current.valor.nombre).toBe('Nueva visita A');
    act(() => vi.advanceTimersByTime(1500));
    expect(JSON.parse(localStorage.getItem('borrador:a')!).valor.nombre).toBe('Nueva visita A');
  });

  it('una instancia desmontada no elimina el borrador de otra instancia de la misma clave', () => {
    const primera = renderHook(() => useBorradorLocal('borrador:a', inicial));
    const antiguos = primera.result.current;
    primera.unmount();
    const segunda = renderHook(() => useBorradorLocal('borrador:a', inicial));
    act(() => segunda.result.current.setValor({ nombre: 'Nueva instancia', cantidad: '' }));
    act(() => vi.advanceTimersByTime(1500));
    const updater = vi.fn(() => inicial);
    act(() => { antiguos.setValor(updater); antiguos.limpiar(); antiguos.descartarRecuperado(); });
    expect(updater).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('borrador:a')!).valor.nombre).toBe('Nueva instancia');
  });

  it('una instancia desmontada retira el borrador que ella misma escribió', () => {
    const primera = renderHook(() => useBorradorLocal('borrador:a', inicial));
    act(() => primera.result.current.setValor({ nombre: 'Mío', cantidad: '' }));
    act(() => vi.advanceTimersByTime(1500));
    expect(localStorage.getItem('borrador:a')).not.toBeNull();
    const limpiarAntiguo = primera.result.current.limpiar;
    primera.unmount();
    act(() => limpiarAntiguo());
    expect(localStorage.getItem('borrador:a')).toBeNull();
  });

  it('una instancia desmontada retira el borrador que recuperó si nadie lo cambió', () => {
    localStorage.setItem('borrador:a', JSON.stringify({ valor: { nombre: 'Recuperado', cantidad: '' }, guardadoEn: 1 }));
    const primera = renderHook(() => useBorradorLocal('borrador:a', inicial));
    const limpiarAntiguo = primera.result.current.limpiar;
    primera.unmount();
    act(() => limpiarAntiguo());
    expect(localStorage.getItem('borrador:a')).toBeNull();
  });

  it('una instancia desmontada no retira el borrador que otra instancia reescribió con otro contenido', () => {
    const primera = renderHook(() => useBorradorLocal('borrador:a', inicial));
    act(() => primera.result.current.setValor({ nombre: 'Primera', cantidad: '' }));
    act(() => vi.advanceTimersByTime(1500));
    const limpiarAntiguo = primera.result.current.limpiar;
    primera.unmount();
    const segunda = renderHook(() => useBorradorLocal('borrador:a', inicial));
    act(() => segunda.result.current.setValor({ nombre: 'Segunda', cantidad: '' }));
    act(() => vi.advanceTimersByTime(1500));
    act(() => limpiarAntiguo());
    expect(JSON.parse(localStorage.getItem('borrador:a')!).valor.nombre).toBe('Segunda');
  });

  it('mantiene el valor en memoria si falla setItem y expone el error', () => {
    const { result } = renderHook(() => useBorradorLocal('borrador:a', inicial));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError'); });
    act(() => result.current.setValor({ nombre: 'No perder', cantidad: '' }));
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.valor.nombre).toBe('No perder');
    expect(result.current.estado).toBe('idle');
    expect(result.current.errorPersistencia).toBeTruthy();
  });

  it('tolera lectura y eliminación bloqueadas', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    const { result } = renderHook(() => useBorradorLocal('borrador:a', inicial));
    expect(result.current.valor).toEqual(inicial);
    expect(result.current.errorPersistencia).toBeTruthy();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('bloqueado'); });
    act(() => result.current.limpiar());
    expect(result.current.errorPersistencia).toBeTruthy();
  });

  it('retirar todo lo editado elimina el borrador anterior, sin recrearlo', () => {
    const { result } = renderHook(() => useBorradorLocal('borrador:a', inicial));
    act(() => result.current.setValor({ nombre: 'Poda', cantidad: '' }));
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.setValor(inicial));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.hayContenido).toBe(false);
    expect(localStorage.getItem('borrador:a')).toBeNull();
  });

  it('cero ingresado frente a vacío sí es un dato que debe guardarse', () => {
    const defaults: Record<string, unknown> = { cantidad: null };
    const { result } = renderHook(() => useBorradorLocal('borrador:a', defaults));
    act(() => result.current.setValor({ cantidad: 0 }));
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.hayContenido).toBe(true);
    expect(JSON.parse(localStorage.getItem('borrador:a')!).valor.cantidad).toBe(0);
  });

  it('no recrea datos al desmontar después de la limpieza de logout', () => {
    const { result, unmount } = renderHook(() => useBorradorLocal('borrador:a', inicial));
    act(() => result.current.setValor({ nombre: 'A', cantidad: '' }));
    localStorage.clear();
    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(localStorage.length).toBe(0);
  });
});


describe('borradores con propietario explícito', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

  it('sin propietario funciona solo en memoria, sin lecturas, escrituras ni borrados', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const { result } = renderHook(() => useBorradorLocal('borrador:prueba:p1', inicial, { usuarioId: null }));
    act(() => result.current.setValor({ ...inicial, nombre: 'En memoria' }));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.valor.nombre).toBe('En memoria');
    expect(result.current.estado).toBe('idle');
    expect(result.current.persistenciaHabilitada).toBe(false);
    act(() => result.current.limpiar());
    expect(result.current.valor.nombre).toBe('En memoria');
    act(() => result.current.descartarRecuperado());
    expect(result.current.valor).toEqual(inicial);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('aísla A/B, conserva legado intacto y bloquea callbacks A antiguos al volver A→B→A', () => {
    const legado = JSON.stringify({ valor: { ...inicial, nombre: 'Sin propietario' }, guardadoEn: 100 });
    localStorage.setItem('borrador:prueba:p1', legado);
    const { result, rerender } = renderHook(({ usuarioId }) => useBorradorLocal('borrador:prueba:p1', inicial, { usuarioId }), { initialProps: { usuarioId: 'A' } });
    expect(result.current.valor).toEqual(inicial);
    const anterior = result.current;
    act(() => result.current.setValor({ ...inicial, nombre: 'De A' }));
    act(() => vi.advanceTimersByTime(1500));
    rerender({ usuarioId: 'B' });
    expect(result.current.valor).toEqual(inicial);
    act(() => result.current.setValor({ ...inicial, nombre: 'De B' }));
    const updater = vi.fn(() => ({ ...inicial, nombre: 'Obsoleto' }));
    act(() => { anterior.setValor(updater); anterior.limpiar(); anterior.descartarRecuperado(); });
    act(() => vi.advanceTimersByTime(1500));
    expect(JSON.parse(localStorage.getItem('borrador:usuario:B:prueba:p1')!).valor.nombre).toBe('De B');
    rerender({ usuarioId: 'A' });
    expect(result.current.valor.nombre).toBe('De A');
    act(() => { anterior.setValor(updater); anterior.limpiar(); anterior.descartarRecuperado(); });
    expect(updater).not.toHaveBeenCalled();
    expect(result.current.valor.nombre).toBe('De A');
    expect(localStorage.getItem('borrador:prueba:p1')).toBe(legado);
    expect(JSON.parse(localStorage.getItem('borrador:usuario:A:prueba:p1')!).valor.nombre).toBe('De A');
  });

  it('cancela debounce al perder propietario y no adopta su memoria al confirmar otra cuenta', () => {
    const { result, rerender } = renderHook(({ usuarioId }: { usuarioId: string | null }) => useBorradorLocal('borrador:prueba:p1', inicial, { usuarioId }), { initialProps: { usuarioId: 'A' as string | null } });
    act(() => result.current.setValor({ ...inicial, nombre: 'Pendiente A' }));
    rerender({ usuarioId: null });
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    act(() => result.current.setValor({ ...inicial, nombre: 'Sin dueño' }));
    act(() => vi.advanceTimersByTime(2000));
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(result.current.estado).toBe('idle');
    rerender({ usuarioId: 'B' });
    expect(result.current.valor).toEqual(inicial);
    expect(localStorage.getItem('borrador:usuario:A:prueba:p1')).toBeNull();
    expect(localStorage.getItem('borrador:usuario:B:prueba:p1')).toBeNull();
  });
});
