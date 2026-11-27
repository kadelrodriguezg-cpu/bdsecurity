import { afterEach, describe, expect, it, vi } from 'vitest';
import { actualizarServiceWorker } from './serviceWorker';

afterEach(() => vi.useRealTimers());

function trabajadorFalso(estado: string) {
  const oyentes = new Set<() => void>();
  return {
    state: estado,
    addEventListener: (_tipo: string, f: () => void) => { oyentes.add(f); },
    removeEventListener: (_tipo: string, f: () => void) => { oyentes.delete(f); },
    cambiarA(nuevo: string) { this.state = nuevo; oyentes.forEach((f) => f()); },
  };
}

describe('actualizarServiceWorker', () => {
  it('sin service worker (navegador sin soporte) no hace nada', async () => {
    await expect(actualizarServiceWorker(undefined)).resolves.toBeUndefined();
  });

  it('sin registro no hace nada', async () => {
    await expect(actualizarServiceWorker({ getRegistration: async () => undefined })).resolves.toBeUndefined();
  });

  it('pide la revisión y espera a que el worker nuevo se active', async () => {
    const nuevo = trabajadorFalso('installing');
    const update = vi.fn(async () => undefined);
    const registro = { update, installing: nuevo, waiting: null } as unknown as ServiceWorkerRegistration;
    let terminado = false;
    const espera = actualizarServiceWorker({ getRegistration: async () => registro }).then(() => { terminado = true; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    expect(terminado).toBe(false);
    nuevo.cambiarA('installed');
    await Promise.resolve();
    expect(terminado).toBe(false);
    nuevo.cambiarA('activated');
    await espera;
    expect(terminado).toBe(true);
  });

  it('si no se activa, se rinde al llegar al tope', async () => {
    vi.useFakeTimers();
    const nuevo = trabajadorFalso('installing');
    const registro = { update: async () => undefined, installing: nuevo, waiting: null } as unknown as ServiceWorkerRegistration;
    const espera = actualizarServiceWorker({ getRegistration: async () => registro }, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(espera).resolves.toBeUndefined();
  });

  it('un fallo al actualizar (sin red) no lanza error', async () => {
    const registro = { update: async () => { throw new Error('sin red'); } } as unknown as ServiceWorkerRegistration;
    await expect(actualizarServiceWorker({ getRegistration: async () => registro })).resolves.toBeUndefined();
  });
});
