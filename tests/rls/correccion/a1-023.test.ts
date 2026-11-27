import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';
vi.mock('../../../frontend/src/api/client', () => ({
  supabase: new Proxy({}, { get: (_target, prop) => (globalThis as unknown as { __fix023: SupabaseClient & Record<string | symbol, unknown> }).__fix023[prop] }),
  traducirError: (error: { message: string }) => new Error(error.message),
  // Hotfix U-04: las escrituras piden el usuario con exigirUsuario(); aquí, el del cliente de la prueba.
  exigirUsuario: async () => {
    const { data } = await (globalThis as unknown as { __fix023: SupabaseClient }).__fix023.auth.getUser();
    if (!data.user) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    return data.user;
  },
}));
import { actualizarSiembra, actualizarCosecha } from '../../../frontend/src/api/fases';
let ctx: Contexto;
let autor: Awaited<ReturnType<typeof usuario>>;
let especie: string;
let planta: string;
let insumo: string;
let sustrato: string;
beforeAll(async () => {
  ctx = contexto(); autor = await usuario(ctx, 'fix023', 'operario');
  (globalThis as unknown as { __fix023: SupabaseClient }).__fix023 = autor.client;
  const e = await ctx.service.from('especies').insert({ nombre: `FIX023-${ctx.R}` }).select('id').single();
  expect(e.error).toBeNull(); especie = e.data!.id;
  const p = await ctx.service.from('plantas').insert({ especie_id: especie, codigo_sistema: `FIX023-${ctx.R}`, estado: 'siembra_semilla', es_prueba: true }).select('id').single();
  expect(p.error).toBeNull(); planta = p.data!.id;
  const i = await ctx.service.from('insumo').insert({ nombre: `FIX023-${ctx.R}`, tipo: 'otro' }).select('id').single();
  expect(i.error).toBeNull(); insumo = i.data!.id;
  const s = await ctx.service.from('sustrato').insert({ nombre: `FIX023-${ctx.R}` }).select('id').single();
  expect(s.error).toBeNull(); sustrato = s.data!.id;
});
afterAll(async () => {
  for (const [tabla, id] of [['plantas', planta], ['insumo', insumo], ['sustrato', sustrato], ['especies', especie]]) {
    expect((await ctx.service.from(tabla).delete().eq('id', id)).error).toBeNull();
  }
  expect((await ctx.service.auth.admin.deleteUser(autor.id)).error).toBeNull();
});
const entrada = () => ({ codigoSistema: `FIX023-${ctx.R}`, semillas_sembradas: 80,
  insumo_ids: [insumo], sustratos: [{ sustrato_id: sustrato, porcentaje: 60 }], protocoloEscarificacion: 'nota propia' });
async function estado() {
  const columnas = await ctx.service.from('plantas').select('semillas_sembradas').eq('id', planta).single();
  const insumos = await ctx.service.from('plantas_insumo').select('insumo_id').eq('planta_id', planta);
  const sustratos = await ctx.service.from('plantas_sustrato').select('sustrato_id,porcentaje').eq('planta_id', planta);
  const historial = await ctx.service.from('registros_evento').select('id,created_by,datos,notas').eq('planta_id', planta);
  const logs = await ctx.service.from('audit_log').select('id').eq('planta_id', planta);
  for (const respuesta of [columnas, insumos, sustratos, historial, logs]) expect(respuesta.error).toBeNull();
  return { columnas: columnas.data, insumos: insumos.data, sustratos: sustratos.data, historial: historial.data, logs: logs.data };
}
it('la API real guarda columnas, materiales e historial atribuido al usuario', async () => {
  await actualizarSiembra(planta, entrada());
  const guardado = await estado();
  expect(guardado.columnas).toEqual({ semillas_sembradas: 80 });
  expect(guardado.insumos).toEqual([{ insumo_id: insumo }]);
  expect(guardado.sustratos).toEqual([{ sustrato_id: sustrato, porcentaje: 60 }]);
  expect(guardado.historial).toHaveLength(1);
  expect(guardado.historial![0]).toMatchObject({ created_by: autor.id, notas: 'nota propia', datos: { semillas_sembradas: 80 } });
});
it('un fallo posterior a reemplazar insumos revierte columnas, ambos conjuntos, historial y auditoría', async () => {
  const antes = await estado();
  await expect(actualizarSiembra(planta, { ...entrada(), semillas_sembradas: 12, insumo_ids: [], sustratos: [{ sustrato_id: sustrato, porcentaje: 101 }] })).rejects.toThrow();
  expect(await estado()).toEqual(antes);
});
it('un insumo inexistente revierte la actualización y el borrado previo', async () => {
  const antes = await estado();
  await expect(actualizarSiembra(planta, { ...entrada(), semillas_sembradas: 15, insumo_ids: ['00000000-0000-0000-0000-000000000000'] })).rejects.toThrow();
  expect(await estado()).toEqual(antes);
});
it('anon no ejecuta la RPC ni altera materiales', async () => {
  const antes = await estado();
  const respuesta = await ctx.anon.rpc('guardar_siembra', {
    p_planta_id: planta, p_cambios: {}, p_insumo_ids: [], p_sustratos: [], p_nota: '', p_fecha: '2026-10-22',
  });
  expect(respuesta.error?.code).toBe('42501');
  expect(await estado()).toEqual(antes);
});
it('A1-189: repetir una siembra idéntica no agrega historial ni auditorías', async () => {
  const antes = await estado();
  await Promise.all([actualizarSiembra(planta, entrada()), actualizarSiembra(planta, entrada())]);
  expect(await estado()).toEqual(antes);
  await actualizarSiembra(planta, { ...entrada(), protocoloEscarificacion: 'nota nueva' });
  expect((await estado()).historial).toHaveLength(2);
});
it('A1-189: cosecha sin cambios no duplica bitácora; un cambio real sí queda registrado', async () => {
  const input = { codigoSistema: `FIX023-${ctx.R}`, fecha_cosecha: '2026-10-21', n_semillas: 80 };
  await actualizarCosecha(planta, input);
  const antes = await estado();
  await Promise.all([actualizarCosecha(planta, input), actualizarCosecha(planta, input)]);
  expect(await estado()).toEqual(antes);
  await actualizarCosecha(planta, { ...input, n_semillas: 81 });
  expect((await estado()).historial!.filter(f => 'n_semillas' in f.datos)).toHaveLength(2);
});
it('A1-189: un archivo nuevo permite crear un evento aunque las columnas no cambien', async () => {
  const antes = (await estado()).historial!.length;
  const r = await autor.client.rpc('guardar_cosecha', { p_planta_id: planta,
    p_cambios: { fecha_cosecha: '2026-10-21', n_semillas: 81 }, p_fecha_historial: '2026-10-21', p_registrar_archivo: true });
  expect(r.error).toBeNull(); expect((await estado()).historial).toHaveLength(antes + 1);
});
