/**
 * v3 (decisión N15, migración 20261024080000): `nombres_de_usuarios(p_ids)` deja que cualquier autenticado lea el
 * NOMBRE de sus compañeros, y nada más del perfil. Se verifica contra la base local.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();
let service: SupabaseClient;
let operario: SupabaseClient;
let operarioId: string;
let adminId: string;
let otroId: string;
const creados: string[] = [];

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `v3-nombres-admin-${R}@test.local`, rol: 'admin', puedeVerLinaje: true });
  adminId = ad.userId; creados.push(adminId);
  const op = await crearUsuarioDePrueba(creds, service, { email: `v3-nombres-op-${R}@test.local`, rol: 'operario' });
  operario = op.client; operarioId = op.userId; creados.push(operarioId);
  const otro = await crearUsuarioDePrueba(creds, service, { email: `v3-nombres-otro-${R}@test.local`, rol: 'operario' });
  otroId = otro.userId; creados.push(otroId);
  await service.from('perfiles').update({ nombre: `Ana Admin ${R}` }).eq('id', adminId);
  await service.from('perfiles').update({ nombre: `Otro Operario ${R}` }).eq('id', otroId);
}, 60_000);

afterAll(async () => {
  for (const id of creados) await service.auth.admin.deleteUser(id);
});

describe('nombres_de_usuarios (N15)', () => {
  it('sin la función, un operario NO lee perfiles ajenos (la RLS de perfiles no cambió)', async () => {
    const { data, error } = await operario.from('perfiles').select('id, nombre').eq('id', adminId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('con la función, el operario lee SOLO id y nombre de los compañeros pedidos', async () => {
    const { data, error } = await operario.rpc('nombres_de_usuarios', { p_ids: [adminId, otroId] });
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    for (const fila of data as Record<string, unknown>[]) expect(Object.keys(fila).sort()).toEqual(['id', 'nombre']);
    expect(data).toEqual(expect.arrayContaining([
      { id: adminId, nombre: `Ana Admin ${R}` },
      { id: otroId, nombre: `Otro Operario ${R}` },
    ]));
  });

  it('no expone rol, permiso de linaje ni fechas, aunque se pidan', async () => {
    const { data, error } = await operario.rpc('nombres_de_usuarios', { p_ids: [adminId] }).select('id, nombre, rol, puede_ver_linaje');
    expect(data ?? null).toBeNull();
    expect(error).toBeTruthy();
  });

  it('no lista a todos: sin ids o con ids que no existen no devuelve a nadie', async () => {
    expect((await operario.rpc('nombres_de_usuarios', { p_ids: [] })).data).toEqual([]);
    expect((await operario.rpc('nombres_de_usuarios', { p_ids: ['00000000-0000-4000-8000-000000000000'] })).data).toEqual([]);
  });

  it('a lo sumo 200 ids por llamada', async () => {
    const ids = Array.from({ length: 201 }, () => operarioId);
    const { error } = await operario.rpc('nombres_de_usuarios', { p_ids: ids });
    expect(error?.code).toBe('22023');
  });

  it('anon no puede llamarla', async () => {
    const creds = getLocalCreds();
    const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.rpc('nombres_de_usuarios', { p_ids: [adminId] });
    expect(error).toBeTruthy();
    expect(data ?? null).toBeNull();
  });
});
