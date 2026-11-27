/**
 * Auditoría integral, Corrida 1, grupo G4: I01 individualizar e I02 clonar.
 *
 * Verificación EMPÍRICA contra la base local (usuarios propios, cruces
 * es_prueba con prefijo AUD-G4-). Las pruebas marcadas `it.fails` demuestran
 * un hallazgo de la Corrida 1 (grupo G4; ver docs/pendientes.md): están escritas
 * con lo que DEBERÍA pasar y se cumplen mientras el bug exista.
 */
import { individualizarPlantas } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

const R = Date.now();
const LOTE_GRANDE = 1000; // 10x el cruce más grande de producción (~300)

let creds: LocalCreds;
let service: SupabaseClient;
let anon: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let operarioId: string;
let operario2: SupabaseClient;
let operario2Id: string;
let especieId: string;

let cruceTrasplante: string; // AUD-G4-IND-A: recibe los 1000 individuos
let cruceTrasplanteCodigo: string;
let crucePolinizacion: string; // AUD-G4-IND-B: fase anterior a trasplante
let cruceArchivado: string; // AUD-G4-IND-C: trasplante + eliminado_at
let cruceConcurrencia: string; // AUD-G4-IND-D: dos usuarios a la vez

const codigo = (sufijo: string) => `AUD-G4-IND-${sufijo}-${R}`;

async function crearCruce(sufijo: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await service
    .from('plantas')
    .insert({ codigo_sistema: codigo(sufijo), especie_id: especieId, estado: 'trasplante', es_prueba: true, ...extra })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce ${sufijo}: ${error?.message}`);
  return data.id as string;
}

async function contarIndividuos(plantaId: string): Promise<number> {
  const { count, error } = await service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId);
  if (error) throw error;
  return count ?? 0;
}

async function contarAudit(plantaId: string, accion: string): Promise<number> {
  const { count, error } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId).eq('accion', accion);
  if (error) throw error;
  return count ?? 0;
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-operario-${R}@test.local`, rol: 'operario' });
  operario = op.client;
  operarioId = op.userId;
  const op2 = await crearUsuarioDePrueba(creds, service, { email: `aud-g4-operario2-${R}@test.local`, rol: 'operario' });
  operario2 = op2.client;
  operario2Id = op2.userId;

  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  cruceTrasplante = await crearCruce('A');
  cruceTrasplanteCodigo = codigo('A');
  crucePolinizacion = await crearCruce('B', { estado: 'polinizacion' });
  cruceArchivado = await crearCruce('C', { eliminado_at: new Date().toISOString() });
  cruceConcurrencia = await crearCruce('D');
}, 60_000);

afterAll(async () => {
  // Orden: primero los cruces cuyos clones apuntan a individuos de A (la FK
  // clon_de_id es ON DELETE RESTRICT y borrar_cruzamiento solo anula los
  // clon_de_id de su propio cruce).
  for (const id of [crucePolinizacion, cruceArchivado, cruceConcurrencia, cruceTrasplante]) {
    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
    if (error) console.warn(`afterAll: no se pudo purgar ${id}: ${error.message}`);
  }
}, 120_000);

describe('I01 individualizar_plantas: volumen 10x (1000 individuos en una llamada)', () => {
  let codigos: string[] = [];
  let duracionMs = 0;

  it('crea 1000 individuos en una sola llamada, con códigos correlativos únicos y en orden', async () => {
    const t0 = Date.now();
    const { data, error } = await individualizarPlantas(operario, { p_planta_id: cruceTrasplante, p_cantidad: LOTE_GRANDE });
    duracionMs = Date.now() - t0;
    expect(error).toBeNull();
    const r = data as { cantidad: number; codigos: string[] };
    expect(r.cantidad).toBe(LOTE_GRANDE);
    codigos = r.codigos;
    expect(codigos).toHaveLength(LOTE_GRANDE);
    expect(new Set(codigos).size).toBe(LOTE_GRANDE);
    // Sin relleno de ceros (migración 20260902000000): P1, P2, ..., P1000.
    expect(codigos[0]).toBe(`${cruceTrasplanteCodigo}-P1`);
    expect(codigos[9]).toBe(`${cruceTrasplanteCodigo}-P10`);
    expect(codigos[99]).toBe(`${cruceTrasplanteCodigo}-P100`);
    expect(codigos[999]).toBe(`${cruceTrasplanteCodigo}-P1000`);
    expect(await contarIndividuos(cruceTrasplante)).toBe(LOTE_GRANDE);
    // Referencia de tiempo (se anota en el informe; no es un umbral de aceptación).
    console.info(`[G4] individualizar_plantas(${LOTE_GRANDE}) tardó ${duracionMs} ms`);
    expect(duracionMs).toBeLessThan(25_000);
  });

  it('queda auditado: una fila de resumen (individualizacion) y una por individuo (creacion_individuo)', async () => {
    expect(await contarAudit(cruceTrasplante, 'individualizacion')).toBe(1);
    expect(await contarAudit(cruceTrasplante, 'creacion_individuo')).toBe(LOTE_GRANDE);
    const { data } = await service.from('audit_log').select('usuario_id, detalle').eq('planta_id', cruceTrasplante).eq('accion', 'individualizacion').single();
    expect(data?.usuario_id).toBe(operarioId);
    expect((data?.detalle as { cantidad: number }).cantidad).toBe(LOTE_GRANDE);
    expect((data?.detalle as { codigos: string[] }).codigos).toHaveLength(LOTE_GRANDE);
  });

  it('los listados agregados del cruce (resumen_individuos_cruce, obtener_resumen_individuos) devuelven los 1000', async () => {
    const { data: resumen, error: e1 } = await operario.rpc('resumen_individuos_cruce', { p_planta_id: cruceTrasplante });
    expect(e1).toBeNull();
    expect(resumen).toHaveLength(LOTE_GRANDE);
    const { data: agregado, error: e2 } = await operario.rpc('obtener_resumen_individuos', { p_planta_id: cruceTrasplante });
    expect(e2).toBeNull();
    expect(Object.keys(agregado as Record<string, unknown>)).toHaveLength(LOTE_GRANDE);
    // La lista del explorador (listarIndividuosDePlanta) es un SELECT directo sin paginar.
    const { data: lista, error: e3 } = await operario.from('individuos').select('id, codigo_display').eq('planta_id', cruceTrasplante);
    expect(e3).toBeNull();
    expect(lista).toHaveLength(LOTE_GRANDE);
  });

  it('el orden numérico de codigo_display (codigo_display_numero) ordena P2 < P10 < P100 < P1000', async () => {
    const { data, error } = await service.rpc('codigo_display_numero', { p_codigo_display: `${cruceTrasplanteCodigo}-P1000` });
    expect(error).toBeNull();
    expect(data).toBe(1000);
  });

  // A1-G4-01: con 1001 individuos, el SELECT directo de la lista y la RPC
  // set-returning quedan recortados en silencio por max_rows (1000 en local).
  it.fails('A1-G4-01: con 1001 individuos la lista del explorador devuelve 1001 (hoy devuelve 1000 sin aviso)', async () => {
    const { error: eClon } = await operario.from('individuos').insert({ planta_id: cruceTrasplante, clon_de_id: null, created_by: operarioId, codigo_display: '' });
    expect(eClon).toBeNull();
    expect(await contarIndividuos(cruceTrasplante)).toBe(LOTE_GRANDE + 1);
    const { data: lista } = await operario.from('individuos').select('id').eq('planta_id', cruceTrasplante);
    expect(lista).toHaveLength(LOTE_GRANDE + 1);
  });

  it.fails('A1-G4-01: resumen_individuos_cruce con 1001 individuos devuelve 1001 (hoy 1000, recorte silencioso)', async () => {
    expect(await contarIndividuos(cruceTrasplante)).toBe(LOTE_GRANDE + 1);
    const { data } = await operario.rpc('resumen_individuos_cruce', { p_planta_id: cruceTrasplante });
    expect(data).toHaveLength(LOTE_GRANDE + 1);
  });

  it('obtener_resumen_individuos (jsonb) no sufre el recorte: devuelve los 1001', async () => {
    const { data, error } = await operario.rpc('obtener_resumen_individuos', { p_planta_id: cruceTrasplante });
    expect(error).toBeNull();
    expect(Object.keys(data as Record<string, unknown>)).toHaveLength(LOTE_GRANDE + 1);
  });
});

describe('I01 individualizar_plantas: validaciones y permisos', () => {
  it('rechaza cantidad 0, negativa y nula (22023) y no crea nada', async () => {
    for (const p_cantidad of [0, -5, null]) {
      const { error } = await individualizarPlantas(operario, { p_planta_id: cruceConcurrencia, p_cantidad });
      expect(error?.code, `cantidad ${p_cantidad}`).toBe('22023');
    }
    expect(await contarIndividuos(cruceConcurrencia)).toBe(0);
  });

  it('anon no puede ejecutarla', async () => {
    const { error } = await individualizarPlantas(anon, { p_planta_id: cruceConcurrencia, p_cantidad: 1 });
    expect(error).not.toBeNull();
    expect(await contarIndividuos(cruceConcurrencia)).toBe(0);
  });

  it('no individualiza un cruce en una fase anterior a trasplante (42501)', async () => {
    const { error } = await individualizarPlantas(operario, { p_planta_id: crucePolinizacion, p_cantidad: 1 });
    expect(error?.code).toBe('42501');
    expect(await contarIndividuos(crucePolinizacion)).toBe(0);
  });

  it('un cruce inexistente responde P0002', async () => {
    const { error } = await individualizarPlantas(operario, { p_planta_id: randomUUID(), p_cantidad: 1 });
    expect(error?.code).toBe('P0002');
  });

  // A1-G4-05: la guardia central de altas también protege la RPC.
  it('A1-G4-05: no individualiza un cruce archivado (eliminado_at)', async () => {
    const { error } = await individualizarPlantas(operario, { p_planta_id: cruceArchivado, p_cantidad: 2 });
    expect(error).not.toBeNull();
    expect(await contarIndividuos(cruceArchivado)).toBe(0);
  });

  // A1-G4-04: no hay tope de cantidad por llamada (la baja en lote tiene 500).
  it('A1-G4-04: rechaza una cantidad desmedida por llamada', async () => {
    const { error } = await individualizarPlantas(operario, { p_planta_id: cruceArchivado, p_cantidad: 2001 });
    expect(error?.code).toBe('22023');
  }, 60_000);

  it('dos usuarios individualizando el mismo cruce a la vez no colisionan: códigos únicos y total exacto', async () => {
    const [a, b] = await Promise.all([
      individualizarPlantas(operario, { p_planta_id: cruceConcurrencia, p_cantidad: 60 }),
      individualizarPlantas(operario2, { p_planta_id: cruceConcurrencia, p_cantidad: 60 }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const todos = [...(a.data as { codigos: string[] }).codigos, ...(b.data as { codigos: string[] }).codigos];
    expect(new Set(todos).size).toBe(120);
    expect(await contarIndividuos(cruceConcurrencia)).toBe(120);
  });

  // A1-G4-03: sin reutilizar la clave del intento, una respuesta perdida y un reenvío duplican el lote.
  it('un reenvío con una clave de intento distinta crea un segundo lote (sin la misma clave no hay idempotencia)', async () => {
    const antes = await contarIndividuos(cruceConcurrencia);
    const args = { p_planta_id: cruceConcurrencia, p_cantidad: 5 };
    expect((await individualizarPlantas(operario, args)).error).toBeNull();
    expect((await individualizarPlantas(operario, args)).error).toBeNull();
    expect(await contarIndividuos(cruceConcurrencia)).toBe(antes + 10);
  });

  // A1-G4-03 quedó corregido por la envoltura individualizar_plantas_una_vez (A1-049); la firma vieja
  // (sin clave) ya no es ejecutable por authenticated (paso 39).
  it('A1-G4-03: la envoltura acepta una clave de idempotencia y no duplica el lote al reenviar', async () => {
    const key = randomUUID();
    const args = { p_planta_id: cruceConcurrencia, p_cantidad: 3 };
    const antes = await contarIndividuos(cruceConcurrencia);
    const primera = await individualizarPlantas(operario, args, key);
    expect(primera.error).toBeNull();
    const reenvio = await individualizarPlantas(operario, args, key);
    expect(reenvio.error).toBeNull();
    expect(reenvio.data).toEqual(primera.data);
    expect(await contarIndividuos(cruceConcurrencia)).toBe(antes + 3);
  });
});

describe('I02 clonar: INSERT directo en individuos (sin RPC)', () => {
  let origenVivo: string;
  let origenMuerto: string;

  beforeAll(async () => {
    const { data } = await service.from('individuos').select('id').eq('planta_id', cruceTrasplante).order('codigo_display').limit(2);
    origenVivo = data![0].id;
    origenMuerto = data![1].id;
    const { error } = await admin.rpc('marcar_baja_individuo', {
      p_individuo_id: origenMuerto, p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID(),
    });
    if (error) throw new Error(`setup baja: ${error.message}`);
  });

  it('un clon legítimo queda con código correlativo, clon_de_id y auditoría creacion_individuo con clon_de_id', async () => {
    const { data, error } = await operario
      .from('individuos')
      .insert({ planta_id: cruceTrasplante, clon_de_id: origenVivo, created_by: operarioId, codigo_display: '' })
      .select('id, codigo_display, clon_de_id, estado_vital')
      .single();
    expect(error).toBeNull();
    expect(data!.clon_de_id).toBe(origenVivo);
    expect(data!.codigo_display).toMatch(new RegExp(`^${cruceTrasplanteCodigo}-P\\d+$`));
    const { data: audit } = await service.from('audit_log').select('detalle').eq('accion', 'creacion_individuo').eq('detalle->>individuo_id', data!.id).single();
    expect((audit?.detalle as { clon_de_id: string }).clon_de_id).toBe(origenVivo);
  });

  it('no puede crearse a nombre de otro usuario (created_by ajeno, 42501)', async () => {
    const { error } = await operario.from('individuos').insert({ planta_id: cruceTrasplante, created_by: operario2Id, codigo_display: '' });
    expect(error?.code).toBe('42501');
  });

  it('el codigo_display que mande el cliente se ignora: lo genera el trigger', async () => {
    const { data, error } = await operario
      .from('individuos')
      .insert({ planta_id: cruceConcurrencia, created_by: operarioId, codigo_display: 'FALSO-P999' })
      .select('codigo_display')
      .single();
    expect(error).toBeNull();
    expect(data!.codigo_display).not.toBe('FALSO-P999');
  });

  // A1-G4-02: identidad, archivado y fase de altas nuevas validados en INSERT.
  it('A1-G4-02: no se puede insertar un individuo en un cruce en polinización', async () => {
    const { error } = await operario.from('individuos').insert({ planta_id: crucePolinizacion, created_by: operarioId, codigo_display: '' });
    expect(error).not.toBeNull();
    expect(await contarIndividuos(crucePolinizacion)).toBe(0);
  });

  it('A1-G4-02: no se puede clonar un individuo muerto', async () => {
    const { error } = await operario.from('individuos').insert({ planta_id: cruceTrasplante, clon_de_id: origenMuerto, created_by: operarioId, codigo_display: '' });
    expect(error).not.toBeNull();
  });

  it('A1-G4-02: no se puede insertar un individuo dentro de un cruce archivado', async () => {
    const { error } = await operario.from('individuos').insert({ planta_id: cruceArchivado, created_by: operarioId, codigo_display: '' });
    expect(error).not.toBeNull();
  });

  it('A1-G4-02: el origen del clon debe ser del mismo cruce', async () => {
    const { error } = await operario.from('individuos').insert({ planta_id: crucePolinizacion, clon_de_id: origenVivo, created_by: operarioId, codigo_display: '' });
    expect(error).not.toBeNull();
  });

  it('un clon de otro cruce se rechaza y no bloquea la purga del origen (regresión A1-G4-02)', async () => {
    const origenCruce = await crearCruce('E');
    const destinoCruce = await crearCruce('F');
    try {
      const { data: origen } = await service.from('individuos').insert({ planta_id: origenCruce, created_by: operarioId, codigo_display: '' }).select('id').single();
      expect((await operario.from('individuos').insert({ planta_id: destinoCruce, clon_de_id: origen!.id, created_by: operarioId, codigo_display: '' })).error?.code).toBe('23514');
      const borrado = await admin.rpc('borrar_cruzamiento', { p_planta_id: origenCruce, p_tipo: 'hard' });
      expect(borrado.error).toBeNull();
      expect((await admin.rpc('borrar_cruzamiento', { p_planta_id: destinoCruce, p_tipo: 'hard' })).error).toBeNull();
    } finally {
      for (const id of [destinoCruce, origenCruce]) await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
    }
  });

  it('A1-G4-02: un individuo no puede nacer clon de sí mismo', async () => {
    const id = randomUUID();
    const { error } = await operario.from('individuos').insert({ id, planta_id: cruceConcurrencia, clon_de_id: id, created_by: operarioId, codigo_display: '' });
    expect(error).not.toBeNull();
  });

  it('el cliente puede fijar fecha_individualizacion al insertar (cualquier fecha); después queda inmutable', async () => {
    const { data, error } = await operario
      .from('individuos')
      .insert({ planta_id: cruceConcurrencia, created_by: operarioId, codigo_display: '', fecha_individualizacion: '1990-01-01' })
      .select('id, fecha_individualizacion')
      .single();
    expect(error).toBeNull();
    expect(data!.fecha_individualizacion).toBe('1990-01-01');
    const { error: eUpd } = await operario.from('individuos').update({ fecha_individualizacion: '2026-01-01' }).eq('id', data!.id);
    expect(eUpd?.code).toBe('23514');
  });
});

describe('I02 columnas de individuos con UPDATE concedido: qué protege proteger_identidad_individuo', () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    const { data, error } = await service
      .from('individuos')
      .insert([
        { planta_id: cruceConcurrencia, created_by: operarioId, codigo_display: '' },
        { planta_id: cruceConcurrencia, created_by: operarioId, codigo_display: '' },
      ])
      .select('id');
    if (error) throw error;
    [a, b] = data!.map((i) => i.id);
  });

  it('id, planta_id, codigo_display y fecha_individualizacion: protegidos (23514)', async () => {
    for (const cambio of [
      { id: randomUUID() },
      { planta_id: cruceTrasplante },
      { codigo_display: 'OTRO' },
      { fecha_individualizacion: '2020-01-01' },
    ]) {
      const { error } = await operario.from('individuos').update(cambio).eq('id', a);
      expect(error?.code, JSON.stringify(cambio)).toBe('23514');
    }
  });

  it('estado_vital y fecha_baja: sin grant de UPDATE (42501), ni para el admin', async () => {
    for (const cliente of [operario, admin]) {
      const { error } = await cliente.from('individuos').update({ estado_vital: 'muerto' }).eq('id', a);
      expect(error?.code).toBe('42501');
      const { error: e2 } = await cliente.from('individuos').update({ fecha_baja: '2026-01-01' }).eq('id', a);
      expect(e2?.code).toBe('42501');
    }
  });

  it('clon_de_id = sí mismo: protegido (23514)', async () => {
    const { error } = await operario.from('individuos').update({ clon_de_id: a }).eq('id', a);
    expect(error?.code).toBe('23514');
  });

  // A1-G4-06: clon_de_id es libre después del alta.
  it.fails('A1-G4-06: clon_de_id no admite ciclos A→B→A', async () => {
    expect((await operario.from('individuos').update({ clon_de_id: b }).eq('id', a)).error).toBeNull();
    const { error } = await operario.from('individuos').update({ clon_de_id: a }).eq('id', b);
    expect(error).not.toBeNull();
  });

  it.fails('A1-G4-06: clon_de_id no se puede reescribir después del alta (hoy el autor lo cambia sin auditoría)', async () => {
    const { error } = await operario.from('individuos').update({ clon_de_id: null }).eq('id', a);
    expect(error).not.toBeNull();
  });

  it.fails('A1-G4-06: created_at no se puede reescribir (hoy el autor lo cambia sin auditoría)', async () => {
    const { error } = await operario.from('individuos').update({ created_at: '2000-01-01T00:00:00Z' }).eq('id', a);
    expect(error).not.toBeNull();
  });

  it('created_by: el autor no puede cederlo a otro usuario (WITH CHECK, 42501); el admin sí y no queda auditado', async () => {
    const { error } = await operario.from('individuos').update({ created_by: operario2Id }).eq('id', a);
    expect(error?.code).toBe('42501');
    const { error: eAdmin } = await admin.from('individuos').update({ created_by: adminId }).eq('id', b);
    expect(eAdmin).toBeNull();
    const { count } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('accion', 'edicion_individuo').eq('detalle->>individuo_id', b);
    expect(count).toBe(0);
  });

  it('ninguna de esas ediciones escribe en audit_log (solo se auditan estado_vital/fecha_baja)', async () => {
    const { count } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('accion', 'edicion_individuo').in('detalle->>individuo_id', [a, b]);
    expect(count).toBe(0);
  });
});
