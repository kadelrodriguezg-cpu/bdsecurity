import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rango: vi.fn(), select: vi.fn(), eq: vi.fn(), en: vi.fn() }));
vi.mock('./client', () => {
  // Cadena de PostgREST: cada paso devuelve la misma cadena y `range` resuelve la página.
  const cadena: Record<string, unknown> = {};
  cadena.select = (...a: unknown[]) => { mocks.select(...a); return cadena; };
  cadena.eq = (...a: unknown[]) => { mocks.eq(...a); return cadena; };
  cadena.in = (...a: unknown[]) => { mocks.en(...a); return cadena; };
  cadena.order = () => cadena;
  cadena.range = (...a: unknown[]) => mocks.rango(...a);
  return { supabase: { from: () => cadena }, traducirError: (e: Error) => e };
});

import { COLUMNAS_VALORES, listarValoresDeRonda } from './valoresRonda';

beforeEach(() => { vi.clearAllMocks(); });

it('lee solo columnas del esquema: nunca linaje, y filtra por relación (!inner), sin listas de ids', async () => {
  mocks.rango.mockResolvedValue({ data: [{ id: 'e1', brotacion: 4 }], error: null });
  const valores = await listarValoresDeRonda('planta-1', 2, 'multisitio');
  const select = String(mocks.select.mock.calls[0][0]);
  expect(select).toContain('ronda:ronda_evaluacion_anual!inner(individuo:individuos!inner(planta_id))');
  for (const prohibido of ['cruzamiento', 'mama', 'papa', '*']) expect(select).not.toContain(prohibido);
  expect(COLUMNAS_VALORES).toContain('brotacion');
  expect(COLUMNAS_VALORES).not.toContain('peso_promedio_g'); // derivado: no entra a la matriz
  expect(mocks.eq).toHaveBeenCalledWith('ronda.individuo.planta_id', 'planta-1');
  expect(mocks.eq).toHaveBeenCalledWith('ronda.numero_ronda', 2);
  expect(mocks.eq).toHaveBeenCalledWith('ronda.tipo_ronda', 'multisitio');
  // El único `in` es el de estados; nunca una lista de ids (414 en un cruce grande).
  expect(mocks.en).toHaveBeenCalledTimes(1);
  expect(mocks.en.mock.calls[0][0]).toBe('estado');
  expect(valores.get('e1')).toEqual({ brotacion: 4 });
});

it('pide la página siguiente mientras vengan 1000 filas', async () => {
  const pagina = (desde: number, n: number) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `e${desde + i}`, brotacion: 3 })), error: null });
  mocks.rango.mockResolvedValueOnce(pagina(0, 1000)).mockResolvedValueOnce(pagina(1000, 250));
  const valores = await listarValoresDeRonda('planta-1', 1);
  expect(mocks.rango).toHaveBeenNthCalledWith(1, 0, 999);
  expect(mocks.rango).toHaveBeenNthCalledWith(2, 1000, 1999);
  expect(valores.size).toBe(1250);
});

it('propaga el error de la lectura', async () => {
  mocks.rango.mockResolvedValue({ data: null, error: new Error('sin permiso') });
  await expect(listarValoresDeRonda('planta-1', 1)).rejects.toThrow('sin permiso');
});

it('lee la distribución de flores y frutos y también el rend_t_ha desactivado (el dato histórico se conserva)', () => {
  expect(COLUMNAS_VALORES).toContain('distribucion_flores_frutos');
  expect(COLUMNAS_VALORES).toContain('rend_t_ha');
});
