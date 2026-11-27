import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marcarCambiosSinGuardar, reiniciarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';
import {
  ANTI_BUCLE_MS,
  CLAVE_INTENTO,
  GRACIA_TRAS_GUARDAR_MS,
  INTERVALO_COMPROBACION_MS,
  useActualizacionApp,
  type OpcionesActualizacionApp,
} from './useActualizacionApp';

const CARGADA = 'aaaa1111';
const NUEVA = 'bbbb2222';

function almacenEnMemoria() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
  };
}

let visibilidad: 'visible' | 'hidden' = 'visible';
const cambiarVisibilidad = async (estado: 'visible' | 'hidden') => {
  visibilidad = estado;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
};

function preparar(publicado: () => Promise<string | null> | string | null, extra: OpcionesActualizacionApp = {}) {
  const obtenerIdPublicado = vi.fn(async () => publicado());
  const recargar = vi.fn();
  const prepararRecarga = vi.fn(async () => undefined);
  const almacen = almacenEnMemoria();
  const opciones: OpcionesActualizacionApp = {
    habilitado: true, idCargado: CARGADA, obtenerIdPublicado, recargar, prepararRecarga, almacenamiento: almacen, ...extra,
  };
  return { opciones, obtenerIdPublicado, recargar, prepararRecarga, almacen };
}

const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  reiniciarCambiosSinGuardar();
  visibilidad = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilidad });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  reiniciarCambiosSinGuardar();
});

describe('useActualizacionApp', () => {
  it('con la misma versión no recarga ni avisa, ni al abrir ni cada 5 minutos', async () => {
    const t = preparar(() => CARGADA);
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    await avanzar(INTERVALO_COMPROBACION_MS * 3);
    expect(t.obtenerIdPublicado).toHaveBeenCalledTimes(4); // al abrir + 3 intervalos
    expect(t.recargar).not.toHaveBeenCalled();
    expect(result.current.hayVersionNueva).toBe(false);
  });

  it('versión distinta y nada sin guardar: se recarga sola, una vez, sin mostrar aviso', async () => {
    const t = preparar(() => NUEVA);
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.prepararRecarga).toHaveBeenCalledTimes(1);
    expect(t.recargar).toHaveBeenCalledTimes(1);
    expect(result.current.hayVersionNueva).toBe(false);
    expect(JSON.parse(t.almacen.datos.get(CLAVE_INTENTO)!)).toMatchObject({ destino: NUEVA });
  });

  it('versión distinta con cambios sin guardar: muestra el aviso y NO recarga', async () => {
    marcarCambiosSinGuardar('evaluacion', true);
    const t = preparar(() => NUEVA);
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(result.current.hayVersionNueva).toBe(true);
    expect(t.recargar).not.toHaveBeenCalled();
    expect(t.prepararRecarga).not.toHaveBeenCalled();
    // Pasan varias comprobaciones y el usuario sigue escribiendo: nunca se recarga.
    await avanzar(INTERVALO_COMPROBACION_MS * 4);
    expect(t.recargar).not.toHaveBeenCalled();
    expect(result.current.hayVersionNueva).toBe(true);
  });

  it('tras guardar el aviso sigue ahí; se recarga sola en la primera comprobación pasada la gracia', async () => {
    marcarCambiosSinGuardar('evaluacion', true);
    const t = preparar(() => NUEVA);
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(result.current.hayVersionNueva).toBe(true);

    marcarCambiosSinGuardar('evaluacion', false); // el usuario guarda
    await avanzar(10_000);
    await cambiarVisibilidad('hidden');
    await cambiarVisibilidad('visible'); // vuelve a primer plano 10 s después de guardar
    expect(t.recargar).not.toHaveBeenCalled();
    expect(result.current.hayVersionNueva).toBe(true);

    await avanzar(GRACIA_TRAS_GUARDAR_MS); // ya pasó la gracia; llega la comprobación periódica
    await avanzar(INTERVALO_COMPROBACION_MS);
    expect(t.recargar).toHaveBeenCalledTimes(1);
  });

  it('un fallo de red no hace nada: ni recarga, ni aviso, ni excepción', async () => {
    const t = preparar(() => { throw new Error('sin red'); });
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    await avanzar(INTERVALO_COMPROBACION_MS * 2);
    expect(t.obtenerIdPublicado).toHaveBeenCalledTimes(3);
    expect(t.recargar).not.toHaveBeenCalled();
    expect(result.current.hayVersionNueva).toBe(false);
  });

  it('una respuesta sin id (null) tampoco hace nada, y la siguiente comprobación sí detecta la versión', async () => {
    let respuesta: string | null = null;
    const t = preparar(() => respuesta);
    renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.recargar).not.toHaveBeenCalled();
    respuesta = NUEVA;
    await avanzar(INTERVALO_COMPROBACION_MS);
    expect(t.recargar).toHaveBeenCalledTimes(1);
  });

  it('al volver a primer plano comprueba de inmediato; en segundo plano deja de sondear', async () => {
    const t = preparar(() => CARGADA);
    renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.obtenerIdPublicado).toHaveBeenCalledTimes(1);

    await cambiarVisibilidad('hidden');
    await avanzar(INTERVALO_COMPROBACION_MS * 3);
    expect(t.obtenerIdPublicado).toHaveBeenCalledTimes(1); // oculta: sin peticiones

    await cambiarVisibilidad('visible');
    expect(t.obtenerIdPublicado).toHaveBeenCalledTimes(2); // comprobación inmediata
    await avanzar(INTERVALO_COMPROBACION_MS);
    expect(t.obtenerIdPublicado).toHaveBeenCalledTimes(3); // y el sondeo se reanudó
  });

  it('al volver la conexión (online) comprueba de inmediato', async () => {
    const t = preparar(() => CARGADA);
    renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0); });
    expect(t.obtenerIdPublicado).toHaveBeenCalledTimes(2);
  });

  it('abrir la app con la pestaña oculta no pide nada hasta que se vea', async () => {
    visibilidad = 'hidden';
    const t = preparar(() => CARGADA);
    renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(INTERVALO_COMPROBACION_MS);
    expect(t.obtenerIdPublicado).not.toHaveBeenCalled();
  });

  it('no hay bucle de recarga: si la versión sigue distinta tras recargar, no recarga otra vez y avisa', async () => {
    const t = preparar(() => NUEVA);
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.recargar).toHaveBeenCalledTimes(1);
    // El «recargar» simulado no cambia el id cargado (el CDN aún sirve lo viejo): siguen las comprobaciones.
    await avanzar(INTERVALO_COMPROBACION_MS);
    expect(t.recargar).toHaveBeenCalledTimes(1);
    expect(result.current.hayVersionNueva).toBe(true);
    // Aunque el usuario cambie de pestaña y vuelva varias veces, tampoco hay otra recarga.
    for (let i = 0; i < 3; i += 1) {
      await cambiarVisibilidad('hidden');
      await cambiarVisibilidad('visible');
    }
    expect(t.recargar).toHaveBeenCalledTimes(1);
  });

  it('el freno contra bucles dura una ventana: pasada, vuelve a intentar sola', async () => {
    const t = preparar(() => NUEVA);
    renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.recargar).toHaveBeenCalledTimes(1);
    await avanzar(ANTI_BUCLE_MS + INTERVALO_COMPROBACION_MS);
    expect(t.recargar).toHaveBeenCalledTimes(2);
  });

  it('un intento previo hacia OTRA versión no frena la recarga hacia esta', async () => {
    const t = preparar(() => NUEVA);
    t.almacen.setItem(CLAVE_INTENTO, JSON.stringify({ destino: 'cccc3333', en: Date.now() }));
    renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.recargar).toHaveBeenCalledTimes(1);
  });

  it('si no se puede dejar constancia del intento (sessionStorage bloqueado), no recarga sola: solo avisa', async () => {
    const t = preparar(() => NUEVA, { almacenamiento: null });
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.recargar).not.toHaveBeenCalled();
    expect(result.current.hayVersionNueva).toBe(true);
  });

  it('si el usuario empieza a escribir mientras se prepara la recarga, no recarga', async () => {
    let liberar: () => void = () => undefined;
    const t = preparar(() => NUEVA, {
      prepararRecarga: vi.fn(() => new Promise<void>((resolver) => { liberar = resolver; })),
    });
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    marcarCambiosSinGuardar('evaluacion', true);
    await act(async () => { liberar(); await vi.advanceTimersByTimeAsync(0); });
    expect(t.recargar).not.toHaveBeenCalled();
    expect(result.current.hayVersionNueva).toBe(true);
  });

  it('el botón «Actualizar» recarga aunque haya cambios sin guardar (decisión explícita del usuario)', async () => {
    marcarCambiosSinGuardar('evaluacion', true);
    const t = preparar(() => NUEVA);
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.recargar).not.toHaveBeenCalled();
    await act(async () => { result.current.actualizar(); await vi.advanceTimersByTimeAsync(0); });
    expect(t.prepararRecarga).toHaveBeenCalledTimes(1);
    expect(t.recargar).toHaveBeenCalledTimes(1);
  });

  it('recarga igual si falla la preparación del service worker', async () => {
    const t = preparar(() => NUEVA, { prepararRecarga: vi.fn(async () => { throw new Error('sw caído'); }) });
    renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(t.recargar).toHaveBeenCalledTimes(1);
  });

  it('si la versión publicada vuelve a ser la cargada (reversión), el aviso desaparece', async () => {
    marcarCambiosSinGuardar('evaluacion', true);
    let publicada = NUEVA;
    const t = preparar(() => publicada);
    const { result } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    expect(result.current.hayVersionNueva).toBe(true);
    publicada = CARGADA;
    await avanzar(INTERVALO_COMPROBACION_MS);
    expect(result.current.hayVersionNueva).toBe(false);
  });

  it('desactivado (desarrollo): no pide nada', async () => {
    const t = preparar(() => NUEVA, { habilitado: false });
    renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(INTERVALO_COMPROBACION_MS * 2);
    expect(t.obtenerIdPublicado).not.toHaveBeenCalled();
    expect(t.recargar).not.toHaveBeenCalled();
  });

  it('por omisión está desactivado bajo Vitest (import.meta.env.DEV)', async () => {
    const t = preparar(() => NUEVA);
    const { habilitado: _habilitado, ...sinHabilitar } = t.opciones;
    void _habilitado;
    renderHook(() => useActualizacionApp(sinHabilitar));
    await avanzar(INTERVALO_COMPROBACION_MS);
    expect(t.obtenerIdPublicado).not.toHaveBeenCalled();
  });

  it('al desmontar se detienen el sondeo y los oyentes', async () => {
    const t = preparar(() => CARGADA);
    const { unmount } = renderHook(() => useActualizacionApp(t.opciones));
    await avanzar(0);
    unmount();
    await avanzar(INTERVALO_COMPROBACION_MS * 2);
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0); });
    expect(t.obtenerIdPublicado).toHaveBeenCalledTimes(1);
  });
});
