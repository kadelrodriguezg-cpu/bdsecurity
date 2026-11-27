import { describe, expect, it } from 'vitest';
import type { ComparacionIndividuo } from '@/api/comparacion';
import type { PuntajeCongelado } from '@/api/compararRondas';
import type { ItemRankingGrupos } from '@/api/rankingGrupos';
import { ESQUEMA_EVALUACION_ANUAL } from '@/lib/esquemaFase/evaluacionAnual';
import type { CampoFase } from '@/lib/esquemaFase/tipos';
import {
  cambioDescriptor,
  categoriasDeRonda,
  compararCategorias,
  compararDescriptores,
  compararTotales,
  elegirRonda,
  grupoDe,
  mismoGrupo,
  puntajeDeRonda,
  rondasPorDefecto,
  type CeldaDescriptor,
  type PuntajeRonda,
} from './compararRondas';

const campo = (clave: string): CampoFase => {
  const c = ESQUEMA_EVALUACION_ANUAL.campos.find((x) => x.clave === clave);
  if (!c) throw new Error(clave);
  return c;
};
const celda = (estado: CeldaDescriptor['estado'], valor: unknown = null): CeldaDescriptor => ({ estado, valor });

describe('cambioDescriptor', () => {
  it('escala y numéricos: sube, baja e igual solo si los dos están medidos', () => {
    expect(cambioDescriptor(campo('brotacion'), celda('medido', 3), celda('medido', 4))).toEqual({ tipo: 'sube', cantidad: 1 });
    expect(cambioDescriptor(campo('cuaja'), celda('medido', 4), celda('medido', 3))).toEqual({ tipo: 'baja', cantidad: 1 });
    expect(cambioDescriptor(campo('floracion'), celda('medido', 4), celda('medido', 4))).toEqual({ tipo: 'igual' });
    expect(cambioDescriptor(campo('altura_brote_mm'), celda('medido', 318), celda('medido', 412))).toEqual({ tipo: 'sube', cantidad: 94 });
  });

  it('redondea la diferencia para que 0,1 + 0,2 no deje restos de coma flotante', () => {
    expect(cambioDescriptor(campo('brix'), celda('medido', 13.1), celda('medido', 13.4))).toEqual({ tipo: 'sube', cantidad: 0.3 });
  });

  it('fechas: se comparan por día del año, sin importar el año', () => {
    expect(cambioDescriptor(campo('fecha_inicio_floracion'), celda('medido', '2025-09-18'), celda('medido', '2026-09-11'))).toEqual({ tipo: 'antes', dias: 7 });
    expect(cambioDescriptor(campo('fecha_inicio_floracion'), celda('medido', '2025-09-11'), celda('medido', '2026-09-14'))).toEqual({ tipo: 'despues', dias: 3 });
    expect(cambioDescriptor(campo('fecha_inicio_floracion'), celda('medido', '2025-09-11'), celda('medido', '2026-09-11'))).toEqual({ tipo: 'igual' });
  });

  it('medido en una ronda y faltó en la otra: sin diferencia', () => {
    expect(cambioDescriptor(campo('cuaja'), celda('medido', 4), celda('falto'))).toEqual({ tipo: 'sin_diferencia', motivo: 'falto_b' });
    expect(cambioDescriptor(campo('cuaja'), celda('falto'), celda('medido', 4))).toEqual({ tipo: 'sin_diferencia', motivo: 'falto_a' });
  });

  it('medido en una y no evaluado en la otra: sin diferencia, y dice en cuál se midió', () => {
    expect(cambioDescriptor(campo('brix'), celda('medido', 13), celda('no_evaluado'))).toEqual({ tipo: 'sin_diferencia', motivo: 'solo_a' });
    expect(cambioDescriptor(campo('brix'), celda('no_evaluado'), celda('medido', 13))).toEqual({ tipo: 'sin_diferencia', motivo: 'solo_b' });
  });

  it('un valor marcado para revisión no se resta', () => {
    expect(cambioDescriptor(campo('calibre_mm'), celda('medido', 15), celda('marcado', 42))).toEqual({ tipo: 'sin_diferencia', motivo: 'marcado' });
  });
});

describe('compararDescriptores', () => {
  it('agrupa por sección, omite lo que ninguna ronda evaluó y marca los evaluados en ambas', () => {
    const secciones = compararDescriptores(
      ESQUEMA_EVALUACION_ANUAL,
      { valores: { brotacion: 3, cuaja: 4, brix: 13 }, estados: { brotacion: 'medido', cuaja: 'medido', brix: 'medido' } },
      { valores: { brotacion: 4, cuaja: null }, estados: { brotacion: 'medido', cuaja: 'falto' } },
    );
    expect(secciones.map((s) => s.id)).toEqual(['fenologia', 'fruto']);
    const fen = secciones[0].filas;
    expect(fen.map((f) => f.campo.clave)).toEqual(['brotacion', 'cuaja']);
    expect(fen.map((f) => f.ambas)).toEqual([true, false]);
    expect(secciones[1].filas.map((f) => f.campo.clave)).toEqual(['brix']);
  });

  it('un derivado con valor cuenta como medido y sin valor no aparece', () => {
    const secciones = compararDescriptores(
      ESQUEMA_EVALUACION_ANUAL,
      { valores: { peso_promedio_g: 1.8 }, estados: {} },
      { valores: {}, estados: {} },
    );
    const fila = secciones.flatMap((s) => s.filas).find((f) => f.campo.clave === 'peso_promedio_g');
    expect(fila?.a.estado).toBe('medido');
    expect(fila?.b.estado).toBe('no_evaluado');
  });
});

const puntaje = (numero: number, extra: Partial<PuntajeRonda> = {}): PuntajeRonda => ({
  numero, categorias: null, grupo: ['fenologia', 'fruto_calidad'], puntaje: 0.5, versionNombre: 'v1', posicionGrupo: null, tamanoGrupo: null,
  fuente: 'ranking', congeladoNombre: null, motivoSinPuntaje: null, ...extra,
});

describe('compararTotales', () => {
  it('mismo grupo y misma versión: resta', () => {
    expect(compararTotales(puntaje(1, { puntaje: 0.5 }), puntaje(2, { puntaje: 0.62 }))).toEqual({ resta: true, diferencia: 0.12 });
  });

  it('grupos distintos: no resta, aunque haya puntaje y versión igual', () => {
    expect(compararTotales(puntaje(1), puntaje(2, { grupo: ['fenologia'] }))).toEqual({ resta: false, motivo: 'grupos_distintos' });
  });

  it('grupos distintos mandan sobre un puntaje que falta', () => {
    expect(compararTotales(puntaje(1, { puntaje: null }), puntaje(2, { grupo: ['fenologia'] }))).toEqual({ resta: false, motivo: 'grupos_distintos' });
  });

  it('versiones distintas: no resta', () => {
    expect(compararTotales(puntaje(1, { versionNombre: 'v1' }), puntaje(2, { versionNombre: 'v2' }))).toEqual({ resta: false, motivo: 'version_distinta' });
  });

  it('sin puntaje de una ronda o sin saber su versión: no resta', () => {
    expect(compararTotales(puntaje(1, { puntaje: null, fuente: null }), puntaje(2))).toEqual({ resta: false, motivo: 'sin_puntaje' });
    expect(compararTotales(puntaje(1, { versionNombre: null }), puntaje(2))).toEqual({ resta: false, motivo: 'sin_puntaje' });
  });

  it('un grupo desconocido no se inventa: si hay puntaje y versión iguales, resta', () => {
    expect(compararTotales(puntaje(1, { grupo: null, puntaje: 0.4 }), puntaje(2, { puntaje: 0.5 }))).toEqual({ resta: true, diferencia: 0.1 });
  });
});

const par = (anterior: number, actual: number, categorias: [string, number | null, number | null][]): ComparacionIndividuo => ({
  individuo_id: 'i1', codigo_display: 'X-P1', tipo_ronda: 'anual', numero_anterior: anterior, numero_actual: actual,
  deltas_categoria: categorias.map(([categoria, va, vb]) => ({
    categoria: categoria as 'fenologia', valor_anterior: va, valor_actual: vb,
    delta: va !== null && vb !== null ? vb - va : null, etiqueta: va !== null && vb !== null ? 'mejoro_leve' : null,
  })),
  deltas_parametro: [],
});

describe('categoriasDeRonda y compararCategorias', () => {
  const pares = [par(1, 2, [['fenologia', 0.5, 0.6], ['fruto_calidad', 0.4, null], ['produccion', null, null], ['estres', null, null]])];

  it('toma el subpuntaje de cada ronda desde los pares consecutivos', () => {
    expect(categoriasDeRonda(pares, 1)).toEqual({ fenologia: 0.5, fruto_calidad: 0.4, produccion: null, brotes: null, estres: null });
    expect(categoriasDeRonda(pares, 2)).toEqual({ fenologia: 0.6, fruto_calidad: null, produccion: null, brotes: null, estres: null });
    expect(categoriasDeRonda(pares, 3)).toBeNull();
  });

  it('une dos pares para comparar rondas no consecutivas', () => {
    const dos = [...pares, par(2, 3, [['fenologia', 0.6, 0.7], ['fruto_calidad', null, 0.5], ['produccion', null, null], ['estres', null, null]])];
    expect(categoriasDeRonda(dos, 2)?.fenologia).toBe(0.6);
    expect(categoriasDeRonda(dos, 3)?.fruto_calidad).toBe(0.5);
  });

  it('la diferencia solo existe donde las dos rondas midieron la categoría', () => {
    const a = puntaje(1, { categorias: categoriasDeRonda(pares, 1) });
    const b = puntaje(2, { categorias: categoriasDeRonda(pares, 2) });
    const filas = compararCategorias(a, b, pares);
    expect(filas.find((f) => f.categoria === 'fenologia')).toMatchObject({ diferencia: 0.1, etiqueta: 'mejoro_leve' });
    expect(filas.find((f) => f.categoria === 'fruto_calidad')).toMatchObject({ a: 0.4, b: null, diferencia: null, etiqueta: null });
    expect(filas.find((f) => f.categoria === 'produccion')).toMatchObject({ diferencia: null });
  });
});

describe('puntajeDeRonda', () => {
  const item = (extra: Partial<ItemRankingGrupos> = {}) => ({
    individuo_id: 'i1', evaluacion_id: 'e2', puntaje: 0.62, grupo: ['fenologia'], posicion_grupo: 3, tamano_grupo: 9, estado_ranking: 'comparable', ...extra,
  }) as ItemRankingGrupos;
  const congelado: PuntajeCongelado = {
    evaluacion_id: 'e1', puntaje: 0.5, grupo: ['fenologia', 'fruto_calidad'], posicion_grupo: 2, tamano_grupo: 7,
    scoring_version_nombre: 'v1', snapshot_nombre: 'Cierre 2025', congelado_at: '2026-01-15T00:00:00Z',
  };

  it('la ronda vigente sale del ranking por grupos', () => {
    expect(puntajeDeRonda({ numero: 2, evaluacionId: 'e2', pares: [], ranking: item(), rankingVersionNombre: 'v1', congelados: [congelado] }))
      .toMatchObject({ puntaje: 0.62, fuente: 'ranking', posicionGrupo: 3, tamanoGrupo: 9, versionNombre: 'v1', grupo: ['fenologia'] });
  });

  it('una ronda pasada sale del ranking congelado de esa evaluación', () => {
    expect(puntajeDeRonda({ numero: 1, evaluacionId: 'e1', pares: [], ranking: item(), rankingVersionNombre: 'v1', congelados: [congelado] }))
      .toMatchObject({ puntaje: 0.5, fuente: 'congelado', congeladoNombre: 'Cierre 2025', grupo: ['fenologia', 'fruto_calidad'] });
  });

  it('una ronda pasada que nunca se congeló queda sin puntaje (no se inventa)', () => {
    expect(puntajeDeRonda({ numero: 1, evaluacionId: 'e1', pares: [], ranking: item(), rankingVersionNombre: 'v1', congelados: [] }))
      .toMatchObject({ puntaje: null, fuente: null });
  });

  it('la ronda vigente excluida dice por qué no tiene puntaje', () => {
    const r = puntajeDeRonda({
      numero: 2, evaluacionId: 'e2', pares: [], rankingVersionNombre: 'v1', congelados: [],
      ranking: item({ puntaje: null, estado_ranking: 'excluida_revision' }),
    });
    expect(r.puntaje).toBeNull();
    expect(r.motivoSinPuntaje).toBeTruthy();
  });
});

describe('selección de rondas', () => {
  it('elegir una tercera conserva la más cercana', () => {
    expect(elegirRonda([1, 2], 3)).toEqual([2, 3]);
    expect(elegirRonda([2, 3], 1)).toEqual([1, 2]);
    expect(elegirRonda([1, 3], 2)).toEqual([1, 2]);
    expect(elegirRonda([1, 2], 2)).toEqual([1, 2]);
  });

  it('usa ?rondas= si sirve y, si no, las dos últimas con evaluación cerrada', () => {
    expect(rondasPorDefecto('1,3', [1, 2, 3])).toEqual([1, 3]);
    expect(rondasPorDefecto('3,1', [1, 2, 3])).toEqual([1, 3]);
    expect(rondasPorDefecto('1,4', [1, 2, 3])).toEqual([2, 3]);
    expect(rondasPorDefecto(null, [1, 2])).toEqual([1, 2]);
    expect(rondasPorDefecto('2,2', [1, 2])).toEqual([1, 2]);
    expect(rondasPorDefecto(null, [1])).toBeNull();
  });
});

describe('cinco categorías (scoring v2, con la categoría brotes)', () => {
  const cinco = (anterior: number, actual: number, brotes: [number | null, number | null]) =>
    par(anterior, actual, [['fenologia', 0.5, 0.6], ['fruto_calidad', 0.7, 0.8], ['produccion', 0.4, 0.5], ['brotes', brotes[0], brotes[1]], ['estres', 0.9, 0.9]]);

  it('toma brotes del par igual que las demás y lo incluye en el grupo', () => {
    const pares = [cinco(1, 2, [0.3, 0.45])];
    expect(categoriasDeRonda(pares, 1)).toEqual({ fenologia: 0.5, fruto_calidad: 0.7, produccion: 0.4, brotes: 0.3, estres: 0.9 });
    // El grupo sale en orden de presentación (por peso de la v2), no en el del enum de la base.
    expect(grupoDe(categoriasDeRonda(pares, 2))).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres']);
  });

  it('sin brotes en los datos (versión de 4 categorías) el grupo no la incluye y su diferencia no existe', () => {
    const pares = [par(1, 2, [['fenologia', 0.5, 0.6], ['fruto_calidad', 0.7, 0.8], ['produccion', 0.4, 0.5], ['estres', 0.9, 0.9]])];
    const a = puntaje(1, { categorias: categoriasDeRonda(pares, 1) });
    const b = puntaje(2, { categorias: categoriasDeRonda(pares, 2) });
    expect(grupoDe(a.categorias)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'estres']);
    const filas = compararCategorias(a, b, pares);
    expect(filas.map((f) => f.categoria)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres']);
    expect(filas.find((f) => f.categoria === 'brotes')).toMatchObject({ a: null, b: null, diferencia: null, etiqueta: null });
  });

  it('con brotes medida en las dos rondas se resta; medida en una sola, no', () => {
    const ambas = [cinco(1, 2, [0.3, 0.45])];
    const filas = compararCategorias(puntaje(1, { categorias: categoriasDeRonda(ambas, 1) }), puntaje(2, { categorias: categoriasDeRonda(ambas, 2) }), ambas);
    expect(filas.find((f) => f.categoria === 'brotes')).toMatchObject({ a: 0.3, b: 0.45, diferencia: 0.15 });
    const una = [cinco(1, 2, [null, 0.45])];
    const solo = compararCategorias(puntaje(1, { categorias: categoriasDeRonda(una, 1) }), puntaje(2, { categorias: categoriasDeRonda(una, 2) }), una);
    expect(solo.find((f) => f.categoria === 'brotes')).toMatchObject({ a: null, b: 0.45, diferencia: null });
  });

  it('dos grupos con las mismas categorías son el mismo grupo aunque lleguen en otro orden', () => {
    // La base entrega el grupo en orden del enum; grupoDe, en orden de presentación.
    expect(mismoGrupo(['fenologia', 'fruto_calidad', 'produccion', 'brotes', 'estres'], ['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres'])).toBe(true);
    expect(mismoGrupo(['fenologia', 'fruto_calidad', 'produccion', 'estres'], ['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres'])).toBe(false);
    expect(compararTotales(
      puntaje(1, { grupo: ['fenologia', 'fruto_calidad', 'produccion', 'brotes', 'estres'] }),
      puntaje(2, { grupo: ['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres'], puntaje: 0.6 }),
    )).toEqual({ resta: true, diferencia: 0.1 });
  });
});
