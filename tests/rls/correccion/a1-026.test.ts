import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';

vi.mock('../../../frontend/src/api/client', () => ({
  supabase: new Proxy({}, { get: (_target, prop) => (globalThis as unknown as { __fix026: SupabaseClient & Record<string | symbol, unknown> }).__fix026[prop] }),
  traducirError: (error: { message: string }) => new Error(error.message),
}));
import { quitarCosechaFruto, quitarUltimoPolinizacionEvento } from '../../../frontend/src/api/fases';

let ctx: Contexto;
let autor: Awaited<ReturnType<typeof usuario>>;
let otro: Awaited<ReturnType<typeof usuario>>;
let especie: string;
let polinizacion: string;
let cosecha: string;
let fruto: string;
const como = (client: SupabaseClient) => { (globalThis as unknown as { __fix026: SupabaseClient }).__fix026 = client; };

beforeAll(async () => {
  ctx = contexto();
  autor = await usuario(ctx, 'fix026autor', 'operario');
  otro = await usuario(ctx, 'fix026otro', 'operario');
  const e = await ctx.service.from('especies').insert({ nombre: `FIX026-${ctx.R}` }).select('id').single();
  expect(e.error).toBeNull(); especie = e.data!.id;
  const plantas = await ctx.service.from('plantas').insert([
    { especie_id: especie, codigo_sistema: `FIX026-${ctx.R}-P`, estado: 'polinizacion', es_prueba: true, n_flores_cruzadas: 12 },
    { especie_id: especie, codigo_sistema: `FIX026-${ctx.R}-C`, estado: 'cosecha', es_prueba: true },
  ]).select('id,codigo_sistema');
  expect(plantas.error).toBeNull();
  polinizacion = plantas.data!.find(p => p.codigo_sistema.endsWith('-P'))!.id;
  cosecha = plantas.data!.find(p => p.codigo_sistema.endsWith('-C'))!.id;
  expect((await ctx.service.from('polinizacion_evento').insert({ planta_id: polinizacion, fecha: '2026-10-22', n_flores_cruzadas: 12, created_by: autor.id })).error).toBeNull();
  const f = await ctx.service.from('cosecha_fruto').insert({ planta_id: cosecha, numero_fruto: 0, cantidad_semillas: 10, created_by: autor.id }).select('id').single();
  expect(f.error).toBeNull(); fruto = f.data!.id;
});
afterAll(async () => {
  expect((await ctx.service.from('polinizacion_evento').delete().eq('planta_id', polinizacion)).error).toBeNull();
  expect((await ctx.service.from('cosecha_fruto').delete().eq('planta_id', cosecha)).error).toBeNull();
  expect((await ctx.service.from('plantas').delete().eq('especie_id', especie)).error).toBeNull();
  expect((await ctx.service.from('especies').delete().eq('id', especie)).error).toBeNull();
  for (const u of [otro, autor]) expect((await ctx.service.auth.admin.deleteUser(u.id)).error).toBeNull();
});

it('otro operario recibe error y la sesión/columnas legacy se conservan', async () => {
  como(otro.client);
  await expect(quitarUltimoPolinizacionEvento(polinizacion)).rejects.toThrow('solo quien la registró');
  const sesiones = await ctx.service.from('polinizacion_evento').select('id').eq('planta_id', polinizacion);
  expect(sesiones.data).toHaveLength(1);
  const planta = await ctx.service.from('plantas').select('n_flores_cruzadas').eq('id', polinizacion).single();
  expect(planta.data!.n_flores_cruzadas).toBe(12);
});

it('otro operario recibe error al quitar fruto ajeno; el autor sí puede quitarlo', async () => {
  como(otro.client);
  await expect(quitarCosechaFruto(fruto)).rejects.toThrow('solo quien lo registró');
  como(autor.client);
  await expect(quitarCosechaFruto(fruto)).resolves.toBeUndefined();
  const f = await ctx.service.from('cosecha_fruto').select('id').eq('id', fruto);
  expect(f.data).toHaveLength(0);
});

it('el autor quita la sesión y se sincroniza el legacy sin aparentar éxito dos veces', async () => {
  como(autor.client);
  await expect(quitarUltimoPolinizacionEvento(polinizacion)).resolves.toBeUndefined();
  const planta = await ctx.service.from('plantas').select('n_flores_cruzadas').eq('id', polinizacion).single();
  expect(planta.data!.n_flores_cruzadas).toBeNull();
  await expect(quitarUltimoPolinizacionEvento(polinizacion)).rejects.toThrow('No hay sesiones');
  await expect(quitarCosechaFruto(fruto)).rejects.toThrow('debe seguir existiendo');
});
