/**
 * Auditoría integral, Corrida 1, grupo G4: I03 / C14 QR y escaneo.
 *
 * tests/rls/qr-individuo.test.ts ya cubre la resolución del QR de individuo
 * bajo RLS (linaje, auditoría, baja, archivado, anon, id inmutable). Acá se
 * cubre lo que falta del lado de la base: qué pasa cuando el escáner lleva a
 * la ficha un UUID que no es de un cruce (un individuo pelado, un uuid
 * inexistente) y si esos intentos fallidos consumen el límite de lecturas.
 * La interpretación del contenido del QR (dominio distinto, formato Notion) y
 * la tanda de 1000 etiquetas son código de navegador y no se verifican acá.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

const R = Date.now();

let creds: LocalCreds;
let service: SupabaseClient;
let admin: SupabaseClient;
let operario: SupabaseClient;
let operarioId: string;
let cruce: string;
let individuoId: string;

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  admin = (await crearUsuarioDePrueba(creds, service, { email: `aud-g4-qr-admin-${R}@test.local`, rol: 'admin' })).client;
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-qr-operario-${R}@test.local`, rol: 'operario' });
  operario = op.client;
  operarioId = op.userId;
  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  const { data: planta, error } = await service.from('plantas').insert({ codigo_sistema: `AUD-G4-QR-${R}`, especie_id: esp!.id, estado: 'trasplante', es_prueba: true }).select('id').single();
  if (error || !planta) throw new Error(`setup cruce: ${error?.message}`);
  cruce = planta.id;
  const { data: ind } = await service.from('individuos').insert({ planta_id: cruce, created_by: operarioId, codigo_display: '' }).select('id').single();
  individuoId = ind!.id;
}, 60_000);

afterAll(async () => {
  const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: cruce, p_tipo: 'hard' });
  if (error) console.warn(`afterAll: no se pudo purgar ${cruce}: ${error.message}`);
});

describe('C14 escaneo: UUID de otra entidad y cruce inexistente', () => {
  it('un UUID de individuo leído como cruce (QR pelado) responde «Cruce no encontrado» (P0002) y no escribe lectura en audit_log', async () => {
    const { error } = await operario.rpc('obtener_planta', { p_planta_id: individuoId });
    expect(error?.code).toBe('P0002');
    const { count } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('planta_id', individuoId);
    expect(count).toBe(0);
  });

  it('un UUID inexistente como cruce responde P0002; el id de un cruce como individuo resuelve null', async () => {
    const { error } = await operario.rpc('obtener_planta', { p_planta_id: randomUUID() });
    expect(error?.code).toBe('P0002');
    const { data, error: e2 } = await operario.from('individuos').select('id, planta_id').eq('id', cruce).maybeSingle();
    expect(e2).toBeNull();
    expect(data).toBeNull();
  });

  it('los intentos fallidos no gastan el límite de 20 lecturas por minuto de obtener_planta', async () => {
    for (let i = 0; i < 25; i++) {
      const { error } = await operario.rpc('obtener_planta', { p_planta_id: individuoId });
      expect(error?.code).toBe('P0002');
    }
    const { error } = await operario.rpc('obtener_planta', { p_planta_id: cruce });
    expect(error).toBeNull();
  });

  it('la resolución del individuo devuelve lo mínimo para navegar y nada del cruce más allá del id', async () => {
    const { data, error } = await operario.from('individuos').select('id, planta_id, codigo_display, estado_vital').eq('id', individuoId).maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ id: individuoId, planta_id: cruce, codigo_display: `AUD-G4-QR-${R}-P1`, estado_vital: 'vivo' });
  });
});
