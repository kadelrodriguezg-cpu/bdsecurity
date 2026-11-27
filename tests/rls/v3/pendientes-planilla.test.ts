/**
 * v3 paso 6 (N26, migración 20261024090000): «Actividad pendiente» de Inicio (pendientes de
 * obtener_dashboard_cientifico) cuenta lo mismo que la planilla (obtener_planilla_ronda): individuos vivos
 * sin evaluación cerrada en la última ronda del cruce. Antes contaba los no elegibles del ranking antiguo.
 * Los cruces son de prueba (N29): se leen como admin con p_incluir_pruebas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;

beforeAll(async () => {
  ctx = await iniciarContexto('v3-pendientes');
}, 60_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

async function pendientesDelPanel(plantaId: string): Promise<number | undefined> {
  const { data, error } = await ctx.admin.rpc('obtener_dashboard_cientifico', { p_especie_id: ctx.especieId, p_limite: 25, p_incluir_pruebas: true });
  expect(error).toBeNull();
  return ((data as Fila).pendientes as Fila[]).find((p) => p.planta_id === plantaId)?.individuos_pendientes;
}

async function sinCerrarEnPlanilla(plantaId: string, tipo: 'anual' | 'multisitio' = 'anual'): Promise<number> {
  const { data, error } = await ctx.admin.rpc('obtener_planilla_ronda', { p_planta_id: plantaId, p_tipo_ronda: tipo });
  expect(error).toBeNull();
  const avance = (data as Fila).avance;
  return avance.vivos - avance.completa;
}

describe('Actividad pendiente = individuos vivos sin evaluación cerrada en la última ronda (como la planilla)', () => {
  it('Evaluación anual: cuenta borrador, ronda sin evaluación y sin ronda; no cuenta cerradas ni bajas', async () => {
    const cruce = await crearCruce(ctx, { codigo: `V3-PEND-A-${ctx.R}` });
    const [i1, i2, i3, i4, , i6] = await crearIndividuos(ctx, cruce, 6); // el quinto queda sin ronda
    await crearEvaluacion(ctx, await crearRonda(ctx, i1.id), {}, { estado: 'completa' });
    // Una corrección solo la hace un admin (trigger de integridad): se cierra y el admin la corrige.
    const aCorregir = await crearEvaluacion(ctx, await crearRonda(ctx, i2.id), {}, { estado: 'completa' });
    const corr = await ctx.admin.from('evaluaciones').update({ estado: 'corregida', motivo_cambio: 'prueba v3' }).eq('id', aCorregir);
    expect(corr.error).toBeNull();
    await crearEvaluacion(ctx, await crearRonda(ctx, i3.id), {}, { estado: 'borrador' });
    await crearRonda(ctx, i4.id);
    await crearRonda(ctx, i6.id);
    const { error } = await ctx.service.from('individuos').update({ estado_vital: 'muerto', fecha_baja: '2026-10-01' }).eq('id', i6.id);
    expect(error).toBeNull();

    expect(await sinCerrarEnPlanilla(cruce)).toBe(3);
    expect(await pendientesDelPanel(cruce)).toBe(3);

    // Se abre la ronda 2 para un individuo: la última ronda del cruce pasa a ser la 2 y nadie la tiene cerrada.
    await crearRonda(ctx, i1.id, 2);
    expect(await sinCerrarEnPlanilla(cruce)).toBe(5);
    expect(await pendientesDelPanel(cruce)).toBe(5);
  });

  it('Multisitio: cuenta sobre la ronda multisitio, no sobre la anual', async () => {
    const cruce = await crearCruce(ctx, { codigo: `V3-PEND-M-${ctx.R}`, estado: 'traslado_destino' });
    const [a, b] = await crearIndividuos(ctx, cruce, 2);
    for (const ind of [a, b]) await crearEvaluacion(ctx, await crearRonda(ctx, ind.id), {}, { estado: 'completa' });
    await crearEvaluacion(ctx, await crearRonda(ctx, a.id, 1, 'multisitio'), {}, { estado: 'completa' });
    await crearRonda(ctx, b.id, 1, 'multisitio');

    expect(await sinCerrarEnPlanilla(cruce, 'multisitio')).toBe(1);
    expect(await pendientesDelPanel(cruce)).toBe(1);
  });

  it('un cruce con todo cerrado no aparece en pendientes', async () => {
    const cruce = await crearCruce(ctx, { codigo: `V3-PEND-C-${ctx.R}` });
    const [a] = await crearIndividuos(ctx, cruce, 1);
    await crearEvaluacion(ctx, await crearRonda(ctx, a.id), {}, { estado: 'completa' });
    expect(await sinCerrarEnPlanilla(cruce)).toBe(0);
    expect(await pendientesDelPanel(cruce)).toBeUndefined();
  });

  it('paso 7: la lista de cruces con p_solo_pendientes muestra exactamente los cruces que el panel cuenta con pendientes', async () => {
    const lista = async (soloPendientes: boolean) => {
      const { data, error } = await ctx.admin.rpc('listar_cruces_analiticos', { p_especie_id: ctx.especieId, p_limite: 100, p_incluir_pruebas: true, p_solo_pendientes: soloPendientes });
      expect(error).toBeNull();
      return ((data as Fila).items as Fila[]).map((c) => c.codigo_sistema as string).sort();
    };
    const { data } = await ctx.admin.rpc('obtener_dashboard_cientifico', { p_especie_id: ctx.especieId, p_limite: 25, p_incluir_pruebas: true });
    const conPendientes = ((data as Fila).pendientes as Fila[]).map((p) => p.codigo_sistema as string).sort();
    expect(conPendientes.length).toBeGreaterThan(0);
    expect(await lista(true)).toEqual(conPendientes);
    expect((await lista(false)).length).toBeGreaterThan(conPendientes.length); // el cruce con todo cerrado sigue en la lista normal
  });
});
