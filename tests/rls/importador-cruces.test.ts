/**
 * Importador masivo de cruces (brecha B1, migración 20261021150000).
 *
 * Se verifica contra la base local: solo admin; errores fila por fila sin
 * tocar plantas; todo o nada al confirmar; idempotencia; límite por lote;
 * auditoría de cada alta (B3) y del lote; reversión solo sin individuos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { limpiarPrueba } from './limpieza-pruebas';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let especieId: string;
const variedadesCreadas: string[] = [];

const R = Date.now();
const codigo = (sufijo: string) => `IMP-${R}-${sufijo}`;
const DUKE = `Duke import ${R}`;
const ONEAL = `O'Neal import ${R}`;
const NUEVA = `Nueva import ${R}`;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Admin propio de esta suite: el límite de frecuencia es por usuario y no
  // debe depender de corridas anteriores.
  const ad = await crearUsuarioDePrueba(creds, service, { email: `importador-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  operario = (await crearUsuarioDePrueba(creds, service, { email: 'operario@test.local', rol: 'operario' })).client;

  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;

  const { data: variedades, error: errVar } = await service
    .from('variedades')
    .insert([
      { especie_id: especieId, nombre: DUKE, created_by: adminId },
      { especie_id: especieId, nombre: ONEAL, created_by: adminId },
    ])
    .select('id');
  if (errVar || !variedades) throw new Error(`setup variedades: ${errVar?.message}`);
  variedadesCreadas.push(...variedades.map((v) => v.id));
}, 60_000);

afterAll(async () => {
  // Cruces del archivo (incluidos los archivados), variedades nuevas, lotes de importación del admin propio y el admin.
  const { data: plantas } = await service.from('plantas').select('id').like('codigo_sistema', `IMP-${R}-%`);
  const { data: nuevas } = await service.from('variedades').select('id').eq('especie_id', especieId).ilike('nombre', `%import ${R}%`);
  await limpiarPrueba(service, {
    plantaIds: (plantas ?? []).map((p) => p.id),
    variedadIds: [...variedadesCreadas, ...(nuevas ?? []).map((v) => v.id)],
    usuarioIds: [adminId],
  }, 'importador-cruces');
}, 60_000);

type FilaPreview = { n: number; codigo_sistema: string | null; errores: string[]; variedades_faltantes: string[]; sugerencias: Record<string, string> };
type Preview = { lote_id: string; filas_total: number; filas_con_error: number; variedades_nuevas: string[]; filas: FilaPreview[] };

async function previsualizar(filas: Array<Record<string, unknown>>, cliente: SupabaseClient = admin) {
  return cliente.rpc('previsualizar_importacion_cruces', { p_filas: filas, p_archivo_nombre: `cruces-${R}.csv` });
}

const fila = (sufijo: string, extra: Record<string, unknown> = {}) => ({
  codigo_sistema: codigo(sufijo), especie: 'Arándano', cruzamiento: 'SINT-IMP x SINT-IMP', mama: DUKE, papa: DUKE, es_prueba: 'si', ...extra,
});

async function plantasDelArchivo() {
  const { data } = await service.from('plantas').select('id, codigo_sistema, mama_id, papa_id, lote_importacion_id, eliminado_at').like('codigo_sistema', `IMP-${R}-%`);
  return data ?? [];
}

describe('importador: permisos (B1)', () => {
  it('un operario no puede previsualizar ni leer lotes', async () => {
    const { error } = await previsualizar([fila('OP')], operario);
    expect(error?.code).toBe('42501');
    const { data, error: errLectura } = await operario.from('importacion_lote').select('id');
    if (errLectura) expect(errLectura).toBeTruthy();
    else expect(data).toHaveLength(0);
  });
});

describe('importador: previsualizar reporta errores fila por fila sin crear nada (B1)', () => {
  it('detecta código repetido, existente, vacío, especie inexistente y progenitor casi igual a uno existente', async () => {
    const { data, error } = await previsualizar([
      fila('DUP'),
      fila('DUP'),
      fila('X', { codigo_sistema: '02-001' }),
      fila('ESP', { especie: 'Kiwi que no existe' }),
      fila('PARECIDA', { mama: `ONeal import ${R}` }),
      fila('VACIO', { codigo_sistema: '  ' }),
    ]);
    expect(error).toBeNull();
    const preview = data as Preview;
    expect(preview.filas_total).toBe(6);
    expect(preview.filas_con_error).toBe(6);
    const errores = preview.filas.map((f) => f.errores);
    expect(errores[0]).toContain('codigo_repetido_en_archivo');
    expect(errores[1]).toContain('codigo_repetido_en_archivo');
    expect(errores[2]).toContain('codigo_existente');
    expect(errores[3]).toContain('especie_inexistente');
    expect(errores[4]).toContain('mama_parecida_a_existente');
    expect(preview.filas[4].sugerencias).toEqual({ mama: ONEAL });
    expect(errores[5]).toContain('codigo_vacio');
    expect(await plantasDelArchivo()).toHaveLength(0);
  });

  it('un archivo sin errores informa las variedades que se crearían, sin crearlas', async () => {
    const { data, error } = await previsualizar([fila('OK1', { papa: NUEVA }), fila('OK2', { mama: `  ${DUKE.toUpperCase()}  ` })]);
    expect(error).toBeNull();
    const preview = data as Preview;
    expect(preview.filas_con_error).toBe(0);
    expect(preview.variedades_nuevas).toEqual([NUEVA]);
    expect(preview.filas[0].variedades_faltantes).toEqual([NUEVA]);
    const { data: variedad } = await service.from('variedades').select('id').eq('nombre', NUEVA);
    expect(variedad).toHaveLength(0);
  });
});

describe('importador: confirmar (B1)', () => {
  let loteA: string;
  const claveA = randomUUID();

  beforeAll(async () => {
    const { data } = await previsualizar([fila('A1', { papa: NUEVA }), fila('A2'), fila('A3', { mama: `  ${DUKE.toLowerCase()} ` })]);
    loteA = (data as Preview).lote_id;
  });

  it('sin permiso para crear variedades nuevas, rechaza y no crea nada', async () => {
    const { error } = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: loteA, p_crear_variedades: false, p_idempotency_key: randomUUID() });
    expect(error?.code).toBe('23514');
    expect(await plantasDelArchivo()).toHaveLength(0);
  });

  it('crea todos los cruces y la variedad nueva, resolviendo progenitores por nombre normalizado', async () => {
    const { data, error } = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: loteA, p_crear_variedades: true, p_idempotency_key: claveA });
    expect(error).toBeNull();
    expect(data).toMatchObject({ cruces_creados: 3, variedades_creadas: 1, repetido: false });

    const plantas = await plantasDelArchivo();
    expect(plantas).toHaveLength(3);
    const [duke] = variedadesCreadas;
    expect(plantas.every((p) => p.lote_importacion_id === loteA && p.mama_id === duke)).toBe(true);
    const { data: nueva } = await service.from('variedades').select('id').eq('nombre', NUEVA).single();
    expect(plantas.find((p) => p.codigo_sistema === codigo('A1'))!.papa_id).toBe(nueva!.id);
  });

  it('cada alta queda auditada como alta_cruce (B3) y el lote deja su resumen', async () => {
    const plantas = await plantasDelArchivo();
    const { data: altas } = await service.from('audit_log').select('planta_id, usuario_id').eq('accion', 'alta_cruce').in('planta_id', plantas.map((p) => p.id));
    expect(altas).toHaveLength(3);
    expect(altas!.every((a) => a.usuario_id === adminId)).toBe(true);

    const { data: resumen } = await service.from('audit_log').select('detalle').eq('accion', 'importacion_cruces').eq('detalle->>lote_id', loteA);
    expect(resumen).toEqual([{ detalle: expect.objectContaining({ cruces_creados: 3, variedades_creadas: 1 }) }]);
  });

  it('repetir con la misma clave devuelve el mismo resultado sin duplicar; otra clave se rechaza', async () => {
    const { data, error } = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: loteA, p_crear_variedades: true, p_idempotency_key: claveA });
    expect(error).toBeNull();
    expect(data).toMatchObject({ cruces_creados: 3, repetido: true });
    expect(await plantasDelArchivo()).toHaveLength(3);

    const { error: errOtra } = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: loteA, p_crear_variedades: true, p_idempotency_key: randomUUID() });
    expect(errOtra?.code).toBe('55000');
  });

  it('si una fila deja de ser válida entre previsualizar y confirmar, no entra ninguna', async () => {
    const { data } = await previsualizar([fila('B1'), fila('B2')]);
    const loteB = (data as Preview).lote_id;
    // Alguien crea a mano un cruce con uno de los códigos del archivo.
    await service.from('plantas').insert({ codigo_sistema: codigo('B2'), especie_id: especieId, es_prueba: true });

    const { error } = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: loteB, p_crear_variedades: true, p_idempotency_key: randomUUID() });
    expect(error?.code).toBe('23514');
    const codigos = (await plantasDelArchivo()).map((p) => p.codigo_sistema);
    expect(codigos).not.toContain(codigo('B1'));
  });
});

describe('importador: límite de frecuencia por lote y reversión (B1)', () => {
  let loteConIndividuo: string;

  it('revertir rechaza un lote con individuos y archiva uno sin individuos', async () => {
    const { data } = await previsualizar([fila('C1')]);
    loteConIndividuo = (data as Preview).lote_id;
    const { error } = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: loteConIndividuo, p_crear_variedades: true, p_idempotency_key: randomUUID() });
    expect(error).toBeNull();
    const c1 = (await plantasDelArchivo()).find((p) => p.codigo_sistema === codigo('C1'))!;
    await service.from('individuos').insert({ planta_id: c1.id, codigo_display: `${codigo('C1')}-P01`, created_by: adminId });

    const { error: errRevertir } = await admin.rpc('revertir_importacion', { p_lote_id: loteConIndividuo });
    expect(errRevertir?.code).toBe('55000');
    expect(errRevertir?.message).toMatch(/individuos/);

    // El lote A (3 cruces sin individuos) sí se revierte.
    const { data: lotes } = await service.from('importacion_lote').select('id').eq('created_by', adminId).eq('cruces_creados', 3);
    const { data: revertido, error: errA } = await admin.rpc('revertir_importacion', { p_lote_id: lotes![0].id });
    expect(errA).toBeNull();
    expect(revertido).toMatchObject({ cruces_archivados: 3 });
    const archivados = (await plantasDelArchivo()).filter((p) => p.lote_importacion_id === lotes![0].id);
    expect(archivados.every((p) => p.eliminado_at !== null)).toBe(true);
  });

  it('un cuarto lote en el mismo minuto excede el límite por lote', async () => {
    const { data: d1 } = await previsualizar([fila('D1')]);
    const { error: e1 } = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: (d1 as Preview).lote_id, p_crear_variedades: true, p_idempotency_key: randomUUID() });
    expect(e1).toBeNull(); // tercer lote confirmado en este minuto (A, C, D)

    const { data: d2 } = await previsualizar([fila('E1')]);
    const { error: e2 } = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: (d2 as Preview).lote_id, p_crear_variedades: true, p_idempotency_key: randomUUID() });
    expect(e2?.code).toBe('58503');
  });
});
