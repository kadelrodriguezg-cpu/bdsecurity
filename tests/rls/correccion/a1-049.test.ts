import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';
vi.mock('../../../frontend/src/api/client', () => ({
  supabase: new Proxy({}, { get: (_target, prop) => (globalThis as unknown as { __fix049: SupabaseClient & Record<string | symbol, unknown> }).__fix049[prop] }),
  traducirError: (error: { message: string }) => new Error(error.message),
  // Hotfix U-04: las escrituras piden el usuario con exigirUsuario(); aquí, el del cliente de la prueba.
  exigirUsuario: async () => {
    const { data } = await (globalThis as unknown as { __fix049: SupabaseClient }).__fix049.auth.getUser();
    if (!data.user) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    return data.user;
  },
}));
import { individualizarPlantas, clonarIndividuo } from '../../../frontend/src/api/individuos';
let ctx: Contexto;
let autor: Awaited<ReturnType<typeof usuario>>;
let especie: string;
let planta: string;
let origen: string;
const memoria = new Map<string, string>();
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: (k: string) => memoria.get(k) ?? null, setItem: (k: string, v: string) => memoria.set(k, v), removeItem: (k: string) => memoria.delete(k) });
  ctx = contexto(); autor = await usuario(ctx, 'fix049', 'operario');
  (globalThis as unknown as { __fix049: SupabaseClient }).__fix049 = autor.client;
  const e = await ctx.service.from('especies').insert({ nombre: `FIX049-${ctx.R}` }).select('id').single();
  expect(e.error).toBeNull(); especie = e.data!.id;
  const p = await ctx.service.from('plantas').insert({ especie_id: especie, codigo_sistema: `FIX049-${ctx.R}`, estado: 'trasplante', es_prueba: true }).select('id').single();
  expect(p.error).toBeNull(); planta = p.data!.id;
  const i = await autor.client.from('individuos').insert({ planta_id: planta, codigo_display: '', created_by: autor.id }).select('id').single();
  expect(i.error).toBeNull(); origen = i.data!.id;
});
afterAll(async () => {
  expect((await ctx.service.from('individuos').delete().eq('planta_id', planta)).error).toBeNull();
  expect((await ctx.service.from('plantas').delete().eq('id', planta)).error).toBeNull();
  expect((await ctx.service.from('especies').delete().eq('id', especie)).error).toBeNull();
  expect((await ctx.service.auth.admin.deleteUser(autor.id)).error).toBeNull();
  vi.unstubAllGlobals();
});
it('la API recupera el lote después de perder la respuesta sin crear individuos nuevos', async () => {
  const rpc = autor.client.rpc.bind(autor.client);
  const espia = vi.spyOn(autor.client, 'rpc').mockImplementationOnce(async (...args) => {
    const guardado = await rpc(...args); expect(guardado.error).toBeNull();
    return { ...guardado, data: null, error: { message: 'Respuesta perdida', code: 'FETCH_ERROR' } } as typeof guardado;
  });
  await expect(individualizarPlantas(planta, 3)).rejects.toThrow('Respuesta perdida');
  espia.mockRestore(); expect(memoria.size).toBe(1);
  const antes = await ctx.service.from('individuos').select('id').eq('planta_id', planta);
  expect(antes.data).toHaveLength(4);
  await expect(individualizarPlantas(planta, 4)).rejects.toThrow('cantidad original es 3');
  const recuperado = await individualizarPlantas(planta, 3);
  expect(recuperado.cantidad).toBe(3); expect(memoria.size).toBe(0);
  const despues = await ctx.service.from('individuos').select('id').eq('planta_id', planta);
  expect(despues.data).toEqual(antes.data);
});
it('la RPC serializa dos llamadas iguales y rechaza otra cantidad con la misma clave', async () => {
  const args = { p_planta_id: planta, p_cantidad: 2, p_clave: randomUUID() };
  const [a, b] = await Promise.all([autor.client.rpc('individualizar_plantas_una_vez', args), autor.client.rpc('individualizar_plantas_una_vez', args)]);
  expect(a.error).toBeNull(); expect(b.error).toBeNull(); expect(a.data).toEqual(b.data);
  expect((await autor.client.rpc('individualizar_plantas_una_vez', { ...args, p_cantidad: 3 })).error?.code).toBe('22023');
  expect((await ctx.anon.rpc('individualizar_plantas_una_vez', args)).error?.code).toBe('42501');
});
it('un clon ya insertado se recupera por UUID sin duplicarlo ni adoptar otro origen', async () => {
  const id = randomUUID();
  expect((await autor.client.from('individuos').insert({ id, planta_id: planta, clon_de_id: origen, created_by: autor.id, codigo_display: '' })).error).toBeNull();
  expect((await ctx.service.from('individuos').update({ estado_vital: 'muerto', fecha_baja: '2026-10-22' }).eq('id', origen)).error).toBeNull();
  memoria.set(`intento:usuario:${autor.id}:clonar:${origen}`, JSON.stringify({ id, solicitud: { plantaId: planta, individuoOrigenId: origen } }));
  const clon = await clonarIndividuo(origen, planta);
  expect(clon.id).toBe(id); expect(memoria.size).toBe(0);
  const clones = await ctx.service.from('individuos').select('id').eq('clon_de_id', origen);
  expect(clones.error).toBeNull(); expect(clones.data).toEqual([{ id }]);
});
it('una respuesta sin resultado no retira la clave ni anuncia éxito', async () => {
  const espia = vi.spyOn(autor.client, 'rpc').mockResolvedValueOnce({ data: null, error: null, count: null, status: 200, statusText: 'OK' });
  await expect(individualizarPlantas(planta, 1)).rejects.toThrow('No se pudo confirmar el resultado');
  espia.mockRestore(); expect(memoria.size).toBe(1);
  expect((await individualizarPlantas(planta, 1)).cantidad).toBe(1);
  expect(memoria.size).toBe(0);
});
