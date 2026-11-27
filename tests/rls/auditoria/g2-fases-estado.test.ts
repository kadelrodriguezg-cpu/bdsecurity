/**
 * Auditoría integral, Corrida 1, grupo G2: flujo C04 (avanzar, retroceder y
 * saltar fase) y la parte transversal del grupo: columnas de fase de
 * `plantas` con UPDATE concedido a cualquier autenticado.
 *
 * Complementa `tests/rls/guardia-orden-fases.test.ts` (B4), que ya cubre el
 * avance de una fase, los saltos y el retroceso con individuos. Acá se cubre
 * lo que esa prueba no toca: cruces archivados, clientes desactualizados
 * (carrera), avance a trasplante sin individuos, retroceso desde trasplante
 * con individuos, ida y vuelta de proceso_finalizado, dos usuarios a la vez,
 * fecha_cambio_estado y la ausencia de validación de fase en las columnas.
 *
 * `it.fails` = hallazgo abierto (A1-G2-NN en el comentario).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let admin2: SupabaseClient;
let operarioA: SupabaseClient;
let operarioAId: string;
let operarioB: SupabaseClient;
let especieId: string;
const plantasCreadas: string[] = [];
const usuariosCreados: string[] = [];

const R = Date.now();
let n = 0;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-fases-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client; adminId = ad.userId; usuariosCreados.push(adminId);
  const ad2 = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-fases-admin2-${R}@test.local`, rol: 'admin' });
  admin2 = ad2.client; usuariosCreados.push(ad2.userId);
  const a = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-fases-opa-${R}@test.local`, rol: 'operario' });
  operarioA = a.client; operarioAId = a.userId; usuariosCreados.push(operarioAId);
  const b = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-fases-opb-${R}@test.local`, rol: 'operario' });
  operarioB = b.client; usuariosCreados.push(b.userId);

  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').limit(1).single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;
}, 60_000);

afterAll(async () => {
  for (const id of plantasCreadas) {
    // Los cruces archivados en estas pruebas se desarchivan antes de purgar
    // (borrar_cruzamiento hard no exige eliminado_at nulo, pero por claridad).
    await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
  }
  for (const uid of usuariosCreados) {
    await service.auth.admin.deleteUser(uid);
  }
});

async function crearCruce(estado: string, opts: { conIndividuo?: boolean; archivado?: boolean } = {}): Promise<string> {
  const { data, error } = await service
    .from('plantas')
    .insert({
      codigo_sistema: `AUD-G2-FAS-${R}-${++n}`,
      especie_id: especieId,
      estado,
      es_prueba: true,
      eliminado_at: opts.archivado ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
  plantasCreadas.push(data.id);
  if (opts.conIndividuo) {
    const { error: eInd } = await service
      .from('individuos')
      .insert({ planta_id: data.id, codigo_display: `AUD-G2-FAS-${R}-${n}-P01`, created_by: adminId });
    if (eInd) throw new Error(`setup individuo: ${eInd.message}`);
  }
  return data.id;
}

/** Exactamente plantas.ts:203-214 (actualizarEstado): update por id, sin condición sobre el estado previo. */
function mover(cliente: SupabaseClient, plantaId: string, estado: string) {
  return cliente.from('plantas').update({ estado }).eq('id', plantaId).select('id, estado');
}

async function plantaDe(plantaId: string) {
  const { data } = await service.from('plantas').select('estado, fecha_cambio_estado, eliminado_at').eq('id', plantaId).single();
  return data!;
}

async function cambiosDeEstado(plantaId: string) {
  const { data } = await service
    .from('audit_log')
    .select('usuario_id, detalle, ocurrido_en')
    .eq('planta_id', plantaId)
    .eq('accion', 'cambio_estado')
    .order('ocurrido_en');
  return data ?? [];
}

describe('C04 fases: confirmaciones sobre la guardia B4 y la auditoría', () => {
  it('el admin avanza a trasplante (U-03: el operario ya no puede) y fecha_cambio_estado se mueve', async () => {
    const id = await crearCruce('germinacion');
    const antes = await plantaDe(id);
    expect((await mover(operarioA, id, 'trasplante')).error?.code).toBe('42501');
    const { error } = await mover(admin, id, 'trasplante');
    expect(error).toBeNull();
    const despues = await plantaDe(id);
    expect(despues.estado).toBe('trasplante');
    expect(new Date(despues.fecha_cambio_estado).getTime()).toBeGreaterThan(new Date(antes.fecha_cambio_estado).getTime());
  });

  it('operario NO retrocede de trasplante a germinación si ya hay individuos; el admin sí, y los individuos quedan colgando de un cruce en una fase anterior', async () => {
    const id = await crearCruce('trasplante', { conIndividuo: true });
    const { error: eOp } = await mover(operarioA, id, 'germinacion');
    expect(eOp?.code).toBe('42501');

    const { error: eAdmin } = await mover(admin, id, 'germinacion');
    expect(eAdmin).toBeNull();
    expect((await plantaDe(id)).estado).toBe('germinacion');
    const { count } = await service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', id);
    expect(count).toBe(1); // nadie los toca: siguen existiendo en un cruce que "todavía no llegó" a trasplante

    const audit = await cambiosDeEstado(id);
    expect(audit.at(-1)).toMatchObject({ usuario_id: adminId, detalle: { estado_anterior: 'trasplante', estado_nuevo: 'germinacion' } });
  });

  it('el admin llega a proceso_finalizado y vuelve una fase; el operario no puede ni avanzar ni volver (U-03)', async () => {
    const id = await crearCruce('traslado_destino');
    expect((await mover(operarioA, id, 'proceso_finalizado')).error?.code).toBe('42501');
    expect((await mover(admin, id, 'proceso_finalizado')).error).toBeNull();
    expect((await mover(operarioA, id, 'traslado_destino')).error?.code).toBe('42501');
    expect((await mover(admin, id, 'traslado_destino')).error).toBeNull();
    expect((await plantaDe(id)).estado).toBe('traslado_destino');

    const id2 = await crearCruce('proceso_finalizado', { conIndividuo: true });
    expect((await mover(operarioA, id2, 'traslado_destino')).error?.code).toBe('42501');
    expect((await mover(admin, id2, 'traslado_destino')).error).toBeNull();
  });

  it('dos admins avanzan el mismo cruce a la vez: ninguno recibe error, el estado queda en cosecha y hay un solo cambio_estado', async () => {
    const id = await crearCruce('polinizacion');
    const [ra, rb] = await Promise.all([mover(admin, id, 'cosecha'), mover(admin2, id, 'cosecha')]);
    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();
    expect(ra.data).toHaveLength(1);
    expect(rb.data).toHaveLength(1); // el segundo también "actualiza" (mismo valor), sin saber que ya estaba hecho
    expect((await plantaDe(id)).estado).toBe('cosecha');
    expect(await cambiosDeEstado(id)).toHaveLength(1);
  });

  it('anon no puede cambiar el estado', async () => {
    const creds = getLocalCreds();
    const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const id = await crearCruce('polinizacion');
    const { error } = await mover(anon, id, 'cosecha');
    expect(error).toBeTruthy();
    expect((await plantaDe(id)).estado).toBe('polinizacion');
  });
});

describe('C04 fases: cliente desactualizado (carrera entre dos usuarios)', () => {
  it('un admin con la ficha vieja "avanza" y en realidad retrocede el cruce que otro admin ya movió dos fases: la base lo acepta (A1-G2-03; desde U-03 solo entre admins)', async () => {
    const id = await crearCruce('polinizacion');
    // A avanza dos veces: polinizacion -> cosecha -> siembra_semilla.
    expect((await mover(admin, id, 'cosecha')).error).toBeNull();
    expect((await mover(admin, id, 'siembra_semilla')).error).toBeNull();

    // B sigue viendo "polinización" y pulsa «Avanzar a Cosecha»: AvanzarEstado.tsx:48
    // envía siguienteEstado(estadoViejo) = 'cosecha', sin condición sobre el estado actual.
    const { error, data } = await mover(admin2, id, 'cosecha');
    expect(error).toBeNull(); // para la base es siembra_semilla -> cosecha: un admin puede retroceder
    expect(data![0].estado).toBe('cosecha');
    expect((await plantaDe(id)).estado).toBe('cosecha'); // el trabajo de A quedó deshecho sin que nadie lo pidiera

    // Queda auditado (hay rastro), pero ninguno de los dos usuarios vio un aviso.
    const audit = await cambiosDeEstado(id);
    expect(audit.map((a) => a.detalle.estado_nuevo)).toEqual(['cosecha', 'siembra_semilla', 'cosecha']);
  });

  it('con una condición sobre el estado previo (compare-and-set), el mismo envío desactualizado no afecta nada: así debería escribir actualizarEstado', async () => {
    const id = await crearCruce('polinizacion');
    expect((await mover(admin, id, 'cosecha')).error).toBeNull();
    expect((await mover(admin, id, 'siembra_semilla')).error).toBeNull();
    const { error, data } = await admin2.from('plantas').update({ estado: 'cosecha' }).eq('id', id).eq('estado', 'polinizacion').select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(0); // 0 filas: el cliente puede avisar "la ficha cambió, recárgala"
    expect((await plantaDe(id)).estado).toBe('siembra_semilla');
  });
});

describe('C04 fases: cruces archivados (eliminado_at)', () => {
  // A1-G2-02: la policy plantas_update_autenticados no exige eliminado_at is null y
  // validar_orden_fases tampoco lo mira: un cruce archivado sigue avanzando de fase.
  it('un operario no puede cambiar la fase de un cruce archivado (A1-G2-02)', async () => {
    const id = await crearCruce('polinizacion', { archivado: true });
    const { data, error } = await mover(operarioA, id, 'cosecha');
    expect(error ?? (data && data.length === 0 ? new Error('0 filas') : null)).not.toBeNull();
    expect((await plantaDe(id)).estado).toBe('polinizacion');
  });

  it('el cambio sobre un cruce archivado se rechaza sin registrar un cambio_estado falso', async () => {
    const id = await crearCruce('polinizacion', { archivado: true });
    const { error } = await mover(operarioA, id, 'cosecha');
    expect(error?.code).toBe('55000');
    const p = await plantaDe(id);
    expect(p.estado).toBe('polinizacion');
    expect(p.eliminado_at).not.toBeNull();
    expect(await cambiosDeEstado(id)).toHaveLength(0);
  });
});

describe('Transversal G2: columnas de fase de plantas con UPDATE para cualquier autenticado', () => {
  // A1-G2-01 / A1-028: la base valida que la columna corresponda a una etapa ya alcanzada.
  it('la base rechaza fecha_cosecha/n_semillas en un cruce que está en polinización (A1-G2-01)', async () => {
    const id = await crearCruce('polinizacion');
    const { error } = await operarioA.from('plantas').update({ fecha_cosecha: '2026-10-01', n_semillas: 50 }).eq('id', id);
    expect(error?.code).toBe('55000');
  });

  it('la base rechaza datos de siembra (escarificación, semillas sembradas) en un cruce con proceso finalizado (A1-G2-01)', async () => {
    const id = await crearCruce('proceso_finalizado');
    const { error } = await operarioA
      .from('plantas')
      .update({ escarificacion_subtipo: 'estratificacion', escarificacion_duracion_dias: 30, semillas_sembradas: 10 })
      .eq('id', id);
    expect(error?.code).toBe('55000');
  });

  it('(estado actual) las escrituras de etapas ya alcanzadas se aceptan y auditar_escritura_fase las registra con anterior/nuevo y autor', async () => {
    const id = await crearCruce('cosecha');
    const { error } = await operarioA.from('plantas').update({ fecha_cosecha: '2026-10-01', n_semillas: 50, predio_id: null }).eq('id', id);
    expect(error).toBeNull();
    const { data: audit } = await service.from('audit_log').select('usuario_id, detalle, campos_expuestos').eq('planta_id', id).eq('accion', 'escritura_fase');
    expect(audit).toHaveLength(1);
    expect(audit![0].usuario_id).toBe(operarioAId);
    expect(audit![0].detalle.anterior.n_semillas).toBeNull();
    expect(audit![0].detalle.nuevo).toMatchObject({ fecha_cosecha: '2026-10-01', n_semillas: 50 });
    expect(audit![0].campos_expuestos).toEqual([
      'fecha_polinizacion', 'n_flores_cruzadas', 'fecha_cosecha', 'n_semillas',
      'escarificacion_subtipo', 'escarificacion_duracion_dias', 'contenedor_id', 'predio_id', 'semillas_sembradas',
    ]);
  });

  it('un UPDATE que no cambia ninguna columna de fase ni el estado no genera ruido en audit_log', async () => {
    const id = await crearCruce('cosecha');
    await operarioA.from('plantas').update({ n_semillas: 5 }).eq('id', id);
    const { error } = await operarioA.from('plantas').update({ n_semillas: 5 }).eq('id', id);
    expect(error).toBeNull();
    const { count } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('planta_id', id).eq('accion', 'escritura_fase');
    expect(count).toBe(1);
  });

  it('los CHECK de dominio sí se aplican en el servidor (negativos y duración sin estratificación)', async () => {
    const id = await crearCruce('siembra_semilla');
    const { error: e1 } = await operarioA.from('plantas').update({ semillas_sembradas: -1 }).eq('id', id);
    expect(e1?.code).toBe('23514');
    const { error: e2 } = await operarioA.from('plantas').update({ escarificacion_subtipo: 'fisica', escarificacion_duracion_dias: 3 }).eq('id', id);
    expect(e2?.code).toBe('23514');
  });

  it('el operario no puede tocar columnas sin grant de UPDATE (codigo_sistema, es_prueba, eliminado_at): 42501', async () => {
    const id = await crearCruce('polinizacion');
    const { error: e1 } = await operarioA.from('plantas').update({ codigo_sistema: 'X' }).eq('id', id);
    expect(e1?.code).toBe('42501');
    const { error: e2 } = await operarioA.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', id);
    expect(e2?.code).toBe('42501');
  });
});
