/**
 * Auditoría integral, Corrida 1, grupo G1 — flujos C08/C09. Concurrencia sobre
 * los límites de frecuencia de `obtener_planta` (20/min) y `actualizar_linaje`
 * (10/min), que se calculan contando filas de `audit_log` ANTES de escribir la
 * suya: ¿aguantan llamadas en paralelo? Y qué pasa cuando dos admins editan el
 * linaje del mismo cruce.
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
let admin2: SupabaseClient;
let admin2Id: string;
let especieId: string;
let varX: string;
let varY: string;
let varZ: string;
let plantaId: string;

async function contarAuditoria(usuarioId: string, acciones: string[]) {
  const { count, error } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioId).in('accion', acciones);
  if (error) throw error;
  return count ?? 0;
}

async function linajeReal() {
  const { data, error } = await service.from('plantas').select('cruzamiento, mama_id, papa_id').eq('id', plantaId).single();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const a1 = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-conc-admin1-${R}@test.local`, rol: 'admin' });
  admin = a1.client;
  adminId = a1.userId;
  const a2 = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-conc-admin2-${R}@test.local`, rol: 'admin' });
  admin2 = a2.client;
  admin2Id = a2.userId;

  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  const { data: vars, error: errVar } = await service
    .from('variedades')
    .insert(['X', 'Y', 'Z'].map((n) => ({ especie_id: especieId, nombre: `Var ${n} conc-g1 ${R}`, created_by: adminId })))
    .select('id, nombre');
  if (errVar || !vars) throw new Error(`setup variedades: ${errVar?.message}`);
  const id = (n: string) => vars.find((v) => v.nombre.startsWith(`Var ${n}`))!.id;
  varX = id('X');
  varY = id('Y');
  varZ = id('Z');
  const { data: planta, error: errPl } = await service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-G1-${R}-CONC`, especie_id: especieId, cruzamiento: `CONC-${R}`, mama_id: varX, papa_id: varY, es_prueba: true })
    .select('id')
    .single();
  if (errPl || !planta) throw new Error(`setup planta: ${errPl?.message}`);
  plantaId = planta.id;
}, 60_000);

afterAll(async () => {
  await service.from('plantas').delete().like('codigo_sistema', `AUD-G1-${R}-%`);
  await service.from('variedades').delete().ilike('nombre', `%conc-g1 ${R}%`);
});

describe('C09 / C08 límites de frecuencia bajo concurrencia', () => {
  // A1-G1-10: el conteo de audit_log y el INSERT de la fila nueva no son
  // atómicos (sin lock ni advisory lock). Con N llamadas en paralelo todas ven
  // «0 lecturas en el último minuto» y pasan.
  it.fails('60 lecturas de ficha en paralelo de cada uno de 3 usuarios: ninguno pasa de 20 (A1-G1-10)', async () => {
    const pasaron: number[] = [];
    for (let u = 0; u < 3; u++) {
      const { client: lector, userId } = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-conc-lector-${u}-${R}@test.local`, rol: 'operario' });
      const resultados = await Promise.all(Array.from({ length: 60 }, () => lector.rpc('obtener_planta', { p_planta_id: plantaId })));
      pasaron.push(resultados.filter((r) => !r.error).length);
      console.log(`[G1-CONC] usuario ${u}: ${pasaron[u]} de 60 lecturas en paralelo pasaron; filas lectura_ficha=${await contarAuditoria(userId, ['lectura_ficha'])}`);
    }
    expect(Math.max(...pasaron)).toBeLessThanOrEqual(20);
  }, 90_000);

  it.fails('30 escrituras de linaje en paralelo de cada uno de 3 admins: ninguno pasa de 10 (A1-G1-10)', async () => {
    const pasaron: number[] = [];
    for (let u = 0; u < 3; u++) {
      const { client: escritor, userId } = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-conc-escritor-${u}-${R}@test.local`, rol: 'admin' });
      const resultados = await Promise.all(
        Array.from({ length: 30 }, (_, i) => escritor.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: `PAR-${u}-${i}`, p_mama_id: varX, p_papa_id: varY })),
      );
      pasaron.push(resultados.filter((r) => !r.error).length);
      console.log(`[G1-CONC] admin ${u}: ${pasaron[u]} de 30 escrituras en paralelo pasaron; filas escritura_linaje=${await contarAuditoria(userId, ['escritura_linaje'])}`);
    }
    expect(Math.max(...pasaron)).toBeLessThanOrEqual(10);
  }, 90_000);
});

describe('C08 dos admins editan el linaje del mismo cruce', () => {
  // A1-G1-11: LinajePanel envía siempre los tres campos con lo que cargó la
  // ficha. Si el admin B solo quería cambiar el cruzamiento, su guardado pisa
  // el cambio de mamá que el admin A hizo mientras B tenía el formulario abierto.
  it.fails('el guardado de un formulario desactualizado no revierte en silencio el cambio de otro admin (A1-G1-11)', async () => {
    await admin.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: 'BASE', p_mama_id: varX, p_papa_id: varY });
    // B abre la edición: ve mamá X, papá Y. A cambia la mamá a Z y guarda.
    expect((await admin.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: 'BASE', p_mama_id: varZ, p_papa_id: varY })).error).toBeNull();
    // B corrige solo el cruzamiento; el formulario manda lo que cargó (mamá X).
    expect((await admin2.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: 'BASE corregido', p_mama_id: varX, p_papa_id: varY })).error).toBeNull();
    const real = await linajeReal();
    expect(real.cruzamiento).toBe('BASE corregido');
    expect(real.mama_id).toBe(varZ); // lo correcto: el cambio de A sobrevive
    const { data: filas } = await service
      .from('audit_log')
      .select('usuario_id')
      .eq('planta_id', plantaId)
      .eq('accion', 'escritura_linaje')
      .in('usuario_id', [adminId, admin2Id]);
    expect(filas!.length).toBeGreaterThanOrEqual(2);
  });

  it('actualizar_linaje rechaza un cruce archivado sin escritura ni auditoría falsa (A1-G1-22)', async () => {
    const { data: arch } = await service
      .from('plantas')
      .insert({ codigo_sistema: `AUD-G1-${R}-CARCH`, especie_id: especieId, cruzamiento: 'ARCH', mama_id: varX, es_prueba: true, eliminado_at: new Date().toISOString() })
      .select('id')
      .single();
    const { error } = await admin.rpc('actualizar_linaje', { p_planta_id: arch!.id, p_cruzamiento: 'EDITADO-ARCHIVADO', p_mama_id: varY, p_papa_id: null });
    expect(error?.code).toBe('P0002');
    const { count, error: auditError } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('planta_id', arch!.id).eq('accion', 'escritura_linaje');
    expect(auditError).toBeNull();
    expect(count).toBe(0);
    const { data } = await service.from('plantas').select('cruzamiento, mama_id, eliminado_at').eq('id', arch!.id).single();
    expect(data).toMatchObject({ cruzamiento: 'ARCH', mama_id: varX });
    expect(data!.eliminado_at).not.toBeNull();
  });
});
