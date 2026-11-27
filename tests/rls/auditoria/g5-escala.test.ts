/**
 * G5 — Escala de la evaluación anual: un cruce con 1 050 individuos vivos,
 * cada uno con su ronda 1 y una evaluación completa (el cruce más grande de
 * producción tiene unos 380 individuos; esto es ~3x y cruza el tope de 1000
 * filas de PostgREST).
 *
 * La carga se hace con SQL de superusuario y `session_replication_role =
 * replica` (sin triggers) para no ensuciar `audit_log` con ~3 000 filas
 * append-only; las LECTURAS se hacen siempre con un operario real.
 *
 * Qué se mide / demuestra:
 * - `obtener_scoring_planta` (la usa EvaluacionAnualWorkspace para saber qué
 *   individuos están «pendientes») devuelve como máximo `max_rows` = 1000
 *   filas: con 1 050 individuos los últimos 50 se cuentan como pendientes
 *   aunque estén evaluados (A1-G5-16, `it.fails`);
 * - lo mismo para `listarIndividuosDePlanta` (select directo sin paginar) y
 *   `resumen_individuos_cruce` (ResumenFinal);
 * - el ranking paginado (`obtener_ranking_operativo`) sí cubre los 1 050;
 * - tiempos de las lecturas del cruce grande (se imprimen en la salida).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  borrarVersionesScoring,
  crearCruce,
  crearVersionScoring,
  prepararContexto,
  psqlRoot,
  type ContextoG5,
} from './g5-setup';

const TOTAL = 1050;
const TOPE_POSTGREST = 1000;

let ctx: ContextoG5;
let cruce: string;
let version: string;
let codigoCruce: string;

beforeAll(async () => {
  ctx = await prepararContexto('esc', { especiePropia: true });
  cruce = await crearCruce(ctx, 'ESC', 'evaluacion_anual');
  const { data } = await ctx.service.from('plantas').select('codigo_sistema').eq('id', cruce).single();
  codigoCruce = data!.codigo_sistema as string;
  version = await crearVersionScoring(ctx, ctx.especieId, { nombre: 'escala', desde: '2026-01-01', estado: 'activa' });

  psqlRoot(`
    set session_replication_role = replica;
    insert into individuos (planta_id, codigo_display, created_by)
      select '${cruce}', '${codigoCruce}-P' || g, '${ctx.adminId}' from generate_series(1, ${TOTAL}) g;
    insert into ronda_evaluacion_anual (individuo_id, tipo_ronda, numero_ronda, anio, fecha_inicio, created_by)
      select i.id, 'anual', 1, 2026, date '2026-06-01', '${ctx.adminId}' from individuos i where i.planta_id = '${cruce}';
    insert into evaluaciones (ronda_id, fecha, estado, created_by, cantidad_frutos, peso_total_g, firmeza, brix)
      select r.id, date '2026-06-10', 'completa', '${ctx.adminId}', 10, 120, 4, 15
      from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id where i.planta_id = '${cruce}';
  `);
}, 120_000);

afterAll(async () => {
  psqlRoot(`
    set session_replication_role = replica;
    delete from evaluaciones where ronda_id in (select r.id from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id where i.planta_id = '${cruce}');
    delete from ronda_evaluacion_anual where individuo_id in (select id from individuos where planta_id = '${cruce}');
    delete from individuos where planta_id = '${cruce}';
    delete from plantas where id = '${cruce}';
  `);
  borrarVersionesScoring([version]);
  await ctx.service.from('especies').delete().eq('id', ctx.especieId);
}, 120_000);

async function medir<T>(nombre: string, fn: () => Promise<T>): Promise<{ resultado: T; ms: number }> {
  const t0 = performance.now();
  const resultado = await fn();
  const ms = Math.round(performance.now() - t0);
  // eslint-disable-next-line no-console
  console.log(`[g5-escala] ${nombre}: ${ms} ms`);
  return { resultado, ms };
}

describe('cruce con 1 050 individuos evaluados', () => {
  it('la carga quedó completa (1 050 individuos, rondas y evaluaciones)', async () => {
    const { count: individuos } = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', cruce);
    expect(individuos).toBe(TOTAL);
  });

  it('obtener_scoring_planta devuelve a lo más 1000 filas: los individuos 1001-1050 desaparecen en silencio (A1-G5-16)', async () => {
    const { resultado, ms } = await medir('obtener_scoring_planta', () => ctx.operario.rpc('obtener_scoring_planta', { p_planta_id: cruce }));
    expect(resultado.error).toBeNull();
    const filas = resultado.data as Array<{ elegible: boolean }>;
    expect(filas.length).toBe(TOPE_POSTGREST); // documenta el corte
    expect(filas.every((f) => f.elegible)).toBe(true);
    expect(ms).toBeLessThan(20_000);
  }, 60_000);

  it.fails('obtener_scoring_planta debería devolver los 1 050 individuos del cruce (A1-G5-16)', async () => {
    const { data, error } = await ctx.operario.rpc('obtener_scoring_planta', { p_planta_id: cruce });
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(TOTAL);
  }, 60_000);

  it('listarIndividuosDePlanta (select directo sin paginar) también se corta en 1000', async () => {
    const { resultado, ms } = await medir('select individuos del cruce', () =>
      ctx.operario.from('individuos').select('id, planta_id, codigo_display, clon_de_id, estado_vital, fecha_baja, created_at').eq('planta_id', cruce),
    );
    expect(resultado.error).toBeNull();
    expect(resultado.data!.length).toBe(TOPE_POSTGREST);
    expect(ms).toBeLessThan(20_000);
  });

  it('resumen_individuos_cruce (ResumenFinal) también se corta en 1000', async () => {
    const { resultado, ms } = await medir('resumen_individuos_cruce', () => ctx.operario.rpc('resumen_individuos_cruce', { p_planta_id: cruce }));
    expect(resultado.error).toBeNull();
    expect((resultado.data as unknown[]).length).toBe(TOPE_POSTGREST);
    expect(ms).toBeLessThan(20_000);
  });

  it('el ranking paginado de a 100 recorre los 1 050 individuos sin repetir ni omitir', async () => {
    const vistos = new Set<string>();
    let total: number | undefined;
    for (let offset = 0; offset < TOTAL; offset += 100) {
      const { data, error } = await ctx.operario.rpc('obtener_ranking_operativo', {
        p_planta_id: cruce, p_limite: 100, p_offset: offset, p_orden: 'puntaje_desc',
      });
      expect(error).toBeNull();
      const respuesta = data as unknown as { items?: Array<{ individuo_id: string }>; total?: number };
      for (const item of respuesta.items ?? []) vistos.add(item.individuo_id);
      total = respuesta.total ?? total;
    }
    expect(vistos.size).toBe(TOTAL);
    if (total !== undefined) expect(total).toBe(TOTAL);
  }, 120_000);

  it('la consulta pesada es una sola ida al servidor, sin N+1: las 4 lecturas del cruce grande suman menos de 20 s', async () => {
    const t0 = performance.now();
    await Promise.all([
      ctx.operario.rpc('obtener_scoring_planta', { p_planta_id: cruce }),
      ctx.operario.rpc('resumen_individuos_cruce', { p_planta_id: cruce }),
      ctx.operario.from('individuos').select('id').eq('planta_id', cruce),
      ctx.operario.rpc('obtener_ranking_operativo', { p_planta_id: cruce, p_limite: 100, p_offset: 0, p_orden: 'puntaje_desc' }),
    ]);
    const ms = Math.round(performance.now() - t0);
    // eslint-disable-next-line no-console
    console.log(`[g5-escala] apertura de la ficha (4 lecturas en paralelo): ${ms} ms`);
    expect(ms).toBeLessThan(20_000);
  }, 60_000);
});
