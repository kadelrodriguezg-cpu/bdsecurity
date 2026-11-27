/**
 * Pruebas empiricas del scoring por categorias contra la base Supabase local.
 * La version creada aqui es especifica de una especie de prueba para no alterar
 * la version global ni depender del seed provisional del entorno.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { limpiarPrueba } from './limpieza-pruebas';

describe('scoring multcategoria', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let operarioId: string;
  let especieId: string;
  let plantaId: string;
  let individuoId: string;
  let evaluacionId: string;
  let individuoFenologiaId: string;
  let evaluacionFenologiaId: string;
  let versionId: string;

  beforeAll(async () => {
    const sufijo = Date.now();
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const usuario = await crearUsuarioDePrueba(creds, service, {
      email: `scoring-categorias-${sufijo}@test.local`,
      rol: 'operario',
    });
    operario = usuario.client;
    operarioId = usuario.userId;

    const { data: especie, error: especieError } = await service
      .from('especies')
      .insert({ nombre: `Scoring categorias ${sufijo}` })
      .select('id')
      .single();
    if (especieError || !especie) throw especieError ?? new Error('No se creo la especie');
    especieId = especie.id;

    const { data: version, error: versionError } = await service
      .from('scoring_version')
      .insert({
        nombre: `Scoring multategoria test ${sufijo}`,
        especie_id: especieId,
        fase: 'evaluacion_anual',
        vigente_desde: '2027-01-01',
        estado: 'activa',
        nota: 'Configuracion aislada para probar la agregacion por categorias.',
      })
      .select('id')
      .single();
    if (versionError || !version) throw versionError ?? new Error('No se creo la version');
    versionId = version.id;

    const { error: categoriasError } = await service.from('scoring_categoria_peso').insert([
      { scoring_version_id: versionId, categoria: 'fenologia', peso: 0.20 },
      { scoring_version_id: versionId, categoria: 'fruto_calidad', peso: 0.40 },
      { scoring_version_id: versionId, categoria: 'produccion', peso: 0.30 },
      { scoring_version_id: versionId, categoria: 'estres', peso: 0.10 },
    ]);
    if (categoriasError) throw categoriasError;

    const { error: metricasError } = await service.from('scoring_metrica').insert([
      { scoring_version_id: versionId, categoria: 'fenologia', metrica: 'brotacion', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 1 },
      { scoring_version_id: versionId, categoria: 'fruto_calidad', metrica: 'firmeza', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 2 },
      { scoring_version_id: versionId, categoria: 'produccion', metrica: 'rend_kg_planta', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 3 },
      { scoring_version_id: versionId, categoria: 'estres', metrica: 'dano_calor', peso: 1, direccion_favorable: 'menor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 4 },
    ]);
    if (metricasError) throw metricasError;

    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({ codigo_sistema: `SCAT-${sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creo la planta');
    plantaId = planta.id;

    const { data: individuo, error: individuoError } = await service
      .from('individuos')
      .insert({
        planta_id: plantaId,
        codigo_display: 'GENERADO-POR-TRIGGER',
        fecha_individualizacion: '2027-01-02',
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (individuoError || !individuo) throw individuoError ?? new Error('No se creo el individuo');
    individuoId = individuo.id;

    const { data: ronda, error: rondaError } = await service
      .from('ronda_evaluacion_anual')
      .insert({
        individuo_id: individuoId,
        numero_ronda: 1,
        anio: 2027,
        fecha_inicio: '2027-06-01',
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (rondaError || !ronda) throw rondaError ?? new Error('No se creo la ronda');

    const { data: evaluacion, error: evaluacionError } = await service
      .from('evaluaciones')
      .insert({
        ronda_id: ronda.id,
        fecha: '2027-06-15',
        estado: 'completa',
        cantidad_frutos: 10,
        peso_total_g: 100,
        brotacion: 5,
        floracion: 3,
        cuaja: 3,
        concentracion_cosecha: 3,
        calibre_mm: 19,
        firmeza: 1,
        color: 3,
        bloom: 3,
        brix: 14,
        rend_kg_planta: 1,
        rend_t_ha: 3,
        pct_fruta_exportable: 3,
        dano_calor: 5,
        golpe_sol: 3,
        caida_fruto: 3,
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (evaluacionError || !evaluacion) throw evaluacionError ?? new Error('No se creo la evaluacion');
    evaluacionId = evaluacion.id;

    const { data: individuoFenologia, error: individuoFenologiaError } = await service
      .from('individuos')
      .insert({
        planta_id: plantaId,
        codigo_display: 'GENERADO-POR-TRIGGER',
        fecha_individualizacion: '2027-01-03',
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (individuoFenologiaError || !individuoFenologia) {
      throw individuoFenologiaError ?? new Error('No se creo el individuo de fenologia');
    }
    individuoFenologiaId = individuoFenologia.id;

    const { data: rondaFenologia, error: rondaFenologiaError } = await service
      .from('ronda_evaluacion_anual')
      .insert({
        individuo_id: individuoFenologiaId,
        numero_ronda: 1,
        anio: 2027,
        fecha_inicio: '2027-08-01',
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (rondaFenologiaError || !rondaFenologia) {
      throw rondaFenologiaError ?? new Error('No se creo la ronda de fenologia');
    }

    const { data: evaluacionFenologia, error: evaluacionFenologiaError } = await operario
      .from('evaluaciones')
      .insert({
        ronda_id: rondaFenologia.id,
        fecha: '2027-08-15',
        estado: 'completa',
        sin_muestra: true,
        brotacion: 4,
        floracion: 3,
        cuaja: 2,
        concentracion_cosecha: 1,
        created_by: operarioId,
      })
      .select('id')
      .single();
    if (evaluacionFenologiaError || !evaluacionFenologia) {
      throw evaluacionFenologiaError ?? new Error('No se cerro la evaluacion de fenologia');
    }
    evaluacionFenologiaId = evaluacionFenologia.id;
  }, 60_000);

  afterAll(async () => {
    // La versión de scoring es de la especie propia: se borra con ella (primero se vacían sus rondas y evaluaciones).
    await limpiarPrueba(service, { plantaIds: [plantaId], especieIds: [especieId], usuarioIds: [operarioId] }, 'scoring-categorias');
  }, 60_000);

  it('series historicas y ranking dan el mismo puntaje con varias categorias', async () => {
    const { data: ranking, error: rankingError } = await operario.rpc('calcular_ranking_operativo', {
      p_scoring_version_id: versionId,
      p_planta_id: plantaId,
      p_especie_id: especieId,
    });
    if (rankingError) throw rankingError;
    const fila = (ranking as Array<Record<string, unknown>>).find(
      (item) => item.individuo_id === individuoId && item.evaluacion_id === evaluacionId,
    );
    expect(fila).toBeTruthy();
    expect(Number(fila!.puntaje_ponderado)).toBe(0.2);

    const { data: series, error: seriesError } = await operario.rpc('obtener_series_historicas_cientificas', {
      p_especie_id: especieId,
      p_planta_id: plantaId,
      p_fecha_desde: '2027-06-01',
      p_fecha_hasta: '2027-06-30',
    });
    if (seriesError) throw seriesError;
    const punto = (series as { scoring: Array<{ periodo: string; evaluaciones_elegibles: number; puntaje_promedio: number }> }).scoring[0];
    expect(punto.evaluaciones_elegibles).toBe(1);
    expect(Number(punto.puntaje_promedio)).toBe(Number(fila!.puntaje_ponderado));
    // El promedio plano de las cuatro metricas seria 0.25; esta asercion
    // demuestra que ambas rutas aplican el peso 0.20 de Fenologia.
    expect(Number(punto.puntaje_promedio)).not.toBe(0.25);
  });

  it('la version global poblada refleja cobertura real de 4 de 4 categorias', async () => {
    const { data: version, error: versionError } = await service
      .from('scoring_version')
      .select('id')
      .eq('estado', 'activa')
      .is('especie_id', null)
      .eq('fase', 'evaluacion_anual')
      .lte('vigente_desde', '2027-06-15')
      .or('vigente_hasta.is.null,vigente_hasta.gte.2027-06-15')
      .single();
    if (versionError || !version) throw versionError ?? new Error('No existe la version global vigente');

    const { data: metricas, error: metricasError } = await service
      .from('scoring_metrica')
      .select('categoria, metrica, peso, direccion_favorable, metodo_normalizacion, minimo_normalizacion, maximo_normalizacion')
      .eq('scoring_version_id', version.id)
      .order('orden');
    if (metricasError) throw metricasError;

    expect(metricas).toHaveLength(20);
    expect(metricas!.slice(4)).toEqual([
      { categoria: 'fenologia', metrica: 'brotacion', peso: 0.034, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'fenologia', metrica: 'floracion', peso: 0.034, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'fenologia', metrica: 'cuaja', peso: 0.033, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'fenologia', metrica: 'concentracion_cosecha', peso: 0.033, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'produccion', metrica: 'rend_kg_planta', peso: 0.06, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'produccion', metrica: 'rend_t_ha', peso: 0.06, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'produccion', metrica: 'pct_fruta_exportable', peso: 0.06, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 0, maximo_normalizacion: 100 },
      { categoria: 'estres', metrica: 'dano_calor', peso: 0.02, direccion_favorable: 'menor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'estres', metrica: 'golpe_sol', peso: 0.02, direccion_favorable: 'menor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'estres', metrica: 'caida_fruto', peso: 0.02, direccion_favorable: 'menor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'fenologia', metrica: 'presencia_yemas_florales', peso: 0.033, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 0, maximo_normalizacion: 5 },
      { categoria: 'fenologia', metrica: 'precocidad', peso: 0.033, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'estres', metrica: 'vigor_vegetativo', peso: 0.02, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'estres', metrica: 'color_follaje', peso: 0.02, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 },
      { categoria: 'produccion', metrica: 'pct_flores', peso: 0.06, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 0, maximo_normalizacion: 100 },
      { categoria: 'produccion', metrica: 'pct_frutos', peso: 0.06, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 0, maximo_normalizacion: 100 },
    ]);

    const { data: ranking, error: rankingError } = await operario.rpc('calcular_ranking_operativo', {
      p_scoring_version_id: version.id,
      p_planta_id: plantaId,
      p_especie_id: especieId,
    });
    if (rankingError) throw rankingError;
    const fila = (ranking as Array<Record<string, unknown>>).find(
      (item) => item.individuo_id === individuoId && item.evaluacion_id === evaluacionId,
    );
    expect(fila).toBeTruthy();
    const detalle = fila!.detalle_categorias as Record<string, number | null>;
    const categoriasConDatos = Object.values(detalle).filter((valor) => valor !== null).length;
    // Es el mismo conteo que renderiza CoberturaCategorias en el indicador UI.
    expect(categoriasConDatos).toBe(4);
    // Desde el paso 44 (scoring v2) el enum trae `brotes`: el detalle lo lista, con valor nulo mientras la versión activa no lo use.
    expect(Object.keys(detalle).sort()).toEqual(['brotes', 'estres', 'fenologia', 'fruto_calidad', 'produccion']);
    expect(detalle.brotes).toBeNull();
  });

  it('una evaluacion completa con solo fenologia queda fuera del ranking sin romperlo', async () => {
    const { data: version, error: versionError } = await service
      .from('scoring_version')
      .select('id')
      .eq('estado', 'activa')
      .is('especie_id', null)
      .eq('fase', 'evaluacion_anual')
      .single();
    if (versionError || !version) throw versionError ?? new Error('No existe la version global activa');

    const { data: ranking, error: rankingError } = await operario.rpc('calcular_ranking_operativo', {
      p_scoring_version_id: version.id,
      p_planta_id: plantaId,
      p_especie_id: especieId,
    });
    expect(rankingError).toBeNull();
    const fila = (ranking as Array<Record<string, unknown>>).find(
      (item) => item.individuo_id === individuoFenologiaId
        && item.evaluacion_id === evaluacionFenologiaId,
    );
    expect(fila).toMatchObject({
      estado_evaluacion: 'completa',
      elegible: false,
      puntaje_ponderado: null,
      motivo_exclusion: 'evaluacion_parcial_en_curso',
    });

    const categorias = fila!.detalle_categorias as Record<string, number | null>;
    expect(categorias.fenologia).not.toBeNull();
    expect(categorias.fruto_calidad).toBeNull();
    expect(categorias.produccion).toBeNull();
    expect(categorias.estres).toBeNull();
  });
});
