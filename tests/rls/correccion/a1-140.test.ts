import { afterAll, beforeAll, expect, it } from 'vitest';
import { prepararContexto, crearCruce, crearIndividuo, crearRondaServicio, purgarCruces, type ContextoG5 } from '../auditoria/g5-setup';
let ctx: ContextoG5;
const cruces: string[] = [];
beforeAll(async () => { ctx = await prepararContexto('fix140', { especiePropia: true }); });
afterAll(async () => {
  await purgarCruces(ctx, cruces, { especieIds: [ctx.especieId] });
  for (const id of [ctx.operario2Id, ctx.operarioId, ctx.adminId]) expect((await ctx.service.auth.admin.deleteUser(id)).error).toBeNull();
});
it.each([
  ['anual', 'archivado'], ['anual', 'fase'], ['anual', 'baja'],
  ['multisitio', 'archivado'], ['multisitio', 'fase'], ['multisitio', 'baja'],
] as const)('%s / %s: no crea ni cambia evaluaciones, conserva lectura y auditoría', async (tipo, condicion) => {
  const planta = await crearCruce(ctx, `${tipo}-${condicion}`, tipo === 'anual' ? 'evaluacion_anual' : 'traslado_destino'); cruces.push(planta);
  const individuo = await crearIndividuo(ctx, planta, `${tipo}-${condicion}`);
  const ronda = await crearRondaServicio(ctx, individuo, { tipo });
  const creada = await ctx.operario.from('evaluaciones').insert({ ronda_id: ronda, created_by: ctx.operarioId, fecha: '2026-10-01', estado: 'borrador', brix: 10 }).select('*').single();
  expect(creada.error).toBeNull();
  if (condicion === 'baja') expect((await ctx.service.from('individuos').update({ estado_vital: 'muerto', fecha_baja: '2026-10-22' }).eq('id', individuo)).error).toBeNull();
  else expect((await ctx.service.from('plantas').update(condicion === 'archivado' ? { eliminado_at: new Date().toISOString() } : { estado: 'proceso_finalizado' }).eq('id', planta)).error).toBeNull();
  const antes = await ctx.service.from('audit_log').select('id').eq('planta_id', planta).order('id');
  expect(antes.error).toBeNull();
  for (const [cliente, autor] of [[ctx.operario, ctx.operarioId], [ctx.admin, ctx.adminId]] as const) {
    const alta = await cliente.from('evaluaciones').insert({ ronda_id: ronda, created_by: autor, fecha: '2026-10-02', estado: 'borrador' });
    expect(alta.error?.code).toBe(condicion === 'baja' ? '42501' : '55000');
    const editar = await cliente.from('evaluaciones').update({ brix: 18 }).eq('id', creada.data!.id);
    expect(editar.error?.code).toBe(condicion === 'baja' ? '42501' : '55000');
  }
  const filas = await ctx.service.from('evaluaciones').select('*').eq('ronda_id', ronda);
  expect(filas.error).toBeNull(); expect(filas.data).toEqual([creada.data]);
  const lectura = await ctx.operario.from('evaluaciones').select('id,brix').eq('id', creada.data!.id).single();
  expect(lectura.error).toBeNull(); expect(lectura.data?.brix).toBe(10);
  const despues = await ctx.service.from('audit_log').select('id').eq('planta_id', planta).order('id');
  expect(despues.error).toBeNull(); expect(despues.data).toEqual(antes.data);
});
