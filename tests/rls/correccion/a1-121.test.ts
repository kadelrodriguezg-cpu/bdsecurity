import { psqlInterno } from '../envolturas';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prepararContexto, crearCruce, crearIndividuo, cerrarRondaServicio, purgarCruces, type ContextoG5 } from '../auditoria/g5-setup';
let ctx: ContextoG5;
const cruces: string[] = [];
beforeAll(async () => { ctx = await prepararContexto('fix121', { especiePropia: true }); });
afterAll(async () => {
  await purgarCruces(ctx, cruces, { especieIds: [ctx.especieId] });
  for (const id of [ctx.operario2Id, ctx.operarioId, ctx.adminId]) expect((await ctx.service.auth.admin.deleteUser(id)).error).toBeNull();
});
it.each(['anual', 'multisitio'] as const)('%s: ambas firmas rechazan nuevas rondas archivadas, conservan el reintento y permiten restaurar', async (tipo) => {
  const planta = await crearCruce(ctx, tipo, tipo === 'anual' ? 'evaluacion_anual' : 'traslado_destino');
  cruces.push(planta);
  const individuo = await crearIndividuo(ctx, planta, tipo);
  const args = { p_individuo_id: individuo, p_tipo: tipo, p_numero_esperado: 1 };
  const primera = await ctx.operario.rpc('iniciar_ronda_esperada', args);
  expect(primera.error).toBeNull();
  expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: planta, p_tipo: 'soft' })).error).toBeNull();
  // La firma vieja ya no es ejecutable por authenticated (paso 39): se invoca con el permiso del dueño y el JWT del operario.
  const vieja = await psqlInterno(ctx.operarioId, `public.${tipo === 'anual' ? 'iniciar_ronda_evaluacion' : 'iniciar_ronda_multisitio'}('${individuo}')`);
  expect(vieja.error?.code).toBe('55000');
  const nueva = await ctx.operario.rpc('iniciar_ronda_esperada', { ...args, p_numero_esperado: 2 });
  expect(nueva.error?.code).toBe('55000');
  expect(nueva.error?.message).toContain('archivado'); // el aviso de cruce archivado precede al de ronda sin cerrar (S2-1)
  const repetida = await ctx.operario.rpc('iniciar_ronda_esperada', args);
  expect(repetida.error).toBeNull(); expect(repetida.data).toEqual(primera.data);
  const filas = await ctx.service.from('ronda_evaluacion_anual').select('id').eq('individuo_id', individuo);
  expect(filas.error).toBeNull(); expect(filas.data).toHaveLength(1);
  const audit = await ctx.service.from('audit_log').select('id').eq('planta_id', planta).eq('accion', 'creacion_ronda_evaluacion_anual');
  expect(audit.error).toBeNull(); expect(audit.data).toHaveLength(1);
  expect((await ctx.admin.rpc('restaurar_cruzamiento', { p_planta_id: planta })).error).toBeNull();
  await cerrarRondaServicio(ctx, (primera.data as { ronda_id: string }).ronda_id); // S2-1: la ronda 2 exige la 1 cerrada
  const restaurada = await ctx.operario.rpc('iniciar_ronda_esperada', { ...args, p_numero_esperado: 2 });
  expect(restaurada.error).toBeNull(); expect(restaurada.data.numero_ronda).toBe(2);
});
