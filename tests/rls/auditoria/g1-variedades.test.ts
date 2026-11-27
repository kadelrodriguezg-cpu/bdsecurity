/**
 * Auditoría integral, Corrida 1, grupo G1 — flujos C01/C08, catálogo de
 * variedades (lo que alimenta mamá/papá) y lo que el ranking varietal hace con
 * él, más el DELETE directo sobre cruces con bitácora.
 *
 * Los `it.fails` demuestran hallazgos abiertos (ID A1-G1-NN en cada uno).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();

let creds: ReturnType<typeof getLocalCreds>;
let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let operarioId: string;
let especieId: string;

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-var-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-var-operario-${R}@test.local`, rol: 'operario' });
  operario = op.client;
  operarioId = op.userId;
  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
}, 60_000);

afterAll(async () => {
  const { data: propios } = await service.from('plantas').select('id').like('codigo_sistema', `AUD-G1-${R}-%`);
  const ids = (propios ?? []).map((p) => p.id as string);
  if (ids.length) {
    await service.from('polinizacion_evento').delete().in('planta_id', ids);
    await service.from('registros_evento').delete().in('planta_id', ids);
    await service.from('plantas').delete().in('id', ids);
  }
  await service.from('variedades').delete().ilike('nombre', `%var-g1 ${R}%`);
}, 60_000);

describe('C01 el ranking varietal y los cruces de prueba', () => {
  // A1-G1-16: la pantalla de alta promete que un cruce de prueba «queda fuera
  // de los listados y del ranking»; obtener_ranking_polinizacion_varietal no
  // filtra es_prueba (ni en las participaciones ni en el resumen de campo).
  it.fails('un cruce es_prueba no cuenta en el ranking de polinización varietal (A1-G1-16)', async () => {
    const nombre = `Solo prueba var-g1 ${R}`;
    const { data: v } = await service.from('variedades').insert({ especie_id: especieId, nombre, created_by: adminId }).select('id').single();
    const { data: c } = await service
      .from('plantas')
      .insert({ codigo_sistema: `AUD-G1-${R}-RKP`, especie_id: especieId, mama_id: v!.id, es_prueba: true, estado: 'polinizacion' })
      .select('id')
      .single();
    await service.from('polinizacion_evento').insert({ planta_id: c!.id, fecha: '2026-10-03', n_flores_cruzadas: 7, created_by: adminId });

    const { data, error } = await admin.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieId, p_rol: 'mama' });
    expect(error).toBeNull();
    const filas = (data as Array<{ tipo_fila: string; variedad_id: string | null }>).filter((f) => f.variedad_id === v!.id);
    expect(filas).toHaveLength(0);
  });
});

describe('C01 catálogo de variedades abierto a cualquier autenticado', () => {
  it('una variedad desactivada ocupa su nombre: crear otra igual falla con 23505 aunque el selector no la liste', async () => {
    const nombre = `Descontinuada var-g1 ${R}`;
    const { data: v } = await service.from('variedades').insert({ especie_id: especieId, nombre, created_by: adminId, activo: false }).select('id').single();
    // Lo que hace listarVariedades(especieId, true): solo activas.
    const { data: visibles } = await admin.from('variedades').select('id').eq('especie_id', especieId).eq('activo', true).eq('nombre', nombre);
    expect(visibles).toHaveLength(0);
    // Lo que hace crearVariedad al elegir «Crear "<nombre>" como nueva variedad».
    const { error } = await admin.from('variedades').insert({ especie_id: especieId, nombre, created_by: adminId });
    expect(error?.code).toBe('23505');
    expect(v!.id).toBeTruthy();
  });

  it('un operario puede crear 200 variedades de una vez por la API: no hay tope, ni auditoría, ni forma de borrarlas', async () => {
    const filas = Array.from({ length: 200 }, (_, i) => ({ especie_id: especieId, nombre: `Relleno ${i} var-g1 ${R}`, created_by: operarioId }));
    const { error } = await operario.from('variedades').insert(filas);
    expect(error).toBeNull();
    const borrado = await operario.from('variedades').delete().ilike('nombre', `Relleno % var-g1 ${R}`).select('id');
    expect(borrado.data ?? []).toHaveLength(0); // sin policy de DELETE: 0 filas
    const { count } = await service.from('variedades').select('id', { count: 'exact', head: true }).ilike('nombre', `Relleno % var-g1 ${R}`);
    expect(count).toBe(200);
  });

  it('el índice por clave rechaza espacios internos distintos («Duke X» y «Duke  X»)', async () => {
    const a = await admin.from('variedades').insert({ especie_id: especieId, nombre: `Duke X var-g1 ${R}`, created_by: adminId }).select('id').single();
    const b = await admin.from('variedades').insert({ especie_id: especieId, nombre: `Duke  X var-g1 ${R}`, created_by: adminId }).select('id').single();
    expect(a.error).toBeNull();
    expect(b.error?.code).toBe('23505'); // mismo criterio en importador y alta manual
  });
});

describe('C01/C11 DELETE directo sobre un cruce real con bitácora', () => {
  // A1-G1-02 (variante con datos): los hijos RESTRICT frenan el DELETE solo
  // si hay individuos, polinización, cosecha, germinación o procedimientos.
  // registros_evento (bitácora, fotos), plantas_insumo y plantas_sustrato son
  // CASCADE: el DELETE directo se los lleva sin snapshot ni auditoría.
  it('un admin no puede borrar con DELETE directo un cruce real que tiene bitácora (A1-G1-02)', async () => {
    const { data: planta } = await service
      .from('plantas')
      .insert({ codigo_sistema: `AUD-G1-${R}-BIT`, especie_id: especieId, es_prueba: false })
      .select('id')
      .single();
    const { data: ev } = await service
      .from('registros_evento')
      .insert({ planta_id: planta!.id, tipo_evento: 'otro', notas: 'bitácora de prueba var-g1', created_by: adminId })
      .select('id')
      .single();

    const { data: borradas } = await admin.from('plantas').delete().eq('id', planta!.id).select('id');
    const { data: evento } = await service.from('registros_evento').select('id').eq('id', ev!.id);
    const { data: alta } = await service.from('audit_log').select('id, planta_id').eq('accion', 'alta_cruce').eq('detalle->>codigo_sistema', `AUD-G1-${R}-BIT`);

    expect(borradas ?? []).toHaveLength(0); // lo correcto: la base rechaza el borrado directo
    expect(evento).toHaveLength(1); // lo correcto: la bitácora sigue ahí
    expect(alta).toHaveLength(1);
  });
});
