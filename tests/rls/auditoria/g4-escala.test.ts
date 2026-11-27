/**
 * Auditoría integral, Corrida 1, grupo G4: escala de I01 (individualizar).
 *
 * El rol `authenticated` tiene statement_timeout = 8 s en la base local (y es
 * el valor por defecto de Supabase hospedado; en producción NO se verificó,
 * ver informe). Esta prueba comprueba dos cosas:
 *   1. Dos llamadas válidas de 1000 individuos y los tiempos de las RPC
 *      de lectura del cruce con ese volumen.
 *   2. Una llamada que excede el timeout se revierte completa (atomicidad): no
 *      queda ningún individuo a medias ni auditoría huérfana.
 */
import { individualizarPlantas } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

const R = Date.now();

let service: SupabaseClient;
let admin: SupabaseClient;
let operario: SupabaseClient;
let operarioId: string;
let cruce: string;

async function contar(tabla: 'individuos' | 'audit_log', filtro: Record<string, string>): Promise<number> {
  let q = service.from(tabla).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

beforeAll(async () => {
  const creds: LocalCreds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  admin = (await crearUsuarioDePrueba(creds, service, { email: `aud-g4-esc-admin-${R}@test.local`, rol: 'admin' })).client;
  const usuario = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-esc-operario-${R}@test.local`, rol: 'operario' });
  operario = usuario.client;
  operarioId = usuario.userId;
  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  const { data, error } = await service.from('plantas').insert({ codigo_sistema: `AUD-G4-ESC-${R}`, especie_id: esp!.id, estado: 'trasplante', es_prueba: true }).select('id').single();
  if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
  cruce = data.id;
}, 60_000);

afterAll(async () => {
  const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: cruce, p_tipo: 'hard' });
  if (error) console.warn(`afterAll: no se pudo purgar ${cruce}: ${error.message}`);
}, 120_000);

describe('I01 escala: 2000 individuos y el límite de 8 s por sentencia', () => {
  it('dos llamadas válidas de 1000 acumulan 2000 y las RPC de lectura responden rápido', async () => {
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      const { data, error } = await individualizarPlantas(operario, { p_planta_id: cruce, p_cantidad: 1000 });
      expect(error).toBeNull();
      expect((data as { cantidad: number }).cantidad).toBe(1000);
      expect(Date.now() - t0).toBeLessThan(8000);
    }

    const t1 = Date.now();
    const { data: resumen } = await operario.rpc('obtener_resumen_individuos', { p_planta_id: cruce });
    expect(Object.keys(resumen as object)).toHaveLength(2000);
    expect(Date.now() - t1).toBeLessThan(3000);

    // El SELECT directo y la RPC set-returning devuelven 1000 de 2000: corte silencioso (A1-G4-01).
    const { data: lista } = await operario.from('individuos').select('id').eq('planta_id', cruce);
    expect(lista).toHaveLength(1000);
    const { data: filas } = await operario.rpc('resumen_individuos_cruce', { p_planta_id: cruce });
    expect(filas).toHaveLength(1000);
  });

  it('una cantidad excesiva se rechaza antes del trabajo, sin individuos ni auditoría a medias', async () => {
    const individuosAntes = await contar('individuos', { planta_id: cruce });
    const resumenesAntes = await contar('audit_log', { planta_id: cruce, accion: 'individualizacion' });
    const { error } = await individualizarPlantas(operario, { p_planta_id: cruce, p_cantidad: 100_000 });
    expect(error?.code).toBe('22023');
    expect(await contar('individuos', { planta_id: cruce })).toBe(individuosAntes);
    expect(await contar('audit_log', { planta_id: cruce, accion: 'individualizacion' })).toBe(resumenesAntes);
  }, 30_000);

  it('un timeout real con cantidad permitida devuelve 57014 y revierte la operación completa', async () => {
    const individuosAntes = await contar('individuos', { planta_id: cruce });
    const resumenesAntes = await contar('audit_log', { planta_id: cruce, accion: 'individualizacion' });
    // Límite local a esta conexión/transacción: no cambia configuración de roles.
    const sql = `begin; set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${operarioId}","role":"authenticated"}', true);
      set local statement_timeout = '25ms';
      select public.individualizar_plantas_una_vez('${cruce}', 1000, gen_random_uuid()); rollback;`;
    const res = spawnSync('docker', ['exec', '-i', 'supabase_db_dbsecurity-frutales', 'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { input: sql, encoding: 'utf8' });
    expect(res.error).toBeUndefined();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/\b57014\b/);
    expect(await contar('individuos', { planta_id: cruce })).toBe(individuosAntes);
    expect(await contar('audit_log', { planta_id: cruce, accion: 'individualizacion' })).toBe(resumenesAntes);
  });
});
