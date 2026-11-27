/**
 * Auditoría integral, Corrida 1, grupo G2: flujo C03 (polinización).
 *
 * Pruebas empíricas contra la base local con usuarios propios del grupo
 * (aud-g2-*). Reproducen con supabase-js exactamente las llamadas que hace
 * `frontend/src/api/fases.ts` (insert/delete de `polinizacion_evento`, update
 * de las columnas legacy de `plantas`, insert en `registros_evento`).
 *
 * Las pruebas marcadas `it.fails` demuestran un hallazgo abierto (ID A1-G2-NN
 * en el comentario): están escritas con lo que DEBERÍA pasar y fallan hoy.
 * Cuando el hallazgo se corrija, pasarán y habrá que quitar el `.fails`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operarioA: SupabaseClient;
let operarioAId: string;
let operarioB: SupabaseClient;
let operarioBId: string;
let especieId: string;
const plantasCreadas: string[] = [];
const usuariosCreados: string[] = [];

const R = Date.now();
let n = 0;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client; adminId = ad.userId; usuariosCreados.push(adminId);
  const a = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-opa-${R}@test.local`, rol: 'operario' });
  operarioA = a.client; operarioAId = a.userId; usuariosCreados.push(operarioAId);
  const b = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-opb-${R}@test.local`, rol: 'operario' });
  operarioB = b.client; operarioBId = b.userId; usuariosCreados.push(operarioBId);

  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').limit(1).single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;
}, 60_000);

afterAll(async () => {
  for (const id of plantasCreadas) {
    await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
  }
  for (const uid of usuariosCreados) {
    await service.auth.admin.deleteUser(uid);
  }
});

async function crearCruce(estado = 'polinizacion', extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-G2-POL-${R}-${++n}`, especie_id: especieId, estado, es_prueba: true, ...extra })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
  plantasCreadas.push(data.id);
  return data.id;
}

/** Misma llamada que fases.ts:177-181 (agregarPolinizacionEvento). */
function insertarSesion(cliente: SupabaseClient, plantaId: string, uid: string, fecha: string, flores: number) {
  return cliente
    .from('polinizacion_evento')
    .insert({ planta_id: plantaId, fecha, n_flores_cruzadas: flores, created_by: uid })
    .select('id, fecha, n_flores_cruzadas')
    .single();
}

async function sesionesDe(plantaId: string) {
  const { data } = await service
    .from('polinizacion_evento')
    .select('id, fecha, n_flores_cruzadas, created_by')
    .eq('planta_id', plantaId)
    .order('fecha')
    .order('created_at');
  return data ?? [];
}

async function auditoriasDe(plantaId: string, accion: string) {
  const { data } = await service.from('audit_log').select('usuario_id, detalle').eq('planta_id', plantaId).eq('accion', accion);
  return data ?? [];
}

describe('C03 polinización: quién puede y qué queda auditado (confirmaciones)', () => {
  it('operario registra una sesión a su nombre y queda auditada con fecha y flores', async () => {
    const id = await crearCruce();
    const { data, error } = await insertarSesion(operarioA, id, operarioAId, '2026-10-01', 40);
    expect(error).toBeNull();
    const audit = await auditoriasDe(id, 'creacion_polinizacion_evento');
    expect(audit).toHaveLength(1);
    expect(audit[0].usuario_id).toBe(operarioAId);
    expect(audit[0].detalle).toMatchObject({ evento_id: data!.id, fecha: '2026-10-01', n_flores_cruzadas: 40 });
  });

  it('dos operarios registran a la vez sobre el mismo cruce: ambas sesiones persisten', async () => {
    const id = await crearCruce();
    const [ra, rb] = await Promise.all([
      insertarSesion(operarioA, id, operarioAId, '2026-10-02', 10),
      insertarSesion(operarioB, id, operarioBId, '2026-10-02', 20),
    ]);
    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();
    const sesiones = await sesionesDe(id);
    expect(sesiones).toHaveLength(2);
    expect(sesiones.reduce((s, e) => s + e.n_flores_cruzadas, 0)).toBe(30);
  });

  it('el autor y el admin pueden borrar una sesión; el borrado queda auditado con los valores', async () => {
    const id = await crearCruce();
    const { data: s1 } = await insertarSesion(operarioA, id, operarioAId, '2026-10-03', 5);
    const { data: s2 } = await insertarSesion(operarioA, id, operarioAId, '2026-10-04', 6);
    const { error: e1 } = await operarioA.from('polinizacion_evento').delete().eq('id', s1!.id);
    expect(e1).toBeNull();
    const { error: e2 } = await admin.from('polinizacion_evento').delete().eq('id', s2!.id);
    expect(e2).toBeNull();
    expect(await sesionesDe(id)).toHaveLength(0);
    const audit = await auditoriasDe(id, 'eliminacion_polinizacion_evento');
    expect(audit.map((a) => a.detalle.n_flores_cruzadas).sort()).toEqual([5, 6]);
    expect(audit.find((a) => a.detalle.n_flores_cruzadas === 6)!.usuario_id).toBe(adminId);
  });

  it('anon no puede leer ni insertar sesiones', async () => {
    const creds = getLocalCreds();
    const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const id = await crearCruce();
    const { error: eIns } = await anon.from('polinizacion_evento').insert({ planta_id: id, fecha: '2026-10-01', n_flores_cruzadas: 1 });
    expect(eIns).toBeTruthy();
    const { data } = await anon.from('polinizacion_evento').select('id').eq('planta_id', id);
    expect(data ?? []).toHaveLength(0);
  });
});

describe('C03 polinización: "Quitar última sesión" de un operario sobre una sesión ajena', () => {
  it('RLS impide el borrado, pero la API no devuelve error: la sesión sigue y la UI cree que la quitó (A1-G2-04)', async () => {
    const id = await crearCruce();
    const { data: sesionDeA } = await insertarSesion(operarioA, id, operarioAId, '2026-10-05', 12);

    // Exactamente fases.ts:201: delete por id sin select ni conteo de filas.
    const { error, data, count } = await operarioB.from('polinizacion_evento').delete().eq('id', sesionDeA!.id);
    expect(error).toBeNull(); // sin error: fases.ts sigue a sincronizar e invalida como si hubiera funcionado
    expect(data).toBeNull();
    expect(count).toBeNull();

    const sesiones = await sesionesDe(id);
    expect(sesiones).toHaveLength(1); // la sesión de A sigue intacta
    expect(await auditoriasDe(id, 'eliminacion_polinizacion_evento')).toHaveLength(0);
  });
});

describe('C03 polinización: validación de etapa y archivado en el servidor', () => {
  // Acuerdo delegado A1-028: las capturas tardías son válidas antes del cierre.
  it('la base permite una sesión tardía de polinización en trasplante (A1-G2-01)', async () => {
    const id = await crearCruce('trasplante');
    const { error } = await insertarSesion(operarioA, id, operarioAId, '2026-10-06', 3);
    expect(error).toBeNull();
  });

  it('la base rechaza una sesión de polinización en un cruce con proceso finalizado (A1-G2-01)', async () => {
    const id = await crearCruce('proceso_finalizado');
    const { error } = await insertarSesion(operarioA, id, operarioAId, '2026-10-06', 3);
    expect(error).not.toBeNull();
  });

  // A1-G2-02: los cruces archivados (eliminado_at) aceptan escrituras de fase.
  it('la base rechaza una sesión de polinización en un cruce archivado (A1-G2-02)', async () => {
    const id = await crearCruce('polinizacion', { eliminado_at: new Date().toISOString() });
    const { error } = await insertarSesion(operarioA, id, operarioAId, '2026-10-06', 3);
    expect(error).not.toBeNull();
  });

  // A1-G2-05: sin idempotency_key, el reintento del mismo envío duplica la sesión.
  it.fails('un reintento del mismo envío (misma fecha, mismas flores, mismo autor, mismo instante) no duplica la sesión (A1-G2-05)', async () => {
    const id = await crearCruce();
    const [r1, r2] = await Promise.all([
      insertarSesion(operarioA, id, operarioAId, '2026-10-07', 33),
      insertarSesion(operarioA, id, operarioAId, '2026-10-07', 33),
    ]);
    expect(r1.error ?? r2.error).not.toBeNull(); // uno de los dos debería rechazarse o devolver la misma fila
    expect(await sesionesDe(id)).toHaveLength(1);
  });

  it('la base acepta fecha futura y cero flores (solo advertencia en la UI; se documenta, no es hallazgo bloqueante)', async () => {
    const id = await crearCruce();
    const { error: eFuturo } = await insertarSesion(operarioA, id, operarioAId, '2099-01-01', 1);
    expect(eFuturo).toBeNull();
    const { error: eCero } = await insertarSesion(operarioA, id, operarioAId, '2026-10-08', 0);
    expect(eCero).toBeNull();
    const { error: eNeg } = await insertarSesion(operarioA, id, operarioAId, '2026-10-08', -1);
    expect(eNeg?.code).toBe('23514'); // el CHECK sí frena los negativos
  });
});

describe('C03 polinización: dual-write legacy y consistencia del historial', () => {
  it('las columnas legacy de plantas las escribe el cliente con la ÚLTIMA sesión, no con la suma; un borrado directo por API las deja desincronizadas', async () => {
    const id = await crearCruce();
    await insertarSesion(operarioA, id, operarioAId, '2026-10-01', 10);
    const { data: ultima } = await insertarSesion(operarioA, id, operarioAId, '2026-10-02', 25);
    // fases.ts:157-163 (sincronizarColumnasLegacyPolinizacion)
    const { error } = await operarioA.from('plantas').update({ fecha_polinizacion: '2026-10-02', n_flores_cruzadas: 25 }).eq('id', id);
    expect(error).toBeNull();
    const { data: p1 } = await service.from('plantas').select('n_flores_cruzadas, fecha_polinizacion').eq('id', id).single();
    expect(p1).toEqual({ n_flores_cruzadas: 25, fecha_polinizacion: '2026-10-02' }); // última, no 35

    // Borrado directo por API de la última sesión (sin pasar por fases.ts): nadie resincroniza.
    await operarioA.from('polinizacion_evento').delete().eq('id', ultima!.id);
    const { data: p2 } = await service.from('plantas').select('n_flores_cruzadas, fecha_polinizacion').eq('id', id).single();
    expect(p2).toEqual({ n_flores_cruzadas: 25, fecha_polinizacion: '2026-10-02' }); // apunta a una sesión que ya no existe
    expect(await sesionesDe(id)).toHaveLength(1);
  });

  it('cualquier operario puede escribir n_flores_cruzadas/fecha_polinizacion directo en plantas con un valor que no sale de ninguna sesión (queda auditado como escritura_fase)', async () => {
    const id = await crearCruce();
    const { error } = await operarioB.from('plantas').update({ n_flores_cruzadas: 999, fecha_polinizacion: '2020-01-01' }).eq('id', id);
    expect(error).toBeNull();
    const audit = await auditoriasDe(id, 'escritura_fase');
    expect(audit).toHaveLength(1);
    expect(audit[0].usuario_id).toBe(operarioBId);
    expect(audit[0].detalle.nuevo.n_flores_cruzadas).toBe(999);
    expect(await sesionesDe(id)).toHaveLength(0);
  });

  it('"Quitar última sesión" borra la sesión pero deja intacta la fila narrativa de registros_evento (y su nota), que el operario no puede eliminar (A1-G2-06)', async () => {
    const id = await crearCruce();
    const { data: sesion } = await insertarSesion(operarioA, id, operarioAId, '2026-10-09', 40);
    // fases.ts:184-191 (registrarHistorial)
    const { data: registro, error: eReg } = await operarioA
      .from('registros_evento')
      .insert({ planta_id: id, tipo_evento: 'polinizacion', fecha: '2026-10-09', datos: { fecha_polinizacion: '2026-10-09', n_flores_cruzadas: 40 }, created_by: operarioAId, notas: 'nota de la sesión borrada' })
      .select('id')
      .single();
    expect(eReg).toBeNull();

    // fases.ts:201 (quitarUltimoPolinizacionEvento): solo borra polinizacion_evento.
    const { error } = await operarioA.from('polinizacion_evento').delete().eq('id', sesion!.id);
    expect(error).toBeNull();
    expect(await sesionesDe(id)).toHaveLength(0);

    // El historial sigue diciendo "40 flores el 2026-10-09" y la nota se precarga en el formulario (fases.ts:85-100).
    const { data: historial } = await service.from('registros_evento').select('id, notas, eliminado_at').eq('planta_id', id).eq('tipo_evento', 'polinizacion');
    expect(historial).toHaveLength(1);
    expect(historial![0].eliminado_at).toBeNull();
    expect(historial![0].notas).toBe('nota de la sesión borrada');

    // Y el operario no puede marcarla como eliminada (trigger bloquear_borrado_no_admin).
    const { error: eSoft } = await operarioA.from('registros_evento').update({ eliminado_at: new Date().toISOString() }).eq('id', registro!.id);
    expect(eSoft?.code).toBe('42501');
  });

  it('si la segunda llamada (historial) falla, la sesión ya quedó guardada sin fila narrativa (no hay transacción)', async () => {
    const id = await crearCruce();
    const { error: e1 } = await insertarSesion(operarioA, id, operarioAId, '2026-10-10', 7);
    expect(e1).toBeNull();
    // Simula la falla de registrarHistorial (fases.ts:184): created_by ajeno viola la policy de registros_evento.
    const { error: e2 } = await operarioA
      .from('registros_evento')
      .insert({ planta_id: id, tipo_evento: 'polinizacion', fecha: '2026-10-10', datos: {}, created_by: operarioBId });
    expect(e2).not.toBeNull();
    expect(await sesionesDe(id)).toHaveLength(1);
    const { data: historial } = await service.from('registros_evento').select('id').eq('planta_id', id);
    expect(historial).toHaveLength(0);
  });
});

describe('C03 polinización: cómo lo ve el ranking varietal (obtener_ranking_polinizacion_varietal)', () => {
  it('suma las sesiones de cruces de prueba (es_prueba = true) igual que las reales, y las de cruces fuera de la fase polinización', async () => {
    const { data: vars } = await service.from('variedades').select('id').limit(2);
    if (!vars || vars.length < 2) return; // sin variedades en el catálogo local no se puede armar el caso
    const id = await crearCruce('trasplante', { mama_id: vars[0].id, papa_id: vars[1].id });
    const { data: antes, error: eAntes } = await admin.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieId, p_rol: 'ambos' });
    expect(eAntes).toBeNull();
    const resumenAntes = (antes as Array<{ tipo_fila: string; flores_reales: number }>).find((f) => f.tipo_fila === 'resumen')!.flores_reales;

    await insertarSesion(operarioA, id, operarioAId, '2026-10-11', 1000);

    const { data: despues } = await admin.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieId, p_rol: 'ambos' });
    const resumenDespues = (despues as Array<{ tipo_fila: string; flores_reales: number }>).find((f) => f.tipo_fila === 'resumen')!.flores_reales;
    expect(Number(resumenDespues) - Number(resumenAntes)).toBe(1000);
  });

  it('el operario no puede consultar el ranking (solo admin)', async () => {
    const { error } = await operarioA.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieId, p_rol: 'ambos' });
    expect(error?.code).toBe('42501');
  });
});

// -----------------------------------------------------------------------------
// Evidencia de producción P13 / P14 (scripts/invariantes_produccion.sql:62-68)
// reproducida en local con la secuencia COMPLETA de fases.ts, paso a paso.
//   P13 = eventos de bitácora de polinización (activos) sin sesión del mismo cruce y fecha.
//   P14 = sesiones sin evento de bitácora activo del mismo cruce y fecha.
// Producción: P13 = 5, P14 = 6. Estas pruebas demuestran los mecanismos que los
// generan (A1-G2-06); que los 5 y los 6 de producción salgan de ellos es [S].
// -----------------------------------------------------------------------------

/** Secuencia de fases.ts:168-194 (agregarPolinizacionEvento) con corte opcional (pérdida de señal / pestaña cerrada). */
async function agregarComoLaApp(
  cliente: SupabaseClient, plantaId: string, uid: string, fecha: string, flores: number,
  opts: { cortarDespuesDe?: 'sesion' | 'legacy' } = {},
) {
  const { error: e1 } = await insertarSesion(cliente, plantaId, uid, fecha, flores); // paso 2: insert polinizacion_evento
  if (e1) throw new Error(`paso sesión: ${e1.message}`);
  if (opts.cortarDespuesDe === 'sesion') return;
  await sincronizarLegacyComoLaApp(cliente, plantaId); // paso 3: dual-write legacy
  if (opts.cortarDespuesDe === 'legacy') return;
  const { error: e4 } = await cliente // paso 4: registrarHistorial
    .from('registros_evento')
    .insert({ planta_id: plantaId, tipo_evento: 'polinizacion', fecha, datos: { fecha_polinizacion: fecha, n_flores_cruzadas: flores }, created_by: uid, notas: null });
  if (e4) throw new Error(`paso historial: ${e4.message}`);
}

/** fases.ts:154-166 (sincronizarColumnasLegacyPolinizacion). */
async function sincronizarLegacyComoLaApp(cliente: SupabaseClient, plantaId: string) {
  const { data } = await cliente.from('polinizacion_evento').select('fecha, n_flores_cruzadas').eq('planta_id', plantaId).order('fecha').order('created_at');
  const ultimo = (data ?? []).at(-1) ?? null;
  const { error } = await cliente.from('plantas').update({ fecha_polinizacion: ultimo?.fecha ?? null, n_flores_cruzadas: ultimo?.n_flores_cruzadas ?? null }).eq('id', plantaId);
  if (error) throw new Error(`legacy: ${error.message}`);
}

/** fases.ts:197-204 (quitarUltimoPolinizacionEvento): borra la última sesión y resincroniza legacy; no toca registros_evento. */
async function quitarComoLaApp(cliente: SupabaseClient, plantaId: string) {
  const { data } = await cliente.from('polinizacion_evento').select('id').eq('planta_id', plantaId).order('fecha').order('created_at');
  const ultimo = (data ?? []).at(-1);
  if (!ultimo) throw new Error('No hay sesiones');
  const { error } = await cliente.from('polinizacion_evento').delete().eq('id', ultimo.id);
  if (error) throw new Error(`delete: ${error.message}`);
  await sincronizarLegacyComoLaApp(cliente, plantaId);
}

/** Mismos criterios que P13 y P14 del script de invariantes, acotados a un cruce. */
async function invariantesP13P14(plantaId: string) {
  const sesiones = await sesionesDe(plantaId);
  const { data: bitacora } = await service
    .from('registros_evento')
    .select('fecha')
    .eq('planta_id', plantaId)
    .eq('tipo_evento', 'polinizacion')
    .is('eliminado_at', null);
  const fechasSesion = new Set(sesiones.map((s) => s.fecha));
  const fechasBitacora = new Set((bitacora ?? []).map((b) => b.fecha));
  return {
    p13: (bitacora ?? []).filter((b) => !fechasSesion.has(b.fecha)).length,
    p14: sesiones.filter((s) => !fechasBitacora.has(s.fecha)).length,
    nSesiones: sesiones.length,
    nBitacora: (bitacora ?? []).length,
  };
}

describe('C03 polinización: P13/P14 de producción reproducidas con la secuencia completa de la app (A1-G2-06)', () => {
  it('alta completa sin cortes: P13 = 0 y P14 = 0 (el camino feliz sí queda consistente)', async () => {
    const id = await crearCruce();
    await agregarComoLaApp(operarioA, id, operarioAId, '2026-10-12', 15);
    expect(await invariantesP13P14(id)).toMatchObject({ p13: 0, p14: 0, nSesiones: 1, nBitacora: 1 });
  });

  it('P14: si la operación se corta después de insertar la sesión (o después del dual-write), la sesión queda sin bitácora y no hay forma de repararla desde la app', async () => {
    for (const corte of ['sesion', 'legacy'] as const) {
      const id = await crearCruce();
      await agregarComoLaApp(operarioA, id, operarioAId, '2026-10-13', 22, { cortarDespuesDe: corte });
      expect(await invariantesP13P14(id)).toMatchObject({ p13: 0, p14: 1, nSesiones: 1, nBitacora: 0 });
      // La sesión sí cuenta en el total y en el ranking; la bitácora nunca se escribe.
      const { data: p } = await service.from('plantas').select('n_flores_cruzadas').eq('id', id).single();
      expect(p!.n_flores_cruzadas).toBe(corte === 'legacy' ? 22 : null);
    }
  });

  it('P13: alta completa y luego "Quitar última sesión": la sesión desaparece, la bitácora queda activa y sin sesión', async () => {
    const id = await crearCruce();
    await agregarComoLaApp(operarioA, id, operarioAId, '2026-10-14', 31);
    await quitarComoLaApp(operarioA, id);
    expect(await invariantesP13P14(id)).toMatchObject({ p13: 1, p14: 0, nSesiones: 0, nBitacora: 1 });
    // El legacy sí se limpió (la app lo resincroniza): el único resto es la bitácora.
    const { data: p } = await service.from('plantas').select('n_flores_cruzadas, fecha_polinizacion').eq('id', id).single();
    expect(p).toEqual({ n_flores_cruzadas: null, fecha_polinizacion: null });
  });

  it('el invariante P13 solo ve la huella si no queda otra sesión del mismo día: dos sesiones el mismo día y se quita una dejan una bitácora fantasma que P13 NO cuenta (los 5 de producción son una cota inferior)', async () => {
    const id = await crearCruce();
    await agregarComoLaApp(operarioA, id, operarioAId, '2026-10-15', 10);
    await agregarComoLaApp(operarioA, id, operarioAId, '2026-10-15', 12);
    await quitarComoLaApp(operarioA, id); // quita la de 12 flores
    expect(await invariantesP13P14(id)).toMatchObject({ p13: 0, p14: 0, nSesiones: 1, nBitacora: 2 });
  });
});
