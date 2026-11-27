import { describe, expect, it } from 'vitest';
import type { ComparacionRondasResponse } from '@/api/comparacion';
import {
  aplicarFiltros, cambiosDesdeComparacion, desglose, escribirEstado, etiquetaDe, grupoPorDefecto, gruposDisponibles,
  leerEstado, medianaDelGrupo, ordenar, ordenarPorPeso, plegado, pesosDelGrupo, rutaDesdeRankingViejo, type FilaResultado,
} from './modelo';

const PESOS = [
  { categoria: 'fruto_calidad', peso: 0.4 },
  { categoria: 'produccion', peso: 0.3 },
  { categoria: 'fenologia', peso: 0.2 },
  { categoria: 'estres', peso: 0.1 },
];
const TODAS = ['estres', 'fenologia', 'fruto_calidad', 'produccion'];

const fila = (id: string, extra: Partial<FilaResultado> = {}): FilaResultado => ({
  individuo_id: id, codigo_display: `X-${id}`, planta_id: 'p', codigo_sistema: 'X', evaluacion_id: `e${id}`,
  fecha_evaluacion: '2026-10-01', numero_ronda: 1, puntaje: 0.5, grupo: TODAS, posicion: 1, tamano: 3,
  categorias: { fruto_calidad: 0.5, produccion: 0.5, fenologia: 0.5, estres: 0.5 }, cobertura: {}, estado: 'comparable', ...extra,
});

describe('grupos', () => {
  it('por defecto: entre los grupos con puestos, el de más categorías', () => {
    const filas = [
      fila('1'), fila('2'),
      fila('3', { grupo: ['fenologia'] }), fila('4', { grupo: ['fenologia'] }), fila('5', { grupo: ['fenologia'] }),
      fila('6', { grupo: ['estres', 'fenologia'], posicion: null, estado: 'pocas_plantas' }),
    ];
    const grupos = gruposDisponibles(filas);
    expect(grupos.map((g) => g.n)).toEqual([2, 1, 3]);
    expect(grupoPorDefecto(grupos)?.clave).toBe(TODAS.join(','));
  });

  it('sin grupos con puestos: el de más individuos', () => {
    const grupos = gruposDisponibles([fila('1', { posicion: null, estado: 'pocas_plantas' }), fila('2', { grupo: ['fenologia'], posicion: null, estado: 'pocas_plantas' }), fila('3', { grupo: ['fenologia'], posicion: null, estado: 'pocas_plantas' })]);
    expect(grupoPorDefecto(grupos)?.clave).toBe('fenologia');
  });

  it('la mediana usa solo los que tienen puesto', () => {
    expect(medianaDelGrupo([fila('1', { puntaje: 0.2 }), fila('2', { puntaje: 0.6 }), fila('3', { puntaje: 0.9, posicion: null })])).toBeCloseTo(0.4);
  });

  it('plegado: excluidas, sin puntaje y en otros grupos', () => {
    const p = plegado([fila('1'), fila('2', { estado: 'excluida_revision' }), fila('3', { estado: 'sin_evaluacion' }), fila('4', { grupo: ['fenologia'] })], TODAS.join(','));
    expect([p.excluidas.length, p.sinPuntaje.length, p.otrosGrupos.length]).toEqual([1, 1, 1]);
  });
});

describe('de dónde salen los puntos', () => {
  it('valor × peso = puntos y la suma da el puntaje (fórmula del motor)', () => {
    const f = fila('1', { categorias: { fruto_calidad: 0.77, produccion: 0.71, fenologia: 0.75, estres: 0.45 } });
    const lineas = desglose(f, PESOS);
    expect(lineas.map((l) => l.categoria)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'estres']);
    expect(lineas[0].puntos).toBeCloseTo(0.308);
    expect(lineas.reduce((s, l) => s + l.puntos, 0)).toBeCloseTo(0.77 * 0.4 + 0.71 * 0.3 + 0.75 * 0.2 + 0.45 * 0.1);
  });

  it('en un grupo con menos categorías el peso se reparte entre las que tienen dato', () => {
    const f = fila('1', { grupo: ['fenologia', 'fruto_calidad'], categorias: { fruto_calidad: 0.8, fenologia: 0.5, produccion: null, estres: null } });
    const lineas = desglose(f, PESOS);
    expect(lineas.map((l) => Number(l.pesoEfectivo.toFixed(4)))).toEqual([0.6667, 0.3333]);
    expect(lineas.reduce((s, l) => s + l.puntos, 0)).toBeCloseTo((0.8 * 0.4 + 0.5 * 0.2) / 0.6);
    expect(pesosDelGrupo(['fenologia', 'fruto_calidad'], PESOS).map((p) => p.categoria)).toEqual(['fruto_calidad', 'fenologia']);
  });

  it('una quinta categoría de la versión aparece sola (no hay categorías fijas)', () => {
    const conQuinta = [...PESOS, { categoria: 'brotes_varas', peso: 0.16 }];
    const f = fila('1', { grupo: [...TODAS, 'brotes_varas'], categorias: { ...fila('1').categorias, brotes_varas: 0.58 } });
    expect(desglose(f, conQuinta).map((l) => l.categoria)).toContain('brotes_varas');
  });
});

describe('cambio vs. ronda anterior', () => {
  it('arma el puntaje de cada ronda con los pesos y etiqueta con los umbrales', () => {
    const resp: ComparacionRondasResponse = {
      umbrales: { leve: 0.05, marcado: 0.15 },
      individuos: [{
        individuo_id: 'i1', codigo_display: 'X', tipo_ronda: 'anual', numero_anterior: 1, numero_actual: 2, deltas_parametro: [],
        deltas_categoria: [
          { categoria: 'fruto_calidad', valor_anterior: 0.5, valor_actual: 0.7, delta: 0.2, etiqueta: 'mejoro_marcado' },
          { categoria: 'fenologia', valor_anterior: 0.5, valor_actual: 0.5, delta: 0, etiqueta: 'estable' },
        ],
      }],
    };
    const c = cambiosDesdeComparacion(resp, PESOS).get('i1')!;
    expect(c.delta).toBeCloseTo((0.7 * 0.4 + 0.5 * 0.2) / 0.6 - 0.5);
    expect(c.etiqueta).toBe('mejoro_leve');
    expect(c.referencia).toBe('1');
    expect(etiquetaDe(-0.2, resp.umbrales!)).toBe('empeoro_marcado');
    expect(etiquetaDe(0.01, resp.umbrales!)).toBe('estable');
  });
});

describe('orden y filtros', () => {
  it('ordena con precisión completa y deja los vacíos al final', () => {
    const filas = [fila('a', { puntaje: 0.70301, posicion: 2 }), fila('b', { puntaje: 0.70302, posicion: 1 }), fila('c', { puntaje: null, posicion: null })];
    expect(ordenar(filas, { columna: 'puntaje', dir: 'desc' }).map((f) => f.individuo_id)).toEqual(['b', 'a', 'c']);
    expect(ordenar(filas, { columna: 'puntaje', dir: 'asc' }).map((f) => f.individuo_id)).toEqual(['a', 'b', 'c']);
  });

  it('filtra por descriptor ≥ / ≤; sin dato no pasa', () => {
    const valores = { a: { brix: { valor: 14, peso: 1, normalizado: 1, fuera_rango_inferior: null, fuera_rango_superior: null } }, b: { brix: { valor: 11, peso: 1, normalizado: 0, fuera_rango_inferior: null, fuera_rango_superior: null } } };
    const filas = [fila('a'), fila('b'), fila('c')];
    expect(aplicarFiltros(filas, valores, [{ metrica: 'brix', op: 'ge', valor: 12 }]).map((f) => f.individuo_id)).toEqual(['a']);
    expect(aplicarFiltros(filas, valores, [{ metrica: 'brix', op: 'le', valor: 12 }]).map((f) => f.individuo_id)).toEqual(['b']);
  });
});

describe('URL', () => {
  it('lee y escribe el estado', () => {
    const p = escribirEstado(new URLSearchParams(), { especie: 'e', columnas: ['brix', 'calibre_mm'], filtros: [{ metrica: 'brix', op: 'ge', valor: 12 }], cambio: true, orden: { columna: 'cat:fenologia', dir: 'desc' } });
    const e = leerEstado(p);
    expect(e).toMatchObject({ especie: 'e', columnas: ['brix', 'calibre_mm'], filtros: [{ metrica: 'brix', op: 'ge', valor: 12 }], cambio: true, orden: { columna: 'cat:fenologia', dir: 'desc' } });
  });

  it('los enlaces viejos de /ranking llevan al estado equivalente', () => {
    const r = (q: string) => rutaDesdeRankingViejo(new URLSearchParams(q));
    expect(r('especie=e&cruce=c&g_col=fenologia&g_dir=desc')).toBe('/resultados?especie=e&cruce=c&orden=cat%3Afenologia%3Adesc');
    expect(r('tab=parametro&especie=e&p_metricas=brix,firmeza&p_filtro=brix&p_op=%3C%3D&p_valor=12&p_vista=grafico')).toBe('/resultados?especie=e&cols=brix%2Cfirmeza&f=brix%3Ale%3A12&cinco=1');
    expect(r('tab=comparacion&especie=e&cruce=c')).toBe('/resultados?especie=e&cruce=c&cambio=1');
    expect(r('tab=snapshots&especie=e')).toBe('/resultados?especie=e&congelado=elegir');
    expect(r('tab=polinizacion-varietal&especie=e')).toBe('/resultados/polinizacion?especie=e');
    expect(r('')).toBe('/resultados');
  });
});

describe('cinco categorías: scoring v2 (40 · 30 · 15 · 10 · 5) con Brotes y varas', () => {
  const PESOS5 = [
    { categoria: 'fruto_calidad', peso: 0.4 },
    { categoria: 'produccion', peso: 0.3 },
    { categoria: 'fenologia', peso: 0.15 },
    { categoria: 'brotes', peso: 0.1 },
    { categoria: 'estres', peso: 0.05 },
  ];
  const CINCO = ['fenologia', 'fruto_calidad', 'produccion', 'brotes', 'estres']; // el grupo llega en orden del enum
  const valores = { fruto_calidad: 0.8, produccion: 0.6, fenologia: 0.5, brotes: 0.4, estres: 1 };

  it('con brotes en los datos: el desglose sigue el orden de los pesos y la suma da el puntaje', () => {
    const f = fila('1', { grupo: CINCO, categorias: valores });
    const lineas = desglose(f, PESOS5);
    expect(lineas.map((l) => l.categoria)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres']);
    expect(lineas.map((l) => Number(l.pesoEfectivo.toFixed(4)))).toEqual([0.4, 0.3, 0.15, 0.1, 0.05]);
    expect(lineas.reduce((s, l) => s + l.puntos, 0)).toBeCloseTo(0.8 * 0.4 + 0.6 * 0.3 + 0.5 * 0.15 + 0.4 * 0.1 + 1 * 0.05);
  });

  it('sin brotes en los datos (el individuo no la midió): el peso se reparte entre las otras cuatro', () => {
    const f = fila('1', { grupo: ['fenologia', 'fruto_calidad', 'produccion', 'estres'], categorias: { ...valores, brotes: null } });
    const lineas = desglose(f, PESOS5);
    expect(lineas.map((l) => l.categoria)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'estres']);
    expect(lineas.map((l) => Number(l.pesoEfectivo.toFixed(4)))).toEqual([0.4444, 0.3333, 0.1667, 0.0556]);
    expect(lineas.reduce((s, l) => s + l.puntos, 0)).toBeCloseTo((0.8 * 0.4 + 0.6 * 0.3 + 0.5 * 0.15 + 1 * 0.05) / 0.9);
  });

  it('con una versión de 4 categorías (v1) y datos sin brotes, todo sigue igual', () => {
    const f = fila('1');
    const lineas = desglose(f, PESOS);
    expect(lineas.map((l) => l.categoria)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'estres']);
    expect(lineas.reduce((s, l) => s + l.pesoEfectivo, 0)).toBeCloseTo(1);
  });

  it('los pesos del grupo salen de la versión: con las cinco coinciden con los de la versión', () => {
    expect(pesosDelGrupo(CINCO, PESOS5).map((p) => [p.categoria, Number(p.peso.toFixed(2))])).toEqual([
      ['fruto_calidad', 0.4], ['produccion', 0.3], ['fenologia', 0.15], ['brotes', 0.1], ['estres', 0.05],
    ]);
  });

  it('las categorías de un grupo se presentan por peso de la versión, no en el orden del enum', () => {
    expect(ordenarPorPeso(CINCO, PESOS5)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres']);
    expect(ordenarPorPeso(['estres', 'fenologia'], PESOS5)).toEqual(['fenologia', 'estres']);
    // Una categoría que la versión no pesa queda al final.
    expect(ordenarPorPeso(['agua', 'fenologia'], PESOS5)).toEqual(['fenologia', 'agua']);
    expect(ordenarPorPeso(['fenologia', 'estres'], [])).toEqual(['fenologia', 'estres']);
  });

  it('el grupo de cinco categorías es el que se abre por defecto frente a uno de cuatro, y cada uno se agrupa aparte', () => {
    const filas = [
      fila('1', { grupo: CINCO, categorias: valores }), fila('2', { grupo: CINCO, categorias: valores }),
      fila('3', { grupo: ['fenologia', 'fruto_calidad', 'produccion', 'estres'], categorias: { ...valores, brotes: null } }),
    ];
    const grupos = gruposDisponibles(filas);
    expect(grupos.map((g) => g.categorias.length)).toEqual([5, 4]);
    expect(grupoPorDefecto(grupos)?.clave).toBe(CINCO.join(','));
  });
});

describe('fase 5, segunda parte: filtro de tardías (G8)', () => {
  it('leerEstado y escribirEstado conservan «tardias» en la URL', async () => {
    const { leerEstado, escribirEstado } = await import('./modelo');
    expect(leerEstado(new URLSearchParams('tardias=1')).tardias).toBe(true);
    expect(leerEstado(new URLSearchParams('')).tardias).toBe(false);
    expect(escribirEstado(new URLSearchParams(''), { tardias: true }).get('tardias')).toBe('1');
    expect(escribirEstado(new URLSearchParams('tardias=1'), { tardias: false }).has('tardias')).toBe(false);
  });

  it('filtrosEfectivos agrega precocidad ≤ 2 (enero o después) a los filtros de columnas', async () => {
    const { filtrosEfectivos, aplicarFiltros } = await import('./modelo');
    const filtros = filtrosEfectivos({ filtros: [{ metrica: 'brix', op: 'ge', valor: 12 }], tardias: true });
    expect(filtros).toEqual([{ metrica: 'brix', op: 'ge', valor: 12 }, { metrica: 'precocidad', op: 'le', valor: 2 }]);
    const valores = { a: { precocidad: { valor: 1 } }, b: { precocidad: { valor: 3 } }, c: {} } as never;
    expect(aplicarFiltros([{ individuo_id: 'a' }, { individuo_id: 'b' }, { individuo_id: 'c' }], valores, filtrosEfectivos({ filtros: [], tardias: true })).map((f) => f.individuo_id)).toEqual(['a']);
  });
});

describe('fase 5, segunda parte: lo plegado va en orden natural (G16)', () => {
  it('sin puntaje: P2 antes que P10 y P100', async () => {
    const { plegado } = await import('./modelo');
    const fila = (codigo: string) => ({ individuo_id: codigo, codigo_display: codigo, estado: 'sin_evaluacion', grupo: [] }) as never;
    expect(plegado([fila('02-001-P100'), fila('02-001-P10'), fila('02-001-P2')], null).sinPuntaje.map((f: { codigo_display: string }) => f.codigo_display))
      .toEqual(['02-001-P2', '02-001-P10', '02-001-P100']);
  });
});
