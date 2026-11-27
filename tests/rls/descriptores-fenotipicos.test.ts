import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { limpiarPrueba } from './limpieza-pruebas';

describe('descriptores fenotipicos Fase 5', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let operarioId: string;
  let especieId: string;
  let plantaId: string;
  let secuencia = 0;

  beforeAll(async () => {
    const sufijo = Date.now();
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const usuario = await crearUsuarioDePrueba(creds, service, {
      email: `descriptores-fase5-${sufijo}@test.local`,
      rol: 'operario',
    });
    operario = usuario.client;
    operarioId = usuario.userId;

    const { data: especie, error: especieError } = await service
      .from('especies')
      .insert({ nombre: `Descriptores Fase 5 ${sufijo}` })
      .select('id')
      .single();
    if (especieError || !especie) throw especieError ?? new Error('No se creo la especie');
    especieId = especie.id;

    const { data: planta, error: plantaError } = await service
      .from('plantas')
      .insert({ codigo_sistema: `F5-${sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    if (plantaError || !planta) throw plantaError ?? new Error('No se creo la planta');
    plantaId = planta.id;
  }, 60_000);

  afterAll(async () => {
    await limpiarPrueba(service, { plantaIds: [plantaId], especieIds: [especieId], usuarioIds: [operarioId] }, 'descriptores-fase5');
  }, 60_000);

  async function crearRonda() {
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
    if (individuoError || !individuo) throw individuoError ?? new Error('No se creo el individuo');

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
    if (rondaError || !ronda) throw rondaError ?? new Error('No se creo la ronda');
    return { rondaId: ronda.id as string, individuoId: individuo.id as string };
  }

  it('aplica CHECK 1-5, no negativos y acepta cero en presencia de yemas', async () => {
    const { rondaId } = await crearRonda();
    const { error: escalaInvalida } = await operario.from('evaluaciones').insert({
      ronda_id: rondaId,
      fecha: '2027-02-01',
      estado: 'borrador',
      vigor_vegetativo: 6,
      created_by: operarioId,
    });
    expect(escalaInvalida?.code).toBe('23514');

    const { error: conteoInvalido } = await operario.from('evaluaciones').insert({
      ronda_id: rondaId,
      fecha: '2027-02-01',
      estado: 'borrador',
      n_varas_basales: -1,
      created_by: operarioId,
    });
    expect(conteoInvalido?.code).toBe('23514');

    const { data, error } = await operario.from('evaluaciones').insert({
      ronda_id: rondaId,
      fecha: '2027-02-01',
      estado: 'completa',
      sin_muestra: true,
      presencia_yemas_florales: 0,
      created_by: operarioId,
    }).select('presencia_yemas_florales').single();
    expect(error).toBeNull();
    expect(data?.presencia_yemas_florales).toBe(0);
  });

  it('calcula porcentajes y devuelve NULL cuando el denominador es cero', async () => {
    const { rondaId } = await crearRonda();
    const { data, error } = await operario.from('evaluaciones').insert({
      ronda_id: rondaId,
      fecha: '2027-02-02',
      estado: 'completa',
      sin_muestra: true,
      n_varas_basales: 10,
      n_varas_con_flor: 4,
      n_flores_varas_basales: 0,
      n_frutos_varas_basales: 3,
      created_by: operarioId,
    }).select('pct_flores, pct_frutos').single();
    expect(error).toBeNull();
    expect(Number(data?.pct_flores)).toBe(40);
    expect(data?.pct_frutos).toBeNull();
  });

  it('cierra una evaluacion con solo descriptores nuevos y sin muestra', async () => {
    const { rondaId } = await crearRonda();
    const { data, error } = await operario.from('evaluaciones').insert({
      ronda_id: rondaId,
      fecha: '2027-02-03',
      estado: 'completa',
      sin_muestra: true,
      n_varas_basales: 8,
      n_varas_con_flor: 4,
      n_flores_varas_basales: 20,
      n_frutos_varas_basales: 10,
      altura_brote_mm: 350.5,
      diametro_brote_mm: 8.2,
      vigor_vegetativo: 4,
      color_follaje: 3,
      presencia_yemas_florales: 5,
      fecha_inicio_floracion: '2027-02-01',
      precocidad: 4,
      created_by: operarioId,
    }).select('estado, pct_flores, pct_frutos').single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ estado: 'completa', pct_flores: 50, pct_frutos: 50 });
  });

  it('mantiene el borrador unico por ronda', async () => {
    const { rondaId } = await crearRonda();
    const primero = await operario.from('evaluaciones').insert({
      ronda_id: rondaId,
      fecha: '2027-02-04',
      estado: 'borrador',
      vigor_vegetativo: 3,
      created_by: operarioId,
    });
    expect(primero.error).toBeNull();

    const segundo = await operario.from('evaluaciones').insert({
      ronda_id: rondaId,
      fecha: '2027-02-05',
      estado: 'borrador',
      color_follaje: 3,
      created_by: operarioId,
    });
    expect(segundo.error?.code).toBe('23505');
    expect(segundo.error?.message).toContain('evaluaciones_un_borrador_activo_por_ronda_uidx');
  });

  it('aplica las seis metricas nuevas con un resultado calculable a mano', async () => {
    const { rondaId, individuoId } = await crearRonda();
    const { error: evaluacionError } = await operario.from('evaluaciones').insert({
      ronda_id: rondaId,
      fecha: '2027-06-15',
      estado: 'completa',
      cantidad_frutos: 10,
      peso_total_g: 100,
      brotacion: 5,
      floracion: 1,
      cuaja: 5,
      concentracion_cosecha: 1,
      presencia_yemas_florales: 5,
      precocidad: 1,
      calibre_mm: 19,
      firmeza: 5,
      color: 3,
      bloom: 1,
      brix: 14,
      rend_kg_planta: 5,
      rend_t_ha: 1,
      pct_fruta_exportable: 80,
      n_varas_basales: 10,
      n_varas_con_flor: 5,
      n_flores_varas_basales: 8,
      n_frutos_varas_basales: 4,
      dano_calor: 1,
      golpe_sol: 5,
      caida_fruto: 3,
      vigor_vegetativo: 5,
      color_follaje: 1,
      created_by: operarioId,
    });
    if (evaluacionError) throw evaluacionError;

    const { data: version, error: versionError } = await service
      .from('scoring_version')
      .select('id')
      .eq('estado', 'activa')
      .is('especie_id', null)
      .eq('fase', 'evaluacion_anual')
      .single();
    if (versionError || !version) throw versionError ?? new Error('No existe version global activa');

    const { data: ranking, error: rankingError } = await operario.rpc('calcular_ranking_operativo', {
      p_scoring_version_id: version.id,
      p_planta_id: plantaId,
      p_especie_id: especieId,
    });
    if (rankingError) throw rankingError;
    const fila = (ranking as Array<Record<string, unknown>>).find((item) => item.individuo_id === individuoId);
    expect(fila).toMatchObject({ elegible: true });

    const categorias = fila!.detalle_categorias as Record<string, number>;
    // Fenologia: (1*.034 + 0*.034 + 1*.033 + 0*.033 + 1*.033 + 0*.033) / .20 = .50
    // El orden real de las seis señales produce .50: brotacion, floracion,
    // cuaja, concentracion, yemas y precocidad.
    expect(Number(categorias.fenologia)).toBeCloseTo(0.5, 10);
    // Produccion: (1 + 0 + .80 + .50 + .50) / 5 = .56.
    expect(Number(categorias.produccion)).toBeCloseTo(0.56, 10);
    // Estres: (1 + 0 + .50 + 1 + 0) / 5 = .50.
    expect(Number(categorias.estres)).toBeCloseTo(0.5, 10);
    // Fruto/calidad = .65. Global = .50*.20 + .65*.40 + .56*.30 + .50*.10 = .578.
    // Con la configuracion anterior las metricas nuevas no existian y 80% de
    // exportable saturaba a 1: .50*.20 + .65*.40 + .6667*.30 + .50*.10 = .61.
    // La diferencia .61 -> .578 queda explicada por componentes, no por un
    // numero opaco.
    expect(Number(fila!.puntaje_ponderado)).toBeCloseTo(0.578, 4);

    const detalle = fila!.detalle_metricas as Record<string, { valor: number; normalizado: number }>;
    expect(Number(detalle.pct_fruta_exportable.valor)).toBe(80);
    expect(Number(detalle.pct_fruta_exportable.normalizado)).toBeCloseTo(0.8, 10);
    expect(Number(detalle.pct_flores.normalizado)).toBeCloseTo(0.5, 10);
    expect(Number(detalle.pct_frutos.normalizado)).toBeCloseTo(0.5, 10);
  });
});
