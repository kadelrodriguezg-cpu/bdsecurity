/**
 * Fase 4, paso 52 (20261026140000): «Cerrar temporada y congelar ranking». Solo admin; congela el ranking por grupos de la
 * temporada con el mecanismo de congelados de siempre; si ya existe en la especie, avisa (23505). Desde la fase 5 (paso 54, G2) el
 * nombre sugerido es «Temporada AAAA-AAAA+1» (las rondas de esta prueba se inician el 01-06-2026: temporada 2025-2026).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, crearVersion, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;

beforeAll(async () => {
  ctx = await iniciarContexto('fase4-cierre');
  await crearVersion(ctx, {
    nombre: `F4 cierre ${ctx.R}`, vigenteDesde: '2020-01-01', pesos: { fruto_calidad: 1 },
    metricas: [{ metrica: 'brix', categoria: 'fruto_calidad', peso: 1, min: 10, max: 20 }],
  });
  // Los congelados no incluyen cruces de prueba: este cruce es real (lo limpia el contexto).
  const cruce = await crearCruce(ctx, { codigo: `F4-CIERRE-${ctx.R}`, esPrueba: false });
  const individuos = await crearIndividuos(ctx, cruce, 5);
  for (const [n, ind] of individuos.entries()) {
    await crearEvaluacion(ctx, await crearRonda(ctx, ind.id), { brix: 12 + n }, { fecha: '2026-06-15' });
  }
  // El mínimo de plantas por grupo es configurable (valor inicial 5): con 5 individuos hay puestos.
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

describe('cerrar_temporada_ranking', () => {
  it('el operario no puede cerrar una temporada', async () => {
    const { error } = await ctx.operario.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 1 });
    expect(error?.code).toBe('42501');
  });

  it('anio_temporada da el año de la ronda', async () => {
    const { data, error } = await ctx.operario.rpc('anio_temporada', { p_especie_id: ctx.especieId, p_numero_ronda: 1 });
    expect(error).toBeNull();
    expect(data).toBe(2026);
  });

  it('el admin congela «Temporada 2025-2026» con los puestos de esa temporada y queda auditado', async () => {
    const { data, error } = await ctx.admin.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 1 });
    expect(error).toBeNull();
    const r = data as Fila;
    expect(r).toMatchObject({ nombre: 'Temporada 2025-2026', poblacion: 5 });
    const { data: snap } = await ctx.admin.from('ranking_snapshot').select('nombre, alcance, planta_id, criterios').eq('id', r.snapshot_id).single();
    expect(snap).toMatchObject({ nombre: 'Temporada 2025-2026', alcance: 'especie', planta_id: null });
    expect((snap!.criterios as Fila)).toMatchObject({ cierre_temporada: true, numero_ronda: 1, anio: 2026 });
    const { count } = await ctx.service.from('audit_log').select('id', { count: 'exact', head: true })
      .eq('usuario_id', ctx.adminId).eq('accion', 'congelacion_ranking').eq('detalle->>snapshot_id', r.snapshot_id);
    expect(count).toBe(1);
  });

  it('si ya existe ese cierre en la especie, avisa y no duplica', async () => {
    const { error } = await ctx.admin.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 1 });
    expect(error?.code).toBe('23505');
    expect(error?.message).toBe('Ya existe «Temporada 2025-2026» en esta especie');
    const { count } = await ctx.admin.from('ranking_snapshot').select('id', { count: 'exact', head: true }).eq('especie_id', ctx.especieId);
    expect(count).toBe(1);
  });

  it('una temporada sin individuos no se cierra', async () => {
    const { error } = await ctx.admin.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 3 });
    expect(error?.code).toBe('23514');
  });
});
