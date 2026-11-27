/**
 * Fase 4, paso 49 (20261026110000): panorama por especie, estado operativo de cada cruce y la última acción auditada.
 * «Sin evaluación cerrada» se cuenta como la planilla (E15, N26). Los cruces de prueba quedan fuera salvo que un admin
 * los pida (N25). El operario ve la fecha y el autor de la última acción, nunca el detalle de la auditoría.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;
let real: string;
let prueba: string;

beforeAll(async () => {
  ctx = await iniciarContexto('fase4-panorama');
  // Un cruce real (no de prueba) en Evaluación anual: 4 vivos, 1 cerrada, 1 borrador, 1 ronda vacía y 1 sin ronda.
  real = await crearCruce(ctx, { codigo: `F4-PAN-R-${ctx.R}`, esPrueba: false });
  const [a, b, c] = await crearIndividuos(ctx, real, 4);
  await crearEvaluacion(ctx, await crearRonda(ctx, a.id), {}, { estado: 'completa' });
  await crearEvaluacion(ctx, await crearRonda(ctx, b.id), {}, { estado: 'borrador' });
  await crearRonda(ctx, c.id);
  // Un cruce de prueba en Crecimiento con 2 vivos.
  prueba = await crearCruce(ctx, { codigo: `F4-PAN-P-${ctx.R}`, estado: 'crecimiento' });
  await crearIndividuos(ctx, prueba, 2);
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

async function panoramaDe(cliente: typeof ctx.admin, incluirPruebas = false): Promise<Fila> {
  const { data, error } = await cliente.rpc('panorama_especies', { p_especie_id: ctx.especieId, p_incluir_pruebas: incluirPruebas });
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  return (data as Fila[])[0];
}

describe('panorama_especies', () => {
  it('cuenta como la planilla y deja fuera los cruces de prueba para todos por defecto', async () => {
    for (const cliente of [ctx.operario, ctx.admin]) {
      const p = await panoramaDe(cliente);
      expect(p).toMatchObject({
        id: ctx.especieId, cruces: 1, cruces_activos: 1, individuos_vivos: 4,
        sin_evaluacion_cerrada: 3, evaluaciones_cerradas: 1, cruces_con_pendientes: 1,
        cruces_por_fase: { evaluacion_anual: 1 }, fases_con_pendientes: { evaluacion_anual: 1 },
      });
    }
    const { data } = await ctx.admin.rpc('obtener_planilla_ronda', { p_planta_id: real, p_tipo_ronda: 'anual' });
    expect((data as Fila).avance.vivos - (data as Fila).avance.completa).toBe(3);
  });

  it('el admin que pide los cruces de prueba los ve; el operario nunca', async () => {
    expect(await panoramaDe(ctx.admin, true)).toMatchObject({ cruces: 2, individuos_vivos: 6, cruces_por_fase: { evaluacion_anual: 1, crecimiento: 1 } });
    expect(await panoramaDe(ctx.operario, true)).toMatchObject({ cruces: 1, individuos_vivos: 4 });
  });

  it('una especie sin cruces aparece con ceros (para la tarjeta «Sin cruces todavía»)', async () => {
    const { data: especie } = await ctx.service.from('especies').insert({ nombre: `F4 vacia ${ctx.R}` }).select('id').single();
    try {
      const { data, error } = await ctx.operario.rpc('panorama_especies', { p_especie_id: especie!.id });
      expect(error).toBeNull();
      expect((data as Fila[])[0]).toMatchObject({ cruces: 0, cruces_activos: 0, individuos_vivos: 0, cruces_por_fase: {}, ultima_actividad: null });
    } finally {
      await ctx.service.from('especies').delete().eq('id', especie!.id);
    }
  });

  it('anon no lo puede llamar', async () => {
    const { error } = await ctx.anon.rpc('panorama_especies', { p_especie_id: ctx.especieId });
    expect(error).not.toBeNull();
  });
});

describe('listar_cruces_analiticos con ronda actual, pendientes y autor', () => {
  it('cada fila trae la ronda actual, las cerradas, los pendientes y quién hizo lo último', async () => {
    const { data, error } = await ctx.operario.rpc('listar_cruces_analiticos', { p_especie_id: ctx.especieId, p_limite: 10 });
    expect(error).toBeNull();
    const fila = ((data as Fila).items as Fila[]).find((c) => c.id === real)!;
    expect(fila.ronda_actual).toMatchObject({ tipo: 'anual', numero: 1, cerradas: 1, vivos: 4 });
    expect(fila.sin_evaluacion_cerrada).toBe(3);
    expect(fila.ultima_actividad).toEqual(expect.any(String));
    expect('ultima_actividad_por' in fila).toBe(true);
  });

  it('un cruce fuera de evaluación no tiene ronda abierta ni pendientes', async () => {
    const { data } = await ctx.admin.rpc('listar_cruces_analiticos', { p_especie_id: ctx.especieId, p_limite: 10, p_incluir_pruebas: true });
    const fila = ((data as Fila).items as Fila[]).find((c) => c.id === prueba)!;
    expect(fila.ronda_actual).toBeNull();
    expect(fila.sin_evaluacion_cerrada).toBe(0);
  });
});

describe('ultima_accion_auditada_cruce', () => {
  it('entrega solo fecha y autor de una acción de trabajo; nunca de un cruce de prueba a un operario', async () => {
    const { error: e1 } = await ctx.admin.from('plantas').update({ estado: 'traslado_destino' }).eq('id', real).select('id');
    expect(e1).toBeNull();
    const { data, error } = await ctx.operario.rpc('ultima_accion_auditada_cruce', { p_planta_id: real });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Object.keys((data as Fila[])[0]).sort()).toEqual(['ocurrido_en', 'usuario_id']);
    expect((data as Fila[])[0].usuario_id).toBe(ctx.adminId);

    const deOperario = await ctx.operario.rpc('ultima_accion_auditada_cruce', { p_planta_id: prueba });
    expect(deOperario.error).toBeNull();
    expect(deOperario.data).toEqual([]);
    const anon = await ctx.anon.rpc('ultima_accion_auditada_cruce', { p_planta_id: real });
    expect(anon.error).not.toBeNull();
  });
});
