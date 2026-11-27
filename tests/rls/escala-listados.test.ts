/**
 * RPC agregadas de escala (brecha B8, migraciones 20261021130000 y
 * 20261021131000).
 *
 * - conteo_cruces_por_estado: agrega en la base lo que antes contaba el
 *   cliente; excluye pruebas y archivados, igual que el listado.
 * - resumen_individuos_cruce: reemplaza el N+1 de ResumenFinal y debe contar
 *   EXACTAMENTE lo que contaba el cliente (solo evaluaciones completa/corregida
 *   de rondas anuales; el resto no es una evaluación válida).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';

let service: SupabaseClient;
let anon: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let especieId: string;
const plantasHard: string[] = [];
const plantasSoft: string[] = [];
const plantasReales: string[] = [];

const R = Date.now();

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: 'admin@test.local', rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  operario = (await crearUsuarioDePrueba(creds, service, { email: 'operario@test.local', rol: 'operario' })).client;

  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;
}, 60_000);

afterAll(async () => {
  for (const id of plantasHard) await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
  // Con historial territorial el borrado permanente es imposible por diseño.
  for (const id of plantasSoft) await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' });
  // Cruces reales sin dependencias: se borran directo para no alterar el conteo de otras corridas.
  if (plantasReales.length) await service.from('plantas').delete().in('id', plantasReales);
});

async function crearCruce(estado: string, esPrueba: boolean, lista: string[]) {
  const { data, error } = await service
    .from('plantas')
    .insert({ codigo_sistema: `ESCALA-${R}-${lista.length}-${esPrueba ? 'P' : 'R'}${Math.random().toString(36).slice(2, 6)}`, especie_id: especieId, estado, es_prueba: esPrueba })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup planta: ${error?.message}`);
  lista.push(data.id);
  return data.id as string;
}

async function conteo(cliente: SupabaseClient) {
  const { data, error } = await cliente.rpc('conteo_cruces_por_estado');
  expect(error).toBeNull();
  return data as Record<string, number>;
}

describe('conteo_cruces_por_estado (B8)', () => {
  it('cuenta cruces reales por estado y no cuenta pruebas ni archivados', async () => {
    const antes = await conteo(operario);

    await crearCruce('germinacion', false, plantasReales);
    await crearCruce('germinacion', true, plantasHard);
    const archivado = await crearCruce('germinacion', false, plantasReales);
    await service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', archivado);

    const despues = await conteo(operario);
    expect(despues.germinacion ?? 0).toBe((antes.germinacion ?? 0) + 1);
  });

  it('coincide con contar las filas de la vista plantas_operativas', async () => {
    const porRpc = await conteo(admin);
    const { data: filas } = await admin.from('plantas_operativas').select('estado').eq('es_prueba', false).range(0, 9999);
    const aMano: Record<string, number> = {};
    for (const f of filas ?? []) aMano[f.estado] = (aMano[f.estado] ?? 0) + 1;
    expect(porRpc).toEqual(aMano);
  });

  it('anon no puede ejecutarla', async () => {
    const { error } = await anon.rpc('conteo_cruces_por_estado');
    expect(error).not.toBeNull();
  });
});

describe('resumen_individuos_cruce (B8)', () => {
  const camposCompletos = {
    brotacion: 1, floracion: 1, cuaja: 1, concentracion_cosecha: 1, calibre_mm: 18, firmeza: 1, color: 1,
    bloom: 1, brix: 12, rend_kg_planta: 1, rend_t_ha: 1, pct_fruta_exportable: 50, dano_calor: 1, golpe_sol: 1,
    caida_fruto: 1, cantidad_frutos: 5, peso_total_g: 50,
  };
  let plantaId: string;
  let ind1: string;
  let ind2: string;

  beforeAll(async () => {
    // Con evaluaciones completas la purga permanente se rechaza (PUERTA 2): se archiva.
    plantaId = await crearCruce('evaluacion_anual', true, plantasSoft);
    const { data: individuos, error } = await service
      .from('individuos')
      .insert([
        { planta_id: plantaId, codigo_display: `ESCALA-${R}-P02`, created_by: adminId },
        { planta_id: plantaId, codigo_display: `ESCALA-${R}-P01`, created_by: adminId },
      ])
      .select('id, codigo_display');
    if (error || !individuos) throw new Error(`setup individuos: ${error?.message}`);
    // codigo_display lo genera un trigger: se identifican por orden de inserción.
    [ind1, ind2] = individuos.map((i) => i.id);

    const ronda = async (individuoId: string, numero: number, tipo: 'anual' | 'multisitio' = 'anual') => {
      const { data, error: err } = await service
        .from('ronda_evaluacion_anual')
        .insert({ individuo_id: individuoId, numero_ronda: numero, anio: tipo === 'anual' ? 2026 : null, tipo_ronda: tipo, created_by: adminId })
        .select('id')
        .single();
      if (err || !data) throw new Error(`setup ronda: ${err?.message}`);
      return data.id as string;
    };
    const r1 = await ronda(ind1, 1);
    const r2 = await ronda(ind1, 2);

    const evaluacion = async (rondaId: string, estado: 'completa' | 'borrador' | 'anulada', cliente: SupabaseClient = service) => {
      const { error: err } = await cliente.from('evaluaciones').insert({
        ronda_id: rondaId, fecha: '2026-10-21', estado, created_by: adminId,
        motivo_cambio: estado === 'anulada' ? 'Anulada en test de escala' : null,
        ...camposCompletos,
      });
      if (err) throw new Error(`setup evaluacion ${estado}: ${err.message}`);
    };
    await evaluacion(r1, 'completa');
    await evaluacion(r1, 'borrador');
    await evaluacion(r1, 'anulada', admin);
    await evaluacion(r2, 'completa');

    const { error: errPcr } = await service.from('pcr_analisis').insert({ ronda_id: r1, realizado: true, fecha: '2026-10-21' });
    if (errPcr) throw new Error(`setup pcr: ${errPcr.message}`);

    const { error: errBaja } = await service.from('baja_motivo').insert([
      { individuo_id: ind2, criterio: 'vigor', nota: 'Bajo vigor', created_by: adminId },
      { individuo_id: ind2, criterio: 'sanidad', nota: null, created_by: adminId },
    ]);
    if (errBaja) throw new Error(`setup baja: ${errBaja.message}`);
  }, 60_000);

  it('cuenta solo evaluaciones completa/corregida de rondas anuales, y los PCR', async () => {
    const { data, error } = await operario.rpc('resumen_individuos_cruce', { p_planta_id: plantaId });
    expect(error).toBeNull();
    const porId = new Map((data as Array<Record<string, unknown>>).map((f) => [f.individuo_id, f]));
    expect(porId.size).toBe(2);

    expect(porId.get(ind1)).toMatchObject({ evaluaciones_count: 2, pcr_count: 1, observaciones: [], tiene_emplazamiento: false });
    expect(porId.get(ind2)).toMatchObject({
      evaluaciones_count: 0,
      pcr_count: 0,
      observaciones: [{ criterio: 'vigor', nota: 'Bajo vigor' }],
    });
  });

  it('coincide con el cálculo anterior del cliente (consulta por ronda)', async () => {
    const { data: rondas } = await operario.from('ronda_evaluacion_anual').select('id').eq('individuo_id', ind1).eq('tipo_ronda', 'anual');
    let total = 0;
    for (const r of rondas ?? []) {
      const { data } = await operario.from('evaluaciones').select('id').eq('ronda_id', r.id).in('estado', ['completa', 'corregida']);
      total += data?.length ?? 0;
    }
    const { data } = await operario.rpc('resumen_individuos_cruce', { p_planta_id: plantaId });
    const fila = (data as Array<Record<string, unknown>>).find((f) => f.individuo_id === ind1);
    expect(fila?.evaluaciones_count).toBe(total);
  });

  it('informa el emplazamiento abierto con sus nombres de predio y sector', async () => {
    const otro = await crearCruce('traslado_destino', true, plantasSoft);
    const { data: individuo } = await service
      .from('individuos')
      .insert({ planta_id: otro, codigo_display: `ESCALA-${R}-T01`, created_by: adminId })
      .select('id')
      .single();
    const { data: sitio } = await admin.from('sitio').insert({ nombre: `Sitio escala ${R}`, created_by: adminId }).select('id').single();
    const { data: predio } = await admin.from('predio').insert({ nombre: `Predio escala ${R}`, sitio_id: sitio!.id }).select('id').single();
    const { data: sector } = await admin
      .from('sector')
      .insert({ nombre: `Sector escala ${R}`, predio_id: predio!.id, created_by: adminId })
      .select('id')
      .single();
    const { error } = await service
      .from('emplazamiento_individuo')
      .insert({ individuo_id: individuo!.id, sector_id: sector!.id, fecha_inicio: '2026-10-01' });
    expect(error).toBeNull();

    const { data } = await operario.rpc('resumen_individuos_cruce', { p_planta_id: otro });
    expect(data).toEqual([
      expect.objectContaining({
        tiene_emplazamiento: true,
        predio_nombre: `Predio escala ${R}`,
        sector_nombre: `Sector escala ${R}`,
      }),
    ]);
  });

  it('anon no puede ejecutarla', async () => {
    const { error } = await anon.rpc('resumen_individuos_cruce', { p_planta_id: plantaId });
    expect(error).not.toBeNull();
  });
});
