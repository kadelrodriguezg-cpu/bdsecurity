/**
 * Auditoría integral, Corrida 1, grupo G4: I06 traslado / emplazamiento.
 *
 * registrar_traslado_individuo, triggers validar_cierre_emplazamiento y
 * bloquear_borrado_emplazamiento, tabla emplazamiento_coordenada (solo admin)
 * y obtener_mapa_cruce. Los cruces con historial territorial NO se pueden
 * purgar (borrar_cruzamiento hard lo rechaza por diseño): este archivo deja
 * los cruces AUD-G4-TRAS y AUD-G4-TRAS-POL (fijos, reutilizados entre corridas)
 * archivados (soft) en la base local, anotado en el informe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';
import { solapar } from './g4-helpers';

let creds: LocalCreds;
let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let admin2: SupabaseClient;
let operario: SupabaseClient;
let operarioId: string;
let especieId: string;
let cruce: string;
let predioActivo: string;
let sectorActivo: string;
let sectorInactivo: string;
let sectorDePredioInactivo: string;

async function individuo(): Promise<string> {
  const { data, error } = await service.from('individuos').insert({ planta_id: cruce, created_by: operarioId, codigo_display: '' }).select('id').single();
  if (error || !data) throw new Error(`setup individuo: ${error?.message}`);
  return data.id as string;
}

// El historial territorial no se puede purgar, así que los cruces y predios de
// esta suite son FIJOS (se reutilizan entre corridas) para que la base local no
// acumule uno nuevo por cada ejecución.
async function predioFijo(nombre: string, activo = true): Promise<string> {
  const { data: existente } = await service.from('predio').select('id, activo').eq('nombre', nombre).limit(1).maybeSingle();
  if (existente) {
    if (existente.activo !== activo) await service.from('predio').update({ activo }).eq('id', existente.id);
    return existente.id as string;
  }
  const { data, error } = await service.from('predio').insert({ nombre, activo }).select('id').single();
  if (error || !data) throw new Error(`setup predio ${nombre}: ${error?.message}`);
  return data.id as string;
}

async function cruceFijo(codigoSistema: string, estado: string, archivado: boolean): Promise<string> {
  const eliminado_at = archivado ? new Date().toISOString() : null;
  const { data: existente } = await service.from('plantas').select('id').eq('codigo_sistema', codigoSistema).maybeSingle();
  if (existente) {
    await service.from('plantas').update({ eliminado_at }).eq('id', existente.id);
    return existente.id as string;
  }
  const { data, error } = await service.from('plantas').insert({ codigo_sistema: codigoSistema, especie_id: especieId, estado, es_prueba: true, eliminado_at }).select('id').single();
  if (error || !data) throw new Error(`setup cruce ${codigoSistema}: ${error?.message}`);
  return data.id as string;
}

async function sectorDe(predioId: string): Promise<string> {
  const { data, error } = await service.from('sector').select('id').eq('predio_id', predioId).eq('activo', true).limit(1).single();
  if (error || !data) throw new Error(`setup sector: ${error?.message}`);
  return data.id as string;
}

async function historial(individuoId: string) {
  const { data } = await service.from('emplazamiento_individuo').select('id, sector_id, fecha_inicio, fecha_fin').eq('individuo_id', individuoId).order('fecha_inicio').order('created_at');
  return data ?? [];
}

const traslado = (individuoId: string, sectorId: string, fecha = '2026-10-21', extra: Record<string, unknown> = {}) => ({
  p_individuo_id: individuoId,
  p_sector_id: sectorId,
  p_fecha_inicio: fecha,
  ...extra,
});

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Usuarios FIJOS (se reutilizan entre corridas), igual que los cruces y predios de esta suite: quien registra un
  // traslado queda como autor de un emplazamiento (created_by), y el historial es append-only (trigger
  // validar_cierre_emplazamiento), así que ese autor NUNCA se puede borrar; y el operario crea individuos que
  // luego reciben emplazamientos (individuos.created_by es RESTRICT). Con correos nuevos por corrida, quedaban 3
  // perfiles huérfanos por ejecución.
  const ad = await crearUsuarioDePrueba(creds, service, { email: 'aud-g4-tras-admin@test.local', rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  admin2 = (await crearUsuarioDePrueba(creds, service, { email: 'aud-g4-tras-admin2@test.local', rol: 'admin' })).client;
  const op = await crearUsuarioDePrueba(creds, service, { email: 'aud-g4-tras-operario@test.local', rol: 'operario' });
  operario = op.client;
  operarioId = op.userId;

  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  cruce = await cruceFijo('AUD-G4-TRAS', 'traslado_destino', false);

  // Predio activo (el trigger auto-provisiona su sector), un sector inactivo
  // dentro de él, y un predio inactivo con su sector activo.
  predioActivo = await predioFijo('AUD-G4-predio-activo');
  sectorActivo = await sectorDe(predioActivo);
  const { data: s2 } = await service.from('sector').select('id').eq('predio_id', predioActivo).eq('nombre', 'AUD-G4-sector-inactivo').maybeSingle();
  if (s2) sectorInactivo = s2.id;
  else {
    const { data: nuevo, error: e2 } = await service.from('sector').insert({ predio_id: predioActivo, nombre: 'AUD-G4-sector-inactivo', activo: false }).select('id').single();
    if (e2 || !nuevo) throw new Error(`setup sector inactivo: ${e2?.message}`);
    sectorInactivo = nuevo.id;
  }
  sectorDePredioInactivo = await sectorDe(await predioFijo('AUD-G4-predio-inactivo', false));
}, 60_000);

afterAll(async () => {
  // El historial territorial no se borra por diseño: el cruce solo se archiva.
  const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: cruce, p_tipo: 'soft' });
  if (error) console.warn(`afterAll: no se pudo archivar ${cruce}: ${error.message}`);
  // Los individuos de los cruces fijos NO se borran: el código se genera con count(*)+1 por cruce, así que borrar
  // algunos dejaría huecos y el siguiente alta chocaría con un código existente (individuos_codigo_display_key).
}, 60_000);

describe('I06 registrar_traslado_individuo: permisos y validaciones de servidor', () => {
  it('el operario no puede registrar traslados (42501) aunque la UI o la API se lo pidan', async () => {
    const id = await individuo();
    const { error } = await operario.rpc('registrar_traslado_individuo', traslado(id, sectorActivo));
    expect(error?.code).toBe('42501');
    expect(await historial(id)).toHaveLength(0);
  });

  it('sector inactivo, predio inactivo, sector inexistente, individuo inexistente y fecha nula se rechazan con mensaje de negocio', async () => {
    const id = await individuo();
    expect((await admin.rpc('registrar_traslado_individuo', traslado(id, sectorInactivo))).error).toMatchObject({ code: '23514', message: expect.stringMatching(/sector está inactivo/) });
    expect((await admin.rpc('registrar_traslado_individuo', traslado(id, sectorDePredioInactivo))).error).toMatchObject({ code: '23514', message: expect.stringMatching(/predio está inactivo/) });
    expect((await admin.rpc('registrar_traslado_individuo', traslado(id, randomUUID()))).error?.code).toBe('P0002');
    expect((await admin.rpc('registrar_traslado_individuo', traslado(randomUUID(), sectorActivo))).error?.code).toBe('P0002');
    expect((await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, null as unknown as string))).error?.code).toBe('23502');
    expect(await historial(id)).toHaveLength(0);
  });

  it('un individuo muerto no se traslada (23514)', async () => {
    const id = await individuo();
    await operario.rpc('marcar_baja_individuo', { p_individuo_id: id, p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: null, p_fecha: '2026-10-20', p_idempotency_key: randomUUID() });
    const { error } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo));
    expect(error?.code).toBe('23514');
  });

  it('primer emplazamiento y traslado posterior: cierra el vigente con la fecha del nuevo, audita registro_emplazamiento y traslado_individuo', async () => {
    const id = await individuo();
    const { data: e1, error: err1 } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-01'));
    expect(err1).toBeNull();
    const sectorDestino = await sectorDe(await predioFijo('AUD-G4-predio-destino'));
    const { data: e2, error: err2 } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorDestino, '2026-10-15'));
    expect(err2).toBeNull();
    const h = await historial(id);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ id: e1, sector_id: sectorActivo, fecha_inicio: '2026-10-01', fecha_fin: '2026-10-15' });
    expect(h[1]).toMatchObject({ id: e2, sector_id: sectorDestino, fecha_inicio: '2026-10-15', fecha_fin: null });
    const { data: audit } = await service.from('audit_log').select('accion, detalle').eq('planta_id', cruce).eq('detalle->>individuo_id', id).in('accion', ['registro_emplazamiento', 'traslado_individuo']).order('ocurrido_en');
    expect(audit!.map((a) => a.accion)).toEqual(['registro_emplazamiento', 'traslado_individuo']);
    expect(audit![1].detalle).toMatchObject({ sector_anterior_id: sectorActivo, sector_nuevo_id: sectorDestino, emplazamiento_anterior_id: e1 });
  });

  it('una fecha anterior al emplazamiento vigente se rechaza (22007) y no toca el historial', async () => {
    const id = await individuo();
    await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-10'));
    const { error } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-05'));
    expect(error?.code).toBe('22007');
    expect(await historial(id)).toHaveLength(1);
  });

  // A1-G4-10: no hay idempotencia ni se rechaza el traslado al mismo sector.
  it.fails('A1-G4-10: un reenvío idéntico (mismo sector, misma fecha) no debe duplicar el historial (hoy crea un segundo registro y cierra el primero con duración cero)', async () => {
    const id = await individuo();
    const args = traslado(id, sectorActivo, '2026-10-12');
    expect((await admin.rpc('registrar_traslado_individuo', args)).error).toBeNull();
    const reintento = await admin.rpc('registrar_traslado_individuo', args);
    const h = await historial(id);
    expect(reintento.error !== null || h.length === 1).toBe(true);
  });

  it('(evidencia de A1-G4-10) el reenvío deja dos filas: la primera con fecha_inicio = fecha_fin', async () => {
    const id = await individuo();
    const args = traslado(id, sectorActivo, '2026-10-12');
    await admin.rpc('registrar_traslado_individuo', args);
    await admin.rpc('registrar_traslado_individuo', args);
    const h = await historial(id);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ fecha_inicio: '2026-10-12', fecha_fin: '2026-10-12' });
    expect(h[1]).toMatchObject({ fecha_inicio: '2026-10-12', fecha_fin: null });
  });

  it('dos admins registrando el primer emplazamiento del mismo individuo a la vez: nunca quedan dos vigentes (el índice parcial lo impide)', async () => {
    const id = await individuo();
    const [a, b] = await Promise.all([
      admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-20')),
      admin2.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-20')),
    ]);
    const h = await historial(id);
    expect(h.filter((e) => e.fecha_fin === null)).toHaveLength(1);
    const errores = [a.error, b.error].filter(Boolean);
    // O uno falló (23505 por el índice único, mensaje técnico) o el segundo
    // esperó el lock y cerró al primero: en ambos casos hay un solo vigente.
    if (errores.length === 1) expect(errores[0]!.code).toBe('23505');
    else expect(h).toHaveLength(2);
  });

  it('la RPC no valida la fase ni el archivado del cruce (el gate «traslado_destino» vive solo en la UI)', async () => {
    const otro = await cruceFijo('AUD-G4-TRAS-POL', 'polinizacion', true);
    const { data: ind } = await service.from('individuos').insert({ planta_id: otro, created_by: operarioId, codigo_display: '' }).select('id').single();
    const { error } = await admin.rpc('registrar_traslado_individuo', traslado(ind!.id, sectorActivo));
    expect(error).toBeNull();
  });
});

describe('I06 emplazamiento_individuo: append-only y coordenadas exactas', () => {
  it('nadie actualiza ni borra emplazamientos por la API (sin grants), y ni el service_role puede borrar (trigger)', async () => {
    const id = await individuo();
    const { data: emp } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-01'));
    expect((await admin.from('emplazamiento_individuo').update({ fecha_fin: '2026-10-02' }).eq('id', emp)).error?.code).toBe('42501');
    expect((await admin.from('emplazamiento_individuo').delete().eq('id', emp)).error?.code).toBe('42501');
    expect((await service.from('emplazamiento_individuo').delete().eq('id', emp)).error?.code).toBe('55000');
    // Reabrir un emplazamiento cerrado o cambiar sus datos también está vedado al service_role.
    expect((await service.from('emplazamiento_individuo').update({ sector_id: sectorInactivo }).eq('id', emp)).error?.code).toBe('55000');
    expect(await historial(id)).toHaveLength(1);
  });

  it('las coordenadas exactas las ve solo el admin; el operario ve el historial sin coordenadas y el mapa a nivel de predio', async () => {
    const id = await individuo();
    const { data: emp, error } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-01', { p_latitud: -35.4264, p_longitud: -71.6554, p_precision_metros: 3, p_ubicacion_exacta: 'Hilera 4, planta 12' }));
    expect(error).toBeNull();
    const { data: comoAdmin } = await admin.from('emplazamiento_coordenada').select('latitud, longitud, ubicacion_exacta').eq('emplazamiento_id', emp);
    expect(comoAdmin).toHaveLength(1);
    const { data: comoOperario, error: eOp } = await operario.from('emplazamiento_coordenada').select('latitud, longitud, ubicacion_exacta').eq('emplazamiento_id', emp);
    expect(eOp).toBeNull();
    expect(comoOperario).toHaveLength(0);
    const { data: embebido } = await operario.from('emplazamiento_individuo').select('id, emplazamiento_coordenada(latitud)').eq('id', emp).single();
    expect((embebido as { emplazamiento_coordenada: unknown }).emplazamiento_coordenada).toBeNull();
    const { data: mapa } = await operario.rpc('obtener_mapa_cruce', { p_planta_id: cruce });
    const texto = JSON.stringify(mapa);
    expect(texto).not.toContain('Hilera 4');
    expect(texto).not.toContain('-35.4264');
  });

  it('el operario no puede insertar coordenadas directo (sin grant de INSERT)', async () => {
    const id = await individuo();
    const { data: emp } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-01'));
    const { error } = await operario.from('emplazamiento_coordenada').insert({ emplazamiento_id: emp, latitud: -35, longitud: -71 });
    expect(error?.code).toBe('42501');
  });
});

describe('I06 carrera real, fechas y coordenadas por otras RPC', () => {
  // A1-G4-14: con un emplazamiento vigente, dos traslados que de verdad se
  // solapan hacen que el segundo reciba el error crudo del índice único
  // (23505, emplazamiento_individuo_un_activo) en vez de esperar o de recibir
  // un mensaje de negocio. La base queda íntegra (la transacción se revierte).
  // La carrera se fuerza con dos sesiones de psql (ver g4-helpers.ts).
  it.fails('A1-G4-14: dos traslados solapados del mismo individuo no deben terminar en un error crudo de índice único', async () => {
    const id = await individuo();
    expect((await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-01'))).error).toBeNull();
    const sectorB = await sectorDe(await predioFijo('AUD-G4-predio-carrera'));
    const llamada = (sector: string, fecha: string) => `select registrar_traslado_individuo('${id}', '${sector}', '${fecha}');`;
    const [r1, r2] = await solapar(
      { usuarioId: adminId, sentencia: llamada(sectorB, '2026-10-15') },
      { usuarioId: adminId, sentencia: llamada(sectorActivo, '2026-10-16') },
    );
    const h = await historial(id);
    // Invariante que sí se cumple hoy: nunca hay dos vigentes.
    expect(h.filter((e) => e.fecha_fin === null).length).toBeLessThanOrEqual(1);
    // Lo que debería pasar: ninguna de las dos sesiones termina en el error crudo.
    expect(r1.salida + r2.salida).not.toMatch(/emplazamiento_individuo_un_activo|duplicate key/);
  }, 30_000);

  // A1-G4-15: la fecha del traslado no se valida contra el presente ni contra
  // la individualización (solo contra el emplazamiento vigente).
  it.fails('A1-G4-15: rechaza una fecha de traslado futura (hoy se acepta)', async () => {
    const id = await individuo();
    const { error } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2031-01-01'));
    expect(error).not.toBeNull();
  });

  it.fails('A1-G4-15: rechaza una fecha anterior a la individualización del individuo (hoy se acepta)', async () => {
    const id = await individuo();
    const { error } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '1999-01-01'));
    expect(error).not.toBeNull();
  });

  it('consultar_mapa_viewport (la otra RPC que lee emplazamiento_coordenada) es solo para admin: el operario recibe 42501', async () => {
    const args = { p_latitud_minima: -90, p_latitud_maxima: 90, p_longitud_minima: -180, p_longitud_maxima: 180 };
    expect((await operario.rpc('consultar_mapa_viewport', args)).error?.code).toBe('42501');
    expect((await admin.rpc('consultar_mapa_viewport', args)).error).toBeNull();
    const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.rpc('consultar_mapa_viewport', args)).error).not.toBeNull();
  });

  it('el historial territorial es legible por cualquier autenticado (con quién lo registró) y un traslado sin coordenadas opcionales (lo que manda la UI) no crea fila en emplazamiento_coordenada', async () => {
    const id = await individuo();
    const { data: emp } = await admin.rpc('registrar_traslado_individuo', traslado(id, sectorActivo, '2026-10-02'));
    const { data } = await operario.from('emplazamiento_individuo').select('id, created_by').eq('id', emp).single();
    expect(data?.created_by).toBe(adminId);
    const { count } = await service.from('emplazamiento_coordenada').select('emplazamiento_id', { count: 'exact', head: true }).eq('emplazamiento_id', emp);
    expect(count).toBe(0);
  });
});
