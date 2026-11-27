import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepararContexto, crearCruce, crearIndividuo, cerrarRondaServicio, purgarCruces, type ContextoG5 } from '../auditoria/g5-setup';
vi.mock('../../../frontend/src/api/client', () => ({
  supabase: new Proxy({}, { get: (_target, prop) => (globalThis as unknown as { __fix063: SupabaseClient & Record<string | symbol, unknown> }).__fix063[prop] }),
  traducirError: (error: { message: string }) => new Error(error.message),
}));
import { iniciarRonda, iniciarRondaMultisitio } from '../../../frontend/src/api/rondas';
let ctx: ContextoG5;
const cruces: string[] = [];
let anual: string;
let multi: string;
beforeAll(async () => {
  ctx = await prepararContexto('fix063', { especiePropia: true });
  (globalThis as unknown as { __fix063: SupabaseClient }).__fix063 = ctx.operario;
  cruces.push(await crearCruce(ctx, 'FIX063-A', 'evaluacion_anual'), await crearCruce(ctx, 'FIX063-M', 'traslado_destino'));
  anual = await crearIndividuo(ctx, cruces[0], 'FIX063-A'); multi = await crearIndividuo(ctx, cruces[1], 'FIX063-M');
});
afterAll(async () => {
  await purgarCruces(ctx, cruces, { especieIds: [ctx.especieId] });
  for (const id of [ctx.operario2Id, ctx.operarioId, ctx.adminId]) expect((await ctx.service.auth.admin.deleteUser(id)).error).toBeNull();
});
it('repetir el número esperado de la anual recupera esa ronda sin consumir otra', async () => {
  const a = await iniciarRonda(anual, 1); const b = await iniciarRonda(anual, 1);
  expect(a).toEqual(b); expect(a.numero_ronda).toBe(1);
  const filas = await ctx.service.from('ronda_evaluacion_anual').select('id').eq('individuo_id', anual);
  expect(filas.error).toBeNull(); expect(filas.data).toHaveLength(1);
});
it('un número futuro se rechaza sin consumir cupo y dos peticiones de ronda 2 obtienen la misma', async () => {
  await expect(iniciarRonda(anual, 3)).rejects.toThrow('Las rondas cambiaron');
  // S2-1: la ronda 2 exige la 1 cerrada.
  await cerrarRondaServicio(ctx, (await iniciarRonda(anual, 1)).ronda_id);
  const [a, b] = await Promise.all([iniciarRonda(anual, 2), iniciarRonda(anual, 2)]);
  expect(a).toEqual(b); expect(a.numero_ronda).toBe(2);
  const filas = await ctx.service.from('ronda_evaluacion_anual').select('id').eq('individuo_id', anual);
  expect(filas.error).toBeNull(); expect(filas.data).toHaveLength(2);
});
it('multisitio conserva la misma garantía y no permite serie/fase equivocada ni anon', async () => {
  const a = await iniciarRondaMultisitio(multi, 1);
  expect(await iniciarRondaMultisitio(multi, 1)).toEqual(a);
  await expect(iniciarRonda(multi, 1)).rejects.toThrow('fase');
  const anon = await ctx.anon.rpc('iniciar_ronda_esperada', { p_individuo_id: anual, p_tipo: 'anual', p_numero_esperado: 1 });
  expect(anon.error?.code).toBe('42501');
});
