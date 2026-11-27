/**
 * Versionado real del scoring (brecha B6, migraciones 20261021140000,
 * 20261021141000 y 20261021142000).
 *
 * El caso que motiva todo: agregar una métrica en una versión nueva NO debe
 * volver inelegibles, de forma retroactiva, las evaluaciones cerradas con la
 * versión anterior. Se prueba de punta a punta contra la base local con una
 * especie aislada y sus propias versiones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let especieId: string;
let plantaId: string;
let v1: string;
let v2: string;
let individuoViejo: string;
let rondaVieja: string;
let individuoNuevo: string;

const R = Date.now();
let n = 0;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ad = await crearUsuarioDePrueba(creds, service, { email: 'admin@test.local', rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  operario = (await crearUsuarioDePrueba(creds, service, { email: 'operario@test.local', rol: 'operario' })).client;

  const { data: especie, error: errEspecie } = await service
    .from('especies')
    .insert({ nombre: `Scoring versionado ${R}` })
    .select('id')
    .single();
  if (errEspecie || !especie) throw new Error(`setup especie: ${errEspecie?.message}`);
  especieId = especie.id;

  // V1: dos métricas, activa desde enero.
  const { data: version, error: errVersion } = await service
    .from('scoring_version')
    .insert({ nombre: `V1 versionado ${R}`, especie_id: especieId, fase: 'evaluacion_anual', vigente_desde: '2026-01-01', estado: 'activa' })
    .select('id')
    .single();
  if (errVersion || !version) throw new Error(`setup version: ${errVersion?.message}`);
  v1 = version.id;
  const { error: errMetricas } = await service.from('scoring_metrica').insert([
    { scoring_version_id: v1, categoria: 'fruto_calidad', metrica: 'firmeza', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 1 },
    { scoring_version_id: v1, categoria: 'fruto_calidad', metrica: 'brix', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 10, maximo_normalizacion: 20, orden: 2 },
  ]);
  if (errMetricas) throw new Error(`setup metricas: ${errMetricas.message}`);

  const { data: planta, error: errPlanta } = await service
    .from('plantas')
    .insert({ codigo_sistema: `SVER-${R}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true })
    .select('id')
    .single();
  if (errPlanta || !planta) throw new Error(`setup planta: ${errPlanta?.message}`);
  plantaId = planta.id;

  // Individuo evaluado y cerrado mientras V1 era la vigente.
  ({ individuoId: individuoViejo, rondaId: rondaVieja } = await individuoConRonda());
  await cerrarEvaluacion(rondaVieja, '2026-06-01');
}, 60_000);

afterAll(async () => {
  // Con evaluaciones cerradas la purga permanente se rechaza por diseño.
  await service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', plantaId);
});

async function individuoConRonda() {
  const { data: individuo, error } = await service
    .from('individuos')
    .insert({ planta_id: plantaId, codigo_display: `SVER-${R}-${++n}`, created_by: adminId })
    .select('id')
    .single();
  if (error || !individuo) throw new Error(`setup individuo: ${error?.message}`);
  const { data: ronda, error: errRonda } = await service
    .from('ronda_evaluacion_anual')
    .insert({ individuo_id: individuo.id, numero_ronda: 1, anio: 2026, created_by: adminId })
    .select('id')
    .single();
  if (errRonda || !ronda) throw new Error(`setup ronda: ${errRonda?.message}`);
  return { individuoId: individuo.id as string, rondaId: ronda.id as string };
}

/** Evaluación completa con firmeza y brix, SIN calibre_mm (la métrica que agrega V2). */
async function cerrarEvaluacion(rondaId: string, fecha: string) {
  const { error } = await service
    .from('evaluaciones')
    .insert({ ronda_id: rondaId, fecha, estado: 'completa', created_by: adminId, firmeza: 4, brix: 15, cantidad_frutos: 10, peso_total_g: 100 });
  if (error) throw new Error(`setup evaluacion: ${error.message}`);
}

async function versionDeRonda(rondaId: string) {
  const { data } = await service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', rondaId).single();
  return data!.scoring_version_id as string | null;
}

describe('la ronda queda ligada a la versión con que se cerró (B6)', () => {
  it('al cerrar la primera evaluación, la ronda se liga a la versión vigente en esa fecha', async () => {
    expect(await versionDeRonda(rondaVieja)).toBe(v1);
  });

  it('una ronda sin evaluaciones cerradas no se liga', async () => {
    const { rondaId } = await individuoConRonda();
    const { error } = await service
      .from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha: '2026-06-02', estado: 'borrador', created_by: adminId, firmeza: 3 });
    expect(error).toBeNull();
    expect(await versionDeRonda(rondaId)).toBeNull();
  });

  it('el operario ve la ligadura pero no puede cambiarla', async () => {
    const { data, error } = await operario.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', rondaVieja).single();
    expect(error).toBeNull();
    expect(data!.scoring_version_id).toBe(v1);

    const { data: cambiadas } = await operario
      .from('ronda_evaluacion_anual')
      .update({ scoring_version_id: null })
      .eq('id', rondaVieja)
      .select('id');
    expect(cambiadas ?? []).toHaveLength(0);
    expect(await versionDeRonda(rondaVieja)).toBe(v1);
  });
});

describe('una versión en uso no se modifica (B6)', () => {
  it('no se pueden cambiar, agregar ni quitar métricas de una versión en uso', async () => {
    const { error: errUpdate } = await admin.from('scoring_metrica').update({ peso: 2 }).eq('scoring_version_id', v1).eq('metrica', 'firmeza');
    expect(errUpdate?.code).toBe('55000');

    const { error: errInsert } = await service.from('scoring_metrica').insert({
      scoring_version_id: v1, categoria: 'fruto_calidad', metrica: 'calibre_mm', peso: 1,
      direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 10, maximo_normalizacion: 30, orden: 3,
    });
    expect(errInsert?.code).toBe('55000');

    const { error: errDelete } = await service.from('scoring_metrica').delete().eq('scoring_version_id', v1).eq('metrica', 'brix');
    expect(errDelete?.code).toBe('55000');

    const { data: metricas } = await service.from('scoring_metrica').select('metrica, peso').eq('scoring_version_id', v1).order('orden');
    expect(metricas).toEqual([{ metrica: 'firmeza', peso: 1 }, { metrica: 'brix', peso: 1 }]);
  });

  it('no se cambia el alcance ni la vigencia de inicio, pero sí la nota', async () => {
    const { error: errAlcance } = await service.from('scoring_version').update({ vigente_desde: '2025-01-01' }).eq('id', v1);
    expect(errAlcance?.code).toBe('55000');

    const { error: errNota } = await service.from('scoring_version').update({ nota: 'Nota editable' }).eq('id', v1);
    expect(errNota).toBeNull();
  });
});

describe('nueva_version_scoring y activar_version_scoring (B6)', () => {
  it('solo un admin crea versiones', async () => {
    const { error } = await operario.rpc('nueva_version_scoring', { p_version_base_id: v1, p_nombre: `No ${R}`, p_vigente_desde: '2026-07-01' });
    expect(error?.code).toBe('42501');
  });

  it('copia la versión como borrador editable', async () => {
    const { data, error } = await admin.rpc('nueva_version_scoring', {
      p_version_base_id: v1, p_nombre: `V2 versionado ${R}`, p_vigente_desde: '2026-07-01', p_nota: 'Agrega calibre',
    });
    expect(error).toBeNull();
    v2 = data as string;

    const { data: version } = await service.from('scoring_version').select('estado, especie_id, fase, vigente_desde, nota').eq('id', v2).single();
    expect(version).toEqual({ estado: 'borrador', especie_id: especieId, fase: 'evaluacion_anual', vigente_desde: '2026-07-01', nota: 'Agrega calibre' });

    const { data: copiadas } = await service.from('scoring_metrica').select('metrica').eq('scoring_version_id', v2).order('orden');
    expect(copiadas!.map((m) => m.metrica)).toEqual(['firmeza', 'brix']);

    // El borrador no está en uso: el admin le agrega la métrica nueva.
    const { error: errNueva } = await admin.from('scoring_metrica').insert({
      scoring_version_id: v2, categoria: 'fruto_calidad', metrica: 'calibre_mm', peso: 1,
      direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 10, maximo_normalizacion: 30, orden: 3,
    });
    expect(errNueva).toBeNull();
  });

  it('activar retira la versión anterior del mismo alcance en una sola operación', async () => {
    const { error } = await admin.rpc('activar_version_scoring', { p_version_id: v2 });
    expect(error).toBeNull();

    const { data: versiones } = await service
      .from('scoring_version')
      .select('id, estado, vigente_hasta')
      .in('id', [v1, v2]);
    expect(versiones).toContainEqual({ id: v1, estado: 'inactiva', vigente_hasta: '2026-06-30' });
    expect(versiones).toContainEqual({ id: v2, estado: 'activa', vigente_hasta: null });
  });
});

describe('agregar una métrica ya no deja inelegibles las evaluaciones anteriores (B6)', () => {
  beforeAll(async () => {
    // Individuo evaluado DESPUÉS de activar V2, sin la métrica nueva.
    const nuevo = await individuoConRonda();
    individuoNuevo = nuevo.individuoId;
    await cerrarEvaluacion(nuevo.rondaId, '2026-08-01');
    expect(await versionDeRonda(nuevo.rondaId)).toBe(v2);
  });

  async function ranking() {
    const { data, error } = await operario.rpc('obtener_ranking_operativo', { p_especie_id: especieId, p_limite: 100 });
    expect(error).toBeNull();
    const items = (data as { items: Array<Record<string, unknown>>; scoring_version_id: string }).items;
    return { porIndividuo: new Map(items.map((i) => [i.individuo_id, i])), versionActual: (data as { scoring_version_id: string }).scoring_version_id };
  }

  it('el ranking operativo mide a todos con UNA versión, la activa', async () => {
    const { porIndividuo, versionActual } = await ranking();
    expect(versionActual).toBe(v2);
    for (const individuo of [individuoViejo, individuoNuevo]) {
      expect(porIndividuo.get(individuo)).toMatchObject({
        elegible: false,
        scoring_version_id: v2,
        motivo_exclusion: 'evaluacion_parcial_en_curso',
      });
    }
  });

  it('el snapshot congela cada ronda con la versión con que se cerró', async () => {
    const { data: snapshotId, error } = await admin.rpc('congelar_ranking', {
      p_nombre: `Snapshot versionado ${R}`, p_especie_id: especieId,
    });
    expect(error).toBeNull();
    // El snapshot guarda solo los elegibles: el viejo (V1 completa) entra, el
    // nuevo (V2 sin calibre) no.
    const { data: filas } = await service
      .from('ranking_snapshot_resultado')
      .select('individuo_id, detalle')
      .eq('snapshot_id', snapshotId as string);
    const porIndividuo = new Map((filas ?? []).map((f) => [f.individuo_id, f.detalle as { scoring_version_id: string }]));
    expect(porIndividuo.get(individuoViejo)?.scoring_version_id).toBe(v1);
    expect(porIndividuo.has(individuoNuevo)).toBe(false);
  });

  it('con una versión elegida (p_por_ronda = false) todas se calculan con esa versión', async () => {
    const { data, error } = await operario.rpc('calcular_ranking_operativo', {
      p_scoring_version_id: v2, p_planta_id: plantaId, p_especie_id: especieId,
    });
    expect(error).toBeNull();
    const viejo = (data as Array<Record<string, unknown>>).find((f) => f.individuo_id === individuoViejo);
    expect(viejo).toMatchObject({ elegible: false, scoring_version_id: v2, motivo_exclusion: 'evaluacion_parcial_en_curso' });
  });

  it('las series históricas también usan la versión de la ronda', async () => {
    const { data, error } = await operario.rpc('obtener_series_historicas_cientificas', {
      p_especie_id: especieId, p_planta_id: plantaId, p_fecha_desde: '2026-06-01', p_fecha_hasta: '2026-06-30',
    });
    expect(error).toBeNull();
    const junio = (data as { scoring: Array<{ evaluaciones_elegibles: number }> }).scoring[0];
    expect(junio.evaluaciones_elegibles).toBe(1);
  });
});
