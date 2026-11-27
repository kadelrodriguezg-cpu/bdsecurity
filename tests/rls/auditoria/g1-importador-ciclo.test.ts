/**
 * Auditoría integral, Corrida 1, grupo G1 — flujo C02 (importador), ciclo de
 * vida del lote: qué pasa al corregir un archivo después de revertir, qué le
 * dice la previsualización al admin sobre lo que va a crear, y confirmaciones
 * concurrentes. Complementa g1-importador.test.ts y g1-importador-escala.test.ts.
 *
 * Los `it.fails` demuestran hallazgos abiertos (ID A1-G1-NN en cada uno).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();
const codigo = (s: string) => `AUD-G1-CIC-${R}-${s}`;
const DUKE = `Duke ciclo-g1 ${R}`;

let creds: ReturnType<typeof getLocalCreds>;
let service: SupabaseClient;
let adminId: string;
let especieId: string;
const lotes: string[] = [];
let nAdmins = 0;

type Preview = { lote_id: string; filas_total: number; filas_con_error: number; variedades_nuevas: string[]; filas: Array<{ n: number; errores: string[]; variedades_faltantes: string[] }> };

/** Un admin nuevo por grupo: el límite de confirmación es de 3 lotes por minuto por usuario. */
async function adminNuevo(): Promise<SupabaseClient> {
  nAdmins += 1;
  const u = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-cic-admin-${nAdmins}-${R}@test.local`, rol: 'admin' });
  if (nAdmins === 1) adminId = u.userId;
  return u.client;
}

const fila = (s: string, extra: Record<string, unknown> = {}) => ({
  codigo_sistema: codigo(s), especie: 'Arándano', cruzamiento: `SINT-CIC-${R}`, mama: DUKE, papa: DUKE, es_prueba: 'si', ...extra,
});

async function previsualizar(cliente: SupabaseClient, filas: Array<Record<string, unknown>>) {
  const res = await cliente.rpc('previsualizar_importacion_cruces', { p_filas: filas, p_archivo_nombre: `aud-g1-ciclo-${R}.csv` });
  if (res.data && (res.data as Preview).lote_id) lotes.push((res.data as Preview).lote_id);
  return res;
}

const confirmar = (cliente: SupabaseClient, loteId: string, clave = randomUUID()) =>
  cliente.rpc('confirmar_importacion_cruces', { p_lote_id: loteId, p_crear_variedades: true, p_idempotency_key: clave });

async function cruces(prefijo: string) {
  const { data, error } = await service.from('plantas').select('id, codigo_sistema, mama_id, papa_id, cruzamiento, eliminado_at, estado').like('codigo_sistema', `${codigo(prefijo)}%`);
  if (error) throw error;
  return data ?? [];
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await adminNuevo();
  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  const { error } = await service.from('variedades').insert({ especie_id: especieId, nombre: DUKE, created_by: adminId });
  if (error) throw new Error(`setup variedad: ${error.message}`);
}, 60_000);

afterAll(async () => {
  await service.from('plantas').delete().like('codigo_sistema', `AUD-G1-CIC-${R}-%`);
  if (lotes.length) await service.from('importacion_lote').delete().in('id', lotes);
  await service.from('variedades').delete().ilike('nombre', `%ciclo-g1 ${R}%`);
}, 60_000);

describe('C02 corregir un archivo después de revertir', () => {
  // A1-G1-14: revertir archiva los cruces pero los códigos siguen ocupados
  // (codigo_sistema es UNIQUE y el cruce archivado no se borra). El flujo
  // natural «importé con una columna mal asignada → reviertro → corrijo el
  // archivo → vuelvo a importar» termina con TODAS las filas en error.
  it.fails('tras revertir un lote, el mismo archivo corregido se puede volver a previsualizar sin errores (A1-G1-14)', async () => {
    const cliente = await adminNuevo();
    const archivo = [fila('REV1'), fila('REV2'), fila('REV3')];
    const p1 = await previsualizar(cliente, archivo);
    expect(p1.error).toBeNull();
    expect((await confirmar(cliente, (p1.data as Preview).lote_id)).error).toBeNull();
    const rev = await cliente.rpc('revertir_importacion', { p_lote_id: (p1.data as Preview).lote_id });
    expect(rev.error).toBeNull();
    expect((await cruces('REV')).every((c) => c.eliminado_at !== null)).toBe(true);

    const p2 = await previsualizar(cliente, archivo);
    expect(p2.error).toBeNull();
    // Hoy: filas_con_error = 3, todas «codigo_existente». Lo correcto: el admin puede reimportar.
    expect((p2.data as Preview).filas_con_error).toBe(0);
  });

  it('el código de un cruce revertido sigue ocupado y se reporta como codigo_existente (comportamiento actual)', async () => {
    const cliente = await adminNuevo();
    const p1 = await previsualizar(cliente, [fila('REV9')]);
    await confirmar(cliente, (p1.data as Preview).lote_id);
    await cliente.rpc('revertir_importacion', { p_lote_id: (p1.data as Preview).lote_id });
    const p2 = await previsualizar(cliente, [fila('REV9')]);
    expect((p2.data as Preview).filas[0].errores).toEqual(['codigo_existente']);
  });
});

describe('C02 lo que la previsualización le dice al admin', () => {
  // A1-G1-15: un archivo sin columna de mamá/papá (columna sin asignar o mal
  // asignada) produce «0 errores» y crea N cruces sin progenitores, sin aviso.
  it.fails('la previsualización avisa cuántas filas se importarán sin mamá, sin papá o sin cruzamiento (A1-G1-15)', async () => {
    const cliente = await adminNuevo();
    const sinLinaje = [1, 2, 3].map((i) => ({ codigo_sistema: codigo(`SL${i}`), especie: 'Arándano', es_prueba: 'si' }));
    const { data, error } = await previsualizar(cliente, sinLinaje);
    expect(error).toBeNull();
    const preview = data as Preview;
    expect(preview.filas_con_error).toBe(0);
    // Hoy la respuesta no trae ninguna advertencia; lo correcto es que la traiga.
    expect(JSON.stringify(preview)).toMatch(/sin_mama|sin_papa|sin_progenitor|advertencia/i);
  });

  it('confirmar un archivo sin progenitores crea los cruces con mama_id y papa_id nulos y sin error', async () => {
    const cliente = await adminNuevo();
    const { data } = await previsualizar(cliente, [{ codigo_sistema: codigo('SL9'), especie: 'Arándano', es_prueba: 'si' }]);
    const { error } = await confirmar(cliente, (data as Preview).lote_id);
    expect(error).toBeNull();
    const [c] = await cruces('SL9');
    expect(c).toMatchObject({ mama_id: null, papa_id: null, cruzamiento: null, estado: 'sin_empezar' });
  });

  it('cada previsualización guarda un lote nuevo con las filas (con linaje) aunque nunca se confirme', async () => {
    const cliente = await adminNuevo();
    const archivo = [fila('ACU1')];
    const a = await previsualizar(cliente, archivo);
    const b = await previsualizar(cliente, archivo);
    const c = await previsualizar(cliente, archivo);
    const ids = [a, b, c].map((r) => (r.data as Preview).lote_id);
    expect(new Set(ids).size).toBe(3);
    const { data } = await service.from('importacion_lote').select('id, estado, filas').in('id', ids);
    expect(data).toHaveLength(3);
    expect(data!.every((l) => l.estado === 'previsualizado')).toBe(true);
    expect(JSON.stringify(data![0].filas)).toContain(DUKE);
  });
});

describe('C02 confirmaciones concurrentes', () => {
  it('dos admins confirman el MISMO lote a la vez con claves distintas: entra una sola vez y el otro recibe 55000', async () => {
    const a = await adminNuevo();
    const b = await adminNuevo();
    const { data } = await previsualizar(a, [fila('CC1'), fila('CC2')]);
    const loteId = (data as Preview).lote_id;
    const [r1, r2] = await Promise.all([confirmar(a, loteId), confirmar(b, loteId)]);
    const errores = [r1.error, r2.error].filter(Boolean);
    expect(errores).toHaveLength(1);
    expect(errores[0]!.code).toBe('55000');
    expect(await cruces('CC')).toHaveLength(2);
  });

  it('el mismo admin confirma el mismo lote dos veces a la vez con la MISMA clave: una crea, la otra devuelve repetido', async () => {
    const a = await adminNuevo();
    const { data } = await previsualizar(a, [fila('CK1'), fila('CK2')]);
    const loteId = (data as Preview).lote_id;
    const clave = randomUUID();
    const [r1, r2] = await Promise.all([confirmar(a, loteId, clave), confirmar(a, loteId, clave)]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    const repetidos = [r1.data, r2.data].filter((d) => (d as { repetido: boolean }).repetido);
    expect(repetidos).toHaveLength(1);
    expect(await cruces('CK')).toHaveLength(2);
  });

  it('un código tomado a mano entre previsualizar y confirmar se detecta al confirmar (23514) y no se crea ninguna fila del lote', async () => {
    const a = await adminNuevo();
    const { data } = await previsualizar(a, [fila('RA1'), fila('RA2')]);
    const { error: errManual } = await a.from('plantas').insert({ codigo_sistema: codigo('RA2'), especie_id: especieId, es_prueba: true });
    expect(errManual).toBeNull();
    const { error } = await confirmar(a, (data as Preview).lote_id);
    expect(error?.code).toBe('23514');
    expect((await cruces('RA')).map((c) => c.codigo_sistema)).toEqual([codigo('RA2')]);
  });
});
