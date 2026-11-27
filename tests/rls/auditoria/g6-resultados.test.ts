/**
 * Auditoría Corrida 1 — G6 / S05: comparación de rondas, series históricas
 * (SECURITY DEFINER) y dashboard científico.
 *
 * Caso calculado a mano en una especie propia con una versión de dos métricas
 * (brotación 50 % fenología, firmeza 50 % fruto/calidad; escala 1-5).
 *
 * Correr solo este archivo: npx vitest run tests/rls/auditoria/g6-resultados.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce,
  crearEvaluacion,
  crearIndividuos,
  crearRonda,
  crearVersion,
  especieAdicional,
  iniciarContexto,
  limpiarContexto,
  type ContextoG6,
  type Fila,
} from './g6-helpers';

let raiz: ContextoG6;
let ctx: ContextoG6;
let v1: string;
let cruce: string;
let I: Record<string, { id: string; codigo_display: string }> = {};

const sufijo = (codigo: string) => String(codigo).split('-').pop()!;

async function crearVersionDosMetricas(c: ContextoG6, nombre: string) {
  return crearVersion(c, {
    nombre,
    vigenteDesde: '2026-01-01',
    pesos: { fenologia: 0.5, fruto_calidad: 0.5 },
    metricas: [
      { metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 },
      { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 },
    ],
  });
}

async function series(cliente: ContextoG6['operario'], args: Record<string, unknown>) {
  const { data, error } = await cliente.rpc('obtener_series_historicas_cientificas', args);
  return { data: data as Fila, error };
}

beforeAll(async () => {
  raiz = await iniciarContexto('s05');
  ctx = await especieAdicional(raiz, 'res');
  v1 = await crearVersionDosMetricas(ctx, `AUD-G6 S05 v1 ${raiz.R}`);
  cruce = await crearCruce(ctx, { codigo: `AUD-G6-S05-${raiz.R}` });
  const ind = await crearIndividuos(ctx, cruce, 6);
  I = { X: ind[0], Y: ind[1], Z: ind[2], W: ind[3], T: ind[4], U: ind[5] };

  // X: anual 1 (marzo) 0.5 -> anual 2 (septiembre) fenología +0.25.
  const xr1 = await crearRonda(ctx, I.X.id, 1);
  await crearEvaluacion(ctx, xr1, { brotacion: 3, firmeza: 3 }, { fecha: '2026-03-10' });
  const xr2 = await crearRonda(ctx, I.X.id, 2);
  await crearEvaluacion(ctx, xr2, { brotacion: 4, firmeza: 3 }, { fecha: '2026-09-10' });
  // Y: anual 1 (marzo) 1.0; anual 2 marcada no comparable (queda fuera de comparaciones y del ranking).
  await crearEvaluacion(ctx, await crearRonda(ctx, I.Y.id, 1), { brotacion: 5, firmeza: 5 }, { fecha: '2026-03-20' });
  await crearEvaluacion(ctx, await crearRonda(ctx, I.Y.id, 2), { brotacion: 5, firmeza: 5, no_comparable: true }, { fecha: '2026-09-15' });
  // Z: anual 1 (mayo) 0.0.
  await crearEvaluacion(ctx, await crearRonda(ctx, I.Z.id, 1), { brotacion: 1, firmeza: 1 }, { fecha: '2026-05-05' });
  // W: anual 1 (abril) 0.5 y dos rondas multisitio (abril) 1.0 -> 0.5.
  await crearEvaluacion(ctx, await crearRonda(ctx, I.W.id, 1), { brotacion: 3, firmeza: 3 }, { fecha: '2026-04-12' });
  await crearEvaluacion(ctx, await crearRonda(ctx, I.W.id, 1, 'multisitio'), { brotacion: 5, firmeza: 5 }, { fecha: '2026-04-10' });
  await crearEvaluacion(ctx, await crearRonda(ctx, I.W.id, 2, 'multisitio'), { brotacion: 3, firmeza: 3 }, { fecha: '2026-04-20' });
  // T: sin ronda. U: solo borrador.
  await crearEvaluacion(ctx, await crearRonda(ctx, I.U.id, 1), { brotacion: 3 }, { estado: 'borrador' });
}, 120_000);

afterAll(async () => {
  if (raiz) await limpiarContexto(raiz);
});

describe('S05 — obtener_comparacion_rondas', () => {
  it('calcula a mano los deltas por categoría y por métrica entre rondas consecutivas del mismo tipo', async () => {
    const { data, error } = await raiz.operario.rpc('obtener_comparacion_rondas', { p_individuo_id: I.X.id });
    expect(error).toBeNull();
    const c = data as Fila;
    expect(c.umbrales).toMatchObject({ leve: 0.05, marcado: 0.15 });
    expect(c.individuos).toHaveLength(1);
    const x = c.individuos[0];
    expect(x).toMatchObject({ individuo_id: I.X.id, tipo_ronda: 'anual', numero_anterior: 1, numero_actual: 2 });
    const cat = new Map<string, Fila>(x.deltas_categoria.map((d: Fila) => [d.categoria, d]));
    expect(cat.get('fenologia')).toMatchObject({ valor_anterior: 0.5, valor_actual: 0.75, delta: 0.25, etiqueta: 'mejoro_marcado' });
    expect(cat.get('fruto_calidad')).toMatchObject({ valor_anterior: 0.5, valor_actual: 0.5, delta: 0, etiqueta: 'estable' });
    // Las categorías sin ninguna métrica configurada devuelven delta NULL (nunca 0).
    expect(cat.get('produccion')).toMatchObject({ valor_anterior: null, valor_actual: null, delta: null, etiqueta: null });
    const par = new Map<string, Fila>(x.deltas_parametro.map((d: Fila) => [d.metrica, d]));
    expect(par.get('brotacion')).toMatchObject({ valor_anterior: 3, valor_actual: 4, normalizado_anterior: 0.5, normalizado_actual: 0.75, delta: 0.25, etiqueta: 'mejoro_marcado' });
    expect(par.get('firmeza')).toMatchObject({ delta: 0, etiqueta: 'estable' });
  });

  it('nunca mezcla series: la multisitio se compara sola; una ronda no comparable o sin pareja no genera delta', async () => {
    const { data } = await raiz.operario.rpc('obtener_comparacion_rondas', { p_planta_id: cruce });
    const c = data as Fila;
    const pares = c.individuos.map((i: Fila) => `${sufijo(i.codigo_display)}:${i.tipo_ronda}:${i.numero_anterior}->${i.numero_actual}`);
    // X anual 1->2 y W multisitio 1->2. Y (ronda 2 no comparable), Z, T y U no tienen par.
    expect(pares).toEqual(['P1:anual:1->2', 'P4:multisitio:1->2']);
    const w = c.individuos.find((i: Fila) => sufijo(i.codigo_display) === 'P4');
    const catW = new Map<string, Fila>(w.deltas_categoria.map((d: Fila) => [d.categoria, d]));
    expect(catW.get('fenologia')).toMatchObject({ valor_anterior: 1, valor_actual: 0.5, delta: -0.5, etiqueta: 'empeoro_marcado' });
  });

  it('exige exactamente un individuo o un cruce; anon no puede; un individuo dado de baja desaparece de la comparación', async () => {
    const ninguno = await raiz.operario.rpc('obtener_comparacion_rondas', {});
    expect(ninguno.error?.code).toBe('22023');
    const ambos = await raiz.operario.rpc('obtener_comparacion_rondas', { p_individuo_id: I.X.id, p_planta_id: cruce });
    expect(ambos.error?.code).toBe('22023');
    const anon = await raiz.anon.rpc('obtener_comparacion_rondas', { p_individuo_id: I.X.id });
    expect(anon.error).not.toBeNull();
    const inexistente = await raiz.operario.rpc('obtener_comparacion_rondas', { p_individuo_id: '00000000-0000-0000-0000-000000000000' });
    expect(inexistente.error).toBeNull();
    expect((inexistente.data as Fila).individuos).toEqual([]);
    expect((inexistente.data as Fila).umbrales).toBeNull();
  });

  it('etiquetar_delta respeta los bordes: <0.05 estable, [0.05, 0.15) leve, >=0.15 marcado, signo y NULL', async () => {
    const casos: Array<[number | null, string | null]> = [
      [0.049, 'estable'], [-0.049, 'estable'], [0.05, 'mejoro_leve'], [-0.05, 'empeoro_leve'],
      [0.149, 'mejoro_leve'], [0.15, 'mejoro_marcado'], [-0.15, 'empeoro_marcado'], [null, null],
    ];
    for (const [delta, esperada] of casos) {
      const { data, error } = await raiz.operario.rpc('etiquetar_delta', { p_delta: delta, p_umbral_leve: 0.05, p_umbral_marcado: 0.15 });
      expect(error).toBeNull();
      expect(data, String(delta)).toBe(esperada);
    }
  });
});

describe('S05 — obtener_series_historicas_cientificas (SECURITY DEFINER)', () => {
  const RANGO = { p_fecha_desde: '2026-01-01', p_fecha_hasta: '2026-10-31' };

  it('promedia por mes las rondas unificadas elegibles y cuenta individuos vivos; excluye la ronda no comparable', async () => {
    const { data, error } = await series(raiz.operario, { p_especie_id: ctx.especieId, ...RANGO });
    expect(error).toBeNull();
    expect(data.scoring).toHaveLength(10); // enero a octubre
    const mes = (n: string) => data.scoring.find((s: Fila) => s.periodo === `2026-${n}-01`);
    expect(mes('01')).toMatchObject({ evaluaciones_elegibles: 0, puntaje_promedio: null });
    // Marzo: X r1 (0.5) y Y r1 (1.0) -> 0.75
    expect(mes('03')).toMatchObject({ evaluaciones_elegibles: 2 });
    expect(Number(mes('03').puntaje_promedio)).toBe(0.75);
    // Mayo: Z (0.0)
    expect(mes('05')).toMatchObject({ evaluaciones_elegibles: 1 });
    expect(Number(mes('05').puntaje_promedio)).toBe(0);
    // Septiembre: X r2 (0.625); Y r2 no comparable queda fuera.
    expect(mes('09')).toMatchObject({ evaluaciones_elegibles: 1 });
    expect(Number(mes('09').puntaje_promedio)).toBe(0.625);
    // Individuos vivos: los 6 se crearon hoy (created_at), así que en los meses anteriores cuentan 0.
    expect(data.individuos_vivos.find((v: Fila) => v.periodo === '2026-03-01').cantidad).toBe(0);
    // Y en el mes de hoy cuentan los 6. Ese mes se pide aparte: el RANGO fijo dejó de
    // contenerlo al pasar octubre de 2026 (la prueba se escribió en octubre).
    const hoy = new Date();
    // En UTC, como created_at en la base local, para no cruzar de mes en la noche del último día.
    const mesHoy = `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const actual = await series(raiz.operario, {
      p_especie_id: ctx.especieId, p_fecha_desde: mesHoy, p_fecha_hasta: hoy.toISOString().slice(0, 10),
    });
    expect(actual.error).toBeNull();
    expect(actual.data.individuos_vivos.find((v: Fila) => v.periodo === mesHoy).cantidad).toBe(6);
  });

  it('operario y admin reciben exactamente lo mismo: la función DEFINER no expone nada que dependa del rol ni columnas de linaje', async () => {
    const a = await series(raiz.operario, { p_especie_id: ctx.especieId, ...RANGO });
    const b = await series(raiz.admin, { p_especie_id: ctx.especieId, ...RANGO });
    expect(a.data).toEqual(b.data);
    expect(Object.keys(a.data).sort()).toEqual(['especie_id', 'fecha_desde', 'fecha_hasta', 'individuos_vivos', 'planta_id', 'procedimientos', 'scoring']);
    expect(JSON.stringify(a.data)).not.toMatch(/"(mama|papa|cruzamiento|genetica_a)/);
  });

  it('valida especie, rango de fechas y pertenencia del cruce; anon no puede; un cruce archivado devuelve ceros', async () => {
    expect((await series(raiz.operario, { p_especie_id: null })).error?.code).toBe('23502');
    expect((await series(raiz.operario, { p_especie_id: ctx.especieId, p_fecha_desde: '2026-06-01', p_fecha_hasta: '2026-01-01' })).error?.code).toBe('22007');
    const otra = await especieAdicional(raiz, 'otra');
    expect((await series(raiz.operario, { p_especie_id: otra.especieId, p_planta_id: cruce })).error?.code).toBe('23503');
    expect((await series(raiz.anon, { p_especie_id: ctx.especieId })).error).not.toBeNull();
    const archivado = await crearCruce(ctx, { codigo: `AUD-G6-S05ARCH-${raiz.R}`, eliminado: true });
    const r = await series(raiz.operario, { p_especie_id: ctx.especieId, p_planta_id: archivado, ...RANGO });
    expect(r.error).toBeNull();
    expect(r.data.scoring.every((s: Fila) => s.evaluaciones_elegibles === 0)).toBe(true);
    expect(r.data.individuos_vivos.every((v: Fila) => v.cantidad === 0)).toBe(true);
  });

  it('sin fechas usa los últimos 12 meses (13 puntos mensuales)', async () => {
    const { data } = await series(raiz.operario, { p_especie_id: ctx.especieId });
    expect(data.scoring.length).toBeGreaterThanOrEqual(12);
    expect(data.scoring.length).toBeLessThanOrEqual(13);
  });

  // A1-G6-08: el ranking y las comparaciones solo consideran rondas 'anual'; la serie promedia
  // también las multisitio, de modo que un individuo evaluado en varios sitios pesa más que otro.
  it.fails('la serie de scoring cuenta solo rondas anuales, como el ranking (A1-G6-08)', async () => {
    const { data } = await series(raiz.operario, { p_especie_id: ctx.especieId, ...RANGO });
    const abril = data.scoring.find((s: Fila) => s.periodo === '2026-04-01');
    // Abril: W anual (0.5) + W multisitio r1 (1.0) + W multisitio r2 (0.5). Solo anual => 1 ronda, 0.5.
    expect(abril.evaluaciones_elegibles).toBe(1);
    expect(Number(abril.puntaje_promedio)).toBe(0.5);
  });

  // A1-G6-02: series y dashboard cuentan cruces es_prueba.
  it.fails('la serie excluye los cruces de prueba (A1-G6-02)', async () => {
    const { data } = await series(raiz.operario, { p_especie_id: ctx.especieId, ...RANGO });
    expect(data.scoring.every((s: Fila) => s.evaluaciones_elegibles === 0)).toBe(true);
  });

  it('una evaluación con fecha ANTERIOR a la vigencia del scoring puntúa en el ranking pero no en la serie (ronda sin versión sellada) — A1-G6-06', async () => {
    const e = await especieAdicional(raiz, 'antes');
    const vA = await crearVersionDosMetricas(e, `AUD-G6 S05 antes v1 ${raiz.R}`);
    const c = await crearCruce(e, { codigo: `AUD-G6-S05B-${raiz.R}` });
    const ind = await crearIndividuos(e, c, 1);
    const ronda = await crearRonda(e, ind[0].id, 1);
    await crearEvaluacion(e, ronda, { brotacion: 5, firmeza: 5 }, { fecha: '2025-11-15' }); // vigente_desde = 2026-01-01
    const { data: r } = await raiz.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', ronda).single();
    expect(r!.scoring_version_id).toBeNull(); // el resolutor no encontró versión para esa fecha: la ronda no se sella
    const { data: ranking } = await raiz.operario.rpc('obtener_ranking_operativo', { p_planta_id: c });
    expect((ranking as Fila).items[0]).toMatchObject({ elegible: true, scoring_version_id: vA });
    expect(Number((ranking as Fila).items[0].puntaje_ponderado)).toBe(1);
    const s = await series(raiz.operario, { p_especie_id: e.especieId, p_fecha_desde: '2025-10-01', p_fecha_hasta: '2025-12-31' });
    const nov = s.data.scoring.find((x: Fila) => x.periodo === '2025-11-01');
    expect(nov).toMatchObject({ evaluaciones_elegibles: 0, puntaje_promedio: null }); // la serie no la ve
    // Como no queda sellada, la versión sigue sin estar "en uso": su configuración se puede editar bajo el ranking.
    const { data: enUso } = await raiz.operario.rpc('scoring_version_en_uso', { p_version_id: vA });
    expect(enUso).toBe(false);
  });
});

describe('S05 — obtener_dashboard_cientifico', () => {
  async function dash(cliente: ContextoG6['operario'], args: Record<string, unknown> = {}) {
    const { data, error } = await cliente.rpc('obtener_dashboard_cientifico', { p_especie_id: ctx.especieId, ...args });
    return { data: data as Fila, error };
  }

  it('resumen, destacados y pendientes coinciden con el cálculo a mano', async () => {
    // Desde 20261024090000 el panel excluye los cruces de prueba: el cálculo se hace con el cruce como real.
    await raiz.service.from('plantas').update({ es_prueba: false }).eq('id', cruce);
    const { data, error } = await dash(raiz.operario).finally(() => raiz.service.from('plantas').update({ es_prueba: true }).eq('id', cruce));
    expect(error).toBeNull();
    expect(data.scoring_version_id).toBe(v1);
    expect(data.resumen).toMatchObject({ cruces_activos: 1, individuos_vivos: 6, evaluaciones_ultimos_30_dias: 8, procedimientos_pendientes: 0, cruces_con_pendientes: 1 });
    // Elegibles: X (0.625), W (0.5), Z (0.0).
    // Pendientes (v3 N26, como la planilla: vivos sin evaluación cerrada en la última ronda anual, la 2): Z y W (no
    // tienen ronda 2), T (sin ronda), U (borrador). X e Y cerraron la ronda 2 (la de Y, aunque no comparable).
    expect(data.destacados.map((d: Fila) => [sufijo(d.codigo_display), Number(d.puntaje_ponderado)])).toEqual([['P1', 0.625], ['P4', 0.5], ['P3', 0]]);
    expect(data.pendientes).toEqual([{ planta_id: cruce, codigo_sistema: `AUD-G6-S05-${raiz.R}`, estado: 'evaluacion_anual', individuos_pendientes: 4 }]);
  });

  it('el límite acota destacados y listas (1 a 25) y fuera de rango se rechaza; anon no puede', async () => {
    const uno = await dash(raiz.operario, { p_limite: 1 });
    expect(uno.data.destacados).toHaveLength(1);
    expect(uno.data.cambios_recientes.length).toBeLessThanOrEqual(1);
    for (const limite of [0, 26, -1]) expect((await dash(raiz.operario, { p_limite: limite })).error?.code, String(limite)).toBe('22023');
    expect((await dash(raiz.anon)).error).not.toBeNull();
  });

  it('sin especie devuelve el resumen global sin destacados ni versión', async () => {
    const { data, error } = await raiz.operario.rpc('obtener_dashboard_cientifico', {});
    expect(error).toBeNull();
    expect((data as Fila).destacados).toEqual([]);
    expect((data as Fila).scoring_version_id).toBeNull();
    expect((data as Fila).resumen.cruces_activos).toBeGreaterThanOrEqual(1);
  });

  // A1-G6-04: el dashboard desempata por fecha de evaluación (como declara la versión) pero la
  // pestaña Ranking desempata por código; con un empate, el "mejor individuo" cambia de pantalla.
  it.fails('Dashboard y Ranking ordenan igual a los individuos empatados (A1-G6-04)', async () => {
    const e = await especieAdicional(raiz, 'empate');
    await crearVersionDosMetricas(e, `AUD-G6 S05 empate v1 ${raiz.R}`);
    const c = await crearCruce(e, { codigo: `AUD-G6-S05E-${raiz.R}` });
    const ind = await crearIndividuos(e, c, 2);
    await crearEvaluacion(e, await crearRonda(e, ind[0].id), { brotacion: 3, firmeza: 3 }, { fecha: '2026-06-01' });
    await crearEvaluacion(e, await crearRonda(e, ind[1].id), { brotacion: 3, firmeza: 3 }, { fecha: '2026-08-01' });
    const { data: tablero } = await raiz.operario.rpc('obtener_dashboard_cientifico', { p_especie_id: e.especieId });
    const { data: ranking } = await raiz.operario.rpc('obtener_ranking_operativo', { p_planta_id: c });
    const primeroDashboard = sufijo((tablero as Fila).destacados[0].codigo_display);
    const primeroRanking = sufijo((ranking as Fila).items[0].codigo_display);
    expect(primeroDashboard).toBe(primeroRanking);
  });

  // A1-G6-02: corregido en el panel por 20261024090000 (v3). Solo un admin que lo pide los ve.
  it('el dashboard por especie excluye los cruces de prueba (A1-G6-02)', async () => {
    expect((await dash(raiz.operario)).data.resumen.cruces_activos).toBe(0);
    expect((await dash(raiz.operario, { p_incluir_pruebas: true })).data.resumen.cruces_activos).toBe(0);
    expect((await dash(raiz.admin, { p_incluir_pruebas: true })).data.resumen.cruces_activos).toBe(1);
  });

  // A1-G6-13: para un admin, los registros de campo eliminados (soft delete) cuentan como
  // actividad reciente; para un operario no (RLS los oculta). Mismo dashboard, dos verdades.
  it.fails('los registros de campo eliminados no cuentan como actividad reciente para nadie (A1-G6-13)', async () => {
    const e = await especieAdicional(raiz, 'borrado');
    await crearVersionDosMetricas(e, `AUD-G6 S05 borrado v1 ${raiz.R}`);
    const c = await crearCruce(e, { codigo: `AUD-G6-S05D-${raiz.R}` });
    const manana = new Date(Date.now() + 86_400_000).toISOString();
    const { error } = await raiz.service.from('registros_evento').insert({ planta_id: c, tipo_evento: 'otro', notas: 'eliminado', created_by: raiz.adminId, created_at: manana, eliminado_at: new Date().toISOString() });
    expect(error).toBeNull();
    const comoAdmin = (await raiz.admin.rpc('obtener_dashboard_cientifico', { p_especie_id: e.especieId })).data as Fila;
    const comoOperario = (await raiz.operario.rpc('obtener_dashboard_cientifico', { p_especie_id: e.especieId })).data as Fila;
    expect(comoOperario.cambios_recientes[0].tipo).toBe('cambio_etapa'); // el operario no ve el registro eliminado
    expect(comoAdmin.cambios_recientes[0].tipo).toBe(comoOperario.cambios_recientes[0].tipo);
  });
});
