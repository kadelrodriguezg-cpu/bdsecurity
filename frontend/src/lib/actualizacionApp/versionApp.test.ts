import { describe, expect, it, vi } from 'vitest';
import { ID_VERSION_CARGADA, RUTA_VERSION, leerIdVersion, obtenerIdVersionPublicada } from './versionApp';

const respuestaJson = (cuerpo: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(cuerpo), { status: 200, ...init });

describe('leerIdVersion', () => {
  it('lee el id de un version.json válido', () => {
    expect(leerIdVersion({ id: ' 14380a1f ', construidoEn: '2026-10-25T12:00:00.000Z' })).toBe('14380a1f');
  });
  it.each([null, undefined, 'texto', 42, {}, { id: '' }, { id: 7 }, []])('rechaza %j', (valor) => {
    expect(leerIdVersion(valor)).toBeNull();
  });
});

describe('obtenerIdVersionPublicada', () => {
  it('pide /version.json sin caché y devuelve el id', async () => {
    const peticion = vi.fn(async () => respuestaJson({ id: 'bbbb2222' }));
    await expect(obtenerIdVersionPublicada(peticion as unknown as typeof fetch)).resolves.toBe('bbbb2222');
    const [url, opciones] = peticion.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RUTA_VERSION);
    expect(opciones.cache).toBe('no-store');
    expect(opciones.credentials).toBe('omit');
  });

  it('devuelve null si hay error de red', async () => {
    const peticion = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(obtenerIdVersionPublicada(peticion as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('devuelve null con un 404 o 500', async () => {
    for (const status of [404, 500]) {
      const peticion = vi.fn(async () => new Response('x', { status }));
      await expect(obtenerIdVersionPublicada(peticion as unknown as typeof fetch)).resolves.toBeNull();
    }
  });

  it('devuelve null si la respuesta no es JSON (p. ej. el index.html que entrega el rewrite)', async () => {
    const peticion = vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(obtenerIdVersionPublicada(peticion as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('se rinde a los 10 s si la red no responde', async () => {
    vi.useFakeTimers();
    try {
      const peticion = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolver, rechazar) => {
        init?.signal?.addEventListener('abort', () => rechazar(new DOMException('abortado', 'AbortError')));
      }));
      const resultado = obtenerIdVersionPublicada(peticion as unknown as typeof fetch, 10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(resultado).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ID_VERSION_CARGADA', () => {
  it('bajo pruebas (sin build) vale «dev»', () => {
    expect(ID_VERSION_CARGADA).toBe('dev');
  });
});
