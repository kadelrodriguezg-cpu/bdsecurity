/**
 * Auditoría integral, Corrida 1, grupo G3: flujo C13 (procedimientos: crear,
 * actualizar, reasignar) y sus tablas satélite.
 *
 * Complementa `tests/rls/rls.test.ts:2700-3040` (camino feliz, permisos básicos
 * y la regla de «exactamente un cruce» del objetivo por predio). Acá se cubre lo
 * que esa prueba no toca: escritura directa, RPC auxiliares, validaciones de
 * objetivos e insumos, idempotencia (carrera incluida), orden de estados,
 * auditoría con valores, cruces archivados, cierre cuando el contexto
 * multisitio desaparece y volumen.
 *
 * `it.fails` = hallazgo abierto (A1-G3-NN en el comentario).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba } from '../helpers';
import { auditoriasDe, crearContexto, limpiar, nuevoCruce, nuevoIndividuo, type Contexto } from './g3-setup';

let ctx: Contexto;
let insumoId: string;
let insumo2Id: string;
const insumos: string[] = [];

beforeAll(async () => {
  ctx = await crearContexto('proc');
  for (const n of [1, 2]) {
    const { data, error } = await ctx.admin.from('insumo').insert({ nombre: `AUD-G3 insumo ${ctx.R}-${n}`, tipo: 'otro' }).select('id').single();
    if (error || !data) throw new Error(`setup insumo: ${error?.message}`);
    insumos.push(data.id);
  }
  [insumoId, insumo2Id] = insumos;
}, 60_000);

afterAll(async () => {
  await limpiar(ctx);
  for (const id of insumos) await ctx.service.from('insumo').delete().eq('id', id);
});

const key = () => crypto.randomUUID();

/** crear_procedimiento con valores por defecto; registra el id para la limpieza. */
async function crear(cliente: SupabaseClient, cruceId: string, sobre: Record<string, unknown> = {}) {
  const r = await cliente.rpc('crear_procedimiento', {
    p_nombre: `AUD-G3 proc ${ctx.R}`, p_tipo: 'poda', p_fecha_inicio: '2026-10-01',
    p_objetivos: [{ tipo: 'cruzamiento', id: cruceId }], p_insumos: [], p_idempotency_key: key(),
    ...sobre,
  });
  if (r.data) ctx.procedimientos.push(r.data as string);
  return r;
}

async function actualizar(cliente: SupabaseClient, id: string, cruceId: string, sobre: Record<string, unknown> = {}) {
  return cliente.rpc('actualizar_procedimiento', {
    p_procedimiento_id: id, p_nombre: 'AUD-G3 editado', p_tipo: 'poda', p_estado: 'planificado', p_fecha_inicio: '2026-10-01',
    p_objetivos: [{ tipo: 'cruzamiento', id: cruceId }], p_insumos: [],
    ...sobre,
  });
}

async function fila(id: string) {
  const { data } = await ctx.service.from('procedimientos').select('*').eq('id', id).single();
  return data!;
}

async function nProcPorKey(k: string) {
  const { count } = await ctx.service.from('procedimientos').select('*', { count: 'exact', head: true }).eq('idempotency_key', k);
  return count ?? 0;
}

/** La consulta de frontend/src/api/procedimientos.ts:48-54, tal cual. */
async function listarComoLaApp(cliente: SupabaseClient, plantaId: string) {
  const { data, error } = await cliente
    .from('procedimiento_objetivos')
    .select('procedimiento:procedimiento_id(id, nombre, tipo, estado, fecha_inicio, fecha_fin, notas, responsable_id, created_by, objetivos:procedimiento_objetivos(tipo, planta_id, predio_id, individuo_id, nota, individuo:individuo_id(codigo_display), predio:predio_id(nombre)), insumos:procedimiento_insumos(insumo_id, cantidad, unidad))')
    .eq('tipo', 'cruzamiento')
    .eq('planta_id', plantaId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Cruce, individuos y predios FIJOS para la prueba del multisitio: el historial
 * territorial no se puede borrar por diseño (bloquear_borrado_emplazamiento),
 * así que se reutiliza el mismo cruce en cada corrida en vez de dejar uno nuevo.
 * Cada corrida lo deja en el estado inicial: un individuo en cada predio. Los traslados los hace
 * el usuario fijo `aud-g3-fixture@test.local` (el historial guarda created_by y bloquea el borrado
 * del usuario que lo escribió; así los usuarios de cada corrida sí se pueden borrar).
 */
async function fixtureMultisitio() {
  const fx = await crearUsuarioDePrueba(ctx.creds, ctx.service, { email: 'aud-g3-fixture@test.local', rol: 'admin' });
  const codigo = 'AUD-G3-FIJO-MULTISITIO';
  let { data: cruce } = await ctx.service.from('plantas').select('id').eq('codigo_sistema', codigo).maybeSingle();
  if (!cruce) {
    const r = await ctx.service.from('plantas').insert({ codigo_sistema: codigo, especie_id: ctx.especieId, estado: 'traslado_destino', es_prueba: true }).select('id').single();
    if (r.error) throw new Error(`fixture cruce: ${r.error.message}`);
    cruce = r.data;
  }
  const cruceId = cruce!.id as string;
  const { data: inds } = await ctx.service.from('individuos').select('id').eq('planta_id', cruceId).order('created_at');
  const ids = (inds ?? []).map((i) => i.id as string);
  while (ids.length < 2) {
    const r = await ctx.service.from('individuos').insert({ planta_id: cruceId, codigo_display: `${codigo}-P${ids.length + 1}`, created_by: fx.userId }).select('id').single();
    if (r.error) throw new Error(`fixture individuo: ${r.error.message}`);
    ids.push(r.data.id as string);
  }
  const predio = async (nombre: string) => {
    let { data: pr } = await ctx.service.from('predio').select('id').eq('nombre', nombre).maybeSingle();
    if (!pr) {
      const r = await ctx.service.from('predio').insert({ nombre }).select('id').single();
      if (r.error) throw new Error(`fixture predio: ${r.error.message}`);
      pr = r.data;
    }
    await ctx.service.from('predio').update({ activo: true }).eq('id', pr!.id);
    const { data: sec } = await ctx.service.from('sector').select('id').eq('predio_id', pr!.id).limit(1).single();
    return { predio: pr!.id as string, sector: sec!.id as string };
  };
  const A = await predio('AUD-G3 fijo predio A');
  const B = await predio('AUD-G3 fijo predio B');
  const hoy = new Date().toISOString().slice(0, 10);
  const vigente = async (ind: string) => {
    const { data } = await ctx.service.from('emplazamiento_individuo').select('sector_id').eq('individuo_id', ind).is('fecha_fin', null).maybeSingle();
    return data?.sector_id as string | undefined;
  };
  if ((await vigente(ids[0])) !== A.sector) {
    const r = await fx.client.rpc('registrar_traslado_individuo', { p_individuo_id: ids[0], p_sector_id: A.sector, p_fecha_inicio: hoy });
    if (r.error) throw new Error(`fixture traslado 1: ${r.error.message}`);
  }
  if ((await vigente(ids[1])) !== B.sector) {
    const r = await fx.client.rpc('registrar_traslado_individuo', { p_individuo_id: ids[1], p_sector_id: B.sector, p_fecha_inicio: hoy });
    if (r.error) throw new Error(`fixture traslado 2: ${r.error.message}`);
  }
  return { actor: fx.client, cruceId, ind1: ids[0], ind2: ids[1], predioA: A.predio, sectorA: A.sector, predioB: B.predio, sectorB: B.sector };
}

// --- Permisos y caminos directos -------------------------------------------------

describe('C13 · quién puede escribir y por dónde', () => {
  it('las cuatro tablas solo aceptan SELECT por la API; INSERT, UPDATE y DELETE directos se niegan a operario y admin', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    const specs: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
      ['procedimientos', 'id', { nombre: 'x', tipo: 'poda', fecha_inicio: '2026-10-01', responsable_id: ctx.opAId, created_by: ctx.opAId }, { nombre: 'x' }],
      ['procedimiento_objetivos', 'procedimiento_id', { procedimiento_id: p, tipo: 'cruzamiento', planta_id: id }, { nota: 'x' }],
      ['procedimiento_insumos', 'procedimiento_id', { procedimiento_id: p, insumo_id: insumoId, cantidad: 1 }, { cantidad: 9 }],
      ['procedimiento_reasignaciones', 'procedimiento_id', { procedimiento_id: p, responsable_anterior_id: ctx.opAId, responsable_nuevo_id: ctx.opBId, reasignado_por_id: ctx.adminId }, { motivo: 'x' }],
    ];
    for (const cliente of [ctx.opA, ctx.admin]) {
      for (const [tabla, col, carga, cambio] of specs) {
        const ins = await cliente.from(tabla).insert(carga);
        expect(ins.error?.code, `insert ${tabla}`).toBe('42501');
        const upd = await cliente.from(tabla).update(cambio).eq(col, p as string);
        expect(upd.error?.code, `update ${tabla}`).toBe('42501');
        const del = await cliente.from(tabla).delete().eq(col, p as string);
        expect(del.error?.code, `delete ${tabla}`).toBe('42501');
      }
    }
    expect((await fila(p as string)).nombre).toContain('AUD-G3 proc');
  });

  it('las RPC auxiliares (reemplazar_objetivos, reemplazar_insumos, procedimiento_planta_auditable) no se pueden llamar directamente; anon no llama a ninguna', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    for (const cliente of [ctx.opB, ctx.admin]) {
      expect((await cliente.rpc('reemplazar_objetivos_procedimiento', { p_procedimiento_id: p, p_objetivos: [{ tipo: 'cruzamiento', id }] })).error?.code).toBe('42501');
      expect((await cliente.rpc('reemplazar_insumos_procedimiento', { p_procedimiento_id: p, p_insumos: [] })).error?.code).toBe('42501');
      expect((await cliente.rpc('procedimiento_planta_auditable', { p_procedimiento_id: p })).error?.code).toBe('42501');
    }
    for (const [fn, args] of [
      ['crear_procedimiento', { p_nombre: 'x', p_tipo: 'poda', p_fecha_inicio: '2026-10-01', p_objetivos: [{ tipo: 'cruzamiento', id }] }],
      ['actualizar_procedimiento', { p_procedimiento_id: p, p_nombre: 'x', p_tipo: 'poda', p_estado: 'planificado', p_fecha_inicio: '2026-10-01', p_objetivos: [{ tipo: 'cruzamiento', id }] }],
      ['reasignar_procedimiento', { p_procedimiento_id: p, p_responsable_nuevo_id: ctx.opBId }],
      ['listar_predios_activos_cruzamiento', { p_planta_id: id }],
    ] as const) {
      expect((await ctx.anon.rpc(fn, args)).error?.code, fn).toBe('42501');
    }
  });

  it('el procedimiento de otro lo ve cualquier operario, pero lo edita solo su responsable (mientras esté planificado o en curso) o un admin', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    const pid = p as string;
    // B: ve, pero no edita
    const { data: vistoPorB } = await ctx.opB.from('procedimientos').select('id').eq('id', pid);
    expect(vistoPorB).toHaveLength(1);
    expect((await actualizar(ctx.opB, pid, id)).error?.code).toBe('42501');
    // A: edita en curso, no cierra
    expect((await actualizar(ctx.opA, pid, id, { p_estado: 'en_curso' })).error).toBeNull();
    expect((await actualizar(ctx.opA, pid, id, { p_estado: 'completado' })).error?.code).toBe('42501');
    expect((await actualizar(ctx.opA, pid, id, { p_estado: 'cancelado' })).error?.code).toBe('42501');
    // Admin cierra; después A ya no puede tocarlo
    expect((await actualizar(ctx.admin, pid, id, { p_estado: 'completado', p_fecha_fin: '2026-10-05' })).error).toBeNull();
    expect((await actualizar(ctx.opA, pid, id, { p_estado: 'en_curso' })).error?.code).toBe('42501');
    expect((await fila(pid)).estado).toBe('completado');
  });

  it('un procedimiento inexistente se informa como P0002 en actualizar y reasignar', async () => {
    const { id } = await nuevoCruce(ctx);
    expect((await actualizar(ctx.admin, crypto.randomUUID(), id)).error?.code).toBe('P0002');
    expect((await ctx.admin.rpc('reasignar_procedimiento', { p_procedimiento_id: crypto.randomUUID(), p_responsable_nuevo_id: ctx.opAId })).error?.code).toBe('P0002');
  });
});

// --- Reasignar ------------------------------------------------------------------------

describe('C13 · reasignar', () => {
  it('solo un admin reasigna; deja la fila de historial y la auditoría con de/a; el responsable anterior pierde la edición y no ve el historial', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    const pid = p as string;
    expect((await ctx.opA.rpc('reasignar_procedimiento', { p_procedimiento_id: pid, p_responsable_nuevo_id: ctx.opBId })).error?.code).toBe('42501');
    expect((await ctx.opB.rpc('reasignar_procedimiento', { p_procedimiento_id: pid, p_responsable_nuevo_id: ctx.opBId })).error?.code).toBe('42501');

    const { error } = await ctx.admin.rpc('reasignar_procedimiento', { p_procedimiento_id: pid, p_responsable_nuevo_id: ctx.opBId, p_motivo: '  cambio de turno  ' });
    expect(error).toBeNull();
    expect((await fila(pid)).responsable_id).toBe(ctx.opBId);
    const { data: hist } = await ctx.service.from('procedimiento_reasignaciones').select('*').eq('procedimiento_id', pid);
    expect(hist).toHaveLength(1);
    expect(hist![0]).toMatchObject({ responsable_anterior_id: ctx.opAId, responsable_nuevo_id: ctx.opBId, reasignado_por_id: ctx.adminId, motivo: 'cambio de turno' });
    const [a] = await auditoriasDe(ctx, id, 'reasignacion_procedimiento');
    expect(a.usuario_id).toBe(ctx.adminId);
    expect(a.detalle).toMatchObject({ procedimiento_id: pid, de_responsable_id: ctx.opAId, a_responsable_id: ctx.opBId });

    expect((await actualizar(ctx.opA, pid, id)).error?.code).toBe('42501'); // ya no es suyo
    expect((await actualizar(ctx.opB, pid, id, { p_estado: 'en_curso' })).error).toBeNull();
    const { data: ve } = await ctx.opA.from('procedimiento_reasignaciones').select('id').eq('procedimiento_id', pid);
    expect(ve).toHaveLength(0); // el historial solo lo lee un admin
  });

  it('reasignar al mismo responsable (23514) o a un perfil inexistente (23503) se rechaza; reasignar un procedimiento cerrado es posible', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    const pid = p as string;
    expect((await ctx.admin.rpc('reasignar_procedimiento', { p_procedimiento_id: pid, p_responsable_nuevo_id: ctx.opAId })).error?.code).toBe('23514');
    expect((await ctx.admin.rpc('reasignar_procedimiento', { p_procedimiento_id: pid, p_responsable_nuevo_id: crypto.randomUUID() })).error?.code).toBe('23503');
    await actualizar(ctx.admin, pid, id, { p_estado: 'cancelado' });
    expect((await ctx.admin.rpc('reasignar_procedimiento', { p_procedimiento_id: pid, p_responsable_nuevo_id: ctx.opBId })).error).toBeNull();
  });

  it('dos admins reasignando a la vez: el historial queda encadenado (el anterior del segundo es el nuevo del primero) gracias al FOR UPDATE', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    const pid = p as string;
    const [r1, r2] = await Promise.all([
      ctx.admin.rpc('reasignar_procedimiento', { p_procedimiento_id: pid, p_responsable_nuevo_id: ctx.opBId }),
      ctx.admin2.rpc('reasignar_procedimiento', { p_procedimiento_id: pid, p_responsable_nuevo_id: ctx.admin2Id }),
    ]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    const { data: hist } = await ctx.service.from('procedimiento_reasignaciones').select('responsable_anterior_id, responsable_nuevo_id, created_at').eq('procedimiento_id', pid).order('created_at');
    expect(hist).toHaveLength(2);
    expect(hist![0].responsable_anterior_id).toBe(ctx.opAId);
    expect(hist![1].responsable_anterior_id).toBe(hist![0].responsable_nuevo_id);
    expect((await fila(pid)).responsable_id).toBe(hist![1].responsable_nuevo_id);
  });
});

// --- Crear: responsable, objetivos, insumos -------------------------------------------

describe('C13 · crear: responsable, objetivos e insumos', () => {
  it('un operario solo puede crear procedimientos a su nombre; el admin puede asignar a otro; el responsable debe existir', async () => {
    const { id } = await nuevoCruce(ctx);
    expect((await crear(ctx.opA, id, { p_responsable_id: ctx.opBId })).error?.code).toBe('42501');
    const ok = await crear(ctx.admin, id, { p_responsable_id: ctx.opBId });
    expect(ok.error).toBeNull();
    expect((await fila(ok.data as string)).responsable_id).toBe(ctx.opBId);
    expect((await crear(ctx.admin, id, { p_responsable_id: crypto.randomUUID() })).error?.code).toBe('23503');
  });

  it('objetivos inválidos se rechazan sin dejar ninguna fila (la RPC es atómica) y con el código esperado', async () => {
    const cruce = await nuevoCruce(ctx);
    const archivado = await nuevoCruce(ctx, 'sin_empezar', { eliminado_at: new Date().toISOString() });
    const casos: Array<[string, unknown, string]> = [
      ['lista vacía', [], '23514'],
      ['no es lista', { tipo: 'cruzamiento', id: cruce.id }, '23514'],
      ['tipo fuera del enum', [{ tipo: 'inventado', id: cruce.id }], '22P02'],
      ['id que no es uuid', [{ tipo: 'cruzamiento', id: 'no-es-uuid' }], '22P02'],
      ['cruce inexistente', [{ tipo: 'cruzamiento', id: crypto.randomUUID() }], '23503'],
      ['cruce archivado', [{ tipo: 'cruzamiento', id: archivado.id }], '23503'],
      ['individuo inexistente', [{ tipo: 'cruzamiento', id: cruce.id }, { tipo: 'individuo', id: crypto.randomUUID() }], '23503'],
      ['predio inexistente', [{ tipo: 'cruzamiento', id: cruce.id }, { tipo: 'predio', id: crypto.randomUUID() }], '23503'],
      ['mismo cruce dos veces', [{ tipo: 'cruzamiento', id: cruce.id }, { tipo: 'cruzamiento', id: cruce.id }], '23505'],
    ];
    for (const [nombre, objetivos, codigo] of casos) {
      const k = key();
      const r = await ctx.opA.rpc('crear_procedimiento', { p_nombre: `AUD-G3 ${nombre}`, p_tipo: 'poda', p_fecha_inicio: '2026-10-01', p_objetivos: objetivos, p_insumos: [], p_idempotency_key: k });
      expect(r.error?.code, nombre).toBe(codigo);
      expect(await nProcPorKey(k), `${nombre}: sin fila parcial`).toBe(0);
    }
  });

  it('un procedimiento por predio sin contexto multisitio real se rechaza con mensaje de negocio', async () => {
    const cruce = await nuevoCruce(ctx);
    const { data: pr } = await ctx.service.from('predio').insert({ nombre: `AUD-G3 predio solo ${ctx.R}` }).select('id').single();
    try {
      const r = await crear(ctx.opA, cruce.id, { p_objetivos: [{ tipo: 'cruzamiento', id: cruce.id }, { tipo: 'predio', id: pr!.id }] });
      expect(r.error?.code).toBe('23514');
      expect(r.error?.message).toMatch(/multisitio/);
    } finally {
      await ctx.service.from('sector').delete().eq('predio_id', pr!.id);
      await ctx.service.from('predio').delete().eq('id', pr!.id);
    }
  });

  it('insumos: cantidad 0 o negativa (23514), insumo inexistente (23503) y el mismo insumo dos veces (23505) se rechazan; la unidad es texto libre', async () => {
    const { id } = await nuevoCruce(ctx);
    const ins = (o: Record<string, unknown>) => ({ p_tipo: 'fertilizacion', p_insumos: [o] });
    expect((await crear(ctx.opA, id, ins({ insumo_id: insumoId, cantidad: 0 }))).error?.code).toBe('23514');
    expect((await crear(ctx.opA, id, ins({ insumo_id: insumoId, cantidad: -3 }))).error?.code).toBe('23514');
    expect((await crear(ctx.opA, id, ins({ insumo_id: crypto.randomUUID(), cantidad: 1 }))).error?.code).toBe('23503');
    expect((await crear(ctx.opA, id, { p_insumos: [{ insumo_id: insumoId, cantidad: 1 }, { insumo_id: insumoId, cantidad: 2 }] })).error?.code).toBe('23505');
    expect((await crear(ctx.opA, id, { p_insumos: [{ insumo_id: insumoId, cantidad: null }] })).error?.code).toBe('23502');
    const ok = await crear(ctx.opA, id, { p_insumos: [{ insumo_id: insumoId, cantidad: 1.5, unidad: 'cualquier-cosa' }, { insumo_id: insumo2Id, cantidad: 2 }] });
    expect(ok.error).toBeNull();
    const { data } = await ctx.service.from('procedimiento_insumos').select('unidad').eq('procedimiento_id', ok.data as string);
    expect(data).toHaveLength(2);
  });

  it('nombre y tipo en blanco, o fecha de término anterior al inicio, se rechazan', async () => {
    const { id } = await nuevoCruce(ctx);
    expect((await crear(ctx.opA, id, { p_nombre: '   ' })).error?.code).toBe('23514');
    expect((await crear(ctx.opA, id, { p_tipo: ' ' })).error?.code).toBe('23514');
    expect((await crear(ctx.opA, id, { p_fecha_fin: '2026-09-01' })).error?.code).toBe('22007');
  });

  // A1-G3-24 (baja): la forma de los datos solo la valida la interfaz.
  it.fails('A1-G3-24: el servidor limita `tipo` a los tipos conocidos y las fechas a un rango razonable', async () => {
    const { id } = await nuevoCruce(ctx);
    const tipoLibre = await crear(ctx.opA, id, { p_tipo: 'cualquier cosa' });
    const fechaAntigua = await crear(ctx.opA, id, { p_fecha_inicio: '1900-01-01' });
    const fechaLejana = await crear(ctx.opA, id, { p_fecha_inicio: '2999-12-31' });
    expect(tipoLibre.error).toBeTruthy();
    expect(fechaAntigua.error).toBeTruthy();
    expect(fechaLejana.error).toBeTruthy();
  });

  // A1-G3-15 (media): objetivos incoherentes que la interfaz no puede producir.
  it.fails('A1-G3-15: un procedimiento exige un objetivo de cruce, y un individuo objetivo debe pertenecer a uno de los cruces objetivo', async () => {
    const x = await nuevoCruce(ctx);
    const y = await nuevoCruce(ctx);
    const indY = await nuevoIndividuo(ctx, y.id, y.codigo);
    // Individuo de Y colgado de un procedimiento «del cruce X»
    const cruzado = await crear(ctx.opA, x.id, { p_objetivos: [{ tipo: 'cruzamiento', id: x.id }, { tipo: 'individuo', id: indY }] });
    // Sin ningún objetivo de cruce: ninguna ficha lo lista (listarProcedimientos parte de los objetivos 'cruzamiento')
    const sinCruce = await crear(ctx.opA, x.id, { p_objetivos: [{ tipo: 'individuo', id: indY }] });
    expect(cruzado.error).toBeTruthy();
    expect(sinCruce.error).toBeTruthy();
  });

  it('(estado actual) esos procedimientos incoherentes se crean; el sin-cruce no aparece en la ficha de ningún cruce y su auditoría cuelga del cruce del individuo', async () => {
    const x = await nuevoCruce(ctx);
    const y = await nuevoCruce(ctx);
    const indY = await nuevoIndividuo(ctx, y.id, y.codigo);
    const sinCruce = await crear(ctx.opA, x.id, { p_objetivos: [{ tipo: 'individuo', id: indY }] });
    expect(sinCruce.error).toBeNull();
    expect(JSON.stringify(await listarComoLaApp(ctx.opA, x.id))).not.toContain(sinCruce.data as string);
    expect(JSON.stringify(await listarComoLaApp(ctx.opA, y.id))).not.toContain(sinCruce.data as string);
    expect((await auditoriasDe(ctx, y.id, 'creacion_procedimiento')).length).toBe(1);
    expect((await auditoriasDe(ctx, x.id, 'creacion_procedimiento')).length).toBe(0);
    // Un operario puede colgarle un procedimiento a un cruce cualquiera: aparece en la ficha de ese cruce para todos.
    const enOtro = await crear(ctx.opB, y.id);
    expect(enOtro.error).toBeNull();
    expect(JSON.stringify(await listarComoLaApp(ctx.opA, y.id))).toContain(enOtro.data as string);
  });
});

// --- Idempotencia ----------------------------------------------------------------------------

describe('C13 · idempotencia (reintentos con mala señal)', () => {
  it('la misma clave devuelve el mismo id y una sola fila, incluso con dos pedidos simultáneos', async () => {
    const { id } = await nuevoCruce(ctx);
    const k = key();
    const a = await crear(ctx.opA, id, { p_idempotency_key: k });
    const b = await crear(ctx.opA, id, { p_idempotency_key: k });
    expect(a.error).toBeNull();
    expect(b.data).toBe(a.data);
    const k2 = key();
    const [c, d] = await Promise.all([crear(ctx.opA, id, { p_idempotency_key: k2 }), crear(ctx.opA, id, { p_idempotency_key: k2 })]);
    expect(c.error).toBeNull();
    expect(d.error).toBeNull();
    expect(c.data).toBe(d.data);
    expect(await nProcPorKey(k2)).toBe(1);
    const { count } = await ctx.service.from('procedimiento_objetivos').select('*', { count: 'exact', head: true }).eq('procedimiento_id', c.data as string);
    expect(count).toBe(1);
  });

  it('la misma clave con otro contenido devuelve el procedimiento original sin aplicar el contenido nuevo; un intento fallido no consume la clave', async () => {
    const { id } = await nuevoCruce(ctx);
    const k = key();
    const falla = await crear(ctx.opA, id, { p_idempotency_key: k, p_objetivos: [] });
    expect(falla.error?.code).toBe('23514');
    const primero = await crear(ctx.opA, id, { p_idempotency_key: k, p_nombre: 'AUD-G3 primero' });
    expect(primero.error).toBeNull();
    const segundo = await crear(ctx.opA, id, { p_idempotency_key: k, p_nombre: 'AUD-G3 segundo' });
    expect(segundo.data).toBe(primero.data);
    expect((await fila(primero.data as string)).nombre).toBe('AUD-G3 primero');
  });

  it('sin clave cada llamada crea un procedimiento nuevo (la interfaz siempre manda una)', async () => {
    const { id } = await nuevoCruce(ctx);
    const a = await ctx.opA.rpc('crear_procedimiento', { p_nombre: 'AUD-G3 sin clave', p_tipo: 'poda', p_fecha_inicio: '2026-10-01', p_objetivos: [{ tipo: 'cruzamiento', id }] });
    const b = await ctx.opA.rpc('crear_procedimiento', { p_nombre: 'AUD-G3 sin clave', p_tipo: 'poda', p_fecha_inicio: '2026-10-01', p_objetivos: [{ tipo: 'cruzamiento', id }] });
    if (a.data) ctx.procedimientos.push(a.data as string);
    if (b.data) ctx.procedimientos.push(b.data as string);
    expect(a.data).not.toBe(b.data);
  });

  it('actualizar es idempotente por naturaleza (reemplaza objetivos e insumos completos): repetirlo no duplica nada', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id, { p_tipo: 'fertilizacion', p_insumos: [{ insumo_id: insumoId, cantidad: 1 }] });
    const args = { p_estado: 'en_curso', p_tipo: 'fertilizacion', p_insumos: [{ insumo_id: insumoId, cantidad: 2 }] };
    expect((await actualizar(ctx.opA, p as string, id, args)).error).toBeNull();
    expect((await actualizar(ctx.opA, p as string, id, args)).error).toBeNull();
    const { count } = await ctx.service.from('procedimiento_insumos').select('*', { count: 'exact', head: true }).eq('procedimiento_id', p as string);
    expect(count).toBe(1);
  });
});

// --- Estados y auditoría ----------------------------------------------------------------------

describe('C13 · orden de estados y auditoría', () => {
  // A1-G3-24 (baja): la máquina de estados vive en la interfaz.
  it.fails('A1-G3-24: un procedimiento completado o cancelado no se puede reabrir, y completarlo exige fecha de término', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    const pid = p as string;
    const sinFecha = await actualizar(ctx.admin, pid, id, { p_estado: 'completado' }); // sin fecha_fin
    const reabre = await actualizar(ctx.admin, pid, id, { p_estado: 'planificado' });
    expect(sinFecha.error).toBeTruthy();
    expect(reabre.error).toBeTruthy();
  });

  it('(estado actual) el admin completa sin fecha de término y reabre un completado a «planificado», conservando la fecha de término vieja', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    const pid = p as string;
    expect((await actualizar(ctx.admin, pid, id, { p_estado: 'completado', p_fecha_fin: '2026-10-09' })).error).toBeNull();
    expect((await actualizar(ctx.admin, pid, id, { p_estado: 'planificado', p_fecha_fin: '2026-10-09' })).error).toBeNull();
    expect(await fila(pid)).toMatchObject({ estado: 'planificado', fecha_fin: '2026-10-09' });
  });

  it('crear, editar y reasignar dejan fila de auditoría con autor y cruce', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    await actualizar(ctx.opA, p as string, id, { p_estado: 'en_curso' });
    const c = await auditoriasDe(ctx, id, 'creacion_procedimiento');
    const e = await auditoriasDe(ctx, id, 'edicion_procedimiento');
    expect(c).toHaveLength(1);
    expect(e).toHaveLength(1);
    expect(c[0].usuario_id).toBe(ctx.opAId);
    expect(e[0].usuario_id).toBe(ctx.opAId);
  });

  // A1-G3-12 (media): la edición no guarda valores anteriores ni nuevos.
  it.fails('A1-G3-12: la auditoría de una edición guarda los valores anteriores y nuevos (estado, nombre, fechas, objetivos, insumos)', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id, { p_nombre: 'AUD-G3 antes' });
    await actualizar(ctx.opA, p as string, id, { p_estado: 'en_curso', p_nombre: 'AUD-G3 despues' });
    const [e] = await auditoriasDe(ctx, id, 'edicion_procedimiento');
    const texto = JSON.stringify(e.detalle);
    expect(texto).toContain('AUD-G3 antes');
    expect(texto).toContain('AUD-G3 despues');
  });

  it('(estado actual) el detalle de la edición solo trae el id del procedimiento; campos_expuestos nombra columnas pero no sus valores', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    await actualizar(ctx.opA, p as string, id, { p_estado: 'en_curso' });
    const [e] = await auditoriasDe(ctx, id, 'edicion_procedimiento');
    expect(e.detalle).toEqual({ procedimiento_id: p });
    expect(e.campos_expuestos).toEqual(['nombre', 'tipo', 'estado']);
  });
});

// --- Cruces archivados y contexto multisitio ----------------------------------------------------

describe('C13 · el procedimiento y la vida del cruce', () => {
  // A1-G3-13 (media): actualizar siempre revalida los objetivos.
  it.fails('A1-G3-13: un procedimiento de un cruce archivado se puede cerrar o cancelar', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' });
    const r = await actualizar(ctx.admin, p as string, id, { p_estado: 'cancelado' });
    expect(r.error).toBeNull();
  });

  it('(estado actual) tras archivar el cruce, ni el responsable ni el admin pueden actualizar sus procedimientos (23503 «Cruce objetivo no encontrado»); al restaurar vuelve a funcionar', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data: p } = await crear(ctx.opA, id);
    await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' });
    for (const cliente of [ctx.opA, ctx.admin]) {
      const r = await actualizar(cliente, p as string, id, { p_estado: 'en_curso' });
      expect(r.error?.code).toBe('23503');
      expect(r.error?.message).toMatch(/Cruce objetivo no encontrado/);
    }
    await ctx.admin.rpc('restaurar_cruzamiento', { p_planta_id: id });
    expect((await actualizar(ctx.opA, p as string, id, { p_estado: 'en_curso' })).error).toBeNull();
  });

  // A1-G3-14 (media): cerrar un procedimiento por predio exige que el multisitio siga vigente.
  it.fails('A1-G3-14: un procedimiento por predio se puede cerrar aunque los individuos ya no estén repartidos en dos predios', async () => {
    const fx = await fixtureMultisitio();
    const hoy = new Date().toISOString().slice(0, 10);
    const objetivos = [{ tipo: 'cruzamiento', id: fx.cruceId }, { tipo: 'predio', id: fx.predioA }];
    const p = await crear(ctx.opA, fx.cruceId, { p_objetivos: objetivos, p_tipo: 'poda' });
    expect(p.error).toBeNull();
    // El segundo individuo se traslada al primer predio: ya no hay dos predios activos.
    expect((await fx.actor.rpc('registrar_traslado_individuo', { p_individuo_id: fx.ind2, p_sector_id: fx.sectorA, p_fecha_inicio: hoy })).error).toBeNull();
    const cierre = await actualizar(ctx.admin, p.data as string, fx.cruceId, { p_estado: 'completado', p_fecha_fin: hoy, p_objetivos: objetivos });
    expect(cierre.error).toBeNull();
  }, 60_000);

  it('las consultas de apoyo del formulario: predios activos del cruce y individuos de un predio objetivo', async () => {
    const { id } = await nuevoCruce(ctx);
    const { data, error } = await ctx.opA.rpc('listar_predios_activos_cruzamiento', { p_planta_id: id });
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: p } = await crear(ctx.opA, id);
    const r = await ctx.opA.rpc('listar_individuos_procedimiento_predio', { p_procedimiento_id: p, p_predio_id: crypto.randomUUID() });
    expect(r.error?.code).toBe('42501'); // el predio no es objetivo del procedimiento
  });
});

// --- Volumen ------------------------------------------------------------------------------------

describe('C13 · diez veces más datos', () => {
  it('100 procedimientos en un cruce: la consulta de la ficha los devuelve todos con sus objetivos e insumos, en menos de 5 s', async () => {
    const { id, codigo } = await nuevoCruce(ctx);
    const ind = await nuevoIndividuo(ctx, id, codigo);
    for (let i = 0; i < 100; i++) {
      const r = await crear(ctx.opA, id, {
        p_nombre: `AUD-G3 vol ${i}`, p_tipo: 'fertilizacion',
        p_objetivos: [{ tipo: 'cruzamiento', id }, { tipo: 'individuo', id: ind, nota: `n${i}` }],
        p_insumos: [{ insumo_id: insumoId, cantidad: 1 }],
      });
      expect(r.error, `proc ${i}`).toBeNull();
    }
    const t0 = Date.now();
    const lista = await listarComoLaApp(ctx.opB, id);
    const ms = Date.now() - t0;
    expect(lista).toHaveLength(100);
    expect(ms).toBeLessThan(5000);
    const primera = (lista[0] as { procedimiento: { objetivos: unknown[]; insumos: unknown[] } }).procedimiento;
    expect(primera.objetivos).toHaveLength(2);
    expect(primera.insumos).toHaveLength(1);
  }, 120_000);

  it('un procedimiento con 150 individuos como objetivos se crea y se actualiza sin cortes', async () => {
    const { id, codigo } = await nuevoCruce(ctx);
    const filas = Array.from({ length: 150 }, (_, i) => ({ planta_id: id, codigo_display: `${codigo}-X${i}`, created_by: ctx.adminId }));
    const { data: inds, error } = await ctx.service.from('individuos').insert(filas).select('id');
    expect(error).toBeNull();
    const objetivos = [{ tipo: 'cruzamiento', id }, ...inds!.map((i) => ({ tipo: 'individuo', id: i.id }))];
    const t0 = Date.now();
    const p = await crear(ctx.opA, id, { p_objetivos: objetivos });
    expect(p.error).toBeNull();
    expect((await actualizar(ctx.opA, p.data as string, id, { p_estado: 'en_curso', p_objetivos: objetivos })).error).toBeNull();
    expect(Date.now() - t0).toBeLessThan(10_000);
    const { count } = await ctx.service.from('procedimiento_objetivos').select('*', { count: 'exact', head: true }).eq('procedimiento_id', p.data as string);
    expect(count).toBe(151);
  }, 60_000);
});
