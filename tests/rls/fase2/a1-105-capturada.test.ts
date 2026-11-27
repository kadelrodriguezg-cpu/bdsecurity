// Fase 2, Sprint 1 — A1-105 (G11-02): la unificación de una ronda desempata por
// capturada_at, inmutable (20261023130000_fase2_a1_105_capturada_at.sql).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';
import { limpiarPrueba } from '../limpieza-pruebas';

describe('A1-105: capturada_at inmutable y unificación estable ante correcciones', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let admin: SupabaseClient;
  let operarioId: string;
  let rondaId: string;
  let plantaId: string;
  const sufijo = Date.now();

  beforeAll(async () => {
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const u = await crearUsuarioDePrueba(creds, service, { email: `a1105-op-${sufijo}@test.local`, rol: 'operario' });
    operario = u.client;
    operarioId = u.userId;
    admin = (await crearUsuarioDePrueba(creds, service, { email: 'a1105-admin@test.local', rol: 'admin' })).client;
    const { data: esp } = await service.from('especies').select('id').limit(1).single();
    const { data: planta, error: e0 } = await service.from('plantas')
      .insert({ codigo_sistema: `A1105-${sufijo}`, especie_id: esp!.id, estado: 'evaluacion_anual', es_prueba: true }).select('id').single();
    if (e0 || !planta) throw e0 ?? new Error('No se creó la planta');
    plantaId = planta.id;
    const { data: ind, error: e1 } = await service.from('individuos').insert({
      planta_id: planta.id, codigo_display: 'GENERADO-POR-TRIGGER', fecha_individualizacion: '2027-01-05', created_by: operarioId,
    }).select('id').single();
    if (e1 || !ind) throw e1 ?? new Error('No se creó el individuo');
    const { data: ronda, error: e2 } = await service.from('ronda_evaluacion_anual').insert({
      individuo_id: ind.id, numero_ronda: 1, anio: 2027, fecha_inicio: '2027-01-01', created_by: operarioId,
    }).select('id').single();
    if (e2 || !ronda) throw e2 ?? new Error('No se creó la ronda');
    rondaId = ronda.id as string;
  }, 60_000);

  afterAll(async () => {
    // El admin es fijo (a1105-admin@test.local) y se reutiliza entre corridas: no se borra.
    await limpiarPrueba(service, { plantaIds: [plantaId], usuarioIds: [operarioId] }, 'a1-105');
  }, 60_000);

  const unificada = async () => {
    const { data, error } = await admin.rpc('unificar_evaluacion_ronda', { p_ronda_id: rondaId });
    expect(error).toBeNull();
    return (data as Array<Record<string, unknown>>)[0];
  };

  let primeraId: string;

  it('capturada_at la fija la base al insertar: lo que mande el cliente se ignora', async () => {
    const { data, error } = await operario.from('evaluaciones').insert({
      ronda_id: rondaId, fecha: '2027-03-01', estado: 'completa', created_by: operarioId,
      sin_muestra: true, brix: 140, firmeza: 3, capturada_at: '2000-01-01T00:00:00Z',
    }).select('id, capturada_at, created_at').single();
    expect(error).toBeNull();
    primeraId = data!.id as string;
    expect(new Date(data!.capturada_at as string).getFullYear()).toBeGreaterThan(2020);
    // Una segunda visita el mismo día, capturada después.
    await new Promise((r) => setTimeout(r, 20));
    const segunda = await operario.from('evaluaciones').insert({
      ronda_id: rondaId, fecha: '2027-03-01', estado: 'completa', created_by: operarioId, sin_muestra: true, firmeza: 5,
    }).select('capturada_at').single();
    expect(segunda.error).toBeNull();
    expect(new Date(segunda.data!.capturada_at as string).getTime()).toBeGreaterThan(new Date(data!.capturada_at as string).getTime());
  });

  it('nadie la cambia después, tampoco un admin', async () => {
    const { data: antes } = await admin.from('evaluaciones').select('capturada_at').eq('id', primeraId).single();
    const { data, error } = await admin.from('evaluaciones')
      .update({ capturada_at: '2099-01-01T00:00:00Z', observaciones: 'intento de mover la captura' })
      .eq('id', primeraId).select('capturada_at, observaciones').single();
    expect(error).toBeNull();
    expect(data!.observaciones).toBe('intento de mover la captura');
    expect(data!.capturada_at).toBe(antes!.capturada_at);
  });

  it('corregir el Brix de la primera visita no le devuelve su firmeza vieja a la ronda', async () => {
    expect(await unificada()).toMatchObject({ firmeza: 5, brix: 140 });
    const { error } = await admin.from('evaluaciones')
      .update({ estado: 'corregida', motivo_cambio: 'Brix tipeado como 140; la lectura fue 14', brix: 14 })
      .eq('id', primeraId);
    expect(error).toBeNull();
    // Antes de A1-105 la corrección movía updated_at y la firmeza volvía a 3.
    expect(await unificada()).toMatchObject({ firmeza: 5, brix: 14 });
  });
});
