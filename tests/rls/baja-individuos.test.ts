/**
 * Baja de individuos por RPC, individual y en lote (migración 20261021160000).
 *
 * Se verifica contra la base local: la baja individual sigue funcionando para
 * el autor no admin (y es idempotente ante reintentos); la baja en lote es solo
 * de admin, todo o nada, con tope, límite por lote y auditoría; y los caminos
 * directos (UPDATE de estado_vital, INSERT en baja_motivo, crear un individuo
 * ya de baja) quedan cerrados.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let autor: SupabaseClient;
let autorId: string;
let otroOperario: SupabaseClient;
let especieId: string;
let plantaId: string;
let plantaArchivadaId: string;

const R = Date.now();
let n = 0;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Admin propio: el límite de 3 lotes por minuto es por usuario.
  const ad = await crearUsuarioDePrueba(creds, service, { email: `baja-lote-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  const au = await crearUsuarioDePrueba(creds, service, { email: 'operario@test.local', rol: 'operario' });
  autor = au.client;
  autorId = au.userId;
  otroOperario = (await crearUsuarioDePrueba(creds, service, { email: 'operario2@test.local', rol: 'operario' })).client;

  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  const crearPlanta = async (sufijo: string) => {
    const { data, error } = await service
      .from('plantas')
      .insert({ codigo_sistema: `BAJA-${R}-${sufijo}`, especie_id: especieId, estado: 'trasplante', es_prueba: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`setup planta: ${error?.message}`);
    return data.id as string;
  };
  plantaId = await crearPlanta('A');
  plantaArchivadaId = await crearPlanta('ARCH');
}, 60_000);

afterAll(async () => {
  for (const id of [plantaId, plantaArchivadaId]) await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
});

async function individuo(planta = plantaId, creadoPor = autorId) {
  const { data, error } = await service
    .from('individuos')
    .insert({ planta_id: planta, codigo_display: `BAJA-${R}-${++n}`, created_by: creadoPor })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup individuo: ${error?.message}`);
  return data.id as string;
}

async function estados(ids: string[]) {
  const { data } = await service.from('individuos').select('id, estado_vital, fecha_baja').in('id', ids);
  return new Map((data ?? []).map((i) => [i.id, i]));
}

async function motivos(ids: string[]) {
  const { data } = await service.from('baja_motivo').select('individuo_id, criterio, nota, created_by').in('individuo_id', ids);
  return data ?? [];
}

const lote = (ids: string[], key = randomUUID()) => ({
  p_ids: ids, p_estado: 'descartado', p_criterios: ['vigor', 'sanidad'], p_nota: 'Lote de prueba', p_fecha: '2026-10-21', p_idempotency_key: key,
});

describe('baja individual por RPC (marcar_baja_individuo)', () => {
  it('el autor no admin sigue pudiendo dar de baja a su individuo, en una sola operación', async () => {
    const id = await individuo();
    const { data, error } = await autor.rpc('marcar_baja_individuo', {
      p_individuo_id: id, p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: '  Helada  ', p_fecha: '2026-10-20', p_idempotency_key: randomUUID(),
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ repetido: false });
    expect((await estados([id])).get(id)).toMatchObject({ estado_vital: 'muerto', fecha_baja: '2026-10-20' });
    expect(await motivos([id])).toEqual([{ individuo_id: id, criterio: 'muerte_natural', nota: 'Helada', created_by: autorId }]);
  });

  it('un reintento con la misma clave (PWA con mala señal) devuelve éxito sin duplicar', async () => {
    const id = await individuo();
    const args = { p_individuo_id: id, p_estado: 'descartado', p_criterios: ['vigor', 'uniformidad'], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID() };
    expect((await autor.rpc('marcar_baja_individuo', args)).error).toBeNull();
    const reintento = await autor.rpc('marcar_baja_individuo', args);
    expect(reintento.error).toBeNull();
    expect(reintento.data).toMatchObject({ repetido: true });
    expect(await motivos([id])).toHaveLength(2);
  });

  it('otra clave sobre un individuo ya de baja se rechaza', async () => {
    const id = await individuo();
    await autor.rpc('marcar_baja_individuo', { p_individuo_id: id, p_estado: 'descartado', p_criterios: ['vigor'], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID() });
    const { error } = await autor.rpc('marcar_baja_individuo', { p_individuo_id: id, p_estado: 'muerto', p_criterios: ['vigor'], p_nota: null, p_fecha: '2026-10-21', p_idempotency_key: randomUUID() });
    expect(error?.code).toBe('42501');
  });

  it('un operario que no es el autor no puede; sin criterios tampoco se puede', async () => {
    const id = await individuo();
    const ajeno = await otroOperario.rpc('marcar_baja_individuo', { p_individuo_id: id, p_estado: 'descartado', p_criterios: ['vigor'], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID() });
    expect(ajeno.error?.code).toBe('42501');
    const sinCriterios = await autor.rpc('marcar_baja_individuo', { p_individuo_id: id, p_estado: 'descartado', p_criterios: [], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID() });
    expect(sinCriterios.error?.code).toBe('22023');
    expect((await estados([id])).get(id)).toMatchObject({ estado_vital: 'vivo' });
  });
});

describe('caminos directos cerrados', () => {
  it('nadie actualiza estado_vital directo, ni el admin', async () => {
    const id = await individuo();
    for (const cliente of [autor, admin]) {
      const { error } = await cliente.from('individuos').update({ estado_vital: 'muerto', fecha_baja: '2026-10-20' }).eq('id', id);
      expect(error?.code).toBe('42501');
    }
  });

  it('nadie inserta motivos de baja directo, ni sobre un individuo ajeno', async () => {
    const id = await individuo(plantaId, adminId);
    const { error } = await autor.from('baja_motivo').insert({ individuo_id: id, criterio: 'vigor', created_by: autorId });
    expect(error?.code).toBe('42501');
    expect(await motivos([id])).toHaveLength(0);
  });

  it('no se puede crear un individuo que ya nace de baja', async () => {
    const { error } = await autor
      .from('individuos')
      .insert({ planta_id: plantaId, codigo_display: '', created_by: autorId, estado_vital: 'muerto' });
    expect(error?.code).toBe('42501');
  });
});

describe('baja en lote (previsualizar_baja_individuos / dar_baja_individuos)', () => {
  it('el operario no puede previsualizar ni dar de baja en lote', async () => {
    const id = await individuo();
    expect((await autor.rpc('previsualizar_baja_individuos', { p_ids: [id] })).error?.code).toBe('42501');
    expect((await autor.rpc('dar_baja_individuos', lote([id]))).error?.code).toBe('42501');
    expect((await estados([id])).get(id)).toMatchObject({ estado_vital: 'vivo' });
  });

  it('la previsualización separa procesables y excluidos con su motivo', async () => {
    const vivo = await individuo();
    const deBaja = await individuo();
    await autor.rpc('marcar_baja_individuo', { p_individuo_id: deBaja, p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID() });
    const enArchivado = await individuo(plantaArchivadaId);
    await service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', plantaArchivadaId);
    const inexistente = randomUUID();

    const { data, error } = await admin.rpc('previsualizar_baja_individuos', { p_ids: [vivo, deBaja, enArchivado, inexistente, vivo] });
    await service.from('plantas').update({ eliminado_at: null }).eq('id', plantaArchivadaId);
    expect(error).toBeNull();
    const preview = data as { limite: number; procesables: Array<{ id: string }>; excluidos: Array<{ id: string; motivo: string }> };
    expect(preview.limite).toBe(500);
    expect(preview.procesables.map((p) => p.id)).toEqual([vivo]);
    expect(Object.fromEntries(preview.excluidos.map((e) => [e.id, e.motivo]))).toEqual({
      [deBaja]: 'ya_de_baja', [enArchivado]: 'cruce_archivado', [inexistente]: 'no_existe',
    });
  });

  it('el admin procesa el lote completo, con una fila de auditoría por individuo y una de resumen', async () => {
    const ids = [await individuo(), await individuo(), await individuo()];
    const key = randomUUID();
    const { data, error } = await admin.rpc('dar_baja_individuos', lote(ids, key));
    expect(error).toBeNull();
    expect(data).toEqual({ procesados: 3, repetido: false });

    const actuales = await estados(ids);
    for (const id of ids) expect(actuales.get(id)).toMatchObject({ estado_vital: 'descartado', fecha_baja: '2026-10-21' });
    const filas = await motivos(ids);
    expect(filas).toHaveLength(6); // 3 individuos x 2 criterios
    expect(filas.every((f) => f.nota === 'Lote de prueba' && f.created_by === adminId)).toBe(true);

    const { data: porIndividuo } = await service
      .from('audit_log').select('detalle').eq('accion', 'edicion_individuo').in('detalle->>individuo_id', ids);
    expect(porIndividuo).toHaveLength(3);
    const { data: resumen } = await service
      .from('audit_log').select('usuario_id, planta_id, detalle').eq('accion', 'baja_lote').eq('detalle->>idempotency_key', key);
    expect(resumen).toHaveLength(1);
    expect(resumen![0]).toMatchObject({ usuario_id: adminId, planta_id: plantaId });
    expect([...(resumen![0].detalle.individuo_ids as string[])].sort()).toEqual([...ids].sort());
  });

  it('el mismo lote reenviado con la misma clave no duplica nada', async () => {
    const ids = [await individuo(), await individuo()];
    const key = randomUUID();
    expect((await admin.rpc('dar_baja_individuos', lote(ids, key))).error).toBeNull();
    const reintento = await admin.rpc('dar_baja_individuos', lote(ids, key));
    expect(reintento.error).toBeNull();
    expect(reintento.data).toEqual({ procesados: 2, repetido: true });
    expect(await motivos(ids)).toHaveLength(4);
    const { data: resumen } = await service.from('audit_log').select('id').eq('accion', 'baja_lote').eq('detalle->>idempotency_key', key);
    expect(resumen).toHaveLength(1);
  });

  it('un id inválido rechaza todo el lote', async () => {
    const ids = [await individuo(), await individuo()];
    const { error } = await admin.rpc('dar_baja_individuos', lote([...ids, randomUUID()]));
    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/no_existe/);
    for (const [, i] of await estados(ids)) expect(i.estado_vital).toBe('vivo');
    expect(await motivos(ids)).toHaveLength(0);
  });

  it('un individuo ya de baja rechaza todo el lote', async () => {
    const vivos = [await individuo(), await individuo()];
    const deBaja = await individuo();
    await autor.rpc('marcar_baja_individuo', { p_individuo_id: deBaja, p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID() });
    const { error } = await admin.rpc('dar_baja_individuos', lote([...vivos, deBaja]));
    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/ya_de_baja/);
    for (const id of vivos) expect((await estados([id])).get(id)).toMatchObject({ estado_vital: 'vivo' });
  });

  it('respeta el tope de 500 individuos por lote', async () => {
    const ids = Array.from({ length: 501 }, () => randomUUID());
    const { error } = await admin.rpc('dar_baja_individuos', lote(ids));
    expect(error?.code).toBe('22023');
    expect(error?.message).toMatch(/Máximo 500/);
  });

  it('el límite de frecuencia es por lote: el cuarto lote del minuto se rechaza', async () => {
    // Ya hay 2 lotes confirmados de este admin en este minuto (el completo y el idempotente).
    expect((await admin.rpc('dar_baja_individuos', lote([await individuo()]))).error).toBeNull();
    const id = await individuo();
    const { error } = await admin.rpc('dar_baja_individuos', lote([id]));
    expect(error?.code).toBe('58503');
    expect((await estados([id])).get(id)).toMatchObject({ estado_vital: 'vivo' });
  });
});
