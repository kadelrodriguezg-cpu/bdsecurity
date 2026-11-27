import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';
vi.mock('../../../frontend/src/api/client', () => ({
  supabase: new Proxy({}, { get: (_target, prop) => (globalThis as unknown as { __fix025: SupabaseClient & Record<string | symbol, unknown> }).__fix025[prop] }),
  traducirError: (error: { message: string }) => new Error(error.message),
}));
import { actualizarEstado } from '../../../frontend/src/api/plantas';
let ctx: Contexto;
let a: Awaited<ReturnType<typeof usuario>>;
let b: Awaited<ReturnType<typeof usuario>>;
let especie: string;
let planta: string;
const como = (cliente: SupabaseClient) => { (globalThis as unknown as { __fix025: SupabaseClient }).__fix025 = cliente; };
beforeAll(async () => {
  ctx = contexto(); a = await usuario(ctx, 'fix025a', 'admin'); b = await usuario(ctx, 'fix025b', 'admin'); // U-03: solo un admin cambia la fase
  const e = await ctx.service.from('especies').insert({ nombre: `FIX025-${ctx.R}` }).select('id').single();
  expect(e.error).toBeNull(); especie = e.data!.id;
  const p = await ctx.service.from('plantas').insert({ especie_id: especie, codigo_sistema: `FIX025-${ctx.R}`, estado: 'polinizacion', es_prueba: true }).select('id').single();
  expect(p.error).toBeNull(); planta = p.data!.id;
});
afterAll(async () => {
  expect((await ctx.service.from('plantas').delete().eq('id', planta)).error).toBeNull();
  expect((await ctx.service.from('especies').delete().eq('id', especie)).error).toBeNull();
  for (const u of [a, b]) expect((await ctx.service.auth.admin.deleteUser(u.id)).error).toBeNull();
});
it('una ficha antigua no retrocede el estado que otra persona ya avanzó', async () => {
  como(a.client);
  await actualizarEstado(planta, 'cosecha', 'polinizacion');
  await actualizarEstado(planta, 'siembra_semilla', 'cosecha');
  como(b.client);
  await expect(actualizarEstado(planta, 'cosecha', 'polinizacion')).rejects.toThrow('La ficha cambió');
  const p = await ctx.service.from('plantas').select('estado').eq('id', planta).single();
  expect(p.error).toBeNull(); expect(p.data!.estado).toBe('siembra_semilla');
  const logs = await ctx.service.from('audit_log').select('detalle').eq('planta_id', planta).eq('accion', 'cambio_estado');
  expect(logs.error).toBeNull(); expect(logs.data).toHaveLength(2);
});
it('una lectura vigente todavía permite la transición legítima', async () => {
  await expect(actualizarEstado(planta, 'germinacion', 'siembra_semilla')).resolves.toBeUndefined();
});
