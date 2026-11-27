/**
 * Auditoría Corrida 1 — G6 / S01: ranking general, por parámetro y global.
 *
 * Verifica el motor (calcular_ranking_operativo) con un caso calculado a mano
 * en una versión de scoring propia de una especie aislada: pesos por
 * categoría, dirección invertida, normalización por rango_referencia con
 * valores fuera de rango, desempate, elegibilidad y motivos de exclusión,
 * paginación, filtros y orden. Compara las tres RPC que exponen el mismo
 * cálculo (obtener_ranking_operativo, obtener_ranking_global_filtrado,
 * obtener_scoring_planta) y la llamada directa al motor por un operario.
 *
 * Correr solo este archivo: npx vitest run tests/rls/auditoria/g6-ranking.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contarAuditoria,
  crearCruce,
  crearEvaluacion,
  crearIndividuos,
  crearRango,
  crearRonda,
  crearVersion,
  especieAdicional,
  iniciarContexto,
  limpiarContexto,
  redondear4,
  type ContextoG6,
  type Fila,
} from './g6-helpers';

let ctx: ContextoG6;
let versionId: string;
let plantaId: string;
let P: Record<string, { id: string; codigo_display: string }> = {};

/** Valores que empatan (puntaje esperado 0.6833). */
const EMPATE = { brotacion: 3, firmeza: 5, brix: 14, rend_kg_planta: 3, dano_calor: 1 };

/** Cálculo independiente de la fórmula documentada (Maestro 2.1). */
function esperado(v: { brotacion: number; firmeza: number; brix: number; rend_kg_planta: number; dano_calor: number }) {
  const n = (x: number, min: number, max: number) => Math.max(0, Math.min(1, (x - min) / (max - min)));
  const fenologia = n(v.brotacion, 1, 5);
  const fruto = (n(v.firmeza, 1, 5) * 4 + n(v.brix, 10, 18) * 2) / 6;
  const produccion = n(v.rend_kg_planta, 1, 5);
  const estres = Math.max(0, Math.min(1, (5 - v.dano_calor) / 4)); // dirección 'menor'
  return {
    categorias: { fenologia, fruto_calidad: fruto, produccion, estres },
    puntaje: redondear4(0.2 * fenologia + 0.4 * fruto + 0.3 * produccion + 0.1 * estres),
  };
}

beforeAll(async () => {
  ctx = await iniciarContexto('s01');
  const rangoBrix = await crearRango(ctx, { metrica: 'brix', min: 10, max: 18, limSup: 30 });
  versionId = await crearVersion(ctx, {
    nombre: `AUD-G6 S01 v1 ${ctx.R}`,
    vigenteDesde: '2026-01-01',
    pesos: { fenologia: 0.2, fruto_calidad: 0.4, produccion: 0.3, estres: 0.1 },
    metricas: [
      { metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 },
      { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 4, min: 1, max: 5 },
      { metrica: 'brix', categoria: 'fruto_calidad', peso: 2, rangoId: rangoBrix },
      { metrica: 'rend_kg_planta', categoria: 'produccion', peso: 1, min: 1, max: 5 },
      { metrica: 'dano_calor', categoria: 'estres', peso: 1, direccion: 'menor', min: 1, max: 5 },
    ],
  });
  plantaId = await crearCruce(ctx, { codigo: `AUD-G6-S01-${ctx.R}` });
  const individuos = await crearIndividuos(ctx, plantaId, 11);
  individuos.forEach((i, idx) => { P[`P${idx + 1}`] = i; });

  const ronda = async (p: string) => crearRonda(ctx, P[p].id, 1);
  // P1: valores bajos, brix bajo el rango (5 < 10).
  await crearEvaluacion(ctx, await ronda('P1'), { brotacion: 1, firmeza: 3, brix: 5, rend_kg_planta: 1, dano_calor: 3 });
  // P2, P9, P10: empate exacto; P9 con fecha distinta para el filtro por fecha.
  await crearEvaluacion(ctx, await ronda('P2'), EMPATE);
  await crearEvaluacion(ctx, await ronda('P9'), EMPATE, { fecha: '2026-07-20' });
  await crearEvaluacion(ctx, await ronda('P10'), EMPATE);
  // P3: brix sobre el rango (25 > 18) pero bajo el límite de revisión (30).
  await crearEvaluacion(ctx, await ronda('P3'), { brotacion: 5, firmeza: 1, brix: 25, rend_kg_planta: 5, dano_calor: 5 });
  // P4: falta brotacion -> evaluación parcial.
  await crearEvaluacion(ctx, await ronda('P4'), { firmeza: 5, brix: 14, rend_kg_planta: 3, dano_calor: 1 });
  // P5: brix 31 >= límite de revisión 30 -> requiere_revision (trigger validar_evaluacion_integridad).
  await crearEvaluacion(ctx, await ronda('P5'), { ...EMPATE, brix: 31 });
  // P6: solo borrador.
  await crearEvaluacion(ctx, await ronda('P6'), { firmeza: 3 }, { estado: 'borrador' });
  // P7: sin ronda.
  // P8: evaluación completa y después descartado.
  await crearEvaluacion(ctx, await ronda('P8'), EMPATE);
  const { error: errBaja } = await ctx.service.from('individuos').update({ estado_vital: 'descartado', fecha_baja: '2026-07-01' }).eq('id', P.P8.id);
  if (errBaja) throw new Error(`setup baja P8: ${errBaja.message}`);
  // P11: marcado no comparable.
  await crearEvaluacion(ctx, await ronda('P11'), { ...EMPATE, no_comparable: true });
}, 120_000);

afterAll(async () => {
  if (ctx) await limpiarContexto(ctx);
});

async function operativo(args: Record<string, unknown> = {}) {
  const { data, error } = await ctx.operario.rpc('obtener_ranking_operativo', { p_planta_id: plantaId, p_limite: 100, ...args });
  return { data: data as Fila | null, error };
}

async function global(args: Record<string, unknown> = {}) {
  const { data, error } = await ctx.operario.rpc('obtener_ranking_global_filtrado', { p_especie_id: ctx.especieId, p_planta_id: plantaId, p_limite: 100, ...args });
  return { data: data as Fila | null, error };
}

const porCodigo = (items: Fila[]) => new Map<string, Fila>(items.map((i) => [String(i.codigo_display).split('-').pop()!, i]));

describe('S01 — cálculo del motor contra un caso a mano', () => {
  it('resuelve la versión propia de la especie (no la global) y la informa', async () => {
    const { data, error } = await operativo();
    expect(error).toBeNull();
    expect(data!.scoring_version_id).toBe(versionId);
    expect(data!.criterios.alcance).toBe('cruzamiento');
  });

  it('puntaje ponderado, subpuntajes por categoría y dirección invertida coinciden con el cálculo independiente', async () => {
    const { data } = await operativo();
    const filas = porCodigo(data!.items);
    for (const [codigo, valores] of [
      ['P2', EMPATE],
      ['P1', { brotacion: 1, firmeza: 3, brix: 5, rend_kg_planta: 1, dano_calor: 3 }],
      ['P3', { brotacion: 5, firmeza: 1, brix: 25, rend_kg_planta: 5, dano_calor: 5 }],
    ] as const) {
      const fila = filas.get(codigo)!;
      const esp = esperado(valores);
      expect(fila.elegible, codigo).toBe(true);
      expect(Number(fila.puntaje_ponderado), codigo).toBe(esp.puntaje);
      for (const cat of ['fenologia', 'fruto_calidad', 'produccion', 'estres'] as const) {
        expect(Number(fila.detalle_categorias[cat]), `${codigo}.${cat}`).toBeCloseTo(esp.categorias[cat], 6);
      }
    }
    // Valores concretos del caso a mano (documentados en el informe G6).
    expect(Number(filas.get('P2')!.puntaje_ponderado)).toBe(0.6833);
    expect(Number(filas.get('P3')!.puntaje_ponderado)).toBe(0.6333);
    expect(Number(filas.get('P1')!.puntaje_ponderado)).toBe(0.1833);
  });

  it('normaliza recortando a [0, 1] y marca fuera de rango sin bloquear ni alterar la elegibilidad', async () => {
    const { data } = await operativo();
    const filas = porCodigo(data!.items);
    const brixAlto = filas.get('P3')!.detalle_metricas.brix;
    expect(brixAlto).toMatchObject({ valor: 25, normalizado: 1, fuera_rango_superior: true, fuera_rango_inferior: false });
    const brixBajo = filas.get('P1')!.detalle_metricas.brix;
    expect(brixBajo).toMatchObject({ valor: 5, normalizado: 0, fuera_rango_superior: false, fuera_rango_inferior: true });
    // Métrica con escala fija (sin rango_referencia): banderas NULL, no false.
    expect(filas.get('P2')!.detalle_metricas.firmeza).toMatchObject({ fuera_rango_superior: null, fuera_rango_inferior: null });
    // normalizar_metrica_scoring expuesta directamente: mismos recortes.
    const casos: Array<[number, number, number, 'mayor' | 'menor', number | null]> = [
      [25, 10, 18, 'mayor', 1], [5, 10, 18, 'mayor', 0], [1, 1, 5, 'menor', 1], [5, 1, 5, 'menor', 0], [15, 15, 15, 'mayor', null],
    ];
    for (const [valor, min, max, dir, esperadoN] of casos) {
      const { data: n } = await ctx.operario.rpc('normalizar_metrica_scoring', { p_valor: valor, p_minimo: min, p_maximo: max, p_direccion: dir });
      expect(n === null ? null : Number(n), `${valor} en [${min},${max}] ${dir}`).toBe(esperadoN);
    }
  });

  it('elegibilidad y motivo_exclusion por caso: parcial, revisión, no comparable, borrador, sin ronda', async () => {
    const { data } = await operativo();
    const filas = porCodigo(data!.items);
    expect(filas.get('P4')).toMatchObject({ elegible: false, puntaje_ponderado: null, motivo_exclusion: 'evaluacion_parcial_en_curso' });
    expect(filas.get('P5')).toMatchObject({ elegible: false, requiere_revision: true, motivo_exclusion: 'requiere_revision' });
    expect(filas.get('P11')).toMatchObject({ elegible: false, no_comparable: true, motivo_exclusion: 'no_comparable' });
    expect(filas.get('P6')).toMatchObject({ elegible: false, evaluacion_id: null, motivo_exclusion: 'sin_evaluacion_completa_en_ronda_actual' });
    expect(filas.get('P7')).toMatchObject({ elegible: false, numero_ronda: null, motivo_exclusion: 'sin_ronda' });
    // El descartado no está en el ranking operativo (solo vivos).
    expect(filas.has('P8')).toBe(false);
    expect(data!.total).toBe(10);
    expect(data!.poblacion_comparada).toBe(5);
  });

  it('desempate estable: empate por puntaje se resuelve por número de código (P2 < P9 < P10) y los no elegibles van al final sin posición', async () => {
    const { data } = await operativo({ p_orden: 'puntaje_desc' });
    const codigos = (data!.items as Fila[]).map((i) => String(i.codigo_display).split('-').pop());
    expect(codigos.slice(0, 5)).toEqual(['P2', 'P9', 'P10', 'P3', 'P1']);
    const filas = porCodigo(data!.items);
    expect([filas.get('P2')!.posicion, filas.get('P9')!.posicion, filas.get('P10')!.posicion, filas.get('P3')!.posicion, filas.get('P1')!.posicion]).toEqual([1, 2, 3, 4, 5]);
    for (const p of ['P4', 'P5', 'P6', 'P7', 'P11']) expect(filas.get(p)!.posicion, p).toBeNull();
    // Mismo orden con codigo_asc: numérico, no lexicográfico (P2 antes que P10).
    const porCodigoAsc = await operativo({ p_orden: 'codigo_asc' });
    const orden = (porCodigoAsc.data!.items as Fila[]).map((i) => String(i.codigo_display).split('-').pop());
    expect(orden).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P9', 'P10', 'P11']);
  });

  it('paginación: límite 100 como techo, offset, total y poblacion_comparada estables entre páginas', async () => {
    const pag = await operativo({ p_limite: 2, p_offset: 2 });
    expect(pag.error).toBeNull();
    expect((pag.data!.items as Fila[]).map((i) => String(i.codigo_display).split('-').pop())).toEqual(['P10', 'P3']);
    expect(pag.data!.total).toBe(10);
    expect(pag.data!.poblacion_comparada).toBe(5);
    const fuera = await operativo({ p_limite: 101 });
    expect(fuera.error?.code).toBe('22023');
    const vacio = await operativo({ p_limite: 5, p_offset: 50 });
    expect(vacio.data!.items).toEqual([]);
    expect(vacio.data!.total).toBe(10);
    const ordenInvalido = await operativo({ p_orden: 'puntaje_mal' });
    expect(ordenInvalido.error?.code).toBe('22023');
  });
});

describe('S01 — ranking global filtrado', () => {
  it('sin filtros coincide con el operativo (puntajes y posiciones) y añade estado_vital', async () => {
    const op = await operativo();
    const gl = await global();
    expect(gl.error).toBeNull();
    const a = porCodigo(op.data!.items);
    const b = porCodigo(gl.data!.items);
    expect(b.size).toBe(a.size);
    for (const [codigo, fila] of a) {
      expect(b.get(codigo), codigo).toMatchObject({ puntaje_ponderado: fila.puntaje_ponderado, posicion: fila.posicion, elegible: fila.elegible, motivo_exclusion: fila.motivo_exclusion, estado_vital: 'vivo' });
    }
    expect(gl.data!.criterios.alcance).toBe('especie');
  });

  it('filtro por fecha: excluye la evaluación posterior y recalcula posiciones; los sin evaluación quedan fuera del rango', async () => {
    const { data, error } = await global({ p_fecha_hasta: '2026-06-30' });
    expect(error).toBeNull();
    const filas = porCodigo(data!.items);
    expect(filas.has('P9')).toBe(false);
    expect(filas.has('P6')).toBe(false); // borrador: sin fecha de evaluación unificada
    expect(filas.has('P7')).toBe(false); // sin ronda
    expect(data!.total).toBe(7);
    expect([filas.get('P2')!.posicion, filas.get('P10')!.posicion, filas.get('P3')!.posicion, filas.get('P1')!.posicion]).toEqual([1, 2, 3, 4]);
    const invertido = await global({ p_fecha_desde: '2026-07-01', p_fecha_hasta: '2026-06-01' });
    expect(invertido.error?.code).toBe('22007');
  });

  it('filtro por estado vital: descartado con su motivo; null = todos', async () => {
    const desc = await global({ p_estado_vital: 'descartado' });
    expect(desc.error).toBeNull();
    expect(desc.data!.total).toBe(1);
    expect(desc.data!.items[0]).toMatchObject({ estado_vital: 'descartado', elegible: false, motivo_exclusion: 'individuo_descartado', puntaje_ponderado: null });
    const todos = await global({ p_estado_vital: null });
    expect(todos.data!.total).toBe(11);
    expect(todos.data!.poblacion_comparada).toBe(5);
  });

  it('valida que el cruce pertenezca a la especie y rechaza paginación fuera de rango', async () => {
    const otraEspecie = await ctx.operario.rpc('obtener_ranking_global_filtrado', { p_especie_id: '00000000-0000-0000-0000-000000000000', p_planta_id: plantaId });
    expect(otraEspecie.error?.code).toBe('22023');
    const limite = await global({ p_limite: 0 });
    expect(limite.error?.code).toBe('22023');
  });
});

describe('S01 — un solo camino de cálculo', () => {
  it('obtener_scoring_planta y la llamada directa al motor dan los mismos puntajes que obtener_ranking_operativo', async () => {
    const op = porCodigo((await operativo()).data!.items);
    const { data: planta, error } = await ctx.operario.rpc('obtener_scoring_planta', { p_planta_id: plantaId });
    expect(error).toBeNull();
    const sp = porCodigo(planta as Fila[]);
    const { data: directo, error: errDirecto } = await ctx.operario.rpc('calcular_ranking_operativo', { p_scoring_version_id: versionId, p_planta_id: plantaId });
    expect(errDirecto).toBeNull();
    const di = porCodigo(directo as Fila[]);
    expect(sp.size).toBe(op.size);
    expect(di.size).toBe(op.size);
    for (const [codigo, fila] of op) {
      expect(sp.get(codigo), `scoring_planta ${codigo}`).toMatchObject({ puntaje_ponderado: fila.puntaje_ponderado, elegible: fila.elegible, motivo_exclusion: fila.motivo_exclusion });
      expect(di.get(codigo), `motor ${codigo}`).toMatchObject({ puntaje_ponderado: fila.puntaje_ponderado, elegible: fila.elegible, motivo_exclusion: fila.motivo_exclusion });
    }
  });

  // A1-G6-03: obtener_scoring_planta desempata por codigo_display como texto
  // ("P10" < "P2"), mientras obtener_ranking_operativo y el global usan
  // codigo_display_numero. Con empate de puntaje la posición difiere entre la
  // pestaña Ranking y el Explorador de individuos de la ficha.
  it.fails('la posición de obtener_scoring_planta coincide con la de obtener_ranking_operativo ante empates (A1-G6-03)', async () => {
    const op = porCodigo((await operativo()).data!.items);
    const { data: planta } = await ctx.operario.rpc('obtener_scoring_planta', { p_planta_id: plantaId });
    const sp = porCodigo(planta as Fila[]);
    for (const codigo of ['P2', 'P9', 'P10']) {
      expect(sp.get(codigo)!.posicion, codigo).toBe(op.get(codigo)!.posicion);
    }
  });

  it('un operario puede llamar al motor sin alcance y en modo por ronda: devuelve filas de todas las especies, sin tope de página (solo max_rows=1000 lo recorta; documentado, no es linaje)', async () => {
    // PostgREST recorta cada respuesta a max_rows (1000): con datos acumulados en la base las filas de la
    // especie propia pueden quedar fuera de la primera página, así que se recorren todas las páginas.
    const filas: Fila[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await ctx.operario
        .rpc('calcular_ranking_operativo', { p_scoring_version_id: versionId, p_por_ronda: true })
        .range(desde, desde + 999);
      expect(error).toBeNull();
      const pagina = data as Fila[];
      filas.push(...pagina);
      if (pagina.length < 1000) break;
    }
    const especies = new Set(filas.map((f) => f.especie_id));
    expect(especies.has(ctx.especieId)).toBe(true);
    // Solo columnas del contrato del ranking: nada de linaje ni coordenadas.
    const claves = Object.keys(filas[0]);
    for (const prohibida of ['cruzamiento', 'mama', 'papa', 'mama_id', 'papa_id', 'latitud', 'longitud']) expect(claves).not.toContain(prohibida);
    // eslint-disable-next-line no-console
    console.info(`[G6] calcular_ranking_operativo sin alcance devolvió ${filas.length} filas de ${especies.size} especies`);
  });

  it('anon no puede ejecutar ninguna RPC de ranking', async () => {
    for (const fn of ['obtener_ranking_operativo', 'obtener_ranking_global_filtrado', 'obtener_scoring_planta', 'calcular_ranking_operativo']) {
      const { error } = await ctx.anon.rpc(fn, fn === 'obtener_scoring_planta' ? { p_planta_id: plantaId } : fn === 'calcular_ranking_operativo' ? { p_scoring_version_id: versionId } : { p_especie_id: ctx.especieId });
      expect(error, fn).not.toBeNull();
    }
  });

  it('leer el ranking no deja auditoría (lectura agregada sin linaje; se documenta)', async () => {
    const antes = await contarAuditoria(ctx, 'lectura_ranking');
    await operativo();
    expect(await contarAuditoria(ctx, 'lectura_ranking')).toBe(antes);
  });
});

describe('S01 — cruces de prueba y rangos degenerados', () => {
  // A1-G6-02: el ranking por especie, el snapshot, las series y el dashboard
  // incluyen individuos de cruces es_prueba = true. Los selectores los ocultan
  // por default y conteo_cruces_por_estado los excluye, pero el cálculo no.
  it.fails('el ranking por especie excluye los individuos de cruces de prueba (A1-G6-02)', async () => {
    const { data, error } = await ctx.operario.rpc('obtener_ranking_operativo', { p_especie_id: ctx.especieId, p_limite: 100 });
    expect(error).toBeNull();
    const filas = (data as Fila).items as Fila[];
    expect(filas.filter((f) => f.planta_id === plantaId)).toHaveLength(0);
  });

  // A1-G6-01: rango_referencia admite minimo = maximo (CHECK <=). La métrica
  // queda con normalizado NULL pero cuenta como "disponible": la evaluación es
  // elegible y el puntaje se calcula como si la métrica valiera 0, sin aviso.
  it.fails('un rango de referencia degenerado (mínimo = máximo) no produce un puntaje elegible sesgado en silencio (A1-G6-01)', async () => {
    const rangoDegenerado = await crearRango(ctx, { metrica: 'brix', min: 15, max: 15, vigenteDesde: '2020-06-01' });
    const vDegenerada = await crearVersion(ctx, {
      nombre: `AUD-G6 S01 degenerada ${ctx.R}`,
      vigenteDesde: '2026-01-01',
      estado: 'borrador',
      metricas: [
        { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 },
        { metrica: 'brix', categoria: 'fruto_calidad', peso: 1, rangoId: rangoDegenerado },
      ],
    });
    const { data, error } = await ctx.operario.rpc('calcular_ranking_operativo', { p_scoring_version_id: vDegenerada, p_planta_id: plantaId });
    expect(error).toBeNull();
    const p2 = porCodigo(data as Fila[]).get('P2')!;
    // Lo que pasa hoy: elegible = true y puntaje = (1·1 + NULL)/2 = 0.5 en vez de 1.0 (firmeza 5/5 y brix "sin normalizar").
    expect(p2.detalle_metricas.brix.normalizado).toBeNull();
    expect(p2.elegible === false || Number(p2.puntaje_ponderado) === 1).toBe(true);
  });
});

describe('S01 — rango incompleto y desempate declarado', () => {
  // A1-G6-01 (segunda forma): rango_referencia admite minimo/maximo NULL. La métrica
  // pasa a "disponible" (hay valor) pero no se normaliza: cuenta como 0 y el individuo es elegible.
  it.fails('un rango de referencia sin mínimo o máximo no produce un puntaje elegible sesgado en silencio (A1-G6-01)', async () => {
    const rangoIncompleto = await crearRango(ctx, { metrica: 'brix', min: null, max: null, vigenteDesde: '2020-07-01' });
    const vIncompleta = await crearVersion(ctx, {
      nombre: `AUD-G6 S01 incompleta ${ctx.R}`,
      vigenteDesde: '2026-01-01',
      estado: 'borrador',
      metricas: [
        { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 },
        { metrica: 'brix', categoria: 'fruto_calidad', peso: 1, rangoId: rangoIncompleto },
      ],
    });
    const { data, error } = await ctx.operario.rpc('calcular_ranking_operativo', { p_scoring_version_id: vIncompleta, p_planta_id: plantaId });
    expect(error).toBeNull();
    const p2 = porCodigo(data as Fila[]).get('P2')!;
    expect(p2.detalle_metricas.brix.normalizado).toBeNull();
    expect(p2.elegible === false || Number(p2.puntaje_ponderado) === 1).toBe(true);
  });

  // A1-G6-04: la versión declara criterio_desempate = [puntaje_desc, fecha_evaluacion_desc,
  // codigo_asc] y la respuesta lo repite en criterios.desempate, pero el orden aplicado es
  // puntaje desc + número de código (la fecha no interviene). El dashboard sí aplica la fecha.
  it('la respuesta declara el desempate de la versión (puntaje, fecha más reciente, código)', async () => {
    const { data } = await operativo();
    expect(data!.criterios.desempate).toEqual(['puntaje_desc', 'fecha_evaluacion_desc', 'codigo_asc']);
  });

  it.fails('ante un empate de puntaje gana la evaluación más reciente, como declara criterio_desempate (A1-G6-04)', async () => {
    const { data } = await operativo({ p_orden: 'puntaje_desc' });
    const orden = (data!.items as Fila[]).map((i) => String(i.codigo_display).split('-').pop());
    // P9 se evaluó el 2026-07-20; P2 y P10 el 2026-06-15. Los tres empatan en 0.6833.
    expect(orden.indexOf('P9')).toBeLessThan(orden.indexOf('P2'));
  });
});

describe('S01 — más de 100 individuos en el alcance (la pantalla pide una sola página de 100)', () => {
  // A1-G6-10: RankingGeneral/RankingParametro piden limite = 100 y no paginan. Con más de 100
  // comparables, la primera página no contiene a ningún individuo "en evaluación parcial" (los
  // no elegibles van al final) y los contadores de la pantalla se calculan sobre esas 100 filas.
  it('con 105 individuos (102 comparables y 3 parciales) la primera página trae 100 comparables y ningún parcial, pero total y población comparada dicen la verdad', async () => {
    const e = await especieAdicional(ctx, 'cien');
    await crearVersion(e, {
      nombre: `AUD-G6 S01 cien v1 ${ctx.R}`, vigenteDesde: '2026-01-01',
      pesos: { fenologia: 0.5, fruto_calidad: 0.5 },
      metricas: [
        { metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 },
        { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 },
      ],
    });
    const cruce = await crearCruce(e, { codigo: `AUD-G6-S01CIEN-${ctx.R}` });
    const ind = await crearIndividuos(e, cruce, 105);
    const { data: rondas, error: errR } = await ctx.service.from('ronda_evaluacion_anual')
      .insert(ind.map((i) => ({ individuo_id: i.id, numero_ronda: 1, anio: 2026, fecha_inicio: '2026-06-01', tipo_ronda: 'anual', created_by: ctx.adminId }))).select('id, individuo_id');
    expect(errR).toBeNull();
    const idx = new Map(ind.map((i, k) => [i.id, k]));
    const { error: errE } = await ctx.service.from('evaluaciones').insert(rondas!.map((r) => {
      const k = idx.get(r.individuo_id)!;
      return { ronda_id: r.id, fecha: '2026-06-15', estado: 'completa', created_by: ctx.adminId, cantidad_frutos: 10, peso_total_g: 100, ...(k < 102 ? { brotacion: 1 + (k % 5), firmeza: 1 + ((k + 1) % 5) } : { firmeza: 3 }) };
    }));
    expect(errE).toBeNull();
    const { data, error } = await ctx.operario.rpc('obtener_ranking_operativo', { p_especie_id: e.especieId, p_limite: 100, p_orden: 'puntaje_desc' });
    expect(error).toBeNull();
    const d = data as Fila;
    expect(d.total).toBe(105);
    expect(d.poblacion_comparada).toBe(102);
    expect(d.items).toHaveLength(100);
    expect((d.items as Fila[]).every((i) => i.elegible)).toBe(true); // los 3 parciales no están en la página que muestra la pantalla
    // Dato de producción: 711 individuos en cruces en evaluación anual -> la pantalla de la especie ya excede una página.
    const pagina2 = await ctx.operario.rpc('obtener_ranking_operativo', { p_especie_id: e.especieId, p_limite: 100, p_offset: 100 });
    expect(((pagina2.data as Fila).items as Fila[]).map((i) => i.motivo_exclusion)).toEqual([null, null, 'evaluacion_parcial_en_curso', 'evaluacion_parcial_en_curso', 'evaluacion_parcial_en_curso']);
  });
});
