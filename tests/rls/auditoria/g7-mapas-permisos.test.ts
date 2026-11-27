/**
 * Auditoría integral, Corrida 1, grupo G7: R05 permisos y fugas de los mapas.
 *
 * Preguntas: ¿las RPC DEFINER de mapa (obtener_resumen_mapa_territorial,
 * consultar_mapa_viewport) devuelven a un operario coordenadas de
 * emplazamiento_coordenada (solo admin) o algo del linaje (cruzamiento, mama,
 * papa, nombres de variedades)? ¿Qué ve el anon? ¿Qué pasa con cruces
 * archivados, de prueba o individuos muertos?
 *
 * Datos: un cruce AUD-G7-MAPA con linaje centinela, 3 individuos, un predio con
 * coordenadas (creado por psql en modo replica para no disparar la llamada
 * real a Open-Meteo) y emplazamientos creados por la RPC real de traslado con
 * coordenada exacta centinela. Todo se borra en afterAll.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { borrarUsuariosG7, prepararEntornoG7, psql, type EntornoG7 } from './g7-helpers';

const R = Date.now();
const LAT_PREDIO = -45.7;
const LON_PREDIO = -72.2;
const LAT_EXACTA = -45.123457;
const LON_EXACTA = -72.654329;
const VIEWPORT = { p_latitud_minima: -45.9, p_latitud_maxima: -45.0, p_longitud_minima: -72.9, p_longitud_maxima: -72.0 };
const SENTINELAS_LINAJE = [`AUD-G7-CRUZ-${R}`, `AUD-G7-MAMA-${R}`, `AUD-G7-PAPA-${R}`, `AUD-G7-VARMAMA-${R}`, `AUD-G7-VARPAPA-${R}`];
const UBICACION_EXACTA = `AUD-G7-UBICACION-EXACTA-${R}`;

let E: EntornoG7;
let cruceId: string;
let predioId: string;
let sectorId: string;
let variedadMamaId: string;
let variedadPapaId: string;
const individuos: string[] = [];

function contieneSentinelas(valor: unknown): string[] {
  const texto = JSON.stringify(valor);
  const encontradas = SENTINELAS_LINAJE.filter((s) => texto.includes(s));
  if (texto.includes(UBICACION_EXACTA)) encontradas.push(UBICACION_EXACTA);
  if (texto.includes('-45.123457') || texto.includes('-72.654329')) encontradas.push('coordenada exacta');
  return encontradas;
}

beforeAll(async () => {
  E = await prepararEntornoG7('mapas');

  const vm = await E.service.from('variedades').insert({ especie_id: E.especieId, nombre: `AUD-G7-VARMAMA-${R}`, created_by: E.adminId }).select('id').single();
  const vp = await E.service.from('variedades').insert({ especie_id: E.especieId, nombre: `AUD-G7-VARPAPA-${R}`, created_by: E.adminId }).select('id').single();
  if (vm.error || vp.error) throw new Error(`setup variedades: ${vm.error?.message ?? vp.error?.message}`);
  variedadMamaId = vm.data!.id as string;
  variedadPapaId = vp.data!.id as string;

  const { data: cruce, error } = await E.service
    .from('plantas')
    .insert({
      codigo_sistema: `AUD-G7-MAPA-${R}`, especie_id: E.especieId, estado: 'traslado_destino', es_prueba: true,
      cruzamiento: `AUD-G7-CRUZ-${R}`, mama: `AUD-G7-MAMA-${R}`, papa: `AUD-G7-PAPA-${R}`, mama_id: variedadMamaId, papa_id: variedadPapaId,
    })
    .select('id')
    .single();
  if (error || !cruce) throw new Error(`setup cruce: ${error?.message}`);
  cruceId = cruce.id as string;
  // N35 (v3 paso 8): los mapas excluyen los cruces de prueba. El escenario mide el mapa con el cruce como real y lo
  // vuelve a marcar de prueba en afterAll, antes de purgarlo (la purga dura solo acepta cruces de prueba).
  await E.service.from('plantas').update({ es_prueba: false }).eq('id', cruceId);

  const salida = psql(`
begin;
set local session_replication_role = replica;
with p as (insert into predio (nombre, latitud, longitud) values ('AUD-G7-MAPA-predio-${R}', ${LAT_PREDIO}, ${LON_PREDIO}) returning id),
s as (insert into sector (predio_id, nombre) select id, 'Sector principal' from p returning id)
select (select id from p) || '|' || (select id from s);
commit;
`);
  const linea = salida.split('\n').find((l) => /^[0-9a-f-]{36}\|[0-9a-f-]{36}$/.test(l));
  if (!linea) throw new Error(`setup predio: ${salida}`);
  [predioId, sectorId] = linea.split('|');

  for (let i = 0; i < 3; i += 1) {
    const { data, error: e } = await E.service.from('individuos').insert({ planta_id: cruceId, created_by: E.operarioId, codigo_display: '' }).select('id').single();
    if (e || !data) throw new Error(`setup individuo: ${e?.message}`);
    individuos.push(data.id as string);
  }
  for (let i = 0; i < 3; i += 1) {
    const { error: e } = await E.admin.rpc('registrar_traslado_individuo', {
      p_individuo_id: individuos[i], p_sector_id: sectorId, p_fecha_inicio: '2026-10-01',
      p_latitud: LAT_EXACTA, p_longitud: LON_EXACTA, p_precision_metros: 5, p_ubicacion_exacta: UBICACION_EXACTA,
    });
    if (e) throw new Error(`setup traslado: ${e.message}`);
  }
  // Un individuo muerto: sigue "emplazado" pero no cuenta como vivo.
  const baja = await E.operario.rpc('marcar_baja_individuo', {
    p_individuo_id: individuos[2], p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: null, p_fecha: '2026-10-10', p_idempotency_key: randomUUID(),
  });
  if (baja.error) throw new Error(`setup baja: ${baja.error.message}`);
}, 120_000);

afterAll(async () => {
  psql(`
begin;
set local session_replication_role = replica;
delete from emplazamiento_coordenada where emplazamiento_id in (select id from emplazamiento_individuo where individuo_id in (select id from individuos where planta_id = '${cruceId}'));
delete from emplazamiento_individuo where individuo_id in (select id from individuos where planta_id = '${cruceId}');
delete from baja_motivo where individuo_id in (select id from individuos where planta_id = '${cruceId}');
delete from individuos where planta_id = '${cruceId}';
delete from sector where predio_id = '${predioId}';
delete from predio where id = '${predioId}';
commit;
`);
  await E.service.from('plantas').update({ es_prueba: true }).eq('id', cruceId);
  const { error } = await E.admin.rpc('borrar_cruzamiento', { p_planta_id: cruceId, p_tipo: 'hard' });
  if (error) console.warn(`afterAll: no se pudo borrar el cruce ${cruceId}: ${error.message}`);
  await E.service.from('variedades').delete().in('id', [variedadMamaId, variedadPapaId]);
  await borrarUsuariosG7(E);
}, 60_000);

describe('R05 el operario no recibe coordenada exacta ni linaje por ninguna RPC de mapa', () => {
  it('obtener_mapa_cruce: devuelve la coordenada del PREDIO (decisión documentada) pero no la exacta ni el linaje', async () => {
    const { data, error } = await E.operario.rpc('obtener_mapa_cruce', { p_planta_id: cruceId });
    expect(error).toBeNull();
    const d = data as unknown as { total_individuos_emplazados: number; clusters: Array<{ latitud: number; longitud: number; individuos: number; individuos_vivos: number }> };
    expect(d.total_individuos_emplazados).toBe(3);
    expect(d.clusters).toHaveLength(1);
    expect(Number(d.clusters[0].latitud)).toBe(LAT_PREDIO);
    expect(Number(d.clusters[0].longitud)).toBe(LON_PREDIO);
    expect(d.clusters[0].individuos).toBe(3);
    expect(d.clusters[0].individuos_vivos).toBe(2);
    expect(contieneSentinelas(data)).toEqual([]);
  });

  it('obtener_resumen_mapa_territorial (DEFINER): agrega por sector con el código del cruce, sin coordenada exacta ni linaje', async () => {
    const { data, error } = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_predio_id: predioId });
    expect(error).toBeNull();
    const d = data as unknown as { precision: string; total: number; clusters: Array<{ latitud: number; individuos: number; individuos_vivos: number; cruces: Array<{ codigo_sistema: string }> }> };
    expect(d.precision).toBe('agregada');
    expect(d.total).toBe(1);
    expect(Number(d.clusters[0].latitud)).toBe(LAT_PREDIO);
    expect(d.clusters[0].individuos).toBe(3);
    expect(d.clusters[0].individuos_vivos).toBe(2);
    expect(d.clusters[0].cruces).toHaveLength(1);
    expect(d.clusters[0].cruces[0].codigo_sistema).toBe(`AUD-G7-MAPA-${R}`);
    expect(contieneSentinelas(data)).toEqual([]);
  });

  it('consultar_mapa_viewport (DEFINER): el operario recibe 42501 y no se filtra nada', async () => {
    const { data, error } = await E.operario.rpc('consultar_mapa_viewport', VIEWPORT);
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('el operario no lee emplazamiento_coordenada (RLS admin) ni la columna referencia_operativa (grant de columna)', async () => {
    const coordenadas = await E.operario.from('emplazamiento_coordenada').select('*').in('emplazamiento_id', (await E.service.from('emplazamiento_individuo').select('id').in('individuo_id', individuos)).data!.map((f) => f.id));
    expect(coordenadas.error).toBeNull();
    expect(coordenadas.data).toEqual([]);
    const referencia = await E.operario.from('emplazamiento_individuo').select('referencia_operativa').in('individuo_id', individuos);
    expect(referencia.error?.code).toBe('42501');
  });

  it('el admin sí recibe la coordenada exacta y la fuente por viewport; las tres RPC no incluyen linaje', async () => {
    const { data, error } = await E.admin.rpc('consultar_mapa_viewport', VIEWPORT);
    expect(error).toBeNull();
    const d = data as unknown as { total: number; puntos: Array<{ fuente: string; latitud: number; longitud: number; precision_metros: number }> };
    expect(d.total).toBe(3);
    expect(d.puntos.every((p) => p.fuente === 'exacta' && Number(p.latitud) === LAT_EXACTA && Number(p.longitud) === LON_EXACTA)).toBe(true);
    const linaje = contieneSentinelas(data).filter((s) => SENTINELAS_LINAJE.includes(s));
    expect(linaje).toEqual([]);
    for (const [nombre, args] of [['obtener_mapa_cruce', { p_planta_id: cruceId }], ['obtener_resumen_mapa_territorial', { p_predio_id: predioId }]] as const) {
      const r = await E.admin.rpc(nombre, args as never);
      expect(r.error).toBeNull();
      expect(SENTINELAS_LINAJE.filter((s) => JSON.stringify(r.data).includes(s)), nombre).toEqual([]);
    }
  });

  it('anon no puede ejecutar ninguna RPC de mapa ni de clima', async () => {
    const llamadas: Array<[string, Record<string, unknown>]> = [
      ['obtener_mapa_cruce', { p_planta_id: cruceId }],
      ['obtener_resumen_mapa_territorial', {}],
      ['consultar_mapa_viewport', VIEWPORT],
      ['obtener_clima_predio', { p_predio_id: predioId }],
      ['sincronizar_clima_predio', { p_predio_id: predioId, p_meses_atras: 0 }],
    ];
    for (const [nombre, args] of llamadas) {
      const { data, error } = await E.anon.rpc(nombre as never, args as never);
      expect(error?.code, nombre).toBe('42501');
      expect(data, nombre).toBeNull();
    }
  });

  it('entradas inválidas: viewport con mínimos mayores que máximos, NaN, Infinity y fuera de rango se rechazan (22023)', async () => {
    const invalidos: Array<Record<string, unknown>> = [
      { ...VIEWPORT, p_latitud_minima: -10, p_latitud_maxima: -20 },
      { ...VIEWPORT, p_longitud_minima: -71, p_longitud_maxima: -72 },
      { ...VIEWPORT, p_latitud_minima: 'NaN' },
      { ...VIEWPORT, p_latitud_maxima: 'Infinity' },
      { ...VIEWPORT, p_latitud_minima: -91 },
      { ...VIEWPORT, p_longitud_maxima: 181 },
      { ...VIEWPORT, p_latitud_minima: -45.5, p_latitud_maxima: -45.5 },
      { ...VIEWPORT, p_latitud_minima: null },
    ];
    for (const args of invalidos) {
      const { error } = await E.admin.rpc('consultar_mapa_viewport', args as never);
      expect(error?.code, JSON.stringify(args)).toBe('22023');
    }
  });

  it('obtener_mapa_cruce con un cruce inexistente falla con P0002 y mensaje de negocio', async () => {
    const { error } = await E.operario.rpc('obtener_mapa_cruce', { p_planta_id: randomUUID() });
    expect(error?.code).toBe('P0002');
    expect(error?.message).toMatch(/Cruce no encontrado/);
  });
});

describe('R05 los mapas excluyen los cruces de prueba (A1-G7-09, corregido por N35 en v3 paso 8)', () => {
  // A1-G7-09: plantas.ts documenta que los cruces es_prueba se excluyen por defecto de todo listado operativo.
  // Desde 20261024090000 el resumen territorial también los excluye; solo un admin los ve si los pide.
  it('A1-G7-09: obtener_resumen_mapa_territorial no cuenta emplazamientos de cruces es_prueba', async () => {
    await E.service.from('plantas').update({ es_prueba: true }).eq('id', cruceId);
    try {
      const total = async (c: typeof E.operario, incluir: boolean) => {
        const { data, error } = await c.rpc('obtener_resumen_mapa_territorial', { p_predio_id: predioId, p_incluir_pruebas: incluir });
        expect(error).toBeNull();
        return (data as unknown as { total: number }).total;
      };
      expect(await total(E.operario, false)).toBe(0);
      expect(await total(E.operario, true)).toBe(0);
      expect(await total(E.admin, false)).toBe(0);
      expect(await total(E.admin, true)).toBeGreaterThan(0);
    } finally {
      await E.service.from('plantas').update({ es_prueba: false }).eq('id', cruceId);
    }
  });
});

describe('R05 cruce archivado (soft delete): desaparece de los mapas (se ejecuta al final: archiva el cruce)', () => {
  it('tras archivar el cruce, obtener_mapa_cruce da P0002 y el resumen y el viewport ya no lo cuentan', async () => {
    const archivar = await E.admin.rpc('borrar_cruzamiento', { p_planta_id: cruceId, p_tipo: 'soft' });
    expect(archivar.error).toBeNull();

    const mapa = await E.operario.rpc('obtener_mapa_cruce', { p_planta_id: cruceId });
    expect(mapa.error?.code).toBe('P0002');

    const resumen = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_predio_id: predioId });
    expect((resumen.data as unknown as { total: number }).total).toBe(0);

    const viewport = await E.admin.rpc('consultar_mapa_viewport', VIEWPORT);
    expect((viewport.data as unknown as { total: number }).total).toBe(0);

    const clima = await E.operario.rpc('obtener_clima_predio', { p_planta_id: cruceId });
    expect(clima.error?.code).toBe('P0002');
  });
});
