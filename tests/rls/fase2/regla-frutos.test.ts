// Fase 2, Sprint 0 — regla de frutos por descriptores
// (20261022204000_fase2_regla_frutos_por_descriptores.sql).
// La muestra (cantidad y peso) se exige al finalizar SOLO si hay algún
// descriptor de fruta o de muestra: calibre, firmeza, color, bloom, brix,
// cantidad o peso. «Sin muestra de frutos» sigue eximiendo y los borradores
// no se validan.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';
import { limpiarPrueba } from '../limpieza-pruebas';

describe('regla de frutos por descriptores (Fase 2)', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let operarioId: string;
  let plantaId: string;
  let especieId: string;
  let secuencia = 0;

  beforeAll(async () => {
    const sufijo = Date.now();
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const usuario = await crearUsuarioDePrueba(creds, service, {
      email: `regla-frutos-${sufijo}@test.local`,
      rol: 'operario',
    });
    operario = usuario.client;
    operarioId = usuario.userId;

    const { data: especie, error: especieError } = await service
      .from('especies')
      .insert({ nombre: `Regla frutos ${sufijo}` })
      .select('id')
      .single();
    if (especieError || !especie) throw especieError ?? new Error('No se creó la especie');
    especieId = especie.id;

    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({ codigo_sistema: `RF-${sufijo}`, especie_id: especie.id, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creó la planta');
    plantaId = planta.id;
  }, 60_000);

  afterAll(async () => {
    await limpiarPrueba(service, { plantaIds: [plantaId], especieIds: [especieId], usuarioIds: [operarioId] }, 'regla-frutos');
  }, 60_000);

  async function crearRonda(): Promise<string> {
    secuencia += 1;
    const { data: individuo, error: individuoError } = await service
      .from('individuos')
      .insert({
        planta_id: plantaId,
        codigo_display: 'GENERADO-POR-TRIGGER',
        fecha_individualizacion: `2027-01-${String(secuencia).padStart(2, '0')}`,
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (individuoError || !individuo) throw individuoError ?? new Error('No se creó el individuo');
    const { data: ronda, error: rondaError } = await service
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo.id, numero_ronda: 1, anio: 2027, fecha_inicio: '2027-01-01', created_by: operarioId })
      .select('id')
      .single();
    if (rondaError || !ronda) throw rondaError ?? new Error('No se creó la ronda');
    return ronda.id as string;
  }

  const insertar = (rondaId: string, campos: Record<string, unknown>) =>
    operario.from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha: '2027-03-01', created_by: operarioId, ...campos })
      .select('id, estado, updated_at')
      .single();

  it('sin fruta: la evaluación finaliza sin muestra', async () => {
    const { data, error } = await insertar(await crearRonda(), {
      estado: 'completa', sin_muestra: false, brotacion: 4, n_varas_basales: 6, rend_kg_planta: 2.5,
    });
    expect(error).toBeNull();
    expect(data?.estado).toBe('completa');
  });

  it('sin ningún descriptor también finaliza (no se evaluó fruto)', async () => {
    const { error } = await insertar(await crearRonda(), { estado: 'completa', sin_muestra: false });
    expect(error).toBeNull();
  });

  it('con calibre y sin muestra: se rechaza con un mensaje claro', async () => {
    const { data, error } = await insertar(await crearRonda(), { estado: 'completa', sin_muestra: false, calibre_mm: 18 });
    expect(data).toBeNull();
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('Hay datos de fruta o de muestra: cantidad de frutos debe ser mayor que cero');
    expect(error?.message).toContain('Sin muestra de frutos');
  });

  it.each([
    ['firmeza', { firmeza: 3 }],
    ['color', { color: 3 }],
    ['bloom', { bloom: 3 }],
    ['brix', { brix: 12 }],
  ])('con %s y sin muestra: se rechaza', async (_nombre, campos) => {
    const { error } = await insertar(await crearRonda(), { estado: 'completa', ...campos });
    expect(error?.code).toBe('23514');
  });

  it('con cantidad pero sin peso: se rechaza por el peso', async () => {
    const { error } = await insertar(await crearRonda(), { estado: 'completa', cantidad_frutos: 10 });
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('peso total debe ser mayor que cero');
  });

  it('con calibre y «Sin muestra de frutos»: finaliza', async () => {
    const { data, error } = await insertar(await crearRonda(), { estado: 'completa', sin_muestra: true, calibre_mm: 18, brix: 13 });
    expect(error).toBeNull();
    expect(data?.estado).toBe('completa');
  });

  it('con calibre, cantidad y peso: finaliza', async () => {
    const { error } = await insertar(await crearRonda(), {
      estado: 'completa', calibre_mm: 18, cantidad_frutos: 10, peso_total_g: 25,
    });
    expect(error).toBeNull();
  });

  it('los borradores existentes no se rompen: se guardan sin muestra y se finalizan con la regla nueva', async () => {
    // Borrador con fruta y sin muestra: válido como borrador.
    const conFruta = await insertar(await crearRonda(), { estado: 'borrador', calibre_mm: 17 });
    expect(conFruta.error).toBeNull();
    const reguardado = await operario.from('evaluaciones')
      .update({ firmeza: 4 })
      .eq('id', conFruta.data!.id)
      .select('id, estado, updated_at')
      .single();
    expect(reguardado.error).toBeNull();
    expect(reguardado.data?.estado).toBe('borrador');
    // Finalizarlo sin muestra se rechaza; con muestra, pasa.
    const sinMuestra = await operario.from('evaluaciones').update({ estado: 'completa' }).eq('id', conFruta.data!.id).select('id').single();
    expect(sinMuestra.error?.code).toBe('23514');
    const conMuestra = await operario.from('evaluaciones')
      .update({ estado: 'completa', cantidad_frutos: 8, peso_total_g: 20 })
      .eq('id', conFruta.data!.id)
      .select('estado')
      .single();
    expect(conMuestra.error).toBeNull();
    expect(conMuestra.data?.estado).toBe('completa');

    // Borrador solo con fenología: antes no podía finalizar sin marcar «Sin muestra»; ahora sí.
    const fenologia = await insertar(await crearRonda(), { estado: 'borrador', floracion: 3 });
    expect(fenologia.error).toBeNull();
    const finalizado = await operario.from('evaluaciones')
      .update({ estado: 'completa' })
      .eq('id', fenologia.data!.id)
      .select('estado')
      .single();
    expect(finalizado.error).toBeNull();
    expect(finalizado.data?.estado).toBe('completa');
  });
});
