import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepararContexto, crearCruce, crearIndividuo, purgarCruces, type ContextoG5 } from '../auditoria/g5-setup';
vi.mock('../../../frontend/src/api/client', () => ({
  supabase: new Proxy({}, { get: (_target, prop) => (globalThis as unknown as { __fix069: SupabaseClient & Record<string | symbol, unknown> }).__fix069[prop] }),
  traducirError: (error: { message: string }) => new Error(error.message),
}));
import { actualizarEvaluacion, buscarBorradorDeRonda } from '../../../frontend/src/api/rondas';
let ctx: ContextoG5;
let cruce: string;
let evaluacion: string;
let versionInicial: string;
let versionActual: string;
let ronda: string;
beforeAll(async () => {
  ctx = await prepararContexto('fix069', { especiePropia: true });
  (globalThis as unknown as { __fix069: SupabaseClient }).__fix069 = ctx.operario;
  cruce = await crearCruce(ctx, 'FIX069', 'evaluacion_anual');
  const individuo = await crearIndividuo(ctx, cruce, 'FIX069');
  const r = await iniciarRondaAnual(ctx.operario, individuo);
  expect(r.error).toBeNull(); ronda = r.data.ronda_id;
  const e = await ctx.operario.from('evaluaciones').insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'borrador', brix: 12, created_by: ctx.operarioId }).select('id,updated_at').single();
  expect(e.error).toBeNull(); evaluacion = e.data!.id; versionInicial = e.data!.updated_at;
});
afterAll(async () => { await purgarCruces(ctx, [cruce], { especieIds: [ctx.especieId] }); });
it('guarda con la versión leída y devuelve una versión nueva', async () => {
  const fila = await actualizarEvaluacion(evaluacion, { brix: 15 }, versionInicial);
  expect(Number(fila.brix)).toBe(15); expect(fila.updated_at).not.toBe(versionInicial);
  versionActual = fila.updated_at;
});
it('la segunda sesión obsoleta no sobrescribe ni anula la edición reciente', async () => {
  await expect(actualizarEvaluacion(evaluacion, { brix: 12, firmeza: 3 }, versionInicial)).rejects.toMatchObject({ name: 'ConflictoVersionEvaluacionError' });
  await expect(actualizarEvaluacion(evaluacion, { estado: 'anulada', motivo_cambio: 'descarte antiguo' }, versionInicial)).rejects.toMatchObject({ name: 'ConflictoVersionEvaluacionError' });
  const vigente = await buscarBorradorDeRonda(ronda);
  expect(Number(vigente!.brix)).toBe(15); expect(vigente!.estado).toBe('borrador');
  expect(vigente!.updated_at).toBe(versionActual);
});
it('una lectura nueva permite guardar y no se puede omitir la precondición', async () => {
  await expect(actualizarEvaluacion(evaluacion, { brix: 16 }, '')).rejects.toThrow('Falta la versión');
  const vigente = await buscarBorradorDeRonda(ronda);
  const fila = await actualizarEvaluacion(evaluacion, { brix: 16 }, vigente!.updated_at);
  expect(Number(fila.brix)).toBe(16);
});
