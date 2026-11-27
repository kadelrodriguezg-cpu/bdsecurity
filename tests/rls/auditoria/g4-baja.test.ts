/**
 * Auditoría integral, Corrida 1, grupo G4: I04 baja individual e I05 baja en lote.
 *
 * No repite lo que ya cubre tests/rls/baja-individuos.test.ts (permisos
 * básicos, reintento con la misma clave y mismos ids, tope de 500, límite de
 * frecuencia, caminos directos). Busca lo que falta: idempotencia con la
 * misma clave y OTRO contenido, lotes vacíos/nulos/repetidos/mixtos,
 * concurrencia, qué pasa con rondas y evaluaciones del individuo dado de
 * baja, y la edición de baja_motivo por el admin.
 */
import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';
import { solapar } from './g4-helpers';

const R = Date.now();

let creds: LocalCreds;
let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let admin2: SupabaseClient;
let admin3: SupabaseClient; // solo para las pruebas de concurrencia (límite de 3 lotes/min por usuario)
let admin3Id: string;
let admin4: SupabaseClient;
let admin4Id: string;
let autor: SupabaseClient;
let autorId: string;
let especieId: string;
let cruceA: string;
let cruceB: string;
let cruceC: string; // en trasplante: fuera de la fase de evaluación anual

const bajaArgs = (overrides: Record<string, unknown> = {}) => ({
  p_estado: 'descartado',
  p_criterios: ['vigor'],
  p_nota: null,
  p_fecha: '2026-10-21',
  p_idempotency_key: randomUUID(),
  ...overrides,
});

async function crearCruce(sufijo: string, estadoCruce = 'evaluacion_anual'): Promise<string> {
  const { data, error } = await service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-G4-BAJA-${sufijo}-${R}`, especie_id: especieId, estado: estadoCruce, es_prueba: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
  return data.id as string;
}

async function individuo(planta = cruceA, creadoPor = autorId): Promise<string> {
  const { data, error } = await service.from('individuos').insert({ planta_id: planta, created_by: creadoPor, codigo_display: '' }).select('id').single();
  if (error || !data) throw new Error(`setup individuo: ${error?.message}`);
  return data.id as string;
}

async function estado(id: string) {
  const { data } = await service.from('individuos').select('estado_vital, fecha_baja').eq('id', id).single();
  return data!;
}

async function motivos(ids: string[]) {
  const { data } = await service.from('baja_motivo').select('id, individuo_id, criterio, nota, idempotency_key').in('individuo_id', ids);
  return data ?? [];
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-baja-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  admin2 = (await crearUsuarioDePrueba(creds, service, { email: `aud-g4-baja-admin2-${R}@test.local`, rol: 'admin' })).client;
  const a3 = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-baja-admin3-${R}@test.local`, rol: 'admin' });
  admin3 = a3.client;
  admin3Id = a3.userId;
  const a4 = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-baja-admin4-${R}@test.local`, rol: 'admin' });
  admin4 = a4.client;
  admin4Id = a4.userId;
  const au = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-baja-autor-${R}@test.local`, rol: 'operario' });
  autor = au.client;
  autorId = au.userId;
  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  cruceA = await crearCruce('A');
  cruceB = await crearCruce('B');
  cruceC = await crearCruce('C', 'trasplante');
}, 60_000);

afterAll(async () => {
  // A1-G4-09 deja una evaluación «completa» sobre un individuo muerto y
  // borrar_cruzamiento hard se niega a purgar un cruce con evaluaciones
  // terminadas: se retiran antes con service_role (son datos de esta corrida).
  const { data: individuos } = await service.from('individuos').select('id').in('planta_id', [cruceA, cruceB, cruceC]);
  const { data: rondas } = await service.from('ronda_evaluacion_anual').select('id').in('individuo_id', (individuos ?? []).map((i) => i.id));
  if (rondas && rondas.length > 0) await service.from('evaluaciones').delete().in('ronda_id', rondas.map((r) => r.id));
  for (const id of [cruceA, cruceB, cruceC]) {
    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
    if (error) console.warn(`afterAll: no se pudo purgar ${id}: ${error.message}`);
  }
}, 120_000);

describe('I04 marcar_baja_individuo: idempotencia y concurrencia', () => {
  it('la misma clave reutilizada para OTRO individuo no se aplica: falla con 23505 (unique idempotency_key+criterio)', async () => {
    const [x, y] = [await individuo(), await individuo()];
    const key = randomUUID();
    expect((await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: x, p_idempotency_key: key }))).error).toBeNull();
    const { error } = await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: y, p_idempotency_key: key }));
    expect(error?.code).toBe('23505');
    // Atómico: el UPDATE de estado_vital se revirtió junto con el INSERT fallido.
    expect((await estado(y)).estado_vital).toBe('vivo');
  });

  it('la misma clave reenviada con OTROS parámetros (estado/criterios distintos) devuelve repetido sin cambiar nada', async () => {
    const id = await individuo();
    const key = randomUUID();
    expect((await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_idempotency_key: key, p_estado: 'descartado', p_criterios: ['vigor'] }))).error).toBeNull();
    const reintento = await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_idempotency_key: key, p_estado: 'muerto', p_criterios: ['sanidad', 'arquitectura'], p_fecha: '2026-01-01' }));
    expect(reintento.error).toBeNull();
    expect(reintento.data).toMatchObject({ repetido: true });
    expect(await estado(id)).toMatchObject({ estado_vital: 'descartado', fecha_baja: '2026-10-21' });
    expect(await motivos([id])).toHaveLength(1);
  });

  it('dos bajas simultáneas del mismo individuo con claves distintas: una gana y la otra recibe un error (no hay doble baja)', async () => {
    const id = await individuo();
    const [a, b] = await Promise.all([
      autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_estado: 'descartado' })),
      admin.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_estado: 'muerto' })),
    ]);
    const errores = [a.error, b.error].filter(Boolean);
    expect(errores).toHaveLength(1);
    expect(errores[0]!.code).toBe('42501');
    expect(await motivos([id])).toHaveLength(1);
  });

  // A1-G4-16: marcar_baja_individuo evalúa «ya de baja» ANTES de tomar el lock
  // de la fila. Con dos llamadas que de verdad se solapan (dos sesiones de
  // psql, ver g4-helpers.ts) y el MISMO estado y fecha, el trigger
  // bloquear_rebaja_individuo no ve cambio y deja pasar a la segunda: el
  // individuo queda con los motivos duplicados. La baja en lote sí toma el
  // lock primero (ver la prueba de más abajo).
  it.fails('A1-G4-16: dos bajas individuales solapadas con el mismo estado y fecha no deben duplicar el motivo', async () => {
    const id = await individuo();
    const llamada = (clave: string) =>
      `select marcar_baja_individuo('${id}', 'descartado', array['vigor']::criterio_baja[], null, '2026-10-21', '${clave}');`;
    await solapar(
      { usuarioId: adminId, sentencia: llamada(randomUUID()) },
      { usuarioId: adminId, sentencia: llamada(randomUUID()) },
    );
    // Lo esperado: la segunda se rechaza (ya está de baja) o responde repetido.
    expect(await motivos([id])).toHaveLength(1);
  }, 30_000);

  it('rechaza estado vivo, fecha nula y criterios solo nulos (22023), y p_individuo_id nulo no deja rastro', async () => {
    const id = await individuo();
    expect((await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_estado: 'vivo' }))).error?.code).toBe('22023');
    expect((await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_fecha: null }))).error?.code).toBe('22023');
    expect((await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_criterios: [null] }))).error?.code).toBe('22023');
    const nulo = await admin.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: null }));
    expect(nulo.error).not.toBeNull();
    expect((await estado(id)).estado_vital).toBe('vivo');
  });

  // A1-G4-19: la baja individual exige ser el AUTOR del individuo (o admin), y el
  // autor es quien individualizó (en producción, una sola cuenta admin). Un
  // operario que no lo creó recibe un 42501 con mensaje de negocio, pero la UI
  // le ofrece igual el botón «Marcar baja».
  it('un operario que NO creó el individuo no puede darlo de baja (42501 con mensaje de negocio); el admin sí', async () => {
    const otro = (await crearUsuarioDePrueba(creds, service, { email: `aud-g4-baja-otro-${R}@test.local`, rol: 'operario' })).client;
    const id = await individuo(cruceA, adminId); // creado por un admin, como en producción
    const { error } = await otro.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id }));
    expect(error?.code).toBe('42501');
    expect(error?.message).toMatch(/autor del individuo o un admin/);
    expect((await estado(id)).estado_vital).toBe('vivo');
    expect((await admin2.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id }))).error).toBeNull();
  });

  it('criterios repetidos se guardan una sola vez y la nota con espacios se normaliza (o queda null)', async () => {
    const id = await individuo();
    const { error } = await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_criterios: ['vigor', 'vigor', 'sanidad'], p_nota: '   ' }));
    expect(error).toBeNull();
    const filas = await motivos([id]);
    expect(filas.map((f) => f.criterio).sort()).toEqual(['sanidad', 'vigor']);
    expect(filas.every((f) => f.nota === null)).toBe(true);
  });

  it('queda auditado con autor y valores anterior/nuevo (edicion_individuo) y un creacion_baja_motivo por criterio', async () => {
    const id = await individuo();
    await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: id, p_estado: 'muerto', p_criterios: ['muerte_natural', 'sanidad'], p_nota: 'Helada' }));
    const { data: ed } = await service.from('audit_log').select('usuario_id, detalle').eq('accion', 'edicion_individuo').eq('detalle->>individuo_id', id).single();
    expect(ed?.usuario_id).toBe(autorId);
    expect(ed?.detalle).toMatchObject({ anterior: { estado_vital: 'vivo', fecha_baja: null }, nuevo: { estado_vital: 'muerto', fecha_baja: '2026-10-21' } });
    const { data: cr } = await service.from('audit_log').select('detalle').eq('accion', 'creacion_baja_motivo').eq('detalle->>individuo_id', id);
    expect(cr).toHaveLength(2);
    // La nota no viaja al audit_log: solo el criterio.
    expect(cr!.every((f) => !('nota' in (f.detalle as object)))).toBe(true);
  });
});

describe('I05 dar_baja_individuos: idempotencia con otro contenido, lotes raros y concurrencia', () => {
  // A1-050: la clave del lote debe identificar una solicitud equivalente.
  it('A1-G4-07: la misma clave con OTROS ids rechaza el reenvío sin procesar', async () => {
    const primero = [await individuo(), await individuo()];
    const segundo = [await individuo(), await individuo(), await individuo()];
    const key = randomUUID();
    expect((await admin.rpc('dar_baja_individuos', bajaArgs({ p_ids: primero, p_idempotency_key: key }))).error).toBeNull();
    const { data, error } = await admin.rpc('dar_baja_individuos', bajaArgs({ p_ids: segundo, p_idempotency_key: key }));
    expect(error?.code).toBe('22023');
    expect(data).toBeNull();
    for (const id of segundo) expect((await estado(id)).estado_vital).toBe('vivo');
  });

  it('(regresión de A1-G4-07) otro lote conserva individuos vivos y recibe error explícito', async () => {
    const primero = [await individuo()];
    const segundo = [await individuo(), await individuo()];
    const key = randomUUID();
    expect((await admin2.rpc('dar_baja_individuos', bajaArgs({ p_ids: primero, p_idempotency_key: key }))).error).toBeNull();
    const { data, error } = await admin2.rpc('dar_baja_individuos', bajaArgs({ p_ids: segundo, p_idempotency_key: key }));
    expect(error?.code).toBe('22023');
    expect(data).toBeNull();
    for (const id of segundo) expect((await estado(id)).estado_vital).toBe('vivo');
  });

  it('A1-050: compara estado, criterios, fecha y nota; acepta conjuntos equivalentes y nota normalizada', async () => {
    const ids = [await individuo(), await individuo()];
    const key = randomUUID();
    const args = bajaArgs({ p_ids: ids, p_idempotency_key: key, p_criterios: ['vigor', 'sanidad'], p_nota: ' Helada ' });
    expect((await admin2.rpc('dar_baja_individuos', args)).error).toBeNull();
    for (const cambio of [{ p_estado: 'muerto' }, { p_criterios: ['vigor'] }, { p_fecha: '2026-01-01' }, { p_nota: 'Sequía' }]) {
      expect((await admin2.rpc('dar_baja_individuos', { ...args, ...cambio })).error?.code).toBe('22023');
    }
    const repetido = await admin2.rpc('dar_baja_individuos', { ...args, p_ids: [ids[1], ids[0], ids[0]], p_criterios: ['sanidad', 'vigor', 'vigor'], p_nota: 'Helada' });
    expect(repetido.error).toBeNull();
    expect(repetido.data).toEqual({ procesados: 2, repetido: true });
    expect(await motivos(ids)).toHaveLength(4);
    const audit = await service.from('audit_log').select('detalle').eq('accion', 'baja_lote').eq('detalle->>idempotency_key', key);
    expect(audit.error).toBeNull(); expect(audit.data).toHaveLength(1);
    expect(audit.data![0].detalle.huella_solicitud).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit.data)).not.toContain('Helada');
  });

  it('dos lotes que de verdad se solapan sobre los mismos individuos (dos sesiones de psql): el segundo espera el lock y se rechaza completo con ya_de_baja; sin motivos duplicados', async () => {
    const ids = [await individuo(), await individuo()];
    const llamada = (clave: string) =>
      `select dar_baja_individuos(array['${ids[0]}','${ids[1]}']::uuid[], 'descartado', array['vigor']::criterio_baja[], null, '2026-10-21', '${clave}');`;
    const [r1, r2] = await solapar(
      { usuarioId: admin3Id, sentencia: llamada(randomUUID()) },
      { usuarioId: admin4Id, sentencia: llamada(randomUUID()) },
    );
    expect(r1.salida).toContain('"procesados": 2');
    expect(r2.salida).toMatch(/ya_de_baja/);
    expect(await motivos(ids)).toHaveLength(2);
  }, 30_000);

  it('A1-050: dos envíos solapados con la misma clave devuelven un único lote y un reintento', async () => {
    const ids = [await individuo(), await individuo()];
    const key = randomUUID();
    const sentencia = `select dar_baja_individuos(array['${ids[0]}','${ids[1]}']::uuid[], 'descartado', array['vigor']::criterio_baja[], null, '2026-10-21', '${key}');`;
    const [a, b] = await solapar({ usuarioId: admin3Id, sentencia }, { usuarioId: admin3Id, sentencia });
    expect(a.salida).toContain('"repetido": false');
    expect(b.salida).toContain('"repetido": true');
    expect(await motivos(ids)).toHaveLength(2);
    const audit = await service.from('audit_log').select('id').eq('accion', 'baja_lote').eq('detalle->>idempotency_key', key);
    expect(audit.error).toBeNull(); expect(audit.data).toHaveLength(1);
  }, 30_000);

  it('lote vacío, nulo o solo con nulos: 22023 y nada escrito', async () => {
    for (const p_ids of [[], null, [null]]) {
      const { error } = await admin.rpc('dar_baja_individuos', bajaArgs({ p_ids }));
      expect(error?.code, JSON.stringify(p_ids)).toBe('22023');
    }
  });

  it('ids repetidos en el lote se procesan una sola vez (procesados = distintos) y la previsualización no los duplica', async () => {
    const id = await individuo();
    const { data: prev } = await admin.rpc('previsualizar_baja_individuos', { p_ids: [id, id, id] });
    expect((prev as { procesables: unknown[] }).procesables).toHaveLength(1);
    const { data, error } = await admin.rpc('dar_baja_individuos', bajaArgs({ p_ids: [id, id, id] }));
    expect(error).toBeNull();
    expect(data).toEqual({ procesados: 1, repetido: false });
    expect(await motivos([id])).toHaveLength(1);
  });

  it('un lote con individuos de dos cruces se acepta: audit_log baja_lote con planta_id null y planta_ids con ambos', async () => {
    const ids = [await individuo(cruceA), await individuo(cruceB)];
    const key = randomUUID();
    const { error } = await admin.rpc('dar_baja_individuos', bajaArgs({ p_ids: ids, p_idempotency_key: key }));
    expect(error).toBeNull();
    const { data } = await service.from('audit_log').select('planta_id, detalle').eq('accion', 'baja_lote').eq('detalle->>idempotency_key', key).single();
    expect(data?.planta_id).toBeNull();
    expect([...(data?.detalle as { planta_ids: string[] }).planta_ids].sort()).toEqual([...[cruceA, cruceB]].sort());
  });

  it('el admin puede dar de baja en lote individuos creados por otro usuario', async () => {
    const id = await individuo(cruceA, autorId);
    const { error } = await admin2.rpc('dar_baja_individuos', bajaArgs({ p_ids: [id] }));
    expect(error).toBeNull();
    expect((await estado(id)).estado_vital).toBe('descartado');
  });

  it('dos admins dando de baja el mismo lote a la vez: uno procesa y el otro recibe 23514 (ya_de_baja); sin duplicados', async () => {
    const ids = [await individuo(), await individuo()];
    const [a, b] = await Promise.all([
      admin3.rpc('dar_baja_individuos', bajaArgs({ p_ids: ids })),
      admin4.rpc('dar_baja_individuos', bajaArgs({ p_ids: ids, p_estado: 'muerto' })),
    ]);
    const errores = [a.error, b.error].filter(Boolean);
    expect(errores).toHaveLength(1);
    expect(errores[0]!.code).toBe('23514');
    expect(errores[0]!.message).toMatch(/ya_de_baja/);
    expect(await motivos(ids)).toHaveLength(2);
  });
});

describe('I04/I05 efectos sobre rondas, evaluaciones, PCR y evaluación reducida del individuo dado de baja', () => {
  let muerto: string;
  let rondaPrevia: string;
  let evaluacionBorrador: string;

  beforeAll(async () => {
    muerto = await individuo();
    const { data: ronda, error: eR } = await service
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: muerto, numero_ronda: 1, anio: 2026, tipo_ronda: 'anual', created_by: autorId })
      .select('id')
      .single();
    if (eR) throw eR;
    rondaPrevia = ronda!.id;
    const { data: ev, error: eE } = await service
      .from('evaluaciones')
      .insert({ ronda_id: rondaPrevia, fecha: '2026-10-01', estado: 'borrador', created_by: autorId, cantidad_frutos: 10, peso_total_g: 50 })
      .select('id')
      .single();
    if (eE) throw eE;
    evaluacionBorrador = ev!.id;
    const { error } = await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: muerto, p_estado: 'muerto', p_criterios: ['muerte_natural'] }));
    if (error) throw new Error(`setup baja: ${error.message}`);
  });

  it('no se puede insertar evaluación reducida, evaluación ni PCR para el individuo muerto (policies con individuo_esta_vivo / ronda_individuo_esta_vivo)', async () => {
    expect((await autor.from('evaluacion_reducida').insert({ individuo_id: muerto, fase: 'trasplante', vigor: 3, created_by: autorId })).error?.code).toBe('42501');
    expect((await autor.from('evaluaciones').insert({ ronda_id: rondaPrevia, fecha: '2026-10-22', created_by: autorId })).error?.code).toBe('42501');
    expect((await autor.from('pcr_analisis').insert({ ronda_id: rondaPrevia, realizado: false, created_by: autorId })).error?.code).toBe('42501');
  });

  // A1-G4-08: la política de INSERT de ronda_evaluacion_anual no exige individuo vivo.
  it('A1-G4-08: no se puede abrir una ronda nueva para un individuo muerto', async () => {
    const { error } = await autor.from('ronda_evaluacion_anual').insert({ individuo_id: muerto, numero_ronda: 2, anio: 2026, tipo_ronda: 'anual', created_by: autorId });
    expect(error).not.toBeNull();
  });

  // A1-G4-09 (corregido por A1-140): la evaluación en borrador de un individuo muerto no se puede completar.
  it('A1-G4-09: el borrador previo no se puede cerrar como completa después de la baja', async () => {
    const { error } = await autor.from('evaluaciones').update({ estado: 'completa' }).eq('id', evaluacionBorrador);
    expect(error).not.toBeNull();
  });

  // A1-G4-08 (ampliación): la RPC iniciar_ronda_evaluacion exige individuo vivo,
  // cruce en evaluacion_anual y correlativo; el INSERT directo no exige nada de eso.
  it('(control) la RPC iniciar_ronda_evaluacion sí rechaza al individuo muerto y al cruce fuera de evaluación anual (42501)', async () => {
    expect((await iniciarRondaAnual(autor, muerto)).error?.code).toBe('42501');
    const enTrasplante = await individuo(cruceC);
    expect((await iniciarRondaAnual(autor, enTrasplante)).error?.code).toBe('42501');
  });

  it('A1-G4-08: no se puede abrir una ronda anual nº 3 directo (saltando la 1 y la 2) en un cruce que está en trasplante', async () => {
    const enTrasplante = await individuo(cruceC);
    const { error } = await autor.from('ronda_evaluacion_anual').insert({ individuo_id: enTrasplante, numero_ronda: 3, anio: 2026, tipo_ronda: 'anual', created_by: autorId });
    expect(error).not.toBeNull();
  });

  it('la evaluación reducida previa a la baja sigue legible; el admin puede corregirla pero el autor no', async () => {
    const vivo = await individuo();
    const { data: er } = await autor.from('evaluacion_reducida').insert({ individuo_id: vivo, fase: 'trasplante', vigor: 2, created_by: autorId }).select('id').single();
    await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: vivo }));
    expect((await autor.from('evaluacion_reducida').update({ vigor: 5 }).eq('id', er!.id).select('id')).data).toHaveLength(0);
    expect((await admin.from('evaluacion_reducida').update({ vigor: 5 }).eq('id', er!.id)).error).toBeNull();
  });
});

describe('I04 baja_motivo: edición por admin', () => {
  it('el admin puede reescribir criterio, nota e incluso mover el motivo a otro individuo; el audit_log no guarda valores anteriores ni nuevos', async () => {
    const [x, y] = [await individuo(), await individuo()];
    await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: x, p_criterios: ['vigor'], p_nota: 'original' }));
    const [fila] = await motivos([x]);
    const { error } = await admin.from('baja_motivo').update({ criterio: 'sanidad', nota: 'reescrita', individuo_id: y }).eq('id', fila.id);
    expect(error).toBeNull();
    expect(await motivos([x])).toHaveLength(0); // x quedó de baja sin motivo
    const { data: audit } = await service.from('audit_log').select('detalle').eq('accion', 'edicion_baja_motivo').eq('detalle->>baja_motivo_id', fila.id).single();
    expect(audit).not.toBeNull();
    expect(audit!.detalle).not.toHaveProperty('anterior');
    expect(audit!.detalle).not.toHaveProperty('nuevo');
  });

  it('el operario no puede editar motivos (UPDATE solo admin) y nadie los borra', async () => {
    const x = await individuo();
    await autor.rpc('marcar_baja_individuo', bajaArgs({ p_individuo_id: x }));
    const [fila] = await motivos([x]);
    expect((await autor.from('baja_motivo').update({ nota: 'x' }).eq('id', fila.id).select('id')).data).toHaveLength(0);
    expect((await admin.from('baja_motivo').delete().eq('id', fila.id)).error?.code).toBe('42501');
    expect(await motivos([x])).toHaveLength(1);
  });
});
