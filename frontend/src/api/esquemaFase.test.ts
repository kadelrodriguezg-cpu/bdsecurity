import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ secciones: vi.fn(), campos: vi.fn() }));
vi.mock('./client', () => {
  const tabla = (resultado: () => unknown) => {
    const cadena: Record<string, unknown> = {};
    cadena.select = () => cadena;
    cadena.eq = () => cadena;
    cadena.order = () => Promise.resolve(resultado());
    return cadena;
  };
  return {
    supabase: { from: (nombre: string) => (nombre === 'esquema_fase_seccion' ? tabla(mocks.secciones) : tabla(mocks.campos)) },
    traducirError: (e: Error) => e,
  };
});

import { obtenerEsquemaFase } from './esquemaFase';

const campo = (extra: Record<string, unknown>) => ({
  fase: 'evaluacion_anual', clave: 'x', seccion: 'fenologia', etiqueta: 'X', orden: 1, rol: 'descriptor', tipo: 'escala', unidad: null,
  escala_minimo: 1, escala_maximo: 5, etiqueta_minimo: 'bajo', etiqueta_maximo: 'alto', exige_muestra: false, etiquetas_nivel: null, activo: true, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.secciones.mockReturnValue({ data: [{ id: 'fenologia', etiqueta: 'Fenología', orden: 1 }], error: null });
});

it('lee las etiquetas por nivel y la marca de campo desactivado', async () => {
  mocks.campos.mockReturnValue({
    data: [
      campo({ clave: 'distribucion_flores_frutos', escala_maximo: 3, etiqueta_minimo: 'Solo en la punta', etiqueta_maximo: 'Toda la vara', etiquetas_nivel: ['Solo en la punta', 'Hasta la mitad', 'Toda la vara'] }),
      campo({ clave: 'rend_t_ha', seccion: 'produccion', tipo: 'numero', unidad: 't/ha', escala_minimo: null, escala_maximo: null, etiqueta_minimo: null, etiqueta_maximo: null, activo: false }),
      campo({ clave: 'brotacion' }),
    ],
    error: null,
  });
  const esquema = await obtenerEsquemaFase('evaluacion_anual');
  const por = Object.fromEntries(esquema.campos.map((c) => [c.clave, c]));
  expect(por.distribucion_flores_frutos.escala).toEqual({ minimo: 1, maximo: 3, etiquetaMinimo: 'Solo en la punta', etiquetaMaximo: 'Toda la vara', etiquetasNivel: ['Solo en la punta', 'Hasta la mitad', 'Toda la vara'] });
  expect(por.distribucion_flores_frutos.activo).toBeUndefined();
  expect(por.rend_t_ha.activo).toBe(false);
  // Una escala sin etiquetas por nivel no las inventa.
  expect(por.brotacion.escala).toEqual({ minimo: 1, maximo: 5, etiquetaMinimo: 'bajo', etiquetaMaximo: 'alto' });
});

it('contra una base sin la migración (sin columna activo ni etiquetas_nivel) todo campo sigue activo', async () => {
  const vieja = campo({ clave: 'brotacion' }) as Record<string, unknown>;
  delete vieja.activo;
  delete vieja.etiquetas_nivel;
  mocks.campos.mockReturnValue({ data: [vieja], error: null });
  const esquema = await obtenerEsquemaFase('evaluacion_anual');
  expect(esquema.campos[0].activo).toBeUndefined();
  expect(esquema.campos[0].escala?.etiquetasNivel).toBeUndefined();
});
