/**
 * M-08: una ronda con una métrica de scoring que proviene de una visita
 * marcada (requiere_revision) queda fuera de las TRES salidas del motor:
 * ranking (motivo contiene_metrica_marcada), serie histórica y comparación
 * de rondas. Decisión de dominio en 20260923134041; series y comparación la
 * aplican desde 20261004131000.
 *
 * Fixture propio (especie nueva, fechas de 2029): un individuo "control" con
 * dos rondas limpias y completas, y un individuo "marcado" cuya ronda 2 toma
 * calibre_mm de una visita en revisión (calibre ≥ límite de revisión 40) y
 * cuya visita representativa, la más reciente, está limpia. Así el motivo
 * esperado es exactamente contiene_metrica_marcada y no requiere_revision.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { limpiarPrueba } from './limpieza-pruebas';

/** Las 20 métricas de la versión global activa, con valores dentro de rango. */
const VISITA_COMPLETA = {
  cantidad_frutos: 10,
  peso_total_g: 100,
  brotacion: 3,
  floracion: 3,
  cuaja: 3,
  concentracion_cosecha: 3,
  calibre_mm: 20,
  firmeza: 3,
  bloom: 3,
  brix: 15,
  rend_kg_planta: 3,
  rend_t_ha: 3,
  pct_fruta_exportable: 50,
  dano_calor: 3,
  golpe_sol: 3,
  caida_fruto: 3,
  presencia_yemas_florales: 3,
  precocidad: 3,
  vigor_vegetativo: 3,
  color_follaje: 3,
  n_varas_basales: 10,
  n_varas_con_flor: 5,
  n_flores_varas_basales: 20,
  n_frutos_varas_basales: 10,
};

describe('gate de métrica marcada en ranking, serie y comparación', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let operarioId: string;
  let especieId: string;
  let plantaId: string;
  let versionId: string;
  let individuoControlId: string;
  let individuoMarcadoId: string;
  let visitaMarcadaId: string;

  async function crearIndividuo(fecha: string): Promise<string> {
    const { data, error } = await service
      .from('individuos')
      .insert({ planta_id: plantaId, codigo_display: 'GENERADO-POR-TRIGGER', fecha_individualizacion: fecha, created_by: operarioId })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('No se creó el individuo');
    return data.id as string;
  }

  async function crearRonda(individuoId: string, numero: number, fechaInicio: string): Promise<string> {
    const { data, error } = await service
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuoId, numero_ronda: numero, anio: 2029, fecha_inicio: fechaInicio, created_by: operarioId })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('No se creó la ronda');
    return data.id as string;
  }

  async function evaluar(rondaId: string, fecha: string, campos: Record<string, unknown>): Promise<string> {
    const { data, error } = await operario
      .from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha, estado: 'completa', created_by: operarioId, ...campos })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('No se creó la evaluación');
    return data.id as string;
  }

  beforeAll(async () => {
    const sufijo = Date.now();
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const usuario = await crearUsuarioDePrueba(creds, service, { email: `gate-marcada-${sufijo}@test.local`, rol: 'operario' });
    operario = usuario.client;
    operarioId = usuario.userId;

    const { data: especie, error: especieError } = await service
      .from('especies').insert({ nombre: `Gate marcada ${sufijo}` }).select('id').single();
    if (especieError || !especie) throw especieError ?? new Error('No se creó la especie');
    especieId = especie.id;

    const { data: planta, error: plantaError } = await service
      .from('plantas').insert({ codigo_sistema: `GATE-${sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true }).select('id').single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creó la planta');
    plantaId = planta.id;

    const { data: version, error: versionError } = await service
      .from('scoring_version').select('id').eq('estado', 'activa').is('especie_id', null).eq('fase', 'evaluacion_anual').single();
    if (versionError || !version) throw versionError ?? new Error('No existe la versión global activa');
    versionId = version.id;

    individuoControlId = await crearIndividuo('2028-12-01');
    await evaluar(await crearRonda(individuoControlId, 1, '2029-01-01'), '2029-01-10', VISITA_COMPLETA);
    await evaluar(await crearRonda(individuoControlId, 2, '2029-02-01'), '2029-02-10', VISITA_COMPLETA);

    individuoMarcadoId = await crearIndividuo('2028-12-01');
    await evaluar(await crearRonda(individuoMarcadoId, 1, '2029-01-01'), '2029-01-15', VISITA_COMPLETA);
    const rondaMarcada = await crearRonda(individuoMarcadoId, 2, '2029-02-01');
    visitaMarcadaId = await evaluar(rondaMarcada, '2029-02-05', { ...VISITA_COMPLETA, calibre_mm: 45 });
    // Visita representativa limpia y posterior: no aporta calibre, así que el
    // calibre unificado sigue saliendo de la visita en revisión.
    await evaluar(rondaMarcada, '2029-02-20', { sin_muestra: true, brotacion: 4 });
  }, 60_000);

  afterAll(async () => {
    await limpiarPrueba(service, { plantaIds: [plantaId], especieIds: [especieId], usuarioIds: [operarioId] }, 'gate-marcada');
  }, 60_000);

  it('el fixture produce una visita en revisión (calibre sobre el límite)', async () => {
    const { data, error } = await service.from('evaluaciones').select('requiere_revision').eq('id', visitaMarcadaId).single();
    if (error) throw error;
    expect(data.requiere_revision).toBe(true);
  });

  it('ranking: el control es elegible y el marcado queda fuera con contiene_metrica_marcada', async () => {
    const { data, error } = await operario.rpc('calcular_ranking_operativo', {
      p_scoring_version_id: versionId,
      p_planta_id: plantaId,
      p_especie_id: especieId,
    });
    if (error) throw error;
    const filas = data as Array<{ individuo_id: string; elegible: boolean; motivo_exclusion: string | null }>;
    const control = filas.find((fila) => fila.individuo_id === individuoControlId);
    const marcado = filas.find((fila) => fila.individuo_id === individuoMarcadoId);
    expect(control).toMatchObject({ elegible: true, motivo_exclusion: null });
    expect(marcado).toMatchObject({ elegible: false, motivo_exclusion: 'contiene_metrica_marcada' });
  });

  it('serie histórica: la ronda marcada no cuenta en su mes', async () => {
    const { data, error } = await operario.rpc('obtener_series_historicas_cientificas', {
      p_especie_id: especieId,
      p_planta_id: plantaId,
      p_fecha_desde: '2029-01-01',
      p_fecha_hasta: '2029-02-28',
    });
    if (error) throw error;
    const serie = (data as { scoring: Array<{ periodo: string; evaluaciones_elegibles: number }> }).scoring;
    // Enero: ronda 1 del control y del marcado (ambas limpias). Febrero: solo
    // la ronda 2 del control; la ronda 2 del marcado queda fuera.
    expect(serie.find((mes) => mes.periodo === '2029-01-01')?.evaluaciones_elegibles).toBe(2);
    expect(serie.find((mes) => mes.periodo === '2029-02-01')?.evaluaciones_elegibles).toBe(1);
  });

  it('comparación de rondas: el par que incluye la ronda marcada desaparece', async () => {
    const { data, error } = await operario.rpc('obtener_comparacion_rondas', { p_planta_id: plantaId });
    if (error) throw error;
    const individuos = (data as { individuos: Array<{ individuo_id: string; numero_actual: number }> }).individuos;
    expect(individuos.some((fila) => fila.individuo_id === individuoControlId && fila.numero_actual === 2)).toBe(true);
    expect(individuos.some((fila) => fila.individuo_id === individuoMarcadoId)).toBe(false);
  });
});
