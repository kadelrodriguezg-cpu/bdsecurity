import { afterAll, beforeAll, expect, it } from 'vitest';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';

let ctx: Contexto;
let admin: Awaited<ReturnType<typeof usuario>>;
let especie: string;
let planta: string;
let sustrato: string;

beforeAll(async () => {
  ctx = contexto();
  admin = await usuario(ctx, 'fix022admin', 'admin');
  const e = await ctx.service.from('especies').insert({ nombre: `FIX022-${ctx.R}` }).select('id').single();
  expect(e.error).toBeNull(); especie = e.data!.id;
  const p = await ctx.service.from('plantas').insert({ especie_id: especie, codigo_sistema: `FIX022-${ctx.R}`, estado: 'siembra_semilla', es_prueba: true }).select('id').single();
  expect(p.error).toBeNull(); planta = p.data!.id;
  const s = await ctx.service.from('sustrato').insert({ nombre: `FIX022-${ctx.R}` }).select('id').single();
  expect(s.error).toBeNull(); sustrato = s.data!.id;
  expect((await admin.client.from('plantas_sustrato').insert({ planta_id: planta, sustrato_id: sustrato, porcentaje: 30 })).error).toBeNull();
});

afterAll(async () => {
  expect((await ctx.service.from('plantas').delete().eq('id', planta)).error).toBeNull();
  expect((await ctx.service.from('sustrato').delete().eq('id', sustrato)).error).toBeNull();
  expect((await ctx.service.from('especies').delete().eq('id', especie)).error).toBeNull();
  expect((await ctx.service.auth.admin.deleteUser(admin.id)).error).toBeNull();
});

it('una actualización privilegiada conserva los porcentajes anterior/nuevo sin abrir UPDATE al cliente', async () => {
  expect((await admin.client.from('plantas_sustrato').update({ porcentaje: 40 }).eq('planta_id', planta)).error?.code).toBe('42501');
  expect((await ctx.service.from('plantas_sustrato').update({ porcentaje: 40 }).eq('planta_id', planta)).error).toBeNull();
  const logs = await ctx.service.from('audit_log').select('detalle').eq('planta_id', planta).eq('accion', 'cambio_material_siembra').eq('detalle->>operacion', 'UPDATE');
  expect(logs.error).toBeNull(); expect(logs.data).toHaveLength(1);
  expect(logs.data![0].detalle).toMatchObject({ anterior: { porcentaje: 30 }, nuevo: { porcentaje: 40 } });
});

it('la baja autorizada en cascada conserva UUID y actor sin insertar una FK huérfana', async () => {
  const baja = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: planta, p_tipo: 'hard' });
  expect(baja.error).toBeNull();
  const logs = await ctx.service.from('audit_log').select('usuario_id,planta_id,detalle').eq('accion', 'cambio_material_siembra').eq('detalle->>planta_id', planta).eq('detalle->>operacion', 'DELETE');
  expect(logs.error).toBeNull(); expect(logs.data).toHaveLength(1);
  expect(logs.data![0]).toMatchObject({ usuario_id: admin.id, planta_id: null,
    detalle: { tabla: 'plantas_sustrato', planta_id: planta, anterior: { sustrato_id: sustrato, porcentaje: 40 }, nuevo: null } });
});
