import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { limpiarPrueba } from './limpieza-pruebas';

describe('un solo borrador activo por ronda', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let admin: SupabaseClient;
  let operarioId: string;
  let adminId: string;
  let especieId: string;
  let plantaId: string;

  beforeAll(async () => {
    const sufijo = Date.now();
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const usuarioOperario = await crearUsuarioDePrueba(creds, service, {
      email: `borrador-unico-operario-${sufijo}@test.local`,
      rol: 'operario',
    });
    const usuarioAdmin = await crearUsuarioDePrueba(creds, service, {
      email: `borrador-unico-admin-${sufijo}@test.local`,
      rol: 'admin',
    });
    operario = usuarioOperario.client;
    admin = usuarioAdmin.client;
    operarioId = usuarioOperario.userId;
    adminId = usuarioAdmin.userId;

    const { data: especie, error: especieError } = await service
      .from('especies')
      .insert({ nombre: `Borrador unico ${sufijo}` })
      .select('id')
      .single();
    if (especieError || !especie) throw especieError ?? new Error('No se creo la especie');
    especieId = especie.id;

    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({ codigo_sistema: `BORR-${sufijo}`, especie_id: especie.id, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creo la planta');
    plantaId = planta.id;
  }, 60_000);

  afterAll(async () => {
    await limpiarPrueba(service, { plantaIds: [plantaId], especieIds: [especieId], usuarioIds: [operarioId, adminId] }, 'borrador-unico');
  }, 60_000);

  const crearRonda = async (sufijo: string) => {
    const { data: individuo, error: individuoError } = await service
      .from('individuos')
      .insert({
        planta_id: plantaId,
        codigo_display: 'GENERADO-POR-TRIGGER',
        fecha_individualizacion: '2027-01-01',
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (individuoError || !individuo) throw individuoError ?? new Error(`No se creo individuo ${sufijo}`);

    const { data: ronda, error: rondaError } = await service
      .from('ronda_evaluacion_anual')
      .insert({
        individuo_id: individuo.id,
        numero_ronda: 1,
        anio: 2027,
        fecha_inicio: '2027-01-01',
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (rondaError || !ronda) throw rondaError ?? new Error(`No se creo ronda ${sufijo}`);
    return ronda.id as string;
  };

  const crearBorrador = async (rondaId: string, fecha: string) => operario
    .from('evaluaciones')
    .insert({ ronda_id: rondaId, fecha, estado: 'borrador', created_by: operarioId })
    .select('id')
    .single();

  it('rechaza el segundo borrador de la misma ronda con unique_violation', async () => {
    const rondaId = await crearRonda('duplicado');
    const primero = await crearBorrador(rondaId, '2027-01-10');
    expect(primero.error).toBeNull();

    const segundo = await crearBorrador(rondaId, '2027-01-11');
    expect(segundo.error?.code).toBe('23505');
    expect(segundo.error?.message).toContain('evaluaciones_un_borrador_activo_por_ronda_uidx');
  });

  it.each(['completa', 'corregida', 'anulada'] as const)(
    'permite otro borrador cuando el anterior pasa a %s',
    async (estado) => {
      const rondaId = await crearRonda(estado);
      const primero = await crearBorrador(rondaId, '2027-02-10');
      if (primero.error || !primero.data) throw primero.error ?? new Error('No se creo el primer borrador');

      const cambios = estado === 'completa'
        ? { estado, sin_muestra: true }
        : estado === 'corregida'
          ? { estado, sin_muestra: true, motivo_cambio: 'Correccion para verificar borrador unico' }
          : { estado, motivo_cambio: 'Anulacion para verificar borrador unico' };
      const cliente = estado === 'corregida' ? admin : operario;
      const { error: transicionError } = await cliente
        .from('evaluaciones')
        .update(cambios)
        .eq('id', primero.data.id);
      if (transicionError) throw transicionError;

      const siguiente = await crearBorrador(rondaId, '2027-02-11');
      expect(siguiente.error).toBeNull();
      expect(siguiente.data?.id).toBeTruthy();
    },
  );
});
