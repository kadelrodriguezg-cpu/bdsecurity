/**
 * Auditoría integral, Corrida 1, grupo G1 — flujo C02 (importador), escala con
 * el caso REAL de la primera carga: un archivo grande cuyos progenitores casi
 * todos son variedades nuevas, contra un catálogo del tamaño del de producción
 * (83 variedades al 21-10; aquí se siembran 80 propias además de las que haya).
 *
 * La validación calcula, por cada fila con un progenitor que no existe, la
 * clave normalizada de TODAS las variedades de la especie (O(filas x
 * variedades)), y `previsualizar` la ejecuta dos veces. `authenticated` y
 * `authenticator` tienen statement_timeout = 8 s (igual en local y en el
 * proyecto hosted): una RPC más lenta se corta con 57014.
 *
 * Los `it.fails` demuestran hallazgos abiertos (ID A1-G1-NN en cada uno).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();
const P = `AUD-G1-ESC-${R}`;

let creds: ReturnType<typeof getLocalCreds>;
let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let totalVariedades = 0;
const lotes: string[] = [];

/** `tag` cambia los nombres de progenitor para que siempre sean «nuevos» en cada medición. */
const filas = (n: number, tag: string, nombresDistintos = 300) =>
  Array.from({ length: n }, (_, i) => ({
    codigo_sistema: `${P}-${tag}-${i}`,
    especie: 'Arándano',
    cruzamiento: `SINT-ESC-${R}`,
    mama: `Nueva mama ${tag} esc-g1 ${R} ${i % nombresDistintos}`,
    papa: `Nueva papa ${tag} esc-g1 ${R} ${i % nombresDistintos}`,
    es_prueba: 'si',
  }));

async function previsualizar(f: Array<Record<string, unknown>>) {
  const t0 = Date.now();
  const res = await admin.rpc('previsualizar_importacion_cruces', { p_filas: f, p_archivo_nombre: `aud-g1-esc-${R}.csv` });
  if (res.data && (res.data as { lote_id: string }).lote_id) lotes.push((res.data as { lote_id: string }).lote_id);
  return { ...res, ms: Date.now() - t0 };
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-esc-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  const { error } = await service
    .from('variedades')
    .insert(Array.from({ length: 80 }, (_, i) => ({ especie_id: esp!.id, nombre: `Catalogo ${i} esc-g1 ${R}`, created_by: adminId })));
  if (error) throw new Error(`setup catálogo: ${error.message}`);
  const { count } = await service.from('variedades').select('id', { count: 'exact', head: true }).eq('especie_id', esp!.id);
  totalVariedades = count ?? 0;
}, 60_000);

afterAll(async () => {
  await service.from('plantas').delete().like('codigo_sistema', `${P}-%`);
  if (lotes.length) await service.from('importacion_lote').delete().in('id', lotes);
  await service.from('variedades').delete().ilike('nombre', `%esc-g1 ${R}%`);
}, 180_000);

describe('C02 escala con progenitores nuevos y un catálogo de ~90 variedades', () => {
  it('mide previsualizar con 500 y 1000 filas y confirma las 500 (informativo)', async () => {
    const quinientas = await previsualizar(filas(500, 'a'));
    console.log(`[G1-ESC] catálogo=${totalVariedades} variedades; previsualizar 500 filas nuevas: ${quinientas.ms} ms, error=${quinientas.error?.code ?? 'no'}`);
    const mil = await previsualizar(filas(1000, 'b'));
    console.log(`[G1-ESC] previsualizar 1000 filas nuevas: ${mil.ms} ms, error=${mil.error?.code ?? 'no'}`);
    expect(quinientas.error).toBeNull();
    const t0 = Date.now();
    const { error } = await admin.rpc('confirmar_importacion_cruces', {
      p_lote_id: (quinientas.data as { lote_id: string }).lote_id,
      p_crear_variedades: true,
      p_idempotency_key: randomUUID(),
    });
    console.log(`[G1-ESC] confirmar 500 filas nuevas: ${Date.now() - t0} ms, error=${error?.code ?? 'no'}`);
    expect(error).toBeNull();
  }, 120_000);

  // A1-002 añadió índice por clave; estas observaciones ahora pasan localmente.
  // Conservan el RPC real y su timeout normal, sin elevar límites.
  // A1-G1-09: el archivo real de Efraín trae ~2000 cruzamientos; con un
  // catálogo de producción y progenitores nuevos la previsualización se corta
  // por tiempo (57014) y el usuario ve «No se pudo completar la operación
  // (código 57014)». El mismo problema aparece mucho antes con 5000 filas.
  it('un archivo de 2000 filas con progenitores nuevos se previsualiza sin cortarse por tiempo (A1-G1-09)', async () => {
    const r = await previsualizar(filas(2000, 'c'));
    console.log(`[G1-ESC] catálogo=${totalVariedades}; previsualizar 2000 filas nuevas: ${r.ms} ms, error=${r.error?.code ?? 'no'}`);
    expect(r.error).toBeNull();
  }, 120_000);

  it('un archivo de 5000 filas (el máximo permitido) con progenitores nuevos se previsualiza sin cortarse por tiempo (A1-G1-09)', async () => {
    const r = await previsualizar(filas(5000, 'd'));
    console.log(`[G1-ESC] previsualizar 5000 filas nuevas: ${r.ms} ms, error=${r.error?.code ?? 'no'}`);
    expect(r.error).toBeNull();
  }, 120_000);
});
