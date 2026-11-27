/**
 * Valores anteriores y nuevos al editar una evaluación (brecha B5, migración
 * 20261021121000).
 *
 * Se verifica contra la base local que una edición deja en
 * detalle.cambios solo las columnas modificadas, con su valor anterior y el
 * nuevo, sin updated_at, y que un UPDATE que no cambia nada no deja fila.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let plantaId: string;
let rondaId: string;

const R = Date.now();

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ad = await crearUsuarioDePrueba(creds, service, { email: 'admin@test.local', rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  operario = (await crearUsuarioDePrueba(creds, service, { email: 'operario@test.local', rol: 'operario' })).client;

  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  const { data: planta, error: errPlanta } = await service
    .from('plantas')
    .insert({ codigo_sistema: `EDEVAL-${R}`, especie_id: esp!.id, estado: 'evaluacion_anual', es_prueba: true })
    .select('id')
    .single();
  if (errPlanta || !planta) throw new Error(`setup planta: ${errPlanta?.message}`);
  plantaId = planta.id;

  const { data: individuo, error: errInd } = await service
    .from('individuos')
    .insert({ planta_id: plantaId, codigo_display: `EDEVAL-${R}-P01`, created_by: adminId })
    .select('id')
    .single();
  if (errInd || !individuo) throw new Error(`setup individuo: ${errInd?.message}`);

  const { data: ronda, error: errRonda } = await service
    .from('ronda_evaluacion_anual')
    .insert({ individuo_id: individuo.id, numero_ronda: 1, anio: 2026, created_by: adminId })
    .select('id')
    .single();
  if (errRonda || !ronda) throw new Error(`setup ronda: ${errRonda?.message}`);
  rondaId = ronda.id;
}, 60_000);

afterAll(async () => {
  // Cruce de prueba: la purga lo borra con todas sus filas dependientes.
  await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
});

async function ultimaEdicion(evaluacionId: string) {
  const { data, error } = await service
    .from('audit_log')
    .select('*')
    .eq('accion', 'edicion_evaluacion')
    .eq('detalle->>evaluacion_id', evaluacionId)
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0];
}

describe('edición de evaluación con valores anteriores y nuevos (B5)', () => {
  let evaluacionId: string;

  beforeAll(async () => {
    const { data, error } = await admin
      .from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha: '2026-10-21', estado: 'borrador', created_by: adminId, calibre_mm: 18, brix: 12 })
      .select('id')
      .single();
    if (error || !data) throw new Error(`setup evaluacion: ${error?.message}`);
    evaluacionId = data.id;
  });

  it('al editar calibre_mm el log guarda solo ese campo, con el valor anterior y el nuevo', async () => {
    const { error } = await admin.from('evaluaciones').update({ calibre_mm: 21.5 }).eq('id', evaluacionId);
    expect(error).toBeNull();

    const fila = await ultimaEdicion(evaluacionId);
    expect(fila).toBeDefined();
    expect(fila.usuario_id).toBe(adminId);
    expect(fila.planta_id).toBe(plantaId);
    expect(fila.detalle.anio).toBe(2026);
    expect(fila.detalle.cambios).toEqual({ calibre_mm: { anterior: 18, nuevo: 21.5 } });
  });

  it('varios campos a la vez, incluido pasar un valor a null', async () => {
    const { error } = await admin
      .from('evaluaciones')
      .update({ brix: null, observaciones: 'Corregido en terreno' })
      .eq('id', evaluacionId);
    expect(error).toBeNull();

    const fila = await ultimaEdicion(evaluacionId);
    expect(fila.detalle.cambios).toEqual({
      brix: { anterior: 12, nuevo: null },
      observaciones: { anterior: null, nuevo: 'Corregido en terreno' },
    });
  });

  it('un UPDATE sin cambios reales no deja fila (updated_at no cuenta)', async () => {
    const antes = await ultimaEdicion(evaluacionId);
    const { error } = await admin.from('evaluaciones').update({ calibre_mm: 21.5 }).eq('id', evaluacionId);
    expect(error).toBeNull();

    const despues = await ultimaEdicion(evaluacionId);
    expect(despues.id).toBe(antes.id);
  });

  it('el operario no puede leer los valores auditados', async () => {
    const { data, error } = await operario.from('audit_log').select('id').eq('accion', 'edicion_evaluacion');
    if (error) expect(error).toBeTruthy();
    else expect(data).toHaveLength(0);
  });
});
