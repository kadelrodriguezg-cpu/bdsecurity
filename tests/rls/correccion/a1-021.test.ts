import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';
vi.mock('../../../frontend/src/api/client', () => ({
  supabase: new Proxy({}, { get: (_target, prop) => (globalThis as unknown as { __fix021: SupabaseClient & Record<string | symbol, unknown> }).__fix021[prop] }),
  traducirError: (error: { message: string }) => new Error(error.message),
}));
import { crearPlanta } from '../../../frontend/src/api/plantas';
let ctx: Contexto;
let admin: Awaited<ReturnType<typeof usuario>>;
let operario: Awaited<ReturnType<typeof usuario>>;
let especie: string;
let variedades: string[];
const intento = randomUUID();
const como = (cliente: SupabaseClient) => { (globalThis as unknown as { __fix021: SupabaseClient }).__fix021 = cliente; };
beforeAll(async () => {
  ctx = contexto(); admin = await usuario(ctx, 'fix021admin', 'admin'); operario = await usuario(ctx, 'fix021op', 'operario');
  const e = await ctx.service.from('especies').insert({ nombre: `FIX021-${ctx.R}` }).select('id').single();
  expect(e.error).toBeNull(); especie = e.data!.id;
  const v = await ctx.service.from('variedades').insert([1, 2].map(n => ({ especie_id: especie, nombre: `FIX021-${ctx.R}-${n}` }))).select('id');
  expect(v.error).toBeNull(); variedades = v.data!.map(f => f.id);
  como(admin.client);
});
afterAll(async () => {
  expect((await ctx.service.from('plantas').delete().eq('especie_id', especie)).error).toBeNull();
  expect((await ctx.service.from('variedades').delete().eq('especie_id', especie)).error).toBeNull();
  expect((await ctx.service.from('especies').delete().eq('id', especie)).error).toBeNull();
  for (const u of [operario, admin]) expect((await ctx.service.auth.admin.deleteUser(u.id)).error).toBeNull();
});
const entrada = () => ({ intentoId: intento, codigo_sistema: `FIX021-${ctx.R}`, especie_id: especie, esPrueba: true });
it('un reintento por UUID recupera el mismo cruce sin pisar linaje ni crear el código editado', async () => {
  const creado = await crearPlanta({ ...entrada(), mamaId: variedades[0], papaId: variedades[1] });
  const repetido = await crearPlanta({ ...entrada(), codigo_sistema: `FIX021-${ctx.R}-EDITADO` });
  expect(repetido).toEqual(creado);
  expect(Object.keys(repetido).sort()).toEqual(['codigo_sistema', 'id']);
  const filas = await ctx.service.from('plantas').select('id,mama_id,papa_id').eq('especie_id', especie);
  expect(filas.error).toBeNull(); expect(filas.data).toHaveLength(1);
  expect(filas.data![0]).toMatchObject({ id: intento, mama_id: variedades[0], papa_id: variedades[1] });
});
it('un código de otro intento no se adopta ni se duplica', async () => {
  await expect(crearPlanta({ ...entrada(), intentoId: randomUUID() })).rejects.toThrow();
});
it('conocer el UUID no permite a un operario saltarse INSERT de admin', async () => {
  como(operario.client);
  await expect(crearPlanta(entrada())).rejects.toThrow();
  como(admin.client);
});
it('dos envíos simultáneos del mismo intento dejan un solo cruce', async () => {
  const id = randomUUID(); const input = { ...entrada(), intentoId: id, codigo_sistema: `FIX021-${ctx.R}-CONC` };
  const [a, b] = await Promise.all([crearPlanta(input), crearPlanta(input)]);
  expect(a).toEqual(b); expect(a.id).toBe(id);
});
