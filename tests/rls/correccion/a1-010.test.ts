import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';

let ctx: Contexto;
let admin: Awaited<ReturnType<typeof usuario>>;
let operario: Awaited<ReturnType<typeof usuario>>;
let especie: string;
let variedad: string;
let sinUso: string;

beforeAll(async () => {
  ctx = contexto();
  admin = await usuario(ctx, 'fix010', 'admin');
  operario = await usuario(ctx, 'fix010', 'operario');
  const esp = await ctx.service.from('especies').insert({ nombre: `FIX010-${ctx.R}` }).select('id').single();
  expect(esp.error).toBeNull();
  especie = esp.data!.id;
  const vars = await ctx.service.from('variedades').insert([
    { especie_id: especie, nombre: 'Variedad 010', created_by: admin.id },
    { especie_id: especie, nombre: 'Sin uso 010', created_by: admin.id },
  ]).select('id, nombre');
  expect(vars.error).toBeNull();
  variedad = vars.data!.find(v => v.nombre === 'Variedad 010')!.id;
  sinUso = vars.data!.find(v => v.nombre === 'Sin uso 010')!.id;
  const plantas = await ctx.service.from('plantas').insert([
    { especie_id: especie, codigo_sistema: `FIX010-${ctx.R}-1`, mama_id: variedad, papa_id: variedad, es_prueba: true },
    { especie_id: especie, codigo_sistema: `FIX010-${ctx.R}-2`, mama_id: variedad, es_prueba: true },
    { especie_id: especie, codigo_sistema: `FIX010-${ctx.R}-3`, es_prueba: true },
  ]);
  expect(plantas.error).toBeNull();
});
afterAll(async () => {
  expect((await ctx.service.from('plantas').delete().eq('especie_id', especie)).error).toBeNull();
  expect((await ctx.service.from('variedades').delete().eq('especie_id', especie)).error).toBeNull();
  expect((await ctx.service.from('especies').delete().eq('id', especie)).error).toBeNull();
  for (const u of [operario, admin]) expect((await ctx.service.auth.admin.deleteUser(u.id)).error).toBeNull();
});

async function cambios(id: string) {
  const res = await ctx.service.from('audit_log').select('usuario_id, accion, detalle').eq('detalle->>entidad_id', id);
  expect(res.error).toBeNull();
  return res.data!;
}

describe('A1-010 auditoría de catálogos', () => {
  it('renombrar y desactivar variedad registra autor, valores y cruces distintos (sin duplicar mamá/papá)', async () => {
    expect((await admin.client.from('variedades').update({ nombre: 'Variedad corregida 010', activo: false }).eq('id', variedad)).error).toBeNull();
    expect(await cambios(variedad)).toEqual([expect.objectContaining({ usuario_id: admin.id, accion: 'cambio_variedad',
      detalle: expect.objectContaining({ nombre_anterior: 'Variedad 010', nombre_nuevo: 'Variedad corregida 010',
        activo_anterior: true, activo_nuevo: false, cruces_afectados: 2, operacion: 'UPDATE' }) })]);
  });

  it('renombrar especie registra los tres cruces afectados', async () => {
    expect((await admin.client.from('especies').update({ nombre: `FIX010-${ctx.R}-corregida` }).eq('id', especie)).error).toBeNull();
    expect(await cambios(especie)).toEqual([expect.objectContaining({ usuario_id: admin.id, accion: 'cambio_especie',
      detalle: expect.objectContaining({ nombre_anterior: `FIX010-${ctx.R}`, nombre_nuevo: `FIX010-${ctx.R}-corregida`, cruces_afectados: 3 }) })]);
  });

  it('una modificación denegada al operario no modifica el catálogo ni genera un cambio ficticio', async () => {
    const antes = await cambios(variedad);
    const up = await operario.client.from('variedades').update({ nombre: 'No autorizado' }).eq('id', variedad).select('id');
    expect(up.data ?? []).toEqual([]);
    expect(await cambios(variedad)).toEqual(antes);
  });

  it('DELETE privilegiado sin uso se audita y un DELETE bloqueado por FK revierte también la auditoría', async () => {
    expect((await ctx.service.from('variedades').delete().eq('id', sinUso)).error).toBeNull();
    expect(await cambios(sinUso)).toEqual([expect.objectContaining({ usuario_id: null,
      detalle: expect.objectContaining({ nombre_anterior: 'Sin uso 010', nombre_nuevo: null, cruces_afectados: 0, operacion: 'DELETE' }) })]);
    const antes = await cambios(especie);
    expect((await ctx.service.from('especies').delete().eq('id', especie)).error?.code).toBe('23503');
    expect(await cambios(especie)).toEqual(antes);
    const vacia = await ctx.service.from('especies').insert({ nombre: `FIX010-vacia-${ctx.R}` }).select('id').single();
    expect(vacia.error).toBeNull();
    expect((await ctx.service.from('especies').delete().eq('id', vacia.data!.id)).error).toBeNull();
    expect(await cambios(vacia.data!.id)).toEqual([expect.objectContaining({ accion: 'cambio_especie', usuario_id: null,
      detalle: expect.objectContaining({ nombre_anterior: `FIX010-vacia-${ctx.R}`, nombre_nuevo: null, cruces_afectados: 0, operacion: 'DELETE' }) })]);
  });
});
