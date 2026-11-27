import { psqlInterno } from '../envolturas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prepararContexto, crearCruce, purgarCruces, type ContextoG5 } from '../auditoria/g5-setup';
let ctx: ContextoG5;
let planta: string;
beforeAll(async () => { ctx = await prepararContexto('fix129', { especiePropia: true }); planta = await crearCruce(ctx, 'individualizar', 'trasplante'); });
afterAll(async () => {
  await purgarCruces(ctx, [planta], { especieIds: [ctx.especieId] });
  for (const id of [ctx.operario2Id, ctx.operarioId, ctx.adminId]) expect((await ctx.service.auth.admin.deleteUser(id)).error).toBeNull();
});
it('ambas firmas rechazan nuevas altas archivadas sin filas/audit parciales y recuperan el lote confirmado', async () => {
  const args = { p_planta_id: planta, p_cantidad: 2, p_clave: randomUUID() };
  const previo = await ctx.operario.rpc('individualizar_plantas_una_vez', args);
  expect(previo.error).toBeNull();
  expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: planta, p_tipo: 'soft' })).error).toBeNull();
  const antes = await ctx.service.from('audit_log').select('id').eq('planta_id', planta);
  expect(antes.error).toBeNull();
  // La firma vieja ya no es ejecutable por authenticated (paso 39): se invoca con el permiso del dueño y el JWT del usuario.
  for (const [cliente, usuarioId] of [[ctx.admin, ctx.adminId], [ctx.operario, ctx.operarioId]] as const) {
    expect((await psqlInterno(usuarioId, `public.individualizar_plantas('${planta}', 2)`)).error?.code).toBe('55000');
    expect((await cliente.rpc('individualizar_plantas_una_vez', { ...args, p_clave: randomUUID() })).error?.code).toBe('55000');
  }
  const recuperado = await ctx.operario.rpc('individualizar_plantas_una_vez', args);
  expect(recuperado.error).toBeNull(); expect(recuperado.data).toEqual(previo.data);
  const despues = await ctx.service.from('audit_log').select('id').eq('planta_id', planta);
  expect(despues.error).toBeNull(); expect(despues.data).toEqual(antes.data);
  const filas = await ctx.service.from('individuos').select('id').eq('planta_id', planta);
  expect(filas.error).toBeNull(); expect(filas.data).toHaveLength(2);
  expect((await ctx.admin.rpc('restaurar_cruzamiento', { p_planta_id: planta })).error).toBeNull();
  expect((await ctx.operario.rpc('individualizar_plantas_una_vez', { ...args, p_clave: randomUUID() })).error).toBeNull();
});
