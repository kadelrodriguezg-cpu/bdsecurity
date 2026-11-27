/**
 * QR de individuo (/individuo/<uuid>) — verificación EMPÍRICA contra la base local.
 *
 * El escáner resuelve un individuo a su cruce con un SELECT directo sobre
 * `individuos` bajo RLS (sin RPC, sin auditoría por escaneo). Estos tests
 * prueban que esa ruta:
 *   - sirve a un operario sin permiso de linaje, y NO le entrega linaje por
 *     ninguna vía (ni columnas propias, ni embebiendo `plantas`, ni la ficha);
 *   - no escribe en audit_log ni consume el límite de `obtener_planta`;
 *   - se comporta de forma definida con un id inexistente, un individuo dado de
 *     baja, un cruce archivado (eliminado_at) y un cruce de prueba (es_prueba);
 *   - queda cerrada para `anon`.
 * Y (migración 20261011200000) que `individuos.id` es inmutable, porque el QR
 * de la etiqueta lo codifica.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from './helpers';
import { limpiarPrueba } from './limpieza-pruebas';

const R = Date.now();
const LINAJE = ['cruzamiento', 'mama', 'papa', 'mama_id', 'papa_id'] as const;
const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

let creds: LocalCreds;
let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let operarioId: string;
let especieId: string;
let mamaId: string;
let papaId: string;

interface Fixture { plantaId: string; individuoId: string; codigoDisplay: string }
let cruce: Fixture;
let cruceMuerto: Fixture; // mismo cruce de prueba que `cruce`: individuo dado de baja
let cruceArchivado: Fixture;
let crucePrueba: Fixture;
let cruceAutor: Fixture; // individuo creado por el operario (para probar la inmutabilidad como autor)

const plantasCreadas: string[] = [];
const individuosCreados: string[] = [];

async function crearIndividuo(plantaId: string, creadoPor: string, estado: 'vivo' | 'muerto' = 'vivo') {
  const { data, error } = await service
    .from('individuos')
    .insert({
      planta_id: plantaId,
      created_by: creadoPor,
      ...(estado === 'muerto' ? { estado_vital: 'muerto', fecha_baja: '2026-08-05' } : {}),
    })
    .select('id, codigo_display')
    .single();
  if (error || !data) throw new Error(`setup individuo: ${error?.message}`);
  individuosCreados.push(data.id);
  return { individuoId: data.id as string, codigoDisplay: data.codigo_display as string };
}

async function crearCruce(sufijo: string, extra: Record<string, unknown> = {}, creadoPor = adminId): Promise<Fixture> {
  const { data: planta, error } = await service
    .from('plantas')
    .insert({
      codigo_sistema: `QRIND-${sufijo}-${R}`,
      especie_id: especieId,
      estado: 'trasplante',
      cruzamiento: `LINAJE-SECRETO-${sufijo}-${R}`,
      mama_id: mamaId,
      papa_id: papaId,
      ...extra,
    })
    .select('id')
    .single();
  if (error || !planta) throw new Error(`setup planta ${sufijo}: ${error?.message}`);
  plantasCreadas.push(planta.id);
  const ind = await crearIndividuo(planta.id, creadoPor);
  return { plantaId: planta.id as string, ...ind };
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ad = await crearUsuarioDePrueba(creds, service, { email: `qr-individuo-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  const op = await crearUsuarioDePrueba(creds, service, { email: `qr-individuo-operario-${R}@test.local`, rol: 'operario', puedeVerLinaje: false });
  operario = op.client;
  operarioId = op.userId;

  const { data: esp, error: errEsp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (errEsp || !esp) throw new Error(`setup especie: ${errEsp?.message}`);
  especieId = esp.id;

  const { data: vars, error: errVar } = await service
    .from('variedades')
    .insert([
      { especie_id: especieId, nombre: `QRIND-mama-${R}`, created_by: adminId },
      { especie_id: especieId, nombre: `QRIND-papa-${R}`, created_by: adminId },
    ])
    .select('id, nombre');
  if (errVar || !vars) throw new Error(`setup variedades: ${errVar?.message}`);
  mamaId = vars.find((v) => v.nombre.includes('mama'))!.id;
  papaId = vars.find((v) => v.nombre.includes('papa'))!.id;

  cruce = await crearCruce('normal');
  const muerto = await crearIndividuo(cruce.plantaId, adminId, 'muerto');
  cruceMuerto = { plantaId: cruce.plantaId, ...muerto };
  cruceArchivado = await crearCruce('archivado', { eliminado_at: new Date().toISOString() });
  crucePrueba = await crearCruce('prueba', { es_prueba: true });
  cruceAutor = await crearCruce('autor', {}, operarioId);
});

afterAll(async () => {
  // Limpieza con service_role (bypassa RLS). Ningún otro test depende de estos datos.
  // Por planta_id (no por id de individuo): si una prueba de inmutabilidad fallara y el id
  // llegara a cambiar, igual se limpia todo lo que cuelga de los cruces creados acá.
  // Los cruces `normal`, `autor` y `archivado` son REALES a propósito (es_prueba = false) para contrastarlos con `prueba`;
  // por eso se borran acá. `limpiarPrueba` también quita baja_motivo (la baja del individuo muerto lo crea) y los usuarios.
  await limpiarPrueba(service, { plantaIds: plantasCreadas, variedadIds: [mamaId, papaId], usuarioIds: [adminId, operarioId] }, 'qr-individuo');
}, 60_000);

async function filasAuditoria(usuarioId: string): Promise<number> {
  const { count, error } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioId);
  if (error) throw new Error(`audit_log: ${error.message}`);
  return count ?? 0;
}

describe('QR de individuo — resolución bajo RLS (operario sin permiso de linaje)', () => {
  it('resuelve un individuo por id a su cruce, con solo los campos mínimos', async () => {
    const { data, error } = await operario
      .from('individuos')
      .select('id, planta_id, codigo_display, estado_vital')
      .eq('id', cruce.individuoId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({
      id: cruce.individuoId,
      planta_id: cruce.plantaId,
      codigo_display: cruce.codigoDisplay,
      estado_vital: 'vivo',
    });
  });

  it('NO obtiene linaje: ninguna columna de individuos lo contiene', async () => {
    const { data, error } = await operario.from('individuos').select('*').eq('id', cruce.individuoId).maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    for (const campo of LINAJE) expect(Object.keys(data ?? {})).not.toContain(campo);
  });

  it.each(LINAJE)('NO obtiene %s embebiendo plantas desde individuos (permiso denegado)', async (campo) => {
    const { data, error } = await operario
      .from('individuos')
      .select(`id, plantas(${campo})`)
      .eq('id', cruce.individuoId);
    // El grant por columna de `plantas` lo impide: debe fallar o, como mínimo, no traer el valor.
    if (error) {
      expect(['42501', 'PGRST200', 'PGRST201', '42703']).toContain(error.code);
    } else {
      expect(JSON.stringify(data)).not.toContain('LINAJE-SECRETO');
    }
  });

  it('NO obtiene linaje por la ficha: obtener_planta le devuelve la ficha sin cruzamiento/mama/papa', async () => {
    const { data, error } = await operario.rpc('obtener_planta', { p_planta_id: cruce.plantaId });
    expect(error).toBeNull();
    const ficha = data as Record<string, unknown>;
    expect(ficha.id).toBe(cruce.plantaId);
    for (const campo of LINAJE) expect(Object.keys(ficha)).not.toContain(campo);
    expect(JSON.stringify(ficha)).not.toContain('LINAJE-SECRETO');
  });

  it('un UUID inexistente devuelve null, sin error', async () => {
    const { data, error } = await operario
      .from('individuos')
      .select('id, planta_id, codigo_display, estado_vital')
      .eq('id', UUID_INEXISTENTE)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('un individuo dado de baja SE resuelve (la lectura nunca se bloquea)', async () => {
    const { data, error } = await operario
      .from('individuos')
      .select('id, planta_id, estado_vital')
      .eq('id', cruceMuerto.individuoId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ id: cruceMuerto.individuoId, planta_id: cruceMuerto.plantaId, estado_vital: 'muerto' });
  });

  it('un cruce de prueba (es_prueba) se resuelve como cualquier otro', async () => {
    const { data, error } = await operario.from('individuos').select('id, planta_id').eq('id', crucePrueba.individuoId).maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ id: crucePrueba.individuoId, planta_id: crucePrueba.plantaId });
  });

  it('un cruce archivado (eliminado_at): el individuo se resuelve, pero la ficha del cruce no está disponible (P0002)', async () => {
    const { data, error } = await operario.from('individuos').select('id, planta_id').eq('id', cruceArchivado.individuoId).maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ id: cruceArchivado.individuoId, planta_id: cruceArchivado.plantaId });

    const ficha = await operario.rpc('obtener_planta', { p_planta_id: cruceArchivado.plantaId });
    expect(ficha.error?.code).toBe('P0002');
  });
});

describe('QR de individuo — sin auditoría por escaneo y sin gastar el límite de obtener_planta', () => {
  it('25 resoluciones no escriben en audit_log y la ficha sigue abriéndose (sin error 58503)', async () => {
    const antes = await filasAuditoria(operarioId);
    for (let i = 0; i < 25; i++) {
      const { error } = await operario.from('individuos').select('id, planta_id, codigo_display, estado_vital').eq('id', cruce.individuoId).maybeSingle();
      expect(error).toBeNull();
    }
    expect(await filasAuditoria(operarioId)).toBe(antes);

    // El límite es de 20 lecturas por minuto de obtener_planta: 25 resoluciones previas no cuentan.
    const ficha = await operario.rpc('obtener_planta', { p_planta_id: cruce.plantaId });
    expect(ficha.error).toBeNull();
    expect(await filasAuditoria(operarioId)).toBe(antes + 1);
  });
});

describe('QR de individuo — anon', () => {
  it('un cliente anónimo no puede leer individuos', async () => {
    const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.from('individuos').select('id, planta_id').eq('id', cruce.individuoId).maybeSingle();
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });
});

describe('individuos.id inmutable (migración 20261011200000)', () => {
  const NUEVO_ID = () => crypto.randomUUID();

  async function idActual(individuoId: string) {
    const { data } = await service.from('individuos').select('id').eq('id', individuoId).maybeSingle();
    return data?.id ?? null;
  }

  it('un admin no puede cambiar el id de un individuo (23514)', async () => {
    const { error } = await admin.from('individuos').update({ id: NUEVO_ID() }).eq('id', cruce.individuoId);
    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/inmutable/i);
    expect(await idActual(cruce.individuoId)).toBe(cruce.individuoId);
  });

  it('el autor del individuo (operario) tampoco puede cambiarlo, aunque la política le permita editar', async () => {
    const { error } = await operario.from('individuos').update({ id: NUEVO_ID() }).eq('id', cruceAutor.individuoId);
    expect(error?.code).toBe('23514');
    expect(await idActual(cruceAutor.individuoId)).toBe(cruceAutor.individuoId);
  });

  it('el service_role tampoco: el trigger aplica a todos los roles', async () => {
    const { error } = await service.from('individuos').update({ id: NUEVO_ID() }).eq('id', cruce.individuoId);
    expect(error?.code).toBe('23514');
  });

  it('las demás protecciones de identidad siguen intactas (cruce de origen y código)', async () => {
    const otroCruce = crucePrueba.plantaId;
    const a = await admin.from('individuos').update({ planta_id: otroCruce }).eq('id', cruce.individuoId);
    expect(a.error?.code).toBe('23514');
    const b = await admin.from('individuos').update({ codigo_display: 'OTRO-P99' }).eq('id', cruce.individuoId);
    expect(b.error?.code).toBe('23514');
  });

  it('control: una edición legítima (otra columna) sigue funcionando y el id queda igual', async () => {
    // Desde 20261021160000 la baja es por RPC (sin UPDATE directo de estado_vital).
    const { error } = await admin.rpc('marcar_baja_individuo', {
      p_individuo_id: cruceAutor.individuoId, p_estado: 'descartado', p_criterios: ['vigor'],
      p_nota: null, p_fecha: '2026-09-01', p_idempotency_key: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    const { data } = await service.from('individuos').select('id, estado_vital').eq('id', cruceAutor.individuoId).single();
    expect(data).toEqual({ id: cruceAutor.individuoId, estado_vital: 'descartado' });
  });
});
