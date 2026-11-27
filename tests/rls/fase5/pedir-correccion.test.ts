/**
 * Fase 5, segunda parte (decisión G15): «Pedir corrección». En una evaluación cerrada, su autor pide una corrección con una
 * nota obligatoria. El pedido aparece en el Inicio del admin («Correcciones pedidas») y en el historial de la evaluación; al
 * corregir, el pedido queda resuelto. El operario no edita nada: corregir sigue siendo solo del admin (A8).
 * Tabla pedido_correccion con RLS: cada quien lee sus pedidos y el admin todos; nadie escribe directo (solo la RPC).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditoriaDe, crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;

beforeAll(async () => {
  ctx = await iniciarContexto('fase5-pedir-correccion');
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

/** Una evaluación cerrada hecha por el operario, en un cruce nuevo. */
async function evaluacionDelOperario(codigo: string, estado: 'completa' | 'borrador' = 'completa') {
  const cruce = await crearCruce(ctx, { codigo: `${codigo}-${ctx.R}` });
  const [a] = await crearIndividuos(ctx, cruce, 1);
  const ronda = await crearRonda(ctx, a.id);
  const evaluacion = await crearEvaluacion(ctx, ronda, { brotacion: 3 }, { estado, createdBy: ctx.operarioId });
  return { cruce, individuo: a, ronda, evaluacion };
}

const pedir = (cliente: typeof ctx.admin, evaluacion: string, nota: string) =>
  cliente.rpc('pedir_correccion', { p_evaluacion_id: evaluacion, p_nota: nota });

describe('pedir_correccion', () => {
  it('el autor pide una corrección con nota; queda abierta, en la auditoría y la ve en su historial', async () => {
    const { cruce, evaluacion } = await evaluacionDelOperario('F5-PC-A');
    const { data: id, error } = await pedir(ctx.operario, evaluacion, 'El calibre es 18, no 81');
    expect(error).toBeNull();
    expect(id).toBeTruthy();

    const { data: propios } = await ctx.operario.from('pedido_correccion').select('id, evaluacion_id, nota, resuelto_en').eq('evaluacion_id', evaluacion);
    expect(propios).toEqual([{ id, evaluacion_id: evaluacion, nota: 'El calibre es 18, no 81', resuelto_en: null }]);

    const filas = (await auditoriaDe(ctx, ctx.operarioId, 'pedido_correccion')).filter((f) => f.planta_id === cruce);
    expect(filas).toHaveLength(1);
    expect(filas[0].detalle).toMatchObject({ evaluacion_id: evaluacion, nota: 'El calibre es 18, no 81' });

    const { data: historial, error: eh } = await ctx.operario.rpc('pedidos_correccion_evaluacion', { p_evaluacion_id: evaluacion });
    expect(eh).toBeNull();
    expect((historial as Fila[]).map((p) => [p.nota, p.estado])).toEqual([['El calibre es 18, no 81', 'abierto']]);
    expect((historial as Fila[])[0].pedido_por).toBeTruthy();
  });

  it('la nota es obligatoria (y con un largo razonable)', async () => {
    const { evaluacion } = await evaluacionDelOperario('F5-PC-B');
    expect((await pedir(ctx.operario, evaluacion, '   ')).error?.code).toBe('22023');
    expect((await pedir(ctx.operario, evaluacion, 'x'.repeat(1001))).error?.code).toBe('22023');
  });

  it('solo el autor: otro usuario (ni el admin que no la hizo) no puede pedirla sobre una evaluación ajena', async () => {
    const { evaluacion } = await evaluacionDelOperario('F5-PC-C');
    expect((await pedir(ctx.operarioLinaje, evaluacion, 'No es mía')).error?.code).toBe('42501');
    expect((await pedir(ctx.admin, evaluacion, 'No es mía')).error?.code).toBe('42501');
    expect((await pedir(ctx.anon, evaluacion, 'Sin sesión')).error).not.toBeNull();
  });

  it('solo sobre una evaluación cerrada: un borrador no', async () => {
    const { evaluacion } = await evaluacionDelOperario('F5-PC-D', 'borrador');
    expect((await pedir(ctx.operario, evaluacion, 'Borrador')).error?.code).toBe('22023');
  });

  it('no se abren dos pedidos a la vez para la misma evaluación', async () => {
    const { evaluacion } = await evaluacionDelOperario('F5-PC-E');
    expect((await pedir(ctx.operario, evaluacion, 'Primera')).error).toBeNull();
    const otra = await pedir(ctx.operario, evaluacion, 'Segunda');
    expect(otra.error?.code).toBe('23505');
    expect(otra.error?.message).toContain('Ya pediste una corrección');
  });

  it('nadie escribe directo en la tabla, ni el admin', async () => {
    const { evaluacion } = await evaluacionDelOperario('F5-PC-F');
    expect((await ctx.operario.from('pedido_correccion').insert({ evaluacion_id: evaluacion, nota: 'directo' })).error).not.toBeNull();
    expect((await ctx.admin.from('pedido_correccion').insert({ evaluacion_id: evaluacion, nota: 'directo' })).error).not.toBeNull();
  });
});

describe('quién ve los pedidos', () => {
  it('el admin ve los abiertos en «Correcciones pedidas» con el enlace (cruce, evaluación); el operario no puede listarlos', async () => {
    const { cruce, individuo, evaluacion } = await evaluacionDelOperario('F5-PC-G');
    await pedir(ctx.operario, evaluacion, 'Revisar la floración');
    const { data, error } = await ctx.admin.rpc('listar_correcciones_pedidas');
    expect(error).toBeNull();
    const fila = (data as Fila[]).find((p) => p.evaluacion_id === evaluacion);
    expect(fila).toMatchObject({ planta_id: cruce, individuo_id: individuo.id, codigo_display: individuo.codigo_display, nota: 'Revisar la floración', numero_ronda: 1 });
    expect(fila?.pedido_por).toBeTruthy();
    expect(Object.keys(fila ?? {})).not.toEqual(expect.arrayContaining(['cruzamiento', 'mama', 'papa']));
    expect((await ctx.operario.rpc('listar_correcciones_pedidas')).error?.code).toBe('42501');
  });

  it('otro operario no ve los pedidos ajenos (ni en la tabla ni en el historial); el admin ve todos', async () => {
    const { evaluacion } = await evaluacionDelOperario('F5-PC-H');
    await pedir(ctx.operario, evaluacion, 'Pedido privado');
    expect((await ctx.operarioLinaje.from('pedido_correccion').select('id').eq('evaluacion_id', evaluacion)).data).toEqual([]);
    expect((await ctx.operarioLinaje.rpc('pedidos_correccion_evaluacion', { p_evaluacion_id: evaluacion })).data).toEqual([]);
    expect((await ctx.admin.from('pedido_correccion').select('id').eq('evaluacion_id', evaluacion)).data).toHaveLength(1);
    expect((await ctx.anon.from('pedido_correccion').select('id')).data ?? []).toEqual([]);
  });
});

describe('al corregir, el pedido queda resuelto', () => {
  it('la corrección del admin resuelve los pedidos abiertos de esa evaluación y lo deja en la auditoría', async () => {
    const { cruce, evaluacion } = await evaluacionDelOperario('F5-PC-I');
    await pedir(ctx.operario, evaluacion, 'La brotación es 4');
    const { error } = await ctx.admin.from('evaluaciones').update({ estado: 'corregida', brotacion: 4, motivo_cambio: 'Pedido del evaluador' }).eq('id', evaluacion);
    expect(error).toBeNull();
    const { data } = await ctx.operario.from('pedido_correccion').select('resuelto_en, resuelto_por').eq('evaluacion_id', evaluacion);
    expect((data as Fila[])[0].resuelto_en).not.toBeNull();
    expect((data as Fila[])[0].resuelto_por).toBe(ctx.adminId);
    const { data: historial } = await ctx.operario.rpc('pedidos_correccion_evaluacion', { p_evaluacion_id: evaluacion });
    expect((historial as Fila[])[0]).toMatchObject({ estado: 'resuelto' });
    expect((historial as Fila[])[0].resuelto_por).toBeTruthy();
    const filas = (await auditoriaDe(ctx, ctx.adminId, 'pedido_correccion_resuelto')).filter((f) => f.planta_id === cruce);
    expect(filas).toHaveLength(1);
    // Ya no aparece entre las abiertas del admin, y se puede pedir otra.
    expect(((await ctx.admin.rpc('listar_correcciones_pedidas')).data as Fila[]).some((p) => p.evaluacion_id === evaluacion)).toBe(false);
    expect((await pedir(ctx.operario, evaluacion, 'Otra cosa')).error).toBeNull();
  });

  it('el operario sigue sin poder corregir (A8)', async () => {
    const { evaluacion } = await evaluacionDelOperario('F5-PC-J');
    await ctx.operario.from('evaluaciones').update({ estado: 'corregida', brotacion: 5, motivo_cambio: 'yo' }).eq('id', evaluacion);
    const { data } = await ctx.service.from('evaluaciones').select('estado, brotacion').eq('id', evaluacion).single();
    expect(data).toMatchObject({ estado: 'completa', brotacion: 3 });
  });
});
