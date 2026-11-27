import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';

let ctx: Contexto;
let admin: Awaited<ReturnType<typeof usuario>>;
let operario: Awaited<ReturnType<typeof usuario>>;

beforeAll(async () => {
  ctx = contexto();
  admin = await usuario(ctx, 'fix009', 'admin');
  operario = await usuario(ctx, 'fix009', 'operario');
});
afterAll(async () => {
  for (const u of [operario, admin]) expect((await ctx.service.auth.admin.deleteUser(u.id)).error).toBeNull();
});

async function auditoria() {
  const res = await ctx.service.from('audit_log').select('usuario_id, detalle').eq('accion', 'cambio_perfil').eq('detalle->>perfil_id', operario.id);
  expect(res.error).toBeNull();
  return res.data!;
}

describe('A1-009 auditoría de perfiles', () => {
  it('alta Auth deja INSERT con valores iniciales y sin inventar actor humano', async () => {
    const alta = (await auditoria()).find(f => f.detalle.operacion === 'INSERT');
    expect(alta).toBeDefined();
    expect(alta!.usuario_id).toBeNull();
    expect(alta!.detalle.anterior).toBeNull();
    expect(alta!.detalle.nuevo).toMatchObject({ id: operario.id, rol: 'operario', puede_ver_linaje: false });
  });

  it('la concesión y revocación guardan autor y valores anteriores/nuevos; el autoascenso sigue cerrado', async () => {
    const antes = (await auditoria()).length;
    expect((await operario.client.from('perfiles').update({ rol: 'admin' }).eq('id', operario.id)).error?.code).toBe('42501');
    expect((await auditoria()).length).toBe(antes);
    expect((await admin.client.from('perfiles').update({ puede_ver_linaje: true }).eq('id', operario.id)).error).toBeNull();
    expect((await admin.client.from('perfiles').update({ puede_ver_linaje: false }).eq('id', operario.id)).error).toBeNull();
    const cambios = (await auditoria()).filter(f => f.usuario_id === admin.id && f.detalle.operacion === 'UPDATE');
    expect(cambios).toHaveLength(2);
    expect(cambios.some(f => f.detalle.anterior.puede_ver_linaje === false && f.detalle.nuevo.puede_ver_linaje === true)).toBe(true);
    expect(cambios.some(f => f.detalle.anterior.puede_ver_linaje === true && f.detalle.nuevo.puede_ver_linaje === false)).toBe(true);
  });

  it('editar nombre propio deja autor sin permitir escritura directa al log', async () => {
    expect((await operario.client.from('perfiles').update({ nombre: 'Operario 009' }).eq('id', operario.id)).error).toBeNull();
    const cambios = (await auditoria()).filter(f => f.usuario_id === operario.id);
    expect(cambios).toHaveLength(1);
    expect(cambios[0].detalle.nuevo.nombre).toBe('Operario 009');
    expect((await operario.client.from('audit_log').insert({ accion: 'cambio_perfil' })).error?.code).toBe('42501');
  });

  it('DELETE privilegiado conserva una fila de cambio sin impedir una baja Auth legítima', async () => {
    const temporal = await usuario(ctx, 'fix009-baja', 'operario');
    expect((await ctx.service.auth.admin.deleteUser(temporal.id)).error).toBeNull();
    const log = await ctx.service.from('audit_log').select('usuario_id, detalle').eq('accion', 'cambio_perfil')
      .eq('detalle->>perfil_id', temporal.id).eq('detalle->>operacion', 'DELETE').single();
    expect(log.error).toBeNull();
    expect(log.data!.usuario_id).toBeNull();
    expect(log.data!.detalle.anterior).toMatchObject({ id: temporal.id, rol: 'operario' });
    expect(log.data!.detalle.nuevo).toBeNull();
  });
});
