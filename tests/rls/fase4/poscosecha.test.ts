/**
 * Fase 4, paso 51 (20261026130000): poscosecha. Las tres lecturas (15, 30 y 45 días) se cargan en visitas distintas de la
 * misma ronda y la fotografía de la ronda las junta; el % exportable sale de la regla de la decisión 5 y es el que usa el puntaje.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, crearVersion, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;
let cruce: string;
let individuos: Array<{ id: string }>;

beforeAll(async () => {
  ctx = await iniciarContexto('fase4-poscosecha');
  // Versión propia: solo Producción, con el exportable como única métrica (0 a 100 → 0 a 1).
  await crearVersion(ctx, {
    nombre: `F4 poscosecha ${ctx.R}`, vigenteDesde: '2020-01-01',
    pesos: { produccion: 1 },
    metricas: [{ metrica: 'pct_fruta_exportable', categoria: 'produccion', peso: 1, min: 0, max: 100 }],
  });
  cruce = await crearCruce(ctx, { codigo: `F4-POS-${ctx.R}` });
  individuos = await crearIndividuos(ctx, cruce, 4);
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

async function fotografia(rondaId: string): Promise<Fila> {
  const { data, error } = await ctx.service.rpc('unificar_evaluacion_ronda', { p_ronda_id: rondaId });
  expect(error).toBeNull();
  return (data as Fila[])[0];
}

describe('poscosecha y % exportable calculado', () => {
  it('tres visitas (15, 30 y 45 días) se juntan y el exportable es el de 45 días; el puntaje lo usa', async () => {
    const ronda = await crearRonda(ctx, individuos[0].id);
    await crearEvaluacion(ctx, ronda, { pct_buen_estado_15d: 96 }, { fecha: '2026-12-15' });
    await crearEvaluacion(ctx, ronda, { pct_buen_estado_30d: 85 }, { fecha: '2026-12-30' });
    await crearEvaluacion(ctx, ronda, { pct_buen_estado_45d: 70 }, { fecha: '2027-01-14' });
    const f = await fotografia(ronda);
    expect(f).toMatchObject({ pct_buen_estado_15d: 96, pct_buen_estado_30d: 85, pct_buen_estado_45d: 70, pct_fruta_exportable: 70 });

    const { data } = await ctx.admin.rpc('obtener_ranking_por_grupos', { p_planta_id: cruce, p_incluir_pruebas: true });
    const item = ((data as Fila).items as Fila[]).find((i) => i.individuo_id === individuos[0].id)!;
    expect(Number(item.puntaje)).toBeCloseTo(0.7, 6);
  });

  it('si una lectura anterior dio 0 %, el exportable es 0 aunque falte la de 45 días', async () => {
    const ronda = await crearRonda(ctx, individuos[1].id);
    await crearEvaluacion(ctx, ronda, { pct_buen_estado_15d: 40, pct_buen_estado_30d: 0 }, { fecha: '2026-12-30' });
    expect((await fotografia(ronda)).pct_fruta_exportable).toBe(0);
  });

  it('sin la lectura de 45 días queda sin dato (no 0) y no entra al puntaje', async () => {
    const ronda = await crearRonda(ctx, individuos[2].id);
    await crearEvaluacion(ctx, ronda, { pct_buen_estado_15d: 92, pct_buen_estado_30d: 80 }, { fecha: '2026-12-30' });
    expect((await fotografia(ronda)).pct_fruta_exportable).toBeNull();
    const { data } = await ctx.admin.rpc('obtener_ranking_por_grupos', { p_planta_id: cruce, p_incluir_pruebas: true });
    const item = ((data as Fila).items as Fila[]).find((i) => i.individuo_id === individuos[2].id)!;
    expect(item.puntaje).toBeNull();
  });

  it('sin ninguna lectura conserva el exportable escrito a mano antes (histórico)', async () => {
    const ronda = await crearRonda(ctx, individuos[3].id);
    await crearEvaluacion(ctx, ronda, { pct_fruta_exportable: 64 }, { fecha: '2026-06-15' });
    expect((await fotografia(ronda)).pct_fruta_exportable).toBe(64);
  });

  it('las lecturas solo admiten 0 a 100', async () => {
    const ronda = await crearRonda(ctx, individuos[3].id, 2);
    await expect(crearEvaluacion(ctx, ronda, { pct_buen_estado_45d: 101 })).rejects.toThrow(/pct_buen_estado_45d_check/);
  });

  it('el exportable ya no se puede pedir en un protocolo; las lecturas sí', async () => {
    const malo = await ctx.admin.rpc('definir_protocolo_ronda', {
      p_planta_id: cruce, p_tipo_ronda: 'anual', p_numero_ronda: 3, p_nombre: 'Con exportable', p_descriptores: { pct_fruta_exportable: 'opcional' },
    });
    expect(malo.error?.message).toMatch(/no son descriptores del esquema: pct_fruta_exportable/);
  });
});
