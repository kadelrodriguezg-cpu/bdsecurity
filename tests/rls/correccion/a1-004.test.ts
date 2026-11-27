import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';

let ctx: Contexto;
let admin: Awaited<ReturnType<typeof usuario>>;
let operario: Awaited<ReturnType<typeof usuario>>;
const lotes: string[] = [];
const codigos: string[] = [];

beforeAll(async () => {
  ctx = contexto();
  admin = await usuario(ctx, 'fix004', 'admin');
  operario = await usuario(ctx, 'fix004', 'operario');
});

afterAll(async () => {
  if (codigos.length) expect((await ctx.service.from('plantas').delete().in('codigo_sistema', codigos)).error).toBeNull();
  if (lotes.length) expect((await ctx.service.from('importacion_lote').delete().in('id', lotes)).error).toBeNull();
  for (const u of [admin, operario]) expect((await ctx.service.auth.admin.deleteUser(u.id)).error).toBeNull();
});

async function preview() {
  const codigo = `FIX004-${ctx.R}-${lotes.length}`;
  codigos.push(codigo);
  const res = await admin.client.rpc('previsualizar_importacion_cruces', {
    p_filas: [{ codigo_sistema: codigo, especie: 'Arándano', cruzamiento: 'TEXTO-SENSIBLE-FIX004', es_prueba: 'si' }],
    p_archivo_nombre: 'fix004.csv',
  });
  expect(res.error).toBeNull();
  const id = (res.data as { lote_id: string }).lote_id;
  lotes.push(id);
  return id;
}

async function lote(id: string) {
  const res = await ctx.service.from('importacion_lote').select('filas, estado').eq('id', id).single();
  expect(res.error).toBeNull();
  return res.data!;
}

const confirmar = (id: string, clave = crypto.randomUUID()) => admin.client.rpc('confirmar_importacion_cruces', {
  p_lote_id: id, p_crear_variedades: false, p_idempotency_key: clave,
});

describe('A1-004 retención de linaje', () => {
  it('la redacción cubre objetos anidados y arrays sin quitar identificadores ni metadatos', async () => {
    const entrada = await ctx.service.from('audit_log').insert({
      usuario_id: admin.id, accion: 'prueba_redaccion_a1_004', campos_expuestos: ['cruzamiento'],
      detalle: { anterior: { cruzamiento: 'SECRETO', mama_id: admin.id },
        registros: [{ papa: 'SECRETO', mama_nombre: 'SECRETO', papa_id: operario.id }], codigo_sistema: 'FIX004' },
    }).select('usuario_id, accion, campos_expuestos, detalle').single();
    expect(entrada.error).toBeNull();
    expect(entrada.data).toEqual({ usuario_id: admin.id, accion: 'prueba_redaccion_a1_004', campos_expuestos: ['cruzamiento'],
      detalle: { anterior: { mama_id: admin.id }, registros: [{ papa_id: operario.id }], codigo_sistema: 'FIX004' } });
    const cambio = await ctx.service.from('audit_log').update({ detalle: { nuevo: { cruzamiento: 'OTRO-SECRETO', mama_id: admin.id } } })
      .eq('usuario_id', admin.id).eq('accion', 'prueba_redaccion_a1_004').select('detalle');
    expect(cambio.error).toBeNull();
    expect(cambio.data).toEqual([{ detalle: { nuevo: { mama_id: admin.id } } }]);
  });

  it('confirmar elimina filas sensibles, mantiene reintento idempotente y audita la lectura de ficha', async () => {
    const id = await preview();
    const clave = crypto.randomUUID();
    expect((await confirmar(id, clave)).error).toBeNull();
    expect(await lote(id)).toEqual({ filas: [], estado: 'confirmado' });
    const repetido = await confirmar(id, clave);
    expect(repetido.error).toBeNull();
    expect(repetido.data).toMatchObject({ repetido: true });
    const planta = await ctx.service.from('plantas').select('id').eq('lote_importacion_id', id).single();
    expect(planta.error).toBeNull();
    const lectura = await admin.client.rpc('obtener_planta', { p_planta_id: planta.data!.id });
    expect(lectura.error).toBeNull();
    expect(lectura.data).toMatchObject({ cruzamiento: 'TEXTO-SENSIBLE-FIX004' });
    const log = await ctx.service.from('audit_log').select('accion, detalle').eq('planta_id', planta.data!.id);
    expect(log.error).toBeNull();
    expect(log.data!.filter(f => f.accion === 'lectura_linaje')).toHaveLength(1);
    expect(JSON.stringify(log.data)).not.toContain('TEXTO-SENSIBLE-FIX004');
    expect((await admin.client.from('importacion_lote').select('filas').eq('id', id)).error?.code).toBe('42501');
  });

  it('descartar solo como admin limpia filas; repetir y descartar un confirmado no destruye su estado', async () => {
    const id = await preview();
    expect((await operario.client.rpc('descartar_importacion_cruces', { p_lote_id: id })).error?.code).toBe('42501');
    expect((await admin.client.rpc('descartar_importacion_cruces', { p_lote_id: id })).error).toBeNull();
    expect((await admin.client.rpc('descartar_importacion_cruces', { p_lote_id: id })).error).toBeNull();
    expect(await lote(id)).toEqual({ filas: [], estado: 'descartado' });
    expect((await confirmar(id)).error?.code).toBe('55000');
    expect((await admin.client.rpc('descartar_importacion_cruces', { p_lote_id: lotes[0] })).error).toBeNull();
    expect((await lote(lotes[0])).estado).toBe('confirmado');
  });

  it('un lote vencido no se confirma aunque cron no haya corrido; el trabajo de caducidad elimina sus filas', async () => {
    const id = await preview();
    const cambio = await ctx.service.from('importacion_lote').update({ caduca_at: new Date(Date.now() + 700).toISOString() }).eq('id', id);
    expect(cambio.error).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 900));
    expect((await confirmar(id)).error?.code).toBe('55000');
    execFileSync('docker', ['exec', 'supabase_db_dbsecurity-frutales', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'select public.caducar_importaciones_cruces();']);
    expect(await lote(id)).toEqual({ filas: [], estado: 'caducado' });
    expect((await admin.client.rpc('caducar_importaciones_cruces')).error?.code).toBe('42501');
  });
});
