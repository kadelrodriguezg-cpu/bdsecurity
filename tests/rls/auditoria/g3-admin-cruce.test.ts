/**
 * Auditoría integral, Corrida 1, grupo G3: flujo C11 (administrar un cruce:
 * reiniciar, archivar, borrar de prueba, restaurar).
 *
 * Complementa `tests/rls/purga-cruce-prueba.test.ts` (puertas del hard delete y
 * cero huérfanos en tablas) y `tests/rls/rls.test.ts:1200` (permisos básicos).
 * Acá se cubre lo que esas pruebas no tocan: qué conserva y qué destruye
 * `reiniciar_cruzamiento`, qué contiene el snapshot de `audit_log`, los
 * binarios de Storage, el borrado físico directo de `plantas` (sin RPC), el
 * archivado con trabajo abierto, la restauración y las carreras entre dos admins.
 *
 * `it.fails` = hallazgo abierto (A1-G3-NN en el comentario).
 */
import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearUsuarioDePrueba } from '../helpers';
import {
  BUCKET, JPEG_1X1, auditoriasDe, crearContexto, existeObjeto, limpiar, nuevoCruce, nuevoIndividuo, subirObjeto,
  type Contexto,
} from './g3-setup';

let ctx: Contexto;
let insumoId: string;
const NOTA = () => `NOTA-AUD-G3-${ctx.R}`;
const LINAJE = () => `LINAJE-SECRETO-AUD-G3-${ctx.R}`;
const insumosCreados: string[] = [];

beforeAll(async () => {
  ctx = await crearContexto('adm');
  const { data, error } = await ctx.admin.from('insumo').insert({ nombre: `AUD-G3 insumo ${ctx.R}`, tipo: 'otro' }).select('id').single();
  if (error || !data) throw new Error(`setup insumo: ${error?.message}`);
  insumoId = data.id;
  insumosCreados.push(data.id);
}, 60_000);

afterAll(async () => {
  await limpiar(ctx);
  for (const id of insumosCreados) await ctx.service.from('insumo').delete().eq('id', id);
});

/**
 * Cruce con todo lo que la fase de campo puede colgarle: bitácora (con nota y
 * foto real en Storage), sesión de polinización, fruto, germinación, insumo,
 * un individuo con ronda y evaluaciones, un procedimiento y un snapshot.
 */
async function cruceCompleto(opts: { evaluacionCompleta?: boolean; estado?: string } = {}) {
  const { id, codigo } = await nuevoCruce(ctx, opts.estado ?? 'evaluacion_anual', {
    cruzamiento: LINAJE(), mama: `MAMA-${LINAJE()}`, papa: `PAPA-${LINAJE()}`,
    fecha_polinizacion: '2026-08-01', n_flores_cruzadas: 40, fecha_cosecha: '2026-09-01', n_semillas: 100,
  });
  const { data: ev1, error: e1 } = await ctx.opA.from('registros_evento')
    .insert({ planta_id: id, tipo_evento: 'polinizacion', fecha: '2026-08-01', datos: { n_flores_cruzadas: 40 }, notas: NOTA(), created_by: ctx.opAId })
    .select('id').single();
  if (e1) throw new Error(`setup evento: ${e1.message}`);
  await ctx.admin.from('registros_evento').insert({ planta_id: id, tipo_evento: 'otro', fecha: '2026-08-02', datos: {}, notas: 'segunda', created_by: ctx.adminId });
  const path = `plantas/${codigo}/${crypto.randomUUID()}/foto.jpg`;
  const up = await subirObjeto(ctx, ctx.opA, path, JPEG_1X1, 'image/jpeg');
  if (up.error) throw new Error(`setup upload: ${up.error.message}`);
  const { error: eArch } = await ctx.opA.from('evento_archivos').insert({ registro_id: ev1!.id, storage_path: path, tipo: 'foto', created_by: ctx.opAId });
  if (eArch) throw new Error(`setup archivo: ${eArch.message}`);
  await ctx.opA.from('polinizacion_evento').insert({ planta_id: id, fecha: '2026-08-01', n_flores_cruzadas: 40, created_by: ctx.opAId });
  await ctx.opA.from('cosecha_fruto').insert({ planta_id: id, cantidad_semillas: 12, created_by: ctx.opAId, numero_fruto: 0 });
  await ctx.opA.from('germinacion_evento').insert({ planta_id: id, fecha: '2026-09-10', cantidad_nueva: 5, created_by: ctx.opAId });
  await ctx.opA.from('plantas_insumo').insert({ planta_id: id, insumo_id: insumoId });

  const indId = await nuevoIndividuo(ctx, id, codigo);
  const { data: ronda, error: eR } = await ctx.service.from('ronda_evaluacion_anual')
    .insert({ individuo_id: indId, numero_ronda: 1, anio: 2026, created_by: ctx.adminId }).select('id').single();
  if (eR || !ronda) throw new Error(`setup ronda: ${eR?.message}`);
  const metricas = {
    brotacion: 1, floracion: 1, cuaja: 1, concentracion_cosecha: 1, calibre_mm: 18, firmeza: 1, color: 1,
    bloom: 1, brix: 12, rend_kg_planta: 1, rend_t_ha: 1, pct_fruta_exportable: 50, dano_calor: 1, golpe_sol: 1,
    caida_fruto: 1, cantidad_frutos: 5, peso_total_g: 50,
  };
  const evalIds: string[] = [];
  const { data: evB } = await ctx.service.from('evaluaciones')
    .insert({ ronda_id: ronda.id, fecha: '2026-09-07', estado: 'borrador', created_by: ctx.adminId, ...metricas }).select('id').single();
  evalIds.push(evB!.id);
  if (opts.evaluacionCompleta) {
    const { data: evC, error: eC } = await ctx.service.from('evaluaciones')
      .insert({ ronda_id: ronda.id, fecha: '2026-09-08', estado: 'completa', created_by: ctx.adminId, ...metricas }).select('id').single();
    if (eC) throw new Error(`setup evaluacion completa: ${eC.message}`);
    evalIds.push(evC!.id);
  }

  const { data: proc, error: eP } = await ctx.opA.rpc('crear_procedimiento', {
    p_nombre: `AUD-G3 proc ${ctx.R}`, p_tipo: 'poda', p_fecha_inicio: '2026-09-07',
    p_objetivos: [{ tipo: 'cruzamiento', id }], p_insumos: [], p_idempotency_key: crypto.randomUUID(),
  });
  if (eP) throw new Error(`setup procedimiento: ${eP.message}`);
  ctx.procedimientos.push(proc as string);

  return { id, codigo, eventoId: ev1!.id as string, path, indId, rondaId: ronda.id as string, evalIds, procId: proc as string };
}

async function contar(tabla: string, col: string, valor: string | string[]): Promise<number> {
  const q = ctx.service.from(tabla).select('*', { count: 'exact', head: true });
  const { count, error } = Array.isArray(valor) ? await q.in(col, valor) : await q.eq(col, valor);
  if (error) throw new Error(`contar ${tabla}: ${error.message}`);
  return count ?? 0;
}

describe('C11 · permisos: solo un admin administra cruces', () => {
  it('operario y anon no pueden reiniciar, archivar, purgar ni restaurar; el cruce queda intacto y sin auditoría', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    for (const cliente of [ctx.opA, ctx.anon]) {
      for (const [fn, args] of [
        ['reiniciar_cruzamiento', { p_planta_id: id }],
        ['borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' }],
        ['borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' }],
        ['restaurar_cruzamiento', { p_planta_id: id }],
      ] as const) {
        const { error } = await cliente.rpc(fn, args);
        expect(error, `${fn}`).toBeTruthy();
        expect(error!.code, `${fn}`).toBe('42501');
      }
    }
    const { data } = await ctx.service.from('plantas').select('estado, eliminado_at').eq('id', id).single();
    expect(data).toMatchObject({ estado: 'cosecha', eliminado_at: null });
    const log = (await auditoriasDe(ctx, id)).filter((a) => /reinicio|borrado|restauracion/.test(a.accion));
    expect(log).toHaveLength(0);
  });

  // A1-G3-27 (baja, parte verificada): el panel «Gestión de este cruce» se muestra según el linaje, no según el rol.
  it('un operario con puede_ver_linaje recibe la ficha con linaje (la UI le muestra el panel «Gestión de este cruce», que depende de eso y no del rol), pero las RPC lo rechazan', async () => {
    const r = await crearUsuarioDePrueba(ctx.creds, ctx.service, { email: `aud-g3-adm-lin-${ctx.R}@test.local`, rol: 'operario', puedeVerLinaje: true });
    ctx.usuarios.push(r.userId);
    const { id } = await nuevoCruce(ctx, 'cosecha', { cruzamiento: LINAJE() });
    const { data: ficha } = await r.client.rpc('obtener_planta', { p_planta_id: id });
    expect(ficha).toHaveProperty('cruzamiento'); // fichaTieneLinaje(ficha) === true → PlantaFichaPage.tsx:158 renderiza GestionCruceAdmin
    for (const [fn, args] of [
      ['reiniciar_cruzamiento', { p_planta_id: id }],
      ['borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' }],
    ] as const) {
      expect((await r.client.rpc(fn, args)).error?.code).toBe('42501');
    }
    expect((await ctx.service.from('plantas').select('eliminado_at').eq('id', id).single()).data!.eliminado_at).toBeNull();
  });

  it('p_tipo inválido y cruce inexistente se rechazan con mensaje de negocio', async () => {
    const { id } = await nuevoCruce(ctx);
    expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'medio' })).error?.code).toBe('22023');
    expect((await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: crypto.randomUUID() })).error?.code).toBe('P0002');
    expect((await ctx.admin.rpc('restaurar_cruzamiento', { p_planta_id: crypto.randomUUID() })).error?.code).toBe('P0002');
  });
});

describe('C11 · reiniciar: qué borra y qué conserva', () => {
  it('borra bitácora, sesiones, frutos, germinación e insumos; conserva individuos, rondas, evaluaciones, procedimientos y linaje', async () => {
    const c = await cruceCompleto({ evaluacionCompleta: true });
    const antes = {
      ev: await contar('registros_evento', 'planta_id', c.id),
      pol: await contar('polinizacion_evento', 'planta_id', c.id),
      fru: await contar('cosecha_fruto', 'planta_id', c.id),
      ger: await contar('germinacion_evento', 'planta_id', c.id),
      ins: await contar('plantas_insumo', 'planta_id', c.id),
    };
    expect(antes).toEqual({ ev: 2, pol: 1, fru: 1, ger: 1, ins: 1 });

    const { data, error } = await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: c.id });
    expect(error).toBeNull();
    expect((data as { n_individuos_preexistentes: number }).n_individuos_preexistentes).toBe(1);

    // Borrado
    expect(await contar('registros_evento', 'planta_id', c.id)).toBe(0);
    expect(await contar('evento_archivos', 'registro_id', c.eventoId)).toBe(0); // cascada
    expect(await contar('polinizacion_evento', 'planta_id', c.id)).toBe(0);
    expect(await contar('cosecha_fruto', 'planta_id', c.id)).toBe(0);
    expect(await contar('germinacion_evento', 'planta_id', c.id)).toBe(0);
    expect(await contar('plantas_insumo', 'planta_id', c.id)).toBe(0);
    // Conservado
    expect(await contar('individuos', 'planta_id', c.id)).toBe(1);
    expect(await contar('ronda_evaluacion_anual', 'individuo_id', c.indId)).toBe(1);
    expect(await contar('evaluaciones', 'ronda_id', c.rondaId)).toBe(2);
    expect(await contar('procedimiento_objetivos', 'planta_id', c.id)).toBe(1);
    const { data: p } = await ctx.service.from('plantas').select('estado, cruzamiento, mama, papa, fecha_polinizacion, n_flores_cruzadas, n_semillas, eliminado_at').eq('id', c.id).single();
    expect(p).toMatchObject({
      estado: 'sin_empezar', cruzamiento: LINAJE(), fecha_polinizacion: null, n_flores_cruzadas: null, n_semillas: null, eliminado_at: null,
    });
    expect(p!.mama).toContain('MAMA-');
  });

  it('el snapshot de audit_log trae conteos y valores de fase, nunca el linaje ni el texto de las notas', async () => {
    const c = await cruceCompleto();
    const { error } = await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: c.id });
    expect(error).toBeNull();
    const [fila] = await auditoriasDe(ctx, c.id, 'reinicio_cruzamiento');
    expect(fila.usuario_id).toBe(ctx.adminId);
    expect(fila.detalle).toMatchObject({
      estado_anterior: 'evaluacion_anual', n_registros_evento: 2, n_polinizacion_eventos: 1, n_cosecha_frutos: 1,
      n_germinacion_eventos: 1, n_insumos: 1, n_individuos_preexistentes: 1, n_flores_cruzadas: 40, n_semillas: 100,
    });
    const texto = JSON.stringify(fila.detalle);
    expect(texto).not.toContain(LINAJE());
    expect(texto).not.toContain('MAMA-');
    expect(texto).not.toContain(NOTA());
  });

  // A1-G3-02: la bitácora que borra el reinicio no se puede reconstruir desde el audit_log (las sesiones, frutos y germinaciones sí
  // quedan por sus propios triggers; el alta de registros_evento no se audita nunca).
  it.fails('A1-G3-02: el audit_log conserva el contenido de la bitácora que borra el reinicio (el texto de las notas)', async () => {
    const c = await cruceCompleto();
    await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: c.id });
    const todo = JSON.stringify(await auditoriasDe(ctx, c.id));
    expect(todo).toContain(NOTA());
  });

  // A1-G3-03: reiniciar no aplica ninguna de las puertas del borrado permanente.
  it.fails('A1-G3-03: reiniciar rechaza (o exige confirmación) un cruce real con evaluaciones terminadas', async () => {
    const c = await cruceCompleto({ evaluacionCompleta: true });
    const { error } = await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: c.id });
    expect(error).toBeTruthy();
  });

  it('(estado actual) un cruce real (es_prueba = false) con evaluación completa se reinicia sin objeción y queda «sin empezar» con sus individuos', async () => {
    const c = await cruceCompleto({ evaluacionCompleta: true });
    // Un cruce de campo real: no es de prueba. es_prueba solo se escribe al crear, así que se crea otro.
    const real = await nuevoCruce(ctx, 'evaluacion_anual');
    await ctx.service.from('plantas').update({ es_prueba: false }).eq('id', real.id);
    const indReal = await nuevoIndividuo(ctx, real.id, real.codigo);
    const { data: ronda } = await ctx.service.from('ronda_evaluacion_anual').insert({ individuo_id: indReal, numero_ronda: 1, anio: 2026, created_by: ctx.adminId }).select('id').single();
    await ctx.service.from('evaluaciones').insert({ ronda_id: ronda!.id, fecha: '2026-09-08', estado: 'completa', created_by: ctx.adminId, brotacion: 1, floracion: 1, cuaja: 1, concentracion_cosecha: 1, calibre_mm: 18, firmeza: 1, color: 1, bloom: 1, brix: 12, rend_kg_planta: 1, rend_t_ha: 1, pct_fruta_exportable: 50, dano_calor: 1, golpe_sol: 1, caida_fruto: 1, cantidad_frutos: 5, peso_total_g: 50 });
    const { error } = await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: real.id });
    expect(error).toBeNull();
    const { data } = await ctx.service.from('plantas').select('estado, es_prueba').eq('id', real.id).single();
    expect(data).toEqual({ estado: 'sin_empezar', es_prueba: false });
    expect(await contar('evaluaciones', 'ronda_id', ronda!.id)).toBe(1);
    // El primer cruce (de prueba) no se usa más que para armar el caso.
    expect(c.id).toBeTruthy();
    // Se marca como prueba otra vez para que la limpieza lo pueda purgar con la RPC.
    await ctx.service.from('plantas').update({ es_prueba: true }).eq('id', real.id);
  });

  // A1-G3-04: los binarios no se borran con sus metadatos (cascada de FK).
  it.fails('A1-G3-04: reiniciar no deja la foto huérfana en Storage', async () => {
    const c = await cruceCompleto();
    expect(await existeObjeto(ctx, c.path)).toBe(true);
    await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: c.id });
    expect(await contar('evento_archivos', 'storage_path', c.path)).toBe(0);
    expect(await existeObjeto(ctx, c.path)).toBe(false);
  });

  it('reiniciar un cruce ya reiniciado es inocuo pero deja otra fila de auditoría; sobre un cruce archivado funciona sin avisar', async () => {
    const c = await cruceCompleto();
    await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: c.id });
    expect((await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: c.id })).error).toBeNull();
    expect(await auditoriasDe(ctx, c.id, 'reinicio_cruzamiento')).toHaveLength(2);
    await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'soft' });
    const { error } = await ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: c.id });
    expect(error).toBeNull();
    const { data } = await ctx.service.from('plantas').select('estado, eliminado_at').eq('id', c.id).single();
    expect(data!.estado).toBe('sin_empezar');
    expect(data!.eliminado_at).not.toBeNull();
  });
});

describe('C11 · archivar (soft) y restaurar', () => {
  it('archivar no borra nada; el cruce desaparece de la ficha y de los listados; restaurar lo devuelve todo y deja auditoría', async () => {
    const c = await cruceCompleto({ evaluacionCompleta: true });
    const conteo = async () => ({
      ev: await contar('registros_evento', 'planta_id', c.id),
      ind: await contar('individuos', 'planta_id', c.id),
      evals: await contar('evaluaciones', 'ronda_id', c.rondaId),
      arch: await contar('evento_archivos', 'registro_id', c.eventoId),
      obj: await contar('procedimiento_objetivos', 'planta_id', c.id),
    });
    const antes = await conteo();

    expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'soft' })).error).toBeNull();
    expect(await conteo()).toEqual(antes);
    // Ficha: obtener_planta ya no lo encuentra.
    expect((await ctx.opA.rpc('obtener_planta', { p_planta_id: c.id })).error?.code).toBe('P0002');
    // Listados: la vista operativa lo excluye.
    const { data: vista } = await ctx.opA.from('plantas_operativas').select('id').eq('id', c.id);
    expect(vista).toHaveLength(0);
    // Ranking: sus individuos no aparecen.
    expect((await ctx.opA.rpc('obtener_ranking_operativo', { p_planta_id: c.id })).error?.code).toBe('P0002');
    const { data: rankEsp } = await ctx.opA.rpc('obtener_ranking_operativo', { p_especie_id: ctx.especieId, p_limite: 1000 });
    expect(JSON.stringify(rankEsp)).not.toContain(c.indId);
    // Chat: no se puede abrir un canal nuevo para un cruce archivado.
    expect((await ctx.opA.rpc('obtener_canal_chat', { p_tipo: 'cruce', p_entidad_id: c.id })).error?.code).toBe('P0002');

    const { data: res, error } = await ctx.admin.rpc('restaurar_cruzamiento', { p_planta_id: c.id });
    expect(error).toBeNull();
    expect(res).toMatchObject({ planta_id: c.id, codigo_sistema: c.codigo, n_individuos: 1, n_evaluaciones: 2 });
    expect(await conteo()).toEqual(antes);
    expect((await ctx.opA.rpc('obtener_planta', { p_planta_id: c.id })).error).toBeNull();
    const [r] = await auditoriasDe(ctx, c.id, 'restauracion_cruzamiento');
    expect(r.usuario_id).toBe(ctx.adminId);
    expect(r.detalle).toHaveProperty('eliminado_at_anterior');
    expect((await auditoriasDe(ctx, c.id, 'borrado_cruzamiento_soft'))).toHaveLength(1);
  });

  it('A1-G3-19: un cruce archivado no admite rondas de evaluación nuevas sobre sus individuos', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'evaluacion_anual');
    const ind = await nuevoIndividuo(ctx, id, codigo);
    expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' })).error).toBeNull();
    const { error } = await iniciarRondaAnual(ctx.opA, ind);
    expect(error?.code).toBe('55000');
    const filas = await ctx.service.from('ronda_evaluacion_anual').select('id').eq('individuo_id', ind);
    expect(filas.error).toBeNull();
    expect(filas.data).toHaveLength(0);
    expect(await auditoriasDe(ctx, id, 'creacion_ronda_evaluacion_anual')).toHaveLength(0);
  });

  it('restaurar un cruce que no está archivado se rechaza (23514)', async () => {
    const { id } = await nuevoCruce(ctx);
    expect((await ctx.admin.rpc('restaurar_cruzamiento', { p_planta_id: id })).error?.code).toBe('23514');
  });

  // A1-G3-16 (baja): archivar un cruce ya archivado pisa la fecha original.
  it.fails('A1-G3-16: archivar un cruce que ya está archivado no cambia la fecha de archivo original', async () => {
    const { id } = await nuevoCruce(ctx);
    await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' });
    const { data: a } = await ctx.service.from('plantas').select('eliminado_at').eq('id', id).single();
    await new Promise((r) => setTimeout(r, 50));
    expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' })).error).toBeNull();
    const { data: b } = await ctx.service.from('plantas').select('eliminado_at').eq('id', id).single();
    expect(b!.eliminado_at).toBe(a!.eliminado_at);
  });

  it('dos admins restaurando a la vez: uno gana, el otro recibe «no está eliminado» y queda una sola fila de auditoría (FOR UPDATE)', async () => {
    const { id } = await nuevoCruce(ctx);
    await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' });
    const [r1, r2] = await Promise.all([
      ctx.admin.rpc('restaurar_cruzamiento', { p_planta_id: id }),
      ctx.admin2.rpc('restaurar_cruzamiento', { p_planta_id: id }),
    ]);
    expect([r1.error, r2.error].filter(Boolean)).toHaveLength(1);
    expect(await auditoriasDe(ctx, id, 'restauracion_cruzamiento')).toHaveLength(1);
  });
});

describe('C11 · borrar permanentemente (hard)', () => {
  it('purga un cruce de prueba con sesiones, bitácora, individuos y procedimiento; el audit_log guarda conteos y quién, pero no el linaje', async () => {
    const c = await cruceCompleto();
    const { error } = await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' });
    expect(error).toBeNull();
    expect(await contar('plantas', 'id', c.id)).toBe(0);
    expect(await contar('individuos', 'planta_id', c.id)).toBe(0);
    const { data: filas } = await ctx.service.from('audit_log').select('usuario_id, detalle').eq('accion', 'borrado_cruzamiento_hard').contains('detalle', { codigo_sistema: c.codigo });
    expect(filas).toHaveLength(1);
    expect(filas![0].usuario_id).toBe(ctx.adminId);
    expect(filas![0].detalle).toMatchObject({ n_individuos: 1, n_registros_evento: 2, n_polinizacion_eventos: 1, tipo_borrado: 'hard' });
    expect(JSON.stringify(filas![0].detalle)).not.toContain(LINAJE());
    // Las filas de audit_log previas del cruce (alta, ediciones) quedan sin cruce (SET NULL) pero siguen existiendo...
    const { count } = await ctx.service.from('audit_log').select('*', { count: 'exact', head: true }).is('planta_id', null).contains('detalle', { codigo_sistema: c.codigo });
    expect(count).toBeGreaterThanOrEqual(1);
    // A1-004: ni la auditoría que sobrevive al cruce conserva texto de linaje.
    const { count: conLinaje } = await ctx.service.from('audit_log').select('*', { count: 'exact', head: true }).eq('accion', 'alta_cruce').is('planta_id', null).contains('detalle', { nuevo: { cruzamiento: LINAJE() } });
    expect(conLinaje).toBe(0);
  });

  it('un cruce real (es_prueba = false) no se purga; es_prueba no se puede cambiar por la API ni siendo admin', async () => {
    const { id, codigo } = await nuevoCruce(ctx);
    await ctx.service.from('plantas').update({ es_prueba: false }).eq('id', id);
    const { error } = await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain(codigo);
    const { error: eUp } = await ctx.admin.from('plantas').update({ es_prueba: true }).eq('id', id);
    expect(eUp).toBeTruthy(); // sin grant de UPDATE sobre la columna
    await ctx.service.from('plantas').update({ es_prueba: true }).eq('id', id); // para que la limpieza lo purgue
  });

  it('un operario no puede crear cruces (ni con es_prueba) ni borrarlos por la API directa', async () => {
    const { error } = await ctx.opA.from('plantas').insert({ codigo_sistema: `AUD-G3-ADM-OP-${ctx.R}`, especie_id: ctx.especieId, es_prueba: true });
    expect(error).toBeTruthy();
    const { id } = await nuevoCruce(ctx);
    const { data } = await ctx.opA.from('plantas').delete().eq('id', id).select('id');
    expect(data ?? []).toHaveLength(0);
    expect(await contar('plantas', 'id', id)).toBe(1);
  });

  // A1-G3-01: DELETE directo sobre plantas (policy plantas_delete_admin + grant DELETE), sin pasar por la RPC.
  it('A1-G3-01: un admin no puede borrar con DELETE directo un cruce REAL (es_prueba = false), ni sin dejar rastro', async () => {
    const { id } = await nuevoCruce(ctx, 'sin_empezar', { cruzamiento: LINAJE() });
    await ctx.service.from('plantas').update({ es_prueba: false }).eq('id', id);
    const { data, error } = await ctx.admin.from('plantas').delete().eq('id', id).select('id');
    // Se espera que la base lo impida (o al menos lo audite). Hoy se borra el cruce, con su linaje, sin una sola fila de auditoría.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it('(estado corregido A1-003) el DELETE directo del admin preserva un cruce real y su bitácora', async () => {
    const { id } = await nuevoCruce(ctx, 'sin_empezar', { cruzamiento: LINAJE() });
    await ctx.service.from('plantas').update({ es_prueba: false }).eq('id', id);
    await ctx.admin.from('registros_evento').insert({ planta_id: id, tipo_evento: 'otro', fecha: '2026-09-01', datos: {}, notas: NOTA(), created_by: ctx.adminId });
    const { data, error } = await ctx.admin.from('plantas').delete().eq('id', id).select('id');
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
    expect(await contar('plantas', 'id', id)).toBe(1);
    expect(await contar('registros_evento', 'planta_id', id)).toBe(1);
    const { data: log } = await ctx.service.from('audit_log').select('accion').or(`planta_id.eq.${id},detalle->>planta_id.eq.${id}`);
    expect((log ?? []).filter((a) => /borrado|eliminacion/.test(a.accion))).toHaveLength(0);
  });

  it('con individuos, el DELETE directo se rechaza por permiso y nada se borra', async () => {
    const c = await cruceCompleto();
    const { error } = await ctx.admin.from('plantas').delete().eq('id', c.id);
    expect(error?.code).toBe('42501');
    expect(await contar('plantas', 'id', c.id)).toBe(1);
    expect(await contar('individuos', 'planta_id', c.id)).toBe(1);
  });

  // A1-G3-04 (misma causa que el reinicio): la purga borra metadatos y deja los binarios.
  it.fails('A1-G3-04: la purga no deja las fotos huérfanas en Storage', async () => {
    const c = await cruceCompleto();
    expect(await existeObjeto(ctx, c.path)).toBe(true);
    expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' })).error).toBeNull();
    expect(await existeObjeto(ctx, c.path)).toBe(false);
  });

  // A1-G3-07: lo que la purga deja colgando (sin FK a plantas).
  it.fails('A1-G3-07: la purga no deja procedimientos sin objetivo de cruce ni snapshots de ranking que apuntan a un cruce inexistente', async () => {
    const c = await cruceCompleto();
    const { data: ver } = await ctx.service.from('scoring_version').select('id').limit(1).single();
    const { data: snap } = await ctx.service.from('ranking_snapshot').insert({
      nombre: `AUD-G3 snap ${ctx.R}`, alcance: 'cruzamiento', planta_id: c.id, especie_id: ctx.especieId,
      scoring_version_id: ver!.id, poblacion_comparada: 1, criterios: [], created_by: ctx.adminId,
    }).select('id').single();
    expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' })).error).toBeNull();
    const { data: cab } = await ctx.service.from('ranking_snapshot').select('id, planta_id').eq('id', snap!.id).maybeSingle();
    const { data: proc } = await ctx.service.from('procedimientos').select('id').eq('id', c.procId).maybeSingle();
    const { count: nObj } = await ctx.service.from('procedimiento_objetivos').select('*', { count: 'exact', head: true }).eq('procedimiento_id', c.procId);
    await ctx.service.from('ranking_snapshot').delete().eq('id', snap!.id);
    expect(cab).toBeNull();
    expect(proc === null || (nObj ?? 0) > 0).toBe(true);
  });

  it('(estado actual) tras la purga queda la cabecera del snapshot con planta_id colgante, el procedimiento sin objetivos y el canal de chat', async () => {
    const c = await cruceCompleto();
    const { data: ver } = await ctx.service.from('scoring_version').select('id').limit(1).single();
    const { data: snap } = await ctx.service.from('ranking_snapshot').insert({
      nombre: `AUD-G3 snap ${ctx.R}`, alcance: 'cruzamiento', planta_id: c.id, especie_id: ctx.especieId,
      scoring_version_id: ver!.id, poblacion_comparada: 1, criterios: [], created_by: ctx.adminId,
    }).select('id').single();
    const { data: canal } = await ctx.opA.rpc('obtener_canal_chat', { p_tipo: 'cruce', p_entidad_id: c.id });
    expect(canal).toBeTruthy();
    expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' })).error).toBeNull();

    const { data: cab } = await ctx.service.from('ranking_snapshot').select('planta_id').eq('id', snap!.id).single();
    expect(cab!.planta_id).toBe(c.id); // sin FK: apunta a un cruce que ya no existe
    expect(await contar('plantas', 'id', c.id)).toBe(0);
    expect(await contar('procedimientos', 'id', c.procId)).toBe(1);
    expect(await contar('procedimiento_objetivos', 'procedimiento_id', c.procId)).toBe(0);
    expect(await contar('chat_canales', 'id', canal as string)).toBe(1); // el historial de chat sobrevive
    await ctx.service.from('ranking_snapshot').delete().eq('id', snap!.id);
    await ctx.service.from('chat_canales').delete().eq('id', canal as string);
  });

  // A1-G3-18 (baja): un clon de otro cruce apunta a un individuo del cruce que se purga.
  it.fails('A1-G3-18: purgar un cruce cuyos individuos tienen clones en OTRO cruce funciona o se niega con un mensaje que lo explica', async () => {
    const x = await nuevoCruce(ctx);
    const y = await nuevoCruce(ctx);
    const indX = await nuevoIndividuo(ctx, x.id, x.codigo);
    const { error: eClon } = await ctx.service.from('individuos').insert({ planta_id: y.id, codigo_display: `${y.codigo}-P01`, created_by: ctx.adminId, clon_de_id: indX });
    expect(eClon).toBeNull();
    try {
      const { error } = await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: x.id, p_tipo: 'hard' });
      // Hoy: 23503 crudo de la FK individuos_clon_de_id_fkey (la interfaz lo muestra como «hace referencia a un registro relacionado…»), sin decir qué cruce impide la purga.
      expect(error === null || !/violates foreign key/i.test(error.message)).toBe(true);
    } finally {
      await ctx.service.from('individuos').update({ clon_de_id: null }).eq('planta_id', y.id); // para que la limpieza pueda purgar x
    }
  });

  it('con evaluaciones terminadas o historial territorial la purga se niega (23514) y no deja rastro parcial', async () => {
    const c = await cruceCompleto({ evaluacionCompleta: true });
    const { error } = await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' });
    expect(error?.code).toBe('23514');
    expect(await contar('registros_evento', 'planta_id', c.id)).toBe(2);
    expect(await auditoriasDe(ctx, c.id, 'borrado_cruzamiento_hard')).toHaveLength(0);
  });

  it('dos admins purgando el mismo cruce a la vez: el cruce desaparece una sola vez; el perdedor recibe un error crudo (23503 o deadlock 40P01) en vez de «ya fue eliminado»', async () => {
    const c = await cruceCompleto();
    const [r1, r2] = await Promise.all([
      ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' }),
      ctx.admin2.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' }),
    ]);
    const errores = [r1.error, r2.error].filter((e) => e !== null);
    const { data: filas } = await ctx.service.from('audit_log').select('id').eq('accion', 'borrado_cruzamiento_hard').contains('detalle', { codigo_sistema: c.codigo });
    expect(await contar('plantas', 'id', c.id)).toBe(0);
    // La transacción perdedora se revierte entera (también su fila de auditoría): una sola fila.
    expect(filas).toHaveLength(1);
    expect(errores.length).toBeLessThanOrEqual(1);
    for (const e of errores) expect(['23503', '40P01', 'P0002']).toContain(e!.code); // ninguno es un mensaje de negocio (A1-G3-17)
  });

  it('dos admins reiniciando o archivando a la vez: ambos reciben éxito y quedan dos filas de auditoría (la RPC no bloquea la fila)', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    const [a, b] = await Promise.all([
      ctx.admin.rpc('reiniciar_cruzamiento', { p_planta_id: id }),
      ctx.admin2.rpc('reiniciar_cruzamiento', { p_planta_id: id }),
    ]);
    expect([a.error, b.error]).toEqual([null, null]);
    expect(await auditoriasDe(ctx, id, 'reinicio_cruzamiento')).toHaveLength(2);
    const [c, d] = await Promise.all([
      ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' }),
      ctx.admin2.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' }),
    ]);
    expect([c.error, d.error]).toEqual([null, null]);
    expect(await auditoriasDe(ctx, id, 'borrado_cruzamiento_soft')).toHaveLength(2);
  });

  // A1-G3-17 (baja): el segundo admin no recibe un mensaje entendible.
  it.fails('A1-G3-17: el admin que pierde la carrera de una purga recibe un mensaje de negocio, no un código crudo', async () => {
    let crudo = false;
    for (let i = 0; i < 8 && !crudo; i++) {
      const c = await cruceCompleto();
      const [r1, r2] = await Promise.all([
        ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' }),
        ctx.admin2.rpc('borrar_cruzamiento', { p_planta_id: c.id, p_tipo: 'hard' }),
      ]);
      crudo = [r1.error, r2.error].some((e) => e !== null && ['23503', '40P01'].includes(e.code));
    }
    expect(crudo).toBe(false);
  }, 90_000);
});

describe('C11 · escala: el listado del panel de administración se corta en 1000', () => {
  // A1-G3-08: listarTodosLosCruces no pagina; PostgREST devuelve como máximo max_rows = 1000.
  it.fails('A1-G3-08: el listado completo de cruces (como lo pide CruzamientosAdminPage) devuelve todos los cruces aunque pasen de 1000', async () => {
    const prefijo = `AUD-G3-BULK-${ctx.R}`;
    const { count: previos } = await ctx.service.from('plantas').select('*', { count: 'exact', head: true });
    const faltan = Math.max(0, 1000 - (previos ?? 0)) + 50;
    const ids: string[] = [];
    try {
      for (let i = 0; i < faltan; i += 300) {
        const lote = Array.from({ length: Math.min(300, faltan - i) }, (_, k) => ({
          codigo_sistema: `${prefijo}-${String(i + k).padStart(4, '0')}`, especie_id: ctx.especieId, es_prueba: true, estado: 'sin_empezar',
        }));
        const { data, error } = await ctx.service.from('plantas').insert(lote).select('id');
        if (error) throw new Error(error.message);
        ids.push(...data!.map((d) => d.id));
      }
      // Mismo SELECT que frontend/src/api/cruzamientosAdmin.ts:24-31
      const { data, error } = await ctx.admin.from('plantas').select('id, codigo_sistema, estado, eliminado_at, es_prueba').order('codigo_sistema');
      expect(error).toBeNull();
      const { count: total } = await ctx.service.from('plantas').select('*', { count: 'exact', head: true });
      expect(total).toBeGreaterThan(1000);
      expect(data!.length).toBe(total); // hoy: 1000 de N, sin ningún aviso
    } finally {
      for (let i = 0; i < ids.length; i += 100) {
        const trozo = ids.slice(i, i + 100);
        await ctx.service.from('audit_log').delete().in('planta_id', trozo);
        await ctx.service.from('plantas').delete().in('id', trozo);
      }
      await ctx.service.from('audit_log').delete().is('planta_id', null).like('detalle->>codigo_sistema', `${prefijo}%`);
    }
  }, 120_000);
});

describe('C11 · el resumen previo a la purga con un cruce grande', () => {
  // A1-G3-25: resumenParaBorrado (cruzamientosAdmin.ts:73-122) arma `.in('individuo_id', [todos los ids])` en la URL.
  it.fails('A1-G3-25: el resumen previo a la purga se calcula para un cruce de 260 individuos (la URL con los ids supera el límite)', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'evaluacion_anual');
    const filas = Array.from({ length: 260 }, (_, i) => ({ planta_id: id, codigo_display: `${codigo}-X${i}`, created_by: ctx.adminId }));
    const { data: inds, error } = await ctx.service.from('individuos').insert(filas).select('id');
    expect(error).toBeNull();
    const ids = inds!.map((i) => i.id);
    const { error: eR } = await ctx.service.from('ronda_evaluacion_anual').insert(ids.map((individuo_id) => ({ individuo_id, numero_ronda: 1, anio: 2026, created_by: ctx.adminId })));
    expect(eR).toBeNull();
    // Mismas consultas que resumenParaBorrado, con el cliente del admin.
    const { data: individuos } = await ctx.admin.from('individuos').select('id').eq('planta_id', id);
    const individuoIds = (individuos ?? []).map((i) => i.id);
    expect(individuoIds).toHaveLength(260);
    const rondas = await ctx.admin.from('ronda_evaluacion_anual').select('id').in('individuo_id', individuoIds);
    expect(rondas.error).toBeNull(); // hoy: 'URI too long' → la query lanza y el panel «Eliminar» queda en blanco
  }, 60_000);

  it('(estado actual) hasta unos 200 individuos la misma consulta funciona; sin el resumen el panel de purga no muestra ni el botón «Volver»', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'evaluacion_anual');
    const filas = Array.from({ length: 200 }, (_, i) => ({ planta_id: id, codigo_display: `${codigo}-Y${i}`, created_by: ctx.adminId }));
    const { data: inds } = await ctx.service.from('individuos').insert(filas).select('id');
    const r = await ctx.admin.from('ronda_evaluacion_anual').select('id').in('individuo_id', inds!.map((i) => i.id));
    expect(r.error).toBeNull();
    // (lectura de código) CruzamientosAdminPage.tsx:170-214: con la query en error, `resumen` es undefined → el bloque devuelve null.
  }, 60_000);
});

describe('C11 · el binario de Storage y el bucket', () => {
  it('(sanidad) el helper existeObjeto distingue un objeto subido de uno inexistente', async () => {
    const c = await cruceCompleto();
    expect(await existeObjeto(ctx, c.path)).toBe(true);
    expect(await existeObjeto(ctx, c.path + '.no')).toBe(false);
    expect(BUCKET).toBe('media-plantas');
  });
});
