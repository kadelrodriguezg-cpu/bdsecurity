import { afterAll, beforeAll, expect, it } from 'vitest';
import { prepararContexto, crearCruce, crearIndividuo, purgarCruces, type ContextoG5, type EstadoPlanta } from '../auditoria/g5-setup';
let ctx: ContextoG5;
const cruces: string[] = [];
beforeAll(async () => { ctx = await prepararContexto('fix048', { especiePropia: true }); });
afterAll(async () => {
  await purgarCruces(ctx, cruces, { especieIds: [ctx.especieId] });
  for (const id of [ctx.operario2Id, ctx.operarioId, ctx.adminId]) expect((await ctx.service.auth.admin.deleteUser(id)).error).toBeNull();
});
const fases: EstadoPlanta[] = ['sin_empezar', 'polinizacion', 'cosecha', 'siembra_semilla', 'germinacion', 'trasplante', 'crecimiento', 'evaluacion_anual', 'traslado_destino', 'proceso_finalizado'];
it.each(fases)('clonación: fase %s aplica el acuerdo de dominio a admin y operario', async (estado) => {
  const planta = await crearCruce(ctx, estado, estado); cruces.push(planta);
  const origen = await crearIndividuo(ctx, planta, estado);
  const permitido = ['trasplante', 'crecimiento', 'evaluacion_anual', 'traslado_destino'].includes(estado);
  for (const [cliente, autor] of [[ctx.admin, ctx.adminId], [ctx.operario, ctx.operarioId]] as const) {
    const res = await cliente.from('individuos').insert({ planta_id: planta, clon_de_id: origen, created_by: autor, codigo_display: '' });
    if (permitido) expect(res.error).toBeNull();
    else expect(res.error?.code).toBe('55000');
  }
  const filas = await ctx.service.from('individuos').select('id').eq('planta_id', planta);
  expect(filas.error).toBeNull(); expect(filas.data).toHaveLength(permitido ? 3 : 1);
});
