/**
 * Escenario empirico de D2: una ronda anual se completa en varias visitas.
 * Cada descriptor debe usar su valor no nulo mas reciente, sin mezclar la
 * tripleta fisica cantidad/peso/promedio entre muestras distintas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { limpiarPrueba } from './limpieza-pruebas';
import { puntajeEsperado, subpuntajesEsperados } from './scoring-esperado';

describe('unificacion por descriptor para scoring', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let operarioId: string;
  let especieId: string;
  let plantaId: string;
  let versionId: string;
  let individuoMultivisitaId: string;
  let individuoUnaVisitaId: string;
  let evaluacionEneroId: string;
  let evaluacionUnicaId: string;
  let rondaTripletaDivididaId: string;
  let rondaTripletaCompletaAnteriorId: string;
  let individuoComparacionId: string;

  const crearIndividuoConRonda = async (fechaIndividualizacion: string, fechaInicio: string) => {
    const { data: individuo, error: individuoError } = await service
      .from('individuos')
      .insert({
        planta_id: plantaId,
        codigo_display: 'GENERADO-POR-TRIGGER',
        fecha_individualizacion: fechaIndividualizacion,
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (individuoError || !individuo) throw individuoError ?? new Error('No se creo el individuo');

    const { data: ronda, error: rondaError } = await service
      .from('ronda_evaluacion_anual')
      .insert({
        individuo_id: individuo.id,
        numero_ronda: 1,
        anio: 2027,
        fecha_inicio: fechaInicio,
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (rondaError || !ronda) throw rondaError ?? new Error('No se creo la ronda');

    return { individuoId: individuo.id as string, rondaId: ronda.id as string };
  };

  beforeAll(async () => {
    const sufijo = Date.now();
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const usuario = await crearUsuarioDePrueba(creds, service, {
      email: `scoring-unificacion-${sufijo}@test.local`,
      rol: 'operario',
    });
    operario = usuario.client;
    operarioId = usuario.userId;

    const { data: especie, error: especieError } = await service
      .from('especies')
      .insert({ nombre: `Scoring unificacion ${sufijo}` })
      .select('id')
      .single();
    if (especieError || !especie) throw especieError ?? new Error('No se creo la especie');
    especieId = especie.id;

    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({ codigo_sistema: `SUNI-${sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creo la planta');
    plantaId = planta.id;

    const { data: version, error: versionError } = await service
      .from('scoring_version')
      .select('id')
      .eq('estado', 'activa')
      .is('especie_id', null)
      .eq('fase', 'evaluacion_anual')
      .single();
    if (versionError || !version) throw versionError ?? new Error('No existe la version global activa');
    versionId = version.id;

    const multivisita = await crearIndividuoConRonda('2027-08-01', '2027-08-01');
    individuoMultivisitaId = multivisita.individuoId;

    const { error: agostoError } = await operario.from('evaluaciones').insert({
      ronda_id: multivisita.rondaId,
      fecha: '2027-08-15',
      estado: 'completa',
      sin_muestra: true,
      brotacion: 5,
      floracion: 1,
      cuaja: 1,
      concentracion_cosecha: 3,
      presencia_yemas_florales: 5,
      precocidad: 3,
      created_by: operarioId,
    });
    if (agostoError) throw agostoError;

    const { error: noviembreError } = await operario.from('evaluaciones').insert({
      ronda_id: multivisita.rondaId,
      fecha: '2027-11-15',
      estado: 'completa',
      sin_muestra: true,
      calibre_mm: 24,
      cuaja: 5,
      created_by: operarioId,
    });
    if (noviembreError) throw noviembreError;

    const { data: enero, error: eneroError } = await operario
      .from('evaluaciones')
      .insert({
        ronda_id: multivisita.rondaId,
        fecha: '2028-01-15',
        estado: 'completa',
        cantidad_frutos: 10,
        peso_total_g: 100,
        firmeza: 1,
        bloom: 5,
        brix: 18,
        rend_kg_planta: 5,
        rend_t_ha: 1,
        // Dominio 0-100 desde 20260922225105 (antes 1-5, donde 3 era el medio).
        pct_fruta_exportable: 50,
        n_varas_basales: 10, // pct_flores = 5/10 = 50 %
        n_varas_con_flor: 5,
        n_flores_varas_basales: 20, // pct_frutos = 10/20 = 50 %
        n_frutos_varas_basales: 10,
        dano_calor: 1,
        golpe_sol: 3,
        caida_fruto: 5,
        vigor_vegetativo: 3,
        color_follaje: 3,
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (eneroError || !enero) throw eneroError ?? new Error('No se creo la visita de enero');
    evaluacionEneroId = enero.id;

    const unaVisita = await crearIndividuoConRonda('2027-09-01', '2027-09-01');
    individuoUnaVisitaId = unaVisita.individuoId;
    const { data: unica, error: unicaError } = await operario
      .from('evaluaciones')
      .insert({
        ronda_id: unaVisita.rondaId,
        fecha: '2027-09-20',
        estado: 'completa',
        cantidad_frutos: 10,
        peso_total_g: 100,
        brotacion: 5,
        floracion: 1,
        cuaja: 5,
        concentracion_cosecha: 3,
        presencia_yemas_florales: 5,
        precocidad: 3,
        calibre_mm: 24,
        firmeza: 1,
        bloom: 5,
        brix: 18,
        rend_kg_planta: 5,
        rend_t_ha: 1,
        pct_fruta_exportable: 50,
        n_varas_basales: 10,
        n_varas_con_flor: 5,
        n_flores_varas_basales: 20,
        n_frutos_varas_basales: 10,
        dano_calor: 1,
        golpe_sol: 3,
        caida_fruto: 5,
        vigor_vegetativo: 3,
        color_follaje: 3,
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (unicaError || !unica) throw unicaError ?? new Error('No se creo la evaluacion unica');
    evaluacionUnicaId = unica.id;

    const tripletaDividida = await crearIndividuoConRonda('2027-10-01', '2027-10-01');
    rondaTripletaDivididaId = tripletaDividida.rondaId;
    const { error: cantidadSeparadaError } = await operario.from('evaluaciones').insert({
      ronda_id: rondaTripletaDivididaId,
      fecha: '2027-10-10',
      estado: 'completa',
      sin_muestra: true,
      cantidad_frutos: 10,
      created_by: operarioId,
    });
    if (cantidadSeparadaError) throw cantidadSeparadaError;
    const { error: pesoSeparadoError } = await operario.from('evaluaciones').insert({
      ronda_id: rondaTripletaDivididaId,
      fecha: '2027-10-20',
      estado: 'completa',
      sin_muestra: true,
      peso_total_g: 120,
      created_by: operarioId,
    });
    if (pesoSeparadoError) throw pesoSeparadoError;

    const tripletaCompletaAnterior = await crearIndividuoConRonda('2027-11-01', '2027-11-01');
    rondaTripletaCompletaAnteriorId = tripletaCompletaAnterior.rondaId;
    const { error: muestraCompletaError } = await operario.from('evaluaciones').insert({
      ronda_id: rondaTripletaCompletaAnteriorId,
      fecha: '2027-11-10',
      estado: 'completa',
      cantidad_frutos: 10,
      peso_total_g: 100,
      created_by: operarioId,
    });
    if (muestraCompletaError) throw muestraCompletaError;
    const { error: muestraParcialPosteriorError } = await operario.from('evaluaciones').insert({
      ronda_id: rondaTripletaCompletaAnteriorId,
      fecha: '2027-11-20',
      estado: 'completa',
      sin_muestra: true,
      cantidad_frutos: 20,
      created_by: operarioId,
    });
    if (muestraParcialPosteriorError) throw muestraParcialPosteriorError;

    const comparacion = await crearIndividuoConRonda('2027-03-01', '2027-03-01');
    individuoComparacionId = comparacion.individuoId;
    const { error: comparacionFenologiaError } = await operario.from('evaluaciones').insert({
      ronda_id: comparacion.rondaId,
      fecha: '2027-03-10',
      estado: 'completa',
      sin_muestra: true,
      cuaja: 5,
      created_by: operarioId,
    });
    if (comparacionFenologiaError) throw comparacionFenologiaError;
    const { error: comparacionFrutoError } = await operario.from('evaluaciones').insert({
      ronda_id: comparacion.rondaId,
      fecha: '2027-03-20',
      estado: 'completa',
      sin_muestra: true,
      brix: 18,
      created_by: operarioId,
    });
    if (comparacionFrutoError) throw comparacionFrutoError;

    const { data: rondaComparacionDos, error: rondaComparacionDosError } = await service
      .from('ronda_evaluacion_anual')
      .insert({
        individuo_id: individuoComparacionId,
        numero_ronda: 2,
        anio: 2027,
        fecha_inicio: '2027-04-01',
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (rondaComparacionDosError || !rondaComparacionDos) {
      throw rondaComparacionDosError ?? new Error('No se creo la segunda ronda de comparacion');
    }
    const { error: comparacionDosError } = await operario.from('evaluaciones').insert({
      ronda_id: rondaComparacionDos.id,
      fecha: '2027-04-10',
      estado: 'completa',
      sin_muestra: true,
      cuaja: 1,
      brix: 10,
      created_by: operarioId,
    });
    if (comparacionDosError) throw comparacionDosError;
  }, 60_000);

  afterAll(async () => {
    await limpiarPrueba(service, { plantaIds: [plantaId], especieIds: [especieId], usuarioIds: [operarioId] }, 'scoring-unificacion');
  }, 60_000);

  /**
   * Puntaje esperado de la ronda unificada (multivisita) y de la visita única,
   * que llevan los mismos valores. Normalizados a mano con los dominios de la
   * versión activa:
   * - Fenología (1-5; presencia 0-5): brotación 5 → 1; floración 1 → 0;
   *   cuaja 5 → 1 (noviembre); concentración 3 → 0.5; presencia 5 → 1;
   *   precocidad 3 → 0.5.
   *   (0.034·1 + 0.034·0 + 0.033·1 + 0.033·0.5 + 0.033·1 + 0.033·0.5)/0.2 = 0.133/0.2 = 0.665.
   * - Fruto/calidad: firmeza 1 → 0; calibre 24 (14-24) → 1; brix 18 (10-18) → 1;
   *   bloom 5 → 1. (0·4 + 1·3 + 1·2 + 1·1)/10 = 0.6.
   * - Producción: rend_kg_planta 5 → 1; rend_t_ha 1 → 0; pct_fruta_exportable,
   *   pct_flores y pct_frutos 50 (0-100) → 0.5. (1 + 0 + 0.5·3)·0.06/0.30 = 0.5.
   * - Estrés: daño 1 (menor) → 1; golpe 3 → 0.5; caída 5 (menor) → 0; vigor 3
   *   → 0.5; color de follaje 3 → 0.5. (1 + 0.5 + 0 + 0.5 + 0.5)/5 = 0.5.
   * Puntaje = 0.665·0.20 + 0.6·0.40 + 0.5·0.30 + 0.5·0.10 = 0.133 + 0.24 + 0.15 + 0.05 = 0.573.
   */
  const normalizadosRonda = {
    brotacion: 1, floracion: 0, cuaja: 1, concentracion_cosecha: 0.5, presencia_yemas_florales: 1, precocidad: 0.5,
    firmeza: 0, calibre_mm: 1, brix: 1, bloom: 1,
    rend_kg_planta: 1, rend_t_ha: 0, pct_fruta_exportable: 0.5, pct_flores: 0.5, pct_frutos: 0.5,
    dano_calor: 1, golpe_sol: 0.5, caida_fruto: 0, vigor_vegetativo: 0.5, color_follaje: 0.5,
  };
  const puntajeRonda = puntajeEsperado(normalizadosRonda);

  it('el cálculo independiente reproduce la cuenta a mano', () => {
    expect(puntajeRonda).toBe(0.573);
  });

  it('unifica la ronda repartida con resultado calculado a mano y procedencia rastreable', async () => {
    const { data, error } = await operario.rpc('calcular_ranking_operativo', {
      p_scoring_version_id: versionId,
      p_planta_id: plantaId,
      p_especie_id: especieId,
    });
    if (error) throw error;

    const fila = (data as Array<Record<string, unknown>>).find(
      (item) => item.individuo_id === individuoMultivisitaId,
    );
    expect(fila).toMatchObject({
      evaluacion_id: evaluacionEneroId,
      fecha_evaluacion: '2028-01-15',
      elegible: true,
      motivo_exclusion: null,
    });
    expect(Number(fila!.puntaje_ponderado)).toBe(puntajeRonda);

    const detalle = fila!.detalle_metricas as Record<string, { valor: number; normalizado: number }>;
    // Fenologia: ver normalizadosRonda (0.665 con los pesos de Fase 5).
    expect(detalle.brotacion).toMatchObject({ valor: 5, normalizado: 1 }); // agosto
    expect(detalle.floracion).toMatchObject({ valor: 1, normalizado: 0 }); // agosto
    expect(detalle.cuaja).toMatchObject({ valor: 5, normalizado: 1 }); // noviembre, no agosto (=1)
    expect(detalle.concentracion_cosecha).toMatchObject({ valor: 3, normalizado: 0.5 }); // agosto
    // Fruto = (firmeza 0*4 + calibre 1*3 + brix 1*2 + bloom 1*1) / 10 = 0.6.
    expect(detalle.calibre_mm).toMatchObject({ valor: 24, normalizado: 1 }); // noviembre
    expect(detalle.brix).toMatchObject({ valor: 18, normalizado: 1 }); // enero
    expect(detalle.firmeza).toMatchObject({ valor: 1, normalizado: 0 }); // enero
    expect(detalle.bloom).toMatchObject({ valor: 5, normalizado: 1 }); // enero
    expect(detalle.presencia_yemas_florales).toMatchObject({ valor: 5, normalizado: 1 }); // agosto
    expect(detalle.pct_flores).toMatchObject({ valor: 50, normalizado: 0.5 }); // enero, generada
    const categorias = fila!.detalle_categorias as Record<string, number>;
    const esperadas = subpuntajesEsperados(normalizadosRonda);
    for (const categoria of ['fenologia', 'fruto_calidad', 'produccion', 'estres'] as const) {
      expect(Number(categorias[categoria])).toBeCloseTo(esperadas[categoria], 10);
    }
  });

  it('fija la no regresion numerica de una ronda con una sola evaluacion', async () => {
    const { data, error } = await operario.rpc('calcular_ranking_operativo', {
      p_scoring_version_id: versionId,
      p_planta_id: plantaId,
      p_especie_id: especieId,
    });
    if (error) throw error;

    const fila = (data as Array<Record<string, unknown>>).find(
      (item) => item.individuo_id === individuoUnaVisitaId,
    );
    expect(fila).toMatchObject({
      evaluacion_id: evaluacionUnicaId,
      elegible: true,
      motivo_exclusion: null,
    });
    expect(Number(fila!.puntaje_ponderado)).toBe(puntajeRonda);
  });

  it('la serie mensual cuenta una ronda unificada y coincide con el ranking', async () => {
    const { data, error } = await operario.rpc('obtener_series_historicas_cientificas', {
      p_especie_id: especieId,
      p_planta_id: plantaId,
      p_fecha_desde: '2028-01-01',
      p_fecha_hasta: '2028-01-31',
    });
    if (error) throw error;

    const punto = (data as {
      scoring: Array<{ periodo: string; evaluaciones_elegibles: number; puntaje_promedio: number }>;
    }).scoring[0];
    expect(punto).toMatchObject({
      periodo: '2028-01-01',
      evaluaciones_elegibles: 1,
    });
    expect(Number(punto.puntaje_promedio)).toBe(puntajeRonda);
  });

  it('no fabrica una tripleta mezclando cantidad y peso de visitas distintas', async () => {
    const { data, error } = await operario.rpc('unificar_evaluacion_ronda', {
      p_ronda_id: rondaTripletaDivididaId,
    });
    if (error) throw error;
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      cantidad_frutos: null,
      peso_total_g: null,
      peso_promedio_g: null,
    });
  });

  it('conserva la tripleta de la visita completa anterior ante una parcial posterior', async () => {
    const { data, error } = await operario.rpc('unificar_evaluacion_ronda', {
      p_ronda_id: rondaTripletaCompletaAnteriorId,
    });
    if (error) throw error;
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      cantidad_frutos: 10,
      peso_total_g: 100,
      peso_promedio_g: 10,
    });
  });

  it('la comparacion entre rondas usa los descriptores unificados', async () => {
    const { data, error } = await operario.rpc('obtener_comparacion_rondas', {
      p_individuo_id: individuoComparacionId,
      p_planta_id: null,
    });
    if (error) throw error;

    const individuo = (data as {
      individuos: Array<{
        numero_anterior: number;
        numero_actual: number;
        deltas_parametro: Array<{
          metrica: string;
          valor_anterior: number;
          valor_actual: number;
          delta: number;
        }>;
      }>;
    }).individuos[0];
    expect(individuo).toMatchObject({ numero_anterior: 1, numero_actual: 2 });
    expect(individuo.deltas_parametro.find((item) => item.metrica === 'cuaja')).toMatchObject({
      valor_anterior: 5,
      valor_actual: 1,
      delta: -1,
    });
    expect(individuo.deltas_parametro.find((item) => item.metrica === 'brix')).toMatchObject({
      valor_anterior: 18,
      valor_actual: 10,
      delta: -1,
    });
  });
});
