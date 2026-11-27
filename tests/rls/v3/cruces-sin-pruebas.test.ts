/**
 * v3 (N4, migración 20261024090000): la lista de Cruces y el Panel/Inicio excluyen los cruces de prueba por
 * defecto; con p_incluir_pruebas = true los ve solo un admin. Se verifica contra la base local.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();
const CODIGO = `PRUEBAV3-${R}`;
let service: SupabaseClient;
let admin: SupabaseClient;
let operario: SupabaseClient;
let cruceId: string;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  admin = (await crearUsuarioDePrueba(creds, service, { email: `v3-pruebas-admin-${R}@test.local`, rol: 'admin' })).client;
  operario = (await crearUsuarioDePrueba(creds, service, { email: `v3-pruebas-op-${R}@test.local`, rol: 'operario' })).client;
  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  const { data, error } = await service.from('plantas').insert({ codigo_sistema: CODIGO, especie_id: esp!.id, estado: 'polinizacion', es_prueba: true }).select('id').single();
  if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
  cruceId = data.id;
}, 60_000);

afterAll(async () => {
  await admin.rpc('borrar_cruzamiento', { p_planta_id: cruceId, p_tipo: 'hard' });
});

async function codigosEnLista(cliente: SupabaseClient, incluir?: boolean): Promise<string[]> {
  const args: Record<string, unknown> = { p_busqueda: CODIGO };
  if (incluir !== undefined) args.p_incluir_pruebas = incluir;
  const { data, error } = await cliente.rpc('listar_cruces_analiticos', args);
  expect(error).toBeNull();
  return ((data as { items?: Array<{ codigo_sistema: string }> }).items ?? []).map((i) => i.codigo_sistema);
}

async function idsEnPanel(cliente: SupabaseClient, incluir?: boolean): Promise<string[]> {
  const args: Record<string, unknown> = { p_limite: 25 };
  if (incluir !== undefined) args.p_incluir_pruebas = incluir;
  const { data, error } = await cliente.rpc('obtener_dashboard_cientifico', args);
  expect(error).toBeNull();
  return ((data as { cambios_recientes?: Array<{ planta_id: string }> }).cambios_recientes ?? []).map((c) => c.planta_id);
}

describe('cruces de prueba fuera de la lista y del panel (N4)', () => {
  it('por defecto nadie ve el cruce de prueba en la lista (la app vieja llama sin el parámetro)', async () => {
    expect(await codigosEnLista(operario)).toEqual([]);
    expect(await codigosEnLista(admin)).toEqual([]);
  });

  it('el admin lo ve si lo pide; el operario, aunque lo pida, no', async () => {
    expect(await codigosEnLista(admin, true)).toEqual([CODIGO]);
    expect(await codigosEnLista(operario, true)).toEqual([]);
  });

  it('lo mismo en el panel (cambios recientes)', async () => {
    expect(await idsEnPanel(admin)).not.toContain(cruceId);
    expect(await idsEnPanel(operario, true)).not.toContain(cruceId);
    expect(await idsEnPanel(admin, true)).toContain(cruceId);
  });
});
