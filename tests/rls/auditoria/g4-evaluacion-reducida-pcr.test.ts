/**
 * Auditoría integral, Corrida 1, grupo G4: I07 evaluación reducida e I08 PCR.
 *
 * Ambos flujos escriben con INSERT directo bajo RLS (sin RPC). Se verifica
 * quién puede, qué valida el servidor (y qué solo el cliente), la
 * idempotencia, el orden archivo→fila del PCR y los huérfanos en Storage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

const R = Date.now();
const BUCKET = 'media-plantas';

let creds: LocalCreds;
let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let operarioId: string;
let operario2: SupabaseClient;
let operario2Id: string;
let especieId: string;
let cruceTrasplante: string;
let crucePolinizacion: string;
let vivo: string;
let muerto: string;
let rondaVivo: string;
let rondaMuerto: string;
const archivosSubidos: string[] = [];

async function individuo(planta: string, creadoPor = operarioId): Promise<string> {
  const { data, error } = await service.from('individuos').insert({ planta_id: planta, created_by: creadoPor, codigo_display: '' }).select('id').single();
  if (error || !data) throw new Error(`setup individuo: ${error?.message}`);
  return data.id as string;
}

async function ronda(individuoId: string, numero = 1): Promise<string> {
  const { data, error } = await service.from('ronda_evaluacion_anual').insert({ individuo_id: individuoId, numero_ronda: numero, anio: 2026, tipo_ronda: 'anual', created_by: operarioId }).select('id').single();
  if (error || !data) throw new Error(`setup ronda: ${error?.message}`);
  return data.id as string;
}

const pdf = () => new Blob(['%PDF-1.4\n% prueba G4\n'], { type: 'application/pdf' });

async function existeEnStorage(path: string): Promise<boolean> {
  const carpeta = path.slice(0, path.lastIndexOf('/'));
  const nombre = path.slice(path.lastIndexOf('/') + 1);
  const { data, error } = await service.storage.from(BUCKET).list(carpeta);
  if (error) throw error;
  return (data ?? []).some((o) => o.name === nombre);
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-evr-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-evr-operario-${R}@test.local`, rol: 'operario' });
  operario = op.client;
  operarioId = op.userId;
  const op2 = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-evr-operario2-${R}@test.local`, rol: 'operario' });
  operario2 = op2.client;
  operario2Id = op2.userId;

  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  const crear = async (sufijo: string, estado: string) => {
    const { data, error } = await service.from('plantas').insert({ codigo_sistema: `AUD-G4-EVR-${sufijo}-${R}`, especie_id: especieId, estado, es_prueba: true }).select('id').single();
    if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
    return data.id as string;
  };
  cruceTrasplante = await crear('A', 'trasplante');
  crucePolinizacion = await crear('B', 'polinizacion');
  vivo = await individuo(cruceTrasplante);
  muerto = await individuo(cruceTrasplante);
  rondaVivo = await ronda(vivo);
  rondaMuerto = await ronda(muerto);
  const { error } = await operario.rpc('marcar_baja_individuo', { p_individuo_id: muerto, p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID() });
  if (error) throw new Error(`setup baja: ${error.message}`);
}, 60_000);

afterAll(async () => {
  if (archivosSubidos.length > 0) await service.storage.from(BUCKET).remove(archivosSubidos);
  for (const id of [cruceTrasplante, crucePolinizacion]) {
    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
    if (error) console.warn(`afterAll: no se pudo purgar ${id}: ${error.message}`);
  }
}, 120_000);

describe('I07 evaluacion_reducida: permisos y validación de servidor', () => {
  it('el autor de otro individuo también puede evaluar: cualquier autenticado, a su propio nombre, si el individuo está vivo', async () => {
    const { error } = await operario2.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', vigor: 3, created_by: operario2Id });
    expect(error).toBeNull();
  });

  it('no se puede evaluar a nombre de otro (42501) ni a un individuo muerto (42501), y anon no inserta', async () => {
    expect((await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', vigor: 3, created_by: operario2Id })).error?.code).toBe('42501');
    expect((await operario.from('evaluacion_reducida').insert({ individuo_id: muerto, fase: 'trasplante', vigor: 3, created_by: operarioId })).error?.code).toBe('42501');
    const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', vigor: 3 })).error).not.toBeNull();
  });

  it('vigor y presencia_raices fuera de 1..5 se rechazan (CHECK 23514)', async () => {
    expect((await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', vigor: 6, created_by: operarioId })).error?.code).toBe('23514');
    expect((await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'crecimiento', presencia_raices: 0, created_by: operarioId })).error?.code).toBe('23514');
  });

  // A1-G4-11: las reglas de fase y de contenido viven solo en el cliente.
  it.fails('A1-G4-11: la base rechaza una evaluación reducida de fase crecimiento en un cruce que está en trasplante (hoy la acepta)', async () => {
    const { error } = await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'crecimiento', vigor: 2, multibrotes: 3, created_by: operarioId });
    expect(error).not.toBeNull();
  });

  it.fails('A1-G4-11: la base rechaza una evaluación reducida sin ningún dato (todo null) (hoy la acepta)', async () => {
    const { error } = await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', created_by: operarioId });
    expect(error).not.toBeNull();
  });

  it.fails('A1-G4-11: la base rechaza talla y entrenudos negativos (hoy los acepta)', async () => {
    const { error } = await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', talla: -3.5, numero_entrenudos: -1, created_by: operarioId });
    expect(error).not.toBeNull();
  });

  it.fails('A1-G4-11: la base rechaza multibrotes/presencia_raices en fase trasplante (hoy lo descarta solo el cliente)', async () => {
    const { error } = await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', multibrotes: 2, presencia_raices: 3, created_by: operarioId });
    expect(error).not.toBeNull();
  });

  it.fails('A1-G4-11: created_at (la única fecha de la evaluación reducida) no la fija el cliente (hoy el INSERT acepta cualquier created_at)', async () => {
    const { error } = await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', vigor: 3, created_by: operarioId, created_at: '2000-01-01T00:00:00Z' });
    expect(error).not.toBeNull();
  });

  it('se puede evaluar un individuo de un cruce en polinización (el camino directo de clonación lo permite crear ahí)', async () => {
    const enPolinizacion = await individuo(crucePolinizacion);
    const { error } = await operario.from('evaluacion_reducida').insert({ individuo_id: enPolinizacion, fase: 'trasplante', vigor: 1, created_by: operarioId });
    expect(error).toBeNull();
  });

  // A1-G4-12: sin clave de idempotencia, un reenvío duplica la evaluación.
  it('dos envíos idénticos crean dos evaluaciones (no hay clave de idempotencia, a diferencia de evaluaciones y pcr_analisis)', async () => {
    const fila = { individuo_id: vivo, fase: 'trasplante', talla: 12.5, numero_entrenudos: 4, vigor: 4, created_by: operarioId };
    expect((await operario.from('evaluacion_reducida').insert(fila)).error).toBeNull();
    expect((await operario.from('evaluacion_reducida').insert(fila)).error).toBeNull();
    const { count } = await service.from('evaluacion_reducida').select('id', { count: 'exact', head: true }).eq('individuo_id', vivo).eq('talla', 12.5);
    expect(count).toBe(2);
  });

  it.fails('A1-G4-12: evaluacion_reducida acepta idempotency_key (hoy la columna no existe)', async () => {
    const { error } = await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', vigor: 3, created_by: operarioId, idempotency_key: randomUUID() });
    expect(error).toBeNull();
  });

  it('nadie borra; el autor no edita (0 filas); el admin edita cualquier columna y el audit_log no guarda anterior/nuevo', async () => {
    const { data: er } = await operario.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', vigor: 2, created_by: operarioId }).select('id').single();
    expect((await operario.from('evaluacion_reducida').delete().eq('id', er!.id)).error?.code).toBe('42501');
    expect((await operario.from('evaluacion_reducida').update({ vigor: 5 }).eq('id', er!.id).select('id')).data).toHaveLength(0);
    expect((await admin.from('evaluacion_reducida').update({ vigor: 5, individuo_id: muerto, created_by: adminId, created_at: '2000-01-01T00:00:00Z' }).eq('id', er!.id)).error).toBeNull();
    const { data: audit } = await service.from('audit_log').select('detalle').eq('accion', 'edicion_evaluacion_reducida').eq('detalle->>evaluacion_id', er!.id).single();
    expect(audit!.detalle).not.toHaveProperty('anterior');
    expect(audit!.detalle).not.toHaveProperty('nuevo');
  });
});

describe('I08 pcr_analisis + Storage media-plantas', () => {
  it('cualquier autenticado inserta un PCR a su nombre si el individuo de la ronda está vivo; muerto se rechaza', async () => {
    expect((await operario2.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: false, created_by: operario2Id, idempotency_key: randomUUID() })).error).toBeNull();
    expect((await operario.from('pcr_analisis').insert({ ronda_id: rondaMuerto, realizado: false, created_by: operarioId, idempotency_key: randomUUID() })).error?.code).toBe('42501');
    expect((await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: false, created_by: operario2Id, idempotency_key: randomUUID() })).error?.code).toBe('42501');
  });

  it('idempotencia: la misma clave dos veces choca en pcr_analisis_idempotency_key_key (23505) y la fila original se recupera por la clave', async () => {
    const key = randomUUID();
    const { data: primera } = await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: true, fecha: '2026-10-21', created_by: operarioId, idempotency_key: key }).select('id').single();
    const { error } = await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: true, fecha: '2026-10-21', created_by: operarioId, idempotency_key: key });
    expect(error?.code).toBe('23505');
    expect(error?.message).toContain('pcr_analisis_idempotency_key_key');
    const { data: existente } = await operario.from('pcr_analisis').select('id').eq('idempotency_key', key).single();
    expect(existente?.id).toBe(primera!.id);
  });

  it('el PDF se sube ANTES de la fila: si la fila falla, el archivo queda huérfano en el bucket', async () => {
    const path = `pcr/AUD-G4-${R}/${randomUUID()}/${Date.now()}-huerfano.pdf`;
    const { error: eUp } = await operario.storage.from(BUCKET).upload(path, pdf());
    expect(eUp).toBeNull();
    archivosSubidos.push(path);
    const { error } = await operario.from('pcr_analisis').insert({ ronda_id: rondaMuerto, realizado: true, fecha: '2026-10-21', informe_pdf_url: path, created_by: operarioId, idempotency_key: randomUUID() });
    expect(error?.code).toBe('42501');
    expect(await existeEnStorage(path)).toBe(true);
  });

  it('un reintento con la misma clave vuelve a subir otro archivo (ruta nueva) y luego recupera la fila vieja: el segundo PDF queda huérfano', async () => {
    const key = randomUUID();
    const p1 = `pcr/AUD-G4-${R}/${randomUUID()}/${Date.now()}-v1.pdf`;
    const p2 = `pcr/AUD-G4-${R}/${randomUUID()}/${Date.now()}-v2.pdf`;
    archivosSubidos.push(p1, p2);
    expect((await operario.storage.from(BUCKET).upload(p1, pdf())).error).toBeNull();
    expect((await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: true, fecha: '2026-10-21', informe_pdf_url: p1, created_by: operarioId, idempotency_key: key })).error).toBeNull();
    // Reintento tal como lo hace PcrForm/crearPcr: nuevo upload, insert que choca, select por clave.
    expect((await operario.storage.from(BUCKET).upload(p2, pdf())).error).toBeNull();
    expect((await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: true, fecha: '2026-10-21', informe_pdf_url: p2, created_by: operarioId, idempotency_key: key })).error?.code).toBe('23505');
    const { data } = await operario.from('pcr_analisis').select('informe_pdf_url').eq('idempotency_key', key).single();
    expect(data?.informe_pdf_url).toBe(p1);
    expect(await existeEnStorage(p2)).toBe(true);
  });

  it('informe_pdf_url no se valida: puede apuntar a cualquier ruta del bucket (incluso inexistente o ajena)', async () => {
    const { error } = await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: true, fecha: '2026-10-21', informe_pdf_url: 'eventos/otro-cruce/foto-ajena.jpg', created_by: operarioId, idempotency_key: randomUUID() });
    expect(error).toBeNull();
  });

  it('Storage: solo el dueño borra; otro operario y el admin no pueden; no hay UPDATE (sobrescribir la misma ruta falla)', async () => {
    const path = `pcr/AUD-G4-${R}/${randomUUID()}/${Date.now()}-dueno.pdf`;
    archivosSubidos.push(path);
    expect((await operario.storage.from(BUCKET).upload(path, pdf())).error).toBeNull();
    expect((await operario.storage.from(BUCKET).upload(path, pdf())).error).not.toBeNull();
    // remove() con RLS no falla: simplemente no borra lo que la policy no deja ver.
    await operario2.storage.from(BUCKET).remove([path]);
    expect(await existeEnStorage(path)).toBe(true);
    await admin.storage.from(BUCKET).remove([path]);
    expect(await existeEnStorage(path)).toBe(true);
    await operario.storage.from(BUCKET).remove([path]);
    expect(await existeEnStorage(path)).toBe(false);
  });

  // A1-G4-13: el dueño puede borrar el PDF referenciado por un PCR que nunca se borra.
  it.fails('A1-G4-13: el PDF referenciado por un PCR no debería poder borrarse dejando el enlace roto (hoy el dueño lo borra)', async () => {
    const path = `pcr/AUD-G4-${R}/${randomUUID()}/${Date.now()}-referenciado.pdf`;
    archivosSubidos.push(path);
    expect((await operario.storage.from(BUCKET).upload(path, pdf())).error).toBeNull();
    expect((await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: true, fecha: '2026-10-21', informe_pdf_url: path, created_by: operarioId, idempotency_key: randomUUID() })).error).toBeNull();
    await operario.storage.from(BUCKET).remove([path]);
    expect(await existeEnStorage(path)).toBe(true);
  });

  // Hallazgo A1-G4-18 (supuesto en cuanto a la sensibilidad del contenido):
  // la política de SELECT del bucket es solo bucket_id = 'media-plantas', sin
  // mirar el cruce ni puede_ver_linaje. Lo verificado: un operario sin permiso
  // de linaje lista y descarga el PDF subido por otro usuario.
  it('cualquier autenticado (sin permiso de linaje) lista y descarga el informe PDF subido por otro usuario', async () => {
    const carpeta = `pcr/AUD-G4-${R}/${randomUUID()}`;
    const path = `${carpeta}/${Date.now()}-ajeno.pdf`;
    archivosSubidos.push(path);
    expect((await operario.storage.from(BUCKET).upload(path, pdf())).error).toBeNull();
    const { data: listado, error: eList } = await operario2.storage.from(BUCKET).list(carpeta);
    expect(eList).toBeNull();
    expect(listado?.map((o) => o.name)).toContain(path.slice(path.lastIndexOf('/') + 1));
    const { data: descarga, error: eDown } = await operario2.storage.from(BUCKET).download(path);
    expect(eDown).toBeNull();
    expect(descarga).not.toBeNull();
    const { data: perfil } = await service.from('perfiles').select('puede_ver_linaje').eq('id', operario2Id).single();
    expect(perfil?.puede_ver_linaje).toBe(false);
  });

  // A1-G4-17: el cliente anula fecha y PDF cuando el PCR no se realizó, pero la base no lo exige.
  it.fails('A1-G4-17: un PCR «no realizado» no puede traer fecha ni informe PDF (hoy la base lo acepta; solo lo evita el cliente)', async () => {
    const { error } = await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: false, fecha: '2026-10-21', informe_pdf_url: 'pcr/inconsistente.pdf', created_by: operarioId, idempotency_key: randomUUID() });
    expect(error).not.toBeNull();
  });

  it('el bucket no limita tipo ni tamaño: cualquier autenticado sube un archivo no-PDF a cualquier carpeta', async () => {
    const path = `pcr/AUD-G4-${R}/${randomUUID()}/${Date.now()}-no-es-pdf.exe`;
    archivosSubidos.push(path);
    const { error } = await operario.storage.from(BUCKET).upload(path, new Blob(['MZ no soy un pdf'], { type: 'application/octet-stream' }));
    expect(error).toBeNull();
    const { data: bucket } = await service.storage.getBucket(BUCKET);
    expect(bucket?.public).toBe(false);
    expect(bucket?.file_size_limit ?? null).toBeNull();
    expect(bucket?.allowed_mime_types ?? null).toBeNull();
  });

  it('auditoría: creacion_pcr con autor, ronda, realizado y fecha; edicion_pcr (admin) sin valores anteriores/nuevos; nadie borra', async () => {
    const { data: fila } = await operario.from('pcr_analisis').insert({ ronda_id: rondaVivo, realizado: true, fecha: '2026-10-21', created_by: operarioId, idempotency_key: randomUUID() }).select('id').single();
    const { data: cr } = await service.from('audit_log').select('usuario_id, detalle').eq('accion', 'creacion_pcr').eq('detalle->>pcr_id', fila!.id).single();
    expect(cr?.usuario_id).toBe(operarioId);
    expect(cr?.detalle).toMatchObject({ ronda_id: rondaVivo, individuo_id: vivo, realizado: true, fecha: '2026-10-21' });
    expect((await operario.from('pcr_analisis').update({ realizado: false }).eq('id', fila!.id).select('id')).data).toHaveLength(0);
    expect((await admin.from('pcr_analisis').update({ realizado: false, fecha: null }).eq('id', fila!.id)).error).toBeNull();
    const { data: ed } = await service.from('audit_log').select('detalle').eq('accion', 'edicion_pcr').eq('detalle->>pcr_id', fila!.id).single();
    expect(ed!.detalle).not.toHaveProperty('anterior');
    expect((await admin.from('pcr_analisis').delete().eq('id', fila!.id)).error?.code).toBe('42501');
  });
});
