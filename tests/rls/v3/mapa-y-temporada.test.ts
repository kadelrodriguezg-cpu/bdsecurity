/**
 * v3 paso 8 (migración 20261024090000):
 *  - N35: el mapa territorial excluye los cruces de prueba; solo un admin que lo pide los ve.
 *  - N38: el ranking por grupos se puede pedir para una temporada (p_numero_ronda) y trae las rondas del alcance.
 *
 * El cruce de prueba con emplazamiento es FIJO (se reutiliza entre corridas): el historial territorial es append-only
 * y su autor no se puede borrar, así que crearlo en cada corrida dejaría basura (ver tests/rls/README.md).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

const CODIGO_FIJO = 'V3-MAPA-PRUEBA-FIJO';
const PREDIO_FIJO = 'V3 mapa predio fijo (cruce de prueba)';
let service: SupabaseClient;
let admin: SupabaseClient;
let operario: SupabaseClient;
let especieId: string;
let cruceFijo: string;
let ctx: ContextoG6;

async function fixtureMapa(): Promise<string> {
  const { data: existente } = await service.from('plantas').select('id').eq('codigo_sistema', CODIGO_FIJO).maybeSingle();
  if (existente) return existente.id;
  // Autor fijo: nunca se borra (es autor de un individuo con historial territorial).
  const autor = await crearUsuarioDePrueba(getLocalCreds(), service, { email: 'v3-mapa-fijo@test.local', rol: 'admin' });
  const { data: cruce, error } = await service.from('plantas').insert({ codigo_sistema: CODIGO_FIJO, especie_id: especieId, estado: 'traslado_destino', es_prueba: true }).select('id').single();
  if (error || !cruce) throw new Error(`fixture cruce: ${error?.message}`);
  const { data: ind, error: eInd } = await service.from('individuos').insert({ planta_id: cruce.id, codigo_display: 'GENERADO-POR-TRIGGER', created_by: autor.userId }).select('id').single();
  if (eInd || !ind) throw new Error(`fixture individuo: ${eInd?.message}`);
  const { data: predio, error: ePredio } = await service.from('predio').insert({ nombre: PREDIO_FIJO, latitud: -35.42, longitud: -71.66 }).select('id').single();
  if (ePredio || !predio) throw new Error(`fixture predio: ${ePredio?.message}`);
  const { data: sector } = await service.from('sector').select('id').eq('predio_id', predio.id).limit(1).single();
  const { error: eEmp } = await service.from('emplazamiento_individuo').insert({ individuo_id: ind.id, sector_id: sector!.id, fecha_inicio: '2026-10-01' });
  if (eEmp) throw new Error(`fixture emplazamiento: ${eEmp.message}`);
  return cruce.id;
}

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const R = Date.now();
  admin = (await crearUsuarioDePrueba(creds, service, { email: `v3-mapa-admin-${R}@test.local`, rol: 'admin' })).client;
  operario = (await crearUsuarioDePrueba(creds, service, { email: `v3-mapa-op-${R}@test.local`, rol: 'operario' })).client;
  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  cruceFijo = await fixtureMapa();
  ctx = await iniciarContexto('v3-temporada');
}, 90_000);

afterAll(async () => {
  if (ctx) await limpiarContexto(ctx);
}, 60_000);

const cruceEnResumen = async (cliente: SupabaseClient, incluir?: boolean) => {
  const args: Record<string, unknown> = { p_especie_id: especieId, p_limite: 500 };
  if (incluir !== undefined) args.p_incluir_pruebas = incluir;
  const { data, error } = await cliente.rpc('obtener_resumen_mapa_territorial', args);
  expect(error).toBeNull();
  return ((data as Fila).clusters as Fila[]).some((c) => (c.cruces as Fila[]).some((x) => x.planta_id === cruceFijo));
};

const cruceEnViewport = async (incluir?: boolean) => {
  const args: Record<string, unknown> = { p_latitud_minima: -36, p_latitud_maxima: -35, p_longitud_minima: -72, p_longitud_maxima: -71, p_especie_id: especieId, p_limite: 500 };
  if (incluir !== undefined) args.p_incluir_pruebas = incluir;
  const { data, error } = await admin.rpc('consultar_mapa_viewport', args);
  expect(error).toBeNull();
  return ((data as Fila).puntos as Fila[]).some((p) => p.planta_id === cruceFijo);
};

describe('N35: el mapa territorial oculta los cruces de prueba', () => {
  it('por defecto nadie lo ve en el mapa agregado; el operario tampoco aunque lo pida; el admin, si lo pide', async () => {
    expect(await cruceEnResumen(operario)).toBe(false);
    expect(await cruceEnResumen(admin)).toBe(false);
    expect(await cruceEnResumen(operario, true)).toBe(false);
    expect(await cruceEnResumen(admin, true)).toBe(true);
  });

  it('lo mismo en el mapa por coordenadas del admin', async () => {
    expect(await cruceEnViewport()).toBe(false);
    expect(await cruceEnViewport(true)).toBe(true);
  });
});

describe('N38: ranking por temporada', () => {
  it('p_numero_ronda toma la ronda de esa temporada; sin él, la última de cada individuo; y trae las rondas del alcance', async () => {
    const cruce = await crearCruce(ctx, { codigo: `V3-TEMP-${ctx.R}` });
    const [a, b, c] = await crearIndividuos(ctx, cruce, 3);
    const r1 = new Map<string, string>();
    for (const ind of [a, b, c]) r1.set(ind.id, await crearEvaluacion(ctx, await crearRonda(ctx, ind.id, 1), { brotacion: 3 }, { fecha: '2025-10-10' }));
    const r2 = new Map<string, string>();
    for (const ind of [a, b]) r2.set(ind.id, await crearEvaluacion(ctx, await crearRonda(ctx, ind.id, 2), { brotacion: 4 }, { fecha: '2026-10-10' }));

    const pedir = async (numero?: number) => {
      const args: Record<string, unknown> = { p_planta_id: cruce };
      if (numero !== undefined) args.p_numero_ronda = numero;
      const { data, error } = await ctx.operario.rpc('obtener_ranking_por_grupos', args);
      expect(error).toBeNull();
      return data as Fila;
    };
    const porIndividuo = (d: Fila) => new Map((d.items as Fila[]).map((i) => [i.individuo_id as string, { ronda: i.numero_ronda, evaluacion: i.evaluacion_id }]));

    const t1 = porIndividuo(await pedir(1));
    for (const ind of [a, b, c]) expect(t1.get(ind.id)).toEqual({ ronda: 1, evaluacion: r1.get(ind.id) });

    const t2 = porIndividuo(await pedir(2));
    expect(t2.get(a.id)).toEqual({ ronda: 2, evaluacion: r2.get(a.id) });
    expect(t2.get(c.id)).toEqual({ ronda: null, evaluacion: null }); // no tiene ronda 2: queda sin puntaje

    const ultima = await pedir();
    expect(porIndividuo(ultima).get(c.id)).toEqual({ ronda: 1, evaluacion: r1.get(c.id) }); // mezcla temporadas
    expect(ultima.numero_ronda).toBeNull();
    expect(ultima.rondas).toEqual([{ numero: 1, individuos: 3, con_cerrada: 3 }, { numero: 2, individuos: 2, con_cerrada: 2 }]);
  });

  it('una ronda menor que 1 se rechaza (22023)', async () => {
    const { error } = await ctx.operario.rpc('obtener_ranking_por_grupos', { p_especie_id: ctx.especieId, p_numero_ronda: 0 });
    expect(error?.code).toBe('22023');
  });
});
