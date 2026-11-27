/**
 * Auditoría integral, Corrida 1, grupo G2: flujos C05 (cosecha), C06
 * (siembra) y C07 (germinación). Flujos sin uso real desde julio: se
 * simulan en local con usuarios propios (aud-g2-*).
 *
 * Reproducen las llamadas de `frontend/src/api/fases.ts` tal cual las hace
 * el cliente (sin transacción). `it.fails` = hallazgo abierto (A1-G2-NN).
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
let insumoIds: string[] = [];
let sustratoIds: string[] = [];
let contenedorId: string;
const plantasCreadas: string[] = [];
const usuariosCreados: string[] = [];
const catalogoCreado: { tabla: string; id: string }[] = [];

const R = Date.now();
let n = 0;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-csg-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client; adminId = ad.userId; usuariosCreados.push(adminId);
  const a = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-csg-opa-${R}@test.local`, rol: 'operario' });
  operarioA = a.client; operarioAId = a.userId; usuariosCreados.push(operarioAId);
  const b = await crearUsuarioDePrueba(creds, service, { email: `aud-g2-csg-opb-${R}@test.local`, rol: 'operario' });
  operarioB = b.client; operarioBId = b.userId; usuariosCreados.push(operarioBId);

  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').limit(1).single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;

  // Catálogo propio de la prueba (admin, como en la app).
  for (const i of [1, 2]) {
    const { data, error: e } = await admin.from('insumo').insert({ nombre: `AUD-G2 insumo ${R}-${i}`, tipo: 'otro' }).select('id').single();
    if (e || !data) throw new Error(`setup insumo: ${e?.message}`);
    insumoIds.push(data.id); catalogoCreado.push({ tabla: 'insumo', id: data.id });
  }
  for (const i of [1, 2]) {
    const { data, error: e } = await admin.from('sustrato').insert({ nombre: `AUD-G2 sustrato ${R}-${i}` }).select('id').single();
    if (e || !data) throw new Error(`setup sustrato: ${e?.message}`);
    sustratoIds.push(data.id); catalogoCreado.push({ tabla: 'sustrato', id: data.id });
  }
  const { data: cont, error: eCont } = await admin.from('contenedor').insert({ nombre: `AUD-G2 contenedor ${R}` }).select('id').single();
  if (eCont || !cont) throw new Error(`setup contenedor: ${eCont?.message}`);
  contenedorId = cont.id; catalogoCreado.push({ tabla: 'contenedor', id: cont.id });
}, 60_000);

afterAll(async () => {
  for (const id of plantasCreadas) {
    await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
  }
  for (const c of catalogoCreado) {
    await service.from(c.tabla).delete().eq('id', c.id);
  }
  for (const uid of usuariosCreados) {
    await service.auth.admin.deleteUser(uid);
  }
});

async function crearCruce(estado: string): Promise<string> {
  const { data, error } = await service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-G2-CSG-${R}-${++n}`, especie_id: especieId, estado, es_prueba: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
  plantasCreadas.push(data.id);
  return data.id;
}

async function auditoriasDe(plantaId: string, accion?: string) {
  let q = service.from('audit_log').select('accion, usuario_id, detalle').eq('planta_id', plantaId);
  if (accion) q = q.eq('accion', accion);
  const { data } = await q;
  return data ?? [];
}

// --- C05 Cosecha -------------------------------------------------------------

/** fases.ts:254-261 (agregarCosechaFruto): numero_fruto 0 como placeholder que el trigger pisa. */
function agregarFruto(cliente: SupabaseClient, plantaId: string, uid: string, semillas: number) {
  return cliente
    .from('cosecha_fruto')
    .insert({ planta_id: plantaId, cantidad_semillas: semillas, created_by: uid, numero_fruto: 0 })
    .select('id, numero_fruto, cantidad_semillas')
    .single();
}

async function frutosDe(plantaId: string) {
  const { data } = await service.from('cosecha_fruto').select('id, numero_fruto, cantidad_semillas, created_by').eq('planta_id', plantaId).order('numero_fruto');
  return data ?? [];
}

describe('C05 cosecha: numeración, concurrencia, quién borra, agregado', () => {
  it('cinco inserciones simultáneas reciben números 1..5 distintos (advisory lock del trigger)', async () => {
    const id = await crearCruce('cosecha');
    const resultados = await Promise.all([1, 2, 3, 4, 5].map((s) => agregarFruto(operarioA, id, operarioAId, s)));
    for (const r of resultados) expect(r.error).toBeNull();
    const numeros = resultados.map((r) => r.data!.numero_fruto).sort();
    expect(numeros).toEqual([1, 2, 3, 4, 5]);
  });

  // A1-030: max(numero_fruto)+1 conserva el correlativo aunque haya huecos.
  it('tras borrar un fruto intermedio (permitido por RLS al autor o admin), se puede seguir agregando frutos (A1-G2-07)', async () => {
    const id = await crearCruce('cosecha');
    await agregarFruto(operarioA, id, operarioAId, 10);
    const { data: f2 } = await agregarFruto(operarioA, id, operarioAId, 20);
    await agregarFruto(operarioA, id, operarioAId, 30);
    const { error: eDel } = await operarioA.from('cosecha_fruto').delete().eq('id', f2!.id);
    expect(eDel).toBeNull();
    const { error } = await agregarFruto(operarioA, id, operarioAId, 40);
    expect(error).toBeNull();
    expect((await frutosDe(id)).map((f) => f.numero_fruto)).toEqual([1, 3, 4]);
  });

  it('operario y admin pueden agregar frutos después de un borrado intermedio sin renumerar los anteriores', async () => {
    const id = await crearCruce('cosecha');
    await agregarFruto(operarioA, id, operarioAId, 10);
    const { data: f2 } = await agregarFruto(operarioA, id, operarioAId, 20);
    await agregarFruto(operarioA, id, operarioAId, 30);
    await operarioA.from('cosecha_fruto').delete().eq('id', f2!.id);
    const { error } = await agregarFruto(operarioA, id, operarioAId, 40);
    expect(error).toBeNull();
    const { error: eAdmin } = await agregarFruto(admin, id, adminId, 40);
    expect(eAdmin).toBeNull();
    expect((await frutosDe(id)).map(f => f.numero_fruto)).toEqual([1, 3, 4, 5]);
  });

  it('A1-030: inserciones simultáneas tras un hueco reciben los siguientes números distintos', async () => {
    const id = await crearCruce('cosecha');
    await agregarFruto(operarioA, id, operarioAId, 10);
    const medio = await agregarFruto(operarioA, id, operarioAId, 20);
    await agregarFruto(operarioA, id, operarioAId, 30);
    expect((await operarioA.from('cosecha_fruto').delete().eq('id', medio.data!.id)).error).toBeNull();
    const nuevos = await Promise.all([1, 2, 3].map(() => agregarFruto(operarioA, id, operarioAId, 40)));
    for (const r of nuevos) expect(r.error).toBeNull();
    expect(nuevos.map(r => r.data!.numero_fruto).sort()).toEqual([4, 5, 6]);
    expect((await frutosDe(id)).map(f => f.numero_fruto)).toEqual([1, 3, 4, 5, 6]);
  });

  it('"Quitar último" cuando el último fruto es de otro operario: sin error, sin borrado, sin auditoría (A1-G2-04)', async () => {
    const id = await crearCruce('cosecha');
    await agregarFruto(operarioA, id, operarioAId, 10);
    const { data: deB } = await agregarFruto(operarioB, id, operarioBId, 20);
    // fases.ts:268 (quitarCosechaFruto)
    const { error } = await operarioA.from('cosecha_fruto').delete().eq('id', deB!.id);
    expect(error).toBeNull();
    expect(await frutosDe(id)).toHaveLength(2);
    expect(await auditoriasDe(id, 'eliminacion_cosecha_fruto')).toHaveLength(0);
  });

  it('plantas.n_semillas es un dato aparte: no se recalcula desde cosecha_fruto y puede contradecir la suma de frutos', async () => {
    const id = await crearCruce('cosecha');
    await agregarFruto(operarioA, id, operarioAId, 10);
    await agregarFruto(operarioA, id, operarioAId, 7);
    const { data: p0 } = await service.from('plantas').select('n_semillas').eq('id', id).single();
    expect(p0!.n_semillas).toBeNull();
    // fases.ts:224-229 (actualizarCosecha): el total lo tipea el usuario.
    const { error } = await operarioA.from('plantas').update({ fecha_cosecha: '2026-10-01', n_semillas: 999 }).eq('id', id);
    expect(error).toBeNull();
    const { data: p1 } = await service.from('plantas').select('n_semillas').eq('id', id).single();
    expect(p1!.n_semillas).toBe(999); // 999 != 17
  });

  it('insert y delete de frutos quedan auditados con autor, numero_fruto y cantidad', async () => {
    const id = await crearCruce('cosecha');
    const { data: f } = await agregarFruto(operarioA, id, operarioAId, 12);
    await operarioA.from('cosecha_fruto').delete().eq('id', f!.id);
    const audit = (await auditoriasDe(id)).filter((a) => a.accion !== 'alta_cruce');
    expect(audit.map((a) => a.accion).sort()).toEqual(['creacion_cosecha_fruto', 'eliminacion_cosecha_fruto']);
    for (const a of audit) {
      expect(a.usuario_id).toBe(operarioAId);
      expect(a.detalle).toMatchObject({ fruto_id: f!.id, numero_fruto: 1, cantidad_semillas: 12 });
    }
  });
});

// --- C06 Siembra -------------------------------------------------------------

describe('C06 siembra: cuatro llamadas sin transacción, insumos/sustratos sin dueño ni auditoría', () => {
  /** Deja un cruce con siembra completa guardada "ayer" por A: columnas + 2 insumos + 2 sustratos. */
  async function siembraPrevia(): Promise<string> {
    const id = await crearCruce('siembra_semilla');
    const { error: e1 } = await operarioA
      .from('plantas')
      .update({ escarificacion_subtipo: 'quimica', escarificacion_duracion_dias: null, contenedor_id: contenedorId, semillas_sembradas: 100 })
      .eq('id', id);
    expect(e1).toBeNull();
    const { error: e2 } = await operarioA.from('plantas_insumo').insert(insumoIds.map((insumo_id) => ({ planta_id: id, insumo_id })));
    expect(e2).toBeNull();
    const { error: e3 } = await operarioA.from('plantas_sustrato').insert(sustratoIds.map((sustrato_id, i) => ({ planta_id: id, sustrato_id, porcentaje: i === 0 ? 60 : 40 })));
    expect(e3).toBeNull();
    return id;
  }

  it('si falla la tercera llamada (insert de insumos), el cruce queda con las columnas nuevas, SIN insumos y con los sustratos viejos (A1-G2-08)', async () => {
    const id = await siembraPrevia();

    // Resiembra de A: fases.ts:299-320, paso a paso.
    const { error: e1 } = await operarioA.from('plantas').update({ escarificacion_subtipo: 'fisica', semillas_sembradas: 50, contenedor_id: contenedorId }).eq('id', id);
    expect(e1).toBeNull();
    const { error: e2 } = await operarioA.from('plantas_insumo').delete().eq('planta_id', id);
    expect(e2).toBeNull();
    // Tercera llamada falla (acá: FK inválida; en terreno: pérdida de señal).
    const { error: e3 } = await operarioA.from('plantas_insumo').insert([{ planta_id: id, insumo_id: '00000000-0000-0000-0000-000000000000' }]);
    expect(e3).not.toBeNull();
    // fases.ts:309 lanza y no sigue: no se tocan sustratos ni se escribe historial.

    const { data: p } = await service.from('plantas').select('escarificacion_subtipo, semillas_sembradas').eq('id', id).single();
    expect(p).toEqual({ escarificacion_subtipo: 'fisica', semillas_sembradas: 50 }); // nuevo
    const { data: ins } = await service.from('plantas_insumo').select('insumo_id').eq('planta_id', id);
    expect(ins).toHaveLength(0); // perdidos: ni los viejos ni los nuevos
    const { data: sus } = await service.from('plantas_sustrato').select('porcentaje').eq('planta_id', id);
    expect(sus).toHaveLength(2); // viejos
    const { data: hist } = await service.from('registros_evento').select('id').eq('planta_id', id).eq('tipo_evento', 'siembra_semilla');
    expect(hist).toHaveLength(0); // y el historial no sabe nada de la resiembra
  });

  it('otro operario puede borrar e insertar los insumos y sustratos de un cruce que no tocó (no hay dueño de fila: por diseño)', async () => {
    const id = await siembraPrevia();
    const { error: eDel } = await operarioB.from('plantas_insumo').delete().eq('planta_id', id);
    expect(eDel).toBeNull();
    const { data: ins } = await service.from('plantas_insumo').select('insumo_id').eq('planta_id', id);
    expect(ins).toHaveLength(0);
    const { error: eDel2 } = await operarioB.from('plantas_sustrato').delete().eq('planta_id', id);
    expect(eDel2).toBeNull();
    const { error: eIns } = await operarioB.from('plantas_sustrato').insert({ planta_id: id, sustrato_id: sustratoIds[0], porcentaje: 100 });
    expect(eIns).toBeNull();
  });

  // A1-022: auditoría transaccional de ambas junctions.
  it('borrar e insertar insumos/sustratos deja rastro en audit_log con autor (A1-G2-09)', async () => {
    const id = await siembraPrevia();
    const antes = (await auditoriasDe(id)).length;
    await operarioB.from('plantas_insumo').delete().eq('planta_id', id);
    await operarioB.from('plantas_sustrato').delete().eq('planta_id', id);
    await operarioB.from('plantas_insumo').insert({ planta_id: id, insumo_id: insumoIds[0] });
    const despues = (await auditoriasDe(id)).length;
    expect(despues).toBeGreaterThan(antes);
    const cambios = (await auditoriasDe(id, 'cambio_material_siembra')).filter(a => a.usuario_id === operarioBId);
    expect(cambios).toHaveLength(5);
    expect(cambios.filter(a => a.detalle.operacion === 'DELETE')).toHaveLength(4);
    expect(cambios.find(a => a.detalle.operacion === 'INSERT')!.detalle).toMatchObject({
      tabla: 'plantas_insumo', planta_id: id, anterior: null, nuevo: { planta_id: id, insumo_id: insumoIds[0] },
    });
    expect(cambios.filter(a => a.detalle.tabla === 'plantas_sustrato').map(a => a.detalle.anterior.porcentaje).sort()).toEqual([40, 60]);
  });

  it('una inserción múltiple rechazada no deja materiales ni auditorías parciales (A1-022)', async () => {
    const id = await crearCruce('siembra_semilla');
    const respuesta = await operarioA.from('plantas_insumo').insert([
      { planta_id: id, insumo_id: insumoIds[0] },
      { planta_id: id, insumo_id: '00000000-0000-0000-0000-000000000000' },
    ]);
    expect(respuesta.error?.code).toBe('23503');
    expect((await auditoriasDe(id, 'cambio_material_siembra'))).toHaveLength(0);
    const filas = await service.from('plantas_insumo').select('insumo_id').eq('planta_id', id);
    expect(filas.error).toBeNull();
    expect(filas.data).toHaveLength(0);
  });

  it('auditar_escritura_fase cubre las 9 columnas de fase, incluida semillas_sembradas, con anterior y nuevo', async () => {
    const id = await crearCruce('siembra_semilla');
    const { error } = await operarioA
      .from('plantas')
      .update({ escarificacion_subtipo: 'estratificacion', escarificacion_duracion_dias: 21, contenedor_id: contenedorId, semillas_sembradas: 80 })
      .eq('id', id);
    expect(error).toBeNull();
    const audit = await auditoriasDe(id, 'escritura_fase');
    expect(audit).toHaveLength(1);
    expect(audit[0].usuario_id).toBe(operarioAId);
    expect(audit[0].detalle.anterior).toMatchObject({ escarificacion_subtipo: null, semillas_sembradas: null, contenedor_id: null });
    expect(audit[0].detalle.nuevo).toMatchObject({ escarificacion_subtipo: 'estratificacion', escarificacion_duracion_dias: 21, semillas_sembradas: 80, contenedor_id: contenedorId });
  });

  it('la suma de porcentajes de sustrato no se valida (puede superar 100): documentado como decisión en la migración', async () => {
    const id = await crearCruce('siembra_semilla');
    const { error } = await operarioA.from('plantas_sustrato').insert([
      { planta_id: id, sustrato_id: sustratoIds[0], porcentaje: 90 },
      { planta_id: id, sustrato_id: sustratoIds[1], porcentaje: 90 },
    ]);
    expect(error).toBeNull();
  });

  // A1-G2-10: reiniciar_cruzamiento limpia las columnas de fase y plantas_insumo,
  // pero no semillas_sembradas ni plantas_sustrato (ambas llegaron después, 20260718000000).
  it.fails('reiniciar_cruzamiento también limpia semillas_sembradas y los sustratos (A1-G2-10)', async () => {
    const id = await siembraPrevia();
    const { error } = await admin.rpc('reiniciar_cruzamiento', { p_planta_id: id });
    expect(error).toBeNull();
    const { data: p } = await service.from('plantas').select('estado, semillas_sembradas, escarificacion_subtipo').eq('id', id).single();
    expect(p!.estado).toBe('sin_empezar');
    expect(p!.escarificacion_subtipo).toBeNull();
    expect(p!.semillas_sembradas).toBeNull();
    const { data: sus } = await service.from('plantas_sustrato').select('sustrato_id').eq('planta_id', id);
    expect(sus).toHaveLength(0);
  });
});

// --- C07 Germinación ---------------------------------------------------------

function registrarGerminacion(cliente: SupabaseClient, plantaId: string, uid: string, fecha: string, cantidad: number) {
  return cliente
    .from('germinacion_evento')
    .insert({ planta_id: plantaId, fecha, cantidad_nueva: cantidad, created_by: uid })
    .select('id, fecha, cantidad_nueva')
    .single();
}

describe('C07 germinación: alta auditada, sin corrección posible', () => {
  it('operario registra un evento a su nombre y queda auditado', async () => {
    const id = await crearCruce('germinacion');
    const { data, error } = await registrarGerminacion(operarioA, id, operarioAId, '2026-10-01', 15);
    expect(error).toBeNull();
    const audit = await auditoriasDe(id, 'creacion_evento_germinacion');
    expect(audit).toHaveLength(1);
    expect(audit[0].usuario_id).toBe(operarioAId);
    expect(audit[0].detalle).toMatchObject({ evento_id: data!.id, fecha: '2026-10-01', cantidad_nueva: 15 });
  });

  it('un error de tipeo (150 en vez de 15) no lo puede corregir ni el autor ni el admin: sin UPDATE ni DELETE (A1-G2-11)', async () => {
    const id = await crearCruce('germinacion');
    const { data } = await registrarGerminacion(operarioA, id, operarioAId, '2026-10-02', 150);
    const { error: eUpd } = await operarioA.from('germinacion_evento').update({ cantidad_nueva: 15 }).eq('id', data!.id);
    expect(eUpd?.code).toBe('42501');
    const { error: eDel } = await operarioA.from('germinacion_evento').delete().eq('id', data!.id);
    expect(eDel?.code).toBe('42501');
    const { error: eUpdAdmin } = await admin.from('germinacion_evento').update({ cantidad_nueva: 15 }).eq('id', data!.id);
    expect(eUpdAdmin?.code).toBe('42501');
    const { error: eDelAdmin } = await admin.from('germinacion_evento').delete().eq('id', data!.id);
    expect(eDelAdmin?.code).toBe('42501');
    const { data: sigue } = await service.from('germinacion_evento').select('cantidad_nueva').eq('id', data!.id).single();
    expect(sigue!.cantidad_nueva).toBe(150);
  });

  it('un reintento del mismo envío duplica el evento (sin idempotency_key; mismo patrón que A1-G2-05)', async () => {
    const id = await crearCruce('germinacion');
    const [r1, r2] = await Promise.all([
      registrarGerminacion(operarioA, id, operarioAId, '2026-10-03', 9),
      registrarGerminacion(operarioA, id, operarioAId, '2026-10-03', 9),
    ]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    const { data } = await service.from('germinacion_evento').select('id').eq('planta_id', id);
    expect(data).toHaveLength(2);
  });

  it('la base rechaza germinación anticipada en polinización (A1-G2-01)', async () => {
    const id = await crearCruce('polinizacion');
    const { error } = await registrarGerminacion(operarioA, id, operarioAId, '2026-10-04', 1);
    expect(error?.code).toBe('55000');
  });
});
