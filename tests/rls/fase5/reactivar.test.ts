/**
 * Fase 5, hallazgo 6 de la guía (decisión G4): el admin reactiva una planta dada de baja, con motivo obligatorio; queda
 * auditado y en el historial de la planta (tabla reactivacion_individuo, con RLS). La baja sigue siendo irreversible por
 * cualquier otro camino.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditoriaDe, crearCruce, crearIndividuos, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;

beforeAll(async () => {
  ctx = await iniciarContexto('fase5-reactivar');
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

async function darDeBaja(individuoId: string) {
  const { error } = await ctx.admin.rpc('marcar_baja_individuo', {
    p_individuo_id: individuoId, p_estado: 'descartado', p_criterios: ['vigor'], p_nota: 'prueba', p_fecha: '2026-10-20',
    p_idempotency_key: crypto.randomUUID(),
  });
  expect(error).toBeNull();
}

async function individuo(id: string): Promise<Fila> {
  const { data } = await ctx.service.from('individuos').select('estado_vital, fecha_baja').eq('id', id).single();
  return data as Fila;
}

describe('reactivar_individuo', () => {
  it('el admin reactiva una planta dada de baja con motivo; queda en el historial y en la auditoría', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-REA-A-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    await darDeBaja(a.id);
    const { error } = await ctx.admin.rpc('reactivar_individuo', { p_individuo_id: a.id, p_motivo: 'Baja registrada por error' });
    expect(error).toBeNull();
    expect(await individuo(a.id)).toMatchObject({ estado_vital: 'vivo', fecha_baja: null });

    const { data: historial, error: e2 } = await ctx.operario.from('reactivacion_individuo').select('individuo_id, estado_anterior, fecha_baja_anterior, motivo').eq('individuo_id', a.id);
    expect(e2).toBeNull();
    expect(historial).toEqual([{ individuo_id: a.id, estado_anterior: 'descartado', fecha_baja_anterior: '2026-10-20', motivo: 'Baja registrada por error' }]);

    const filas = (await auditoriaDe(ctx, ctx.adminId, 'reactivacion_individuo')).filter((f) => f.planta_id === cruce);
    expect(filas).toHaveLength(1);
    expect(filas[0].detalle).toMatchObject({ individuo_id: a.id, estado_anterior: 'descartado', motivo: 'Baja registrada por error' });
  });

  it('el motivo es obligatorio', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-REA-B-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    await darDeBaja(a.id);
    expect((await ctx.admin.rpc('reactivar_individuo', { p_individuo_id: a.id, p_motivo: ' ' })).error?.code).toBe('22023');
    expect((await individuo(a.id)).estado_vital).toBe('descartado');
  });

  it('el operario no puede reactivar', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-REA-C-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    await darDeBaja(a.id);
    expect((await ctx.operario.rpc('reactivar_individuo', { p_individuo_id: a.id, p_motivo: 'x' })).error?.code).toBe('42501');
  });

  it('una planta viva no se «reactiva»; un cruce archivado tampoco', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-REA-D-${ctx.R}` });
    const [a, b] = await crearIndividuos(ctx, cruce, 2);
    expect((await ctx.admin.rpc('reactivar_individuo', { p_individuo_id: a.id, p_motivo: 'x' })).error?.code).toBe('23514');
    await darDeBaja(b.id);
    await ctx.service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', cruce);
    expect((await ctx.admin.rpc('reactivar_individuo', { p_individuo_id: b.id, p_motivo: 'x' })).error?.code).toBe('23514');
    await ctx.service.from('plantas').update({ eliminado_at: null }).eq('id', cruce);
  });

  it('fuera de la función la baja sigue siendo irreversible (ni el admin con un UPDATE directo)', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-REA-E-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    await darDeBaja(a.id);
    const { error } = await ctx.admin.from('individuos').update({ estado_vital: 'vivo', fecha_baja: null }).eq('id', a.id).select('id');
    expect(error).not.toBeNull();
    expect((await individuo(a.id)).estado_vital).toBe('descartado');
  });

  it('nadie escribe directo en el historial de reactivaciones', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-REA-F-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    const ins = await ctx.admin.from('reactivacion_individuo').insert({ individuo_id: a.id, estado_anterior: 'muerto', motivo: 'x' }).select('id');
    expect(ins.error).not.toBeNull();
    const anon = await ctx.anon.from('reactivacion_individuo').select('id').limit(1);
    expect(anon.error !== null || (anon.data ?? []).length === 0).toBe(true);
  });
});
