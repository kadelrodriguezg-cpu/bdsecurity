/**
 * Auditoría integral, Corrida 1, grupo G1 — flujo C02 (importador CSV de
 * cruces, ruta oculta). Complementa tests/rls/importador-cruces.test.ts (que
 * ya cubre errores por fila, todo o nada, idempotencia, límite por lote y
 * reversión) con: permisos reales de confirmar/revertir para operarios,
 * variedades desactivadas, el booleano de Excel en español, el canal lateral
 * de created_at, el tope de 5000 filas y el tiempo con un lote grande, la
 * reutilización de la clave de idempotencia y la confirmación por otro admin.
 *
 * Los `it.fails` demuestran hallazgos abiertos (ID A1-G1-NN en cada uno).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();
const codigo = (sufijo: string) => `AUD-G1-IMP-${R}-${sufijo}`;
const DUKE = `Duke aud-g1 ${R}`;
const INACTIVA = `Inactiva aud-g1 ${R}`;

let creds: ReturnType<typeof getLocalCreds>;
let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let admin2: SupabaseClient;
let operario: SupabaseClient;
let operarioLinaje: SupabaseClient;
let especieId: string;
let varDukeId: string;
let varInactivaId: string;
const lotes: string[] = [];

type FilaPreview = { n: number; codigo_sistema: string | null; errores: string[]; variedades_faltantes: string[]; sugerencias: Record<string, string> };
type Preview = { lote_id: string; filas_total: number; filas_con_error: number; variedades_nuevas: string[]; filas: FilaPreview[] };

const fila = (sufijo: string, extra: Record<string, unknown> = {}) => ({
  codigo_sistema: codigo(sufijo), especie: 'Arándano', cruzamiento: `SINT-IMP-${R}`, mama: DUKE, papa: DUKE, es_prueba: 'si', ...extra,
});

async function previsualizar(filas: Array<Record<string, unknown>>, cliente: SupabaseClient = admin) {
  const res = await cliente.rpc('previsualizar_importacion_cruces', { p_filas: filas, p_archivo_nombre: `aud-g1-${R}.csv` });
  if (res.data && (res.data as Preview).lote_id) lotes.push((res.data as Preview).lote_id);
  return res;
}

async function confirmar(loteId: string, clave = randomUUID(), cliente: SupabaseClient = admin, crear = true) {
  return cliente.rpc('confirmar_importacion_cruces', { p_lote_id: loteId, p_crear_variedades: crear, p_idempotency_key: clave });
}

/** El límite es de 3 lotes por minuto POR USUARIO: cada grupo confirma con un admin propio. */
let nAdmins = 0;
async function adminNuevo(): Promise<SupabaseClient> {
  nAdmins += 1;
  return (await crearUsuarioDePrueba(creds, service, { email: `aud-g1-imp-admin-${nAdmins}-${R}@test.local`, rol: 'admin' })).client;
}

async function plantasDelPrefijo() {
  const { data, error } = await service
    .from('plantas')
    .select('id, codigo_sistema, mama_id, papa_id, es_prueba, lote_importacion_id, eliminado_at, created_at')
    .like('codigo_sistema', `AUD-G1-IMP-${R}-%`);
  if (error) throw error;
  return data ?? [];
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-imp-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  admin2 = (await crearUsuarioDePrueba(creds, service, { email: `aud-g1-imp-admin2-${R}@test.local`, rol: 'admin' })).client;
  operario = (await crearUsuarioDePrueba(creds, service, { email: `aud-g1-imp-operario-${R}@test.local`, rol: 'operario' })).client;
  operarioLinaje = (await crearUsuarioDePrueba(creds, service, { email: `aud-g1-imp-operario-linaje-${R}@test.local`, rol: 'operario', puedeVerLinaje: true })).client;

  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;

  const { data: variedades, error: errVar } = await service
    .from('variedades')
    .insert([
      { especie_id: especieId, nombre: DUKE, created_by: adminId, activo: true },
      { especie_id: especieId, nombre: INACTIVA, created_by: adminId, activo: false },
    ])
    .select('id, nombre');
  if (errVar || !variedades) throw new Error(`setup variedades: ${errVar?.message}`);
  varDukeId = variedades.find((v) => v.nombre === DUKE)!.id;
  varInactivaId = variedades.find((v) => v.nombre === INACTIVA)!.id;
}, 60_000);

afterAll(async () => {
  // Limpieza con service_role: ningún cruce de esta suite recibe individuos,
  // así que el DELETE directo no deja huérfanos. Las filas de audit_log quedan
  // (planta_id pasa a null por la FK).
  await service.from('plantas').delete().like('codigo_sistema', `AUD-G1-IMP-${R}-%`);
  if (lotes.length) await service.from('importacion_lote').delete().in('id', lotes);
  await service.from('variedades').delete().ilike('nombre', `%aud-g1 ${R}%`);
}, 120_000);

describe('C02 permisos reales de las tres RPC', () => {
  let loteId: string;

  beforeAll(async () => {
    const { data } = await previsualizar([fila('PERM')]);
    loteId = (data as Preview).lote_id;
  });

  it('operario y operario con permiso de linaje: previsualizar, confirmar y revertir devuelven 42501', async () => {
    for (const cliente of [operario, operarioLinaje]) {
      expect((await previsualizar([fila('OP')], cliente)).error?.code).toBe('42501');
      expect((await confirmar(loteId, randomUUID(), cliente)).error?.code).toBe('42501');
      expect((await cliente.rpc('revertir_importacion', { p_lote_id: loteId })).error?.code).toBe('42501');
      const lote = await cliente.from('importacion_lote').select('id, filas').eq('id', loteId);
      if (lote.error) expect(lote.error).toBeTruthy();
      else expect(lote.data).toHaveLength(0);
    }
    expect(await plantasDelPrefijo()).toHaveLength(0);
  });

  it('validar_filas_importacion_cruces no es invocable por un admin (solo service_role)', async () => {
    const { error } = await admin.rpc('validar_filas_importacion_cruces', { p_filas: [fila('VAL')] });
    expect(error?.code).toBe('42501');
  });

  it('otro admin distinto del que previsualizó puede confirmar el lote (sin regla de autoría)', async () => {
    const { data, error } = await confirmar(loteId, randomUUID(), admin2);
    expect(error).toBeNull();
    expect(data).toMatchObject({ cruces_creados: 1 });
    const { data: lote } = await service.from('importacion_lote').select('created_by').eq('id', loteId).single();
    expect(lote!.created_by).toBe(adminId);
  });
});

describe('C02 validación: variedades desactivadas y el booleano de Excel en español', () => {
  // A1-G1-07: la resolución por nombre no mira `activo`; una variedad
  // discontinuada se asigna en silencio como progenitor.
  it.fails('una variedad desactivada en el archivo se marca como problema en la previsualización (A1-G1-07)', async () => {
    const { data, error } = await previsualizar([fila('INACT', { mama: INACTIVA })]);
    expect(error).toBeNull();
    const preview = data as Preview;
    expect(preview.filas_con_error + preview.filas[0].variedades_faltantes.length).toBeGreaterThan(0);
  });

  // A1-G1-07, consecuencia: hoy confirmar asigna la variedad desactivada.
  it.fails('confirmar no asigna una variedad desactivada como progenitor (A1-G1-07)', async () => {
    const { data } = await previsualizar([fila('INACT2', { mama: INACTIVA })]);
    const { error } = await confirmar((data as Preview).lote_id);
    const cruce = (await plantasDelPrefijo()).find((p) => p.codigo_sistema === codigo('INACT2'));
    expect(error ?? cruce?.mama_id !== varInactivaId).toBeTruthy();
    expect(cruce?.mama_id).not.toBe(varInactivaId);
  });

  // A1-G1-08: Excel en español exporta los booleanos como VERDADERO/FALSO;
  // el importador solo reconoce true/t/1/si/sí/x y convierte el resto en
  // «no es de prueba» sin avisar.
  it.fails('es_prueba = VERDADERO (Excel en español) marca el cruce como prueba (A1-G1-08)', async () => {
    const { data } = await previsualizar([fila('VERD', { es_prueba: 'VERDADERO' }), fila('FALSO', { es_prueba: 'FALSO' })]);
    const { error } = await confirmar((data as Preview).lote_id);
    expect(error).toBeNull();
    const plantas = await plantasDelPrefijo();
    expect(plantas.find((p) => p.codigo_sistema === codigo('FALSO'))!.es_prueba).toBe(false);
    expect(plantas.find((p) => p.codigo_sistema === codigo('VERD'))!.es_prueba).toBe(true);
  });

  it('un código que ya existe archivado se reporta solo como codigo_existente (sin decir que está archivado)', async () => {
    const { data: arch } = await service
      .from('plantas')
      .insert({ codigo_sistema: codigo('ARCH'), especie_id: especieId, es_prueba: true, eliminado_at: new Date().toISOString() })
      .select('id')
      .single();
    expect(arch).toBeTruthy();
    const { data } = await previsualizar([fila('ARCH')]);
    expect((data as Preview).filas[0].errores).toEqual(['codigo_existente']);
  });
});

describe('C02 canal lateral: variedades creadas por el importador', () => {
  // A1-G1-03: las variedades nuevas y los cruces del lote nacen en la misma
  // transacción, así que comparten created_at al microsegundo. Un operario
  // puede leer created_at en variedades y en plantas_operativas y emparejar
  // «estas variedades son progenitoras de estos cruces».
  it.fails('un operario no puede emparejar variedades nuevas con los cruces del lote por created_at (A1-G1-03)', async () => {
    const nueva = `Nueva lateral aud-g1 ${R}`;
    const { data } = await previsualizar([fila('LAT', { mama: nueva })]);
    const { error } = await confirmar((data as Preview).lote_id, randomUUID(), await adminNuevo());
    expect(error).toBeNull();

    const { data: cruce } = await operario.from('plantas_operativas').select('id, created_at').eq('codigo_sistema', codigo('LAT')).single();
    const { data: coincidentes } = await operario
      .from('variedades')
      .select('id, nombre')
      .eq('especie_id', especieId)
      .eq('created_at', cruce!.created_at);
    expect(coincidentes).toHaveLength(0);
  });
});

describe('C02 idempotencia y atomicidad con la clave reutilizada', () => {
  it('reusar la clave de un lote confirmado en otro lote falla (23505), no crea nada y el segundo lote sigue previsualizado', async () => {
    const confirmador = await adminNuevo();
    const clave = randomUUID();
    const { data: dA } = await previsualizar([fila('KA')]);
    expect((await confirmar((dA as Preview).lote_id, clave, confirmador)).error).toBeNull();

    const { data: dB } = await previsualizar([fila('KB')]);
    const { error } = await confirmar((dB as Preview).lote_id, clave, confirmador);
    expect(error?.code).toBe('23505');
    expect((await plantasDelPrefijo()).map((p) => p.codigo_sistema)).not.toContain(codigo('KB'));
    const { data: lote } = await service.from('importacion_lote').select('estado').eq('id', (dB as Preview).lote_id).single();
    expect(lote!.estado).toBe('previsualizado');

    // Con una clave nueva sí entra.
    expect((await confirmar((dB as Preview).lote_id, randomUUID(), confirmador)).error).toBeNull();
  });

  it('una variedad creada a mano entre previsualizar y confirmar se reutiliza en vez de duplicarse', async () => {
    const nombre = `Entre medio aud-g1 ${R}`;
    const { data } = await previsualizar([fila('ENTRE', { papa: nombre })]);
    expect((data as Preview).variedades_nuevas).toEqual([nombre]);
    const { data: manual } = await admin.from('variedades').insert({ especie_id: especieId, nombre, created_by: adminId }).select('id').single();
    const { data: res, error } = await confirmar((data as Preview).lote_id, randomUUID(), await adminNuevo());
    expect(error).toBeNull();
    expect(res).toMatchObject({ cruces_creados: 1, variedades_creadas: 0 });
    expect((await plantasDelPrefijo()).find((p) => p.codigo_sistema === codigo('ENTRE'))!.papa_id).toBe(manual!.id);
  });
});

describe('C02 escala: tope de filas y tiempo de un lote grande', () => {
  it('5001 filas se rechazan con un mensaje de negocio; 5000 filas se previsualizan', async () => {
    const grande = Array.from({ length: 5001 }, (_, i) => fila(`T${i}`));
    const { error } = await previsualizar(grande);
    expect(error?.code).toBe('22023');
    expect(error?.message).toMatch(/Máximo 5000 filas/);

    const inicio = Date.now();
    const { data, error: err5000 } = await previsualizar(grande.slice(0, 5000));
    const ms = Date.now() - inicio;
    expect(err5000).toBeNull();
    expect((data as Preview).filas_total).toBe(5000);
    expect((data as Preview).filas_con_error).toBe(0);
    console.log(`[G1] previsualizar 5000 filas: ${ms} ms`);
  }, 120_000);

  it('confirmar un lote de 1000 filas crea los 1000 cruces, audita 1000 altas y tarda lo que se mide', async () => {
    const { data } = await previsualizar(Array.from({ length: 1000 }, (_, i) => fila(`M${i}`)));
    const inicio = Date.now();
    const { data: res, error } = await confirmar((data as Preview).lote_id, randomUUID(), await adminNuevo());
    const ms = Date.now() - inicio;
    expect(error).toBeNull();
    expect(res).toMatchObject({ cruces_creados: 1000 });
    console.log(`[G1] confirmar 1000 filas: ${ms} ms`);
    // Conteos en el servidor: una lectura paginada se cortaría en max_rows (1000).
    const { count: cruces } = await service.from('plantas').select('id', { count: 'exact', head: true }).eq('lote_importacion_id', (data as Preview).lote_id);
    expect(cruces).toBe(1000);
    const { count } = await service
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('accion', 'alta_cruce')
      .like('detalle->>codigo_sistema', `AUD-G1-IMP-${R}-M%`);
    expect(count).toBe(1000);
  }, 120_000);
});
