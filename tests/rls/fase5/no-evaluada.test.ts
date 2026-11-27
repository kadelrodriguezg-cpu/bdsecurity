/**
 * Fase 5, hallazgo 3 de la guía (decisión G3): una planta puede quedar «No evaluada en esta ronda» con un motivo
 * obligatorio (No alcanzó · Sin fruto · Otro + texto). Queda auditado, no cuenta en el ranking de esa ronda, deja de ser
 * pendiente y le permite entrar a la ronda siguiente. La planilla de la ronda N trae, por planta, el estado de su ronda N-1
 * (para la sección «Pendientes de la ronda anterior»).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditoriaDe, crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;

beforeAll(async () => {
  ctx = await iniciarContexto('fase5-no-evaluada');
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

const marcar = (cliente: typeof ctx.admin, rondaId: string, motivo: string, detalle?: string) =>
  cliente.rpc('marcar_ronda_no_evaluada', { p_ronda_id: rondaId, p_motivo: motivo, ...(detalle !== undefined ? { p_detalle: detalle } : {}) });

async function planilla(plantaId: string, numero?: number): Promise<Fila> {
  const { data, error } = await ctx.admin.rpc('obtener_planilla_ronda', { p_planta_id: plantaId, p_tipo_ronda: 'anual', ...(numero ? { p_numero_ronda: numero } : {}) });
  expect(error).toBeNull();
  return data as Fila;
}

describe('marcar_ronda_no_evaluada', () => {
  it('el admin marca una ronda sin evaluar; queda en la planilla, deja de ser pendiente y queda auditado', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-A-${ctx.R}` });
    const [a, b] = await crearIndividuos(ctx, cruce, 2);
    const ra = await crearRonda(ctx, a.id);
    await crearRonda(ctx, b.id);
    const { error } = await marcar(ctx.admin, ra, 'sin_fruto');
    expect(error).toBeNull();

    const p = await planilla(cruce);
    const fila = (p.individuos as Fila[]).find((f) => f.individuo_id === a.id)!;
    expect(fila.estado).toBe('no_evaluada');
    expect(fila.no_evaluada).toMatchObject({ motivo: 'sin_fruto' });
    expect(p.avance).toMatchObject({ vivos: 2, sin_iniciar: 1, no_evaluada: 1, completa: 0 });

    const { data: eo } = await ctx.admin.rpc('estado_operativo_cruce', { p_planta_id: cruce });
    expect((eo as Fila[])[0]).toMatchObject({ sin_evaluacion_cerrada: 1, evaluaciones_cerradas: 0 });

    const filas = (await auditoriaDe(ctx, ctx.adminId, 'ronda_no_evaluada')).filter((x) => x.planta_id === cruce);
    expect(filas).toHaveLength(1);
    expect(filas[0].detalle).toMatchObject({ ronda_id: ra, numero_ronda: 1, motivo: 'sin_fruto' });
  });

  it('«Otro» exige texto; un motivo desconocido se rechaza', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-B-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    const r = await crearRonda(ctx, a.id);
    expect((await marcar(ctx.admin, r, 'otro', '  ')).error?.code).toBe('22023');
    expect((await marcar(ctx.admin, r, 'cualquiera')).error?.code).toBe('22023');
    expect((await marcar(ctx.admin, r, 'otro', 'Planta en cuarentena')).error).toBeNull();
  });

  it('el operario no puede marcar', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-C-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    const r = await crearRonda(ctx, a.id);
    expect((await marcar(ctx.operario, r, 'no_alcanzo')).error?.code).toBe('42501');
  });

  it('no se marca una ronda con evaluación cerrada ni con un borrador sin terminar', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-D-${ctx.R}` });
    const [a, b] = await crearIndividuos(ctx, cruce, 2);
    const ra = await crearRonda(ctx, a.id);
    await crearEvaluacion(ctx, ra, {}, { estado: 'completa' });
    const rb = await crearRonda(ctx, b.id);
    await crearEvaluacion(ctx, rb, {}, { estado: 'borrador' });
    expect((await marcar(ctx.admin, ra, 'no_alcanzo')).error?.code).toBe('23514');
    expect((await marcar(ctx.admin, rb, 'no_alcanzo')).error?.code).toBe('23514');
  });

  it('una ronda marcada ya no recibe evaluaciones nuevas', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-E-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    const r = await crearRonda(ctx, a.id);
    expect((await marcar(ctx.admin, r, 'no_alcanzo')).error).toBeNull();
    const { error } = await ctx.admin.from('evaluaciones').insert({ ronda_id: r, fecha: '2026-06-20', estado: 'borrador', created_by: ctx.adminId }).select('id');
    expect(error?.code).toBe('55000');
  });
});

describe('una planta nunca evaluada en la ronda 1 entra a la ronda 2', () => {
  it('sin la marca, la ronda 2 se rechaza; con «No evaluada» en la ronda 1, se abre', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-F-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    const r1 = await crearRonda(ctx, a.id);
    const antes = await ctx.admin.rpc('iniciar_ronda_esperada', { p_individuo_id: a.id, p_tipo: 'anual', p_numero_esperado: 2 });
    expect(antes.error?.code).toBe('55000');
    expect((await marcar(ctx.admin, r1, 'no_alcanzo')).error).toBeNull();
    const despues = await ctx.admin.rpc('iniciar_ronda_esperada', { p_individuo_id: a.id, p_tipo: 'anual', p_numero_esperado: 2 });
    expect(despues.error).toBeNull();
    expect((despues.data as Fila).numero_ronda).toBe(2);
  });
});

describe('quitar_ronda_no_evaluada', () => {
  it('el admin quita la marca si no empezó la ronda siguiente; con la siguiente iniciada, se niega', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-G-${ctx.R}` });
    const [a, b] = await crearIndividuos(ctx, cruce, 2);
    const ra = await crearRonda(ctx, a.id);
    const rb = await crearRonda(ctx, b.id);
    await marcar(ctx.admin, ra, 'no_alcanzo');
    await marcar(ctx.admin, rb, 'no_alcanzo');
    expect((await ctx.operario.rpc('quitar_ronda_no_evaluada', { p_ronda_id: ra })).error?.code).toBe('42501');
    expect((await ctx.admin.rpc('quitar_ronda_no_evaluada', { p_ronda_id: ra })).error).toBeNull();
    const fila = ((await planilla(cruce)).individuos as Fila[]).find((f) => f.individuo_id === a.id)!;
    expect(fila.estado).toBe('sin_iniciar');
    await ctx.admin.rpc('iniciar_ronda_esperada', { p_individuo_id: b.id, p_tipo: 'anual', p_numero_esperado: 2 });
    expect((await ctx.admin.rpc('quitar_ronda_no_evaluada', { p_ronda_id: rb })).error?.code).toBe('23514');
    expect((await auditoriaDe(ctx, ctx.adminId, 'ronda_no_evaluada_quitada')).filter((x) => x.planta_id === cruce)).toHaveLength(1);
  });
});

describe('planilla de la ronda 2: pendientes de la ronda anterior', () => {
  it('cada planta trae el estado de su ronda 1 (sin evaluar, borrador, cerrada o no evaluada)', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-H-${ctx.R}` });
    const [a, b, c, d] = await crearIndividuos(ctx, cruce, 4);
    const ra = await crearRonda(ctx, a.id); await crearEvaluacion(ctx, ra, {}, { estado: 'completa' });
    await crearRonda(ctx, a.id, 2); // la ronda 2 ya existe en el cruce
    await crearRonda(ctx, b.id); // ronda 1 sin evaluar
    const rc = await crearRonda(ctx, c.id); await crearEvaluacion(ctx, rc, {}, { estado: 'borrador' });
    const rd = await crearRonda(ctx, d.id); await marcar(ctx.admin, rd, 'sin_fruto');

    const p = await planilla(cruce);
    expect(p.numero_ronda).toBe(2);
    const por = Object.fromEntries((p.individuos as Fila[]).map((f) => [f.individuo_id, f]));
    expect(por[a.id].anterior).toMatchObject({ numero: 1, estado: 'completa' });
    expect(por[b.id].anterior).toMatchObject({ numero: 1, estado: 'sin_iniciar' });
    expect(por[c.id].anterior).toMatchObject({ numero: 1, estado: 'borrador' });
    expect(por[d.id].anterior).toMatchObject({ numero: 1, estado: 'no_evaluada' });
    expect(por[b.id].estado).toBe('sin_ronda');

    // En la ronda 1 no hay «anterior».
    const p1 = await planilla(cruce, 1);
    expect((p1.individuos as Fila[])[0].anterior ?? null).toBeNull();
  });
});

describe('Inicio: actividad pendiente', () => {
  it('una planta «No evaluada» no cuenta como pendiente en el panel', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-NE-I-${ctx.R}`, esPrueba: false });
    const [a, b] = await crearIndividuos(ctx, cruce, 2);
    const ra = await crearRonda(ctx, a.id);
    await crearRonda(ctx, b.id);
    await marcar(ctx.admin, ra, 'no_alcanzo');
    const { data } = await ctx.admin.rpc('obtener_dashboard_cientifico', { p_especie_id: ctx.especieId, p_limite: 25 });
    const pendiente = ((data as Fila).pendientes as Fila[]).find((x) => x.planta_id === cruce);
    expect(pendiente?.individuos_pendientes).toBe(1);
  });
});
