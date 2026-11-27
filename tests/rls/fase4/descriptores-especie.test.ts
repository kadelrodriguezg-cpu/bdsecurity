/**
 * Fase 4, paso 50 (20261026120000): qué descriptores usa cada especie. Sin fila todo sigue activo; escribe solo un admin;
 * cada cambio queda auditado; un descriptor que la especie no usa sale de su puntaje, de su cobertura, de sus protocolos y de
 * los estados de sus evaluaciones (salvo que la evaluación ya traiga valor). No se borra ningún dato.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditoriaDe, crearCruce, crearEvaluacion, crearIndividuos, crearRonda, crearVersion, especieAdicional, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;
let otra: ContextoG6;
let cruce: string;
let evaluacion: string;

beforeAll(async () => {
  ctx = await iniciarContexto('fase4-descriptores');
  otra = await especieAdicional(ctx, 'otra');
  // Versión propia de la especie: Fruto = brix y firmeza (mitad y mitad); Estrés = daño por calor.
  await crearVersion(ctx, {
    nombre: `F4 descriptores ${ctx.R}`, vigenteDesde: '2020-01-01',
    pesos: { fruto_calidad: 0.8, estres: 0.2 },
    metricas: [
      { metrica: 'brix', categoria: 'fruto_calidad', peso: 0.5, min: 10, max: 20 },
      { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 0.5, min: 1, max: 5 },
      { metrica: 'dano_calor', categoria: 'estres', peso: 1, min: 1, max: 5, direccion: 'menor' },
    ],
  });
  cruce = await crearCruce(ctx, { codigo: `F4-DESC-${ctx.R}` });
  const [ind] = await crearIndividuos(ctx, cruce, 1);
  evaluacion = await crearEvaluacion(ctx, await crearRonda(ctx, ind.id), { brix: 20, firmeza: 1, dano_calor: 1, fecha: '2026-11-02' }, { fecha: '2026-11-02' });
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

async function rankingDelIndividuo(): Promise<Fila> {
  const { data, error } = await ctx.admin.rpc('obtener_ranking_por_grupos', { p_planta_id: cruce, p_incluir_pruebas: true });
  expect(error).toBeNull();
  return ((data as Fila).items as Fila[])[0];
}

const desactivar = (cliente: typeof ctx.admin, clave: string, especieId = ctx.especieId) =>
  cliente.from('esquema_campo_especie').upsert({ fase: 'evaluacion_anual', clave, especie_id: especieId, activo: false }).select('clave');

describe('esquema_campo_especie: permisos y validación', () => {
  it('sin filas, todo descriptor está activo para la especie (nada cambia hoy)', async () => {
    const { data, error } = await ctx.operario.rpc('descriptor_activo_en_especie', { p_fase: 'evaluacion_anual', p_clave: 'brix', p_especie_id: ctx.especieId });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('el operario lee pero no escribe; anon no lee', async () => {
    const ins = await desactivar(ctx.operario, 'bloom');
    expect(ins.error !== null || (ins.data ?? []).length === 0).toBe(true);
    const { data: leidas, error } = await ctx.operario.from('esquema_campo_especie').select('clave').eq('especie_id', ctx.especieId);
    expect(error).toBeNull();
    expect(leidas).toEqual([]);
    const anon = await ctx.anon.from('esquema_campo_especie').select('clave');
    expect(anon.error !== null || (anon.data ?? []).length === 0).toBe(true);
  });

  it('solo descriptores; las etiquetas por nivel deben ser una por nivel de la escala', async () => {
    const muestra = await ctx.admin.from('esquema_campo_especie').insert({ fase: 'evaluacion_anual', clave: 'cantidad_frutos', especie_id: ctx.especieId, activo: false });
    expect(muestra.error?.message).toMatch(/Solo los descriptores/);
    const corta = await ctx.admin.from('esquema_campo_especie').insert({ fase: 'evaluacion_anual', clave: 'firmeza', especie_id: ctx.especieId, etiquetas_nivel: ['blanda', 'firme'] });
    expect(corta.error?.message).toMatch(/una por nivel/);
    const numero = await ctx.admin.from('esquema_campo_especie').insert({ fase: 'evaluacion_anual', clave: 'brix', especie_id: ctx.especieId, etiquetas_nivel: ['a', 'b'] });
    expect(numero.error?.message).toMatch(/una por nivel/);
  });

  it('el admin cambia las etiquetas por nivel de una especie y queda auditado con antes y después', async () => {
    const etiquetas = ['Muy blanda', 'Blanda', 'Media', 'Firme', 'Muy firme'];
    const { error } = await ctx.admin.from('esquema_campo_especie').insert({ fase: 'evaluacion_anual', clave: 'firmeza', especie_id: otra.especieId, etiquetas_nivel: etiquetas });
    expect(error).toBeNull();
    const filas = await auditoriaDe(ctx, ctx.adminId, 'cambio_descriptor_especie');
    const fila = filas.find((f) => (f.detalle as Fila).especie_id === otra.especieId && (f.detalle as Fila).clave === 'firmeza');
    expect(fila?.detalle).toMatchObject({ operacion: 'INSERT', anterior: null, nuevo: { activo: true, etiquetas_nivel: etiquetas } });
  });
});

describe('un descriptor que la especie no usa', () => {
  it('advierte cuántas evaluaciones cerradas ya traen valor (no se borra ninguno)', async () => {
    const { data, error } = await ctx.admin.rpc('contar_valores_descriptor', { p_especie_id: ctx.especieId, p_clave: 'firmeza' });
    expect(error).toBeNull();
    expect(data).toBe(1);
  });

  it('sale del puntaje y de la cobertura de esa especie; el valor guardado sigue ahí', async () => {
    const antes = await rankingDelIndividuo();
    // brix 20 → 1; firmeza 1 → 0: Fruto 0,5. Estrés 1 (menor es mejor). Puntaje 0,8·0,5 + 0,2·1 = 0,6.
    expect(Number(antes.puntaje)).toBeCloseTo(0.6, 6);
    expect(antes.cobertura.fruto_calidad).toEqual({ con_valor: 2, total: 2 });

    const { error } = await desactivar(ctx.admin, 'firmeza');
    expect(error).toBeNull();
    const despues = await rankingDelIndividuo();
    // Fruto queda solo con brix (1): 0,8·1 + 0,2·1 = 1.
    expect(Number(despues.puntaje)).toBeCloseTo(1, 6);
    expect(despues.cobertura.fruto_calidad).toEqual({ con_valor: 1, total: 1 });
    const { data: ev } = await ctx.admin.from('evaluaciones').select('firmeza').eq('id', evaluacion).single();
    expect(ev?.firmeza).toBe(1);
  });

  it('una categoría sin descriptores activos queda fuera del grupo y los pesos se reparten', async () => {
    const { error } = await desactivar(ctx.admin, 'dano_calor');
    expect(error).toBeNull();
    const item = await rankingDelIndividuo();
    expect(item.grupo).toEqual(['fruto_calidad']);
    expect(Number(item.puntaje)).toBeCloseTo(1, 6);
  });

  it('no puede pedirse en el protocolo de una ronda de esa especie', async () => {
    const { error } = await ctx.admin.rpc('definir_protocolo_ronda', {
      p_planta_id: cruce, p_tipo_ronda: 'anual', p_numero_ronda: 1, p_nombre: 'Con firmeza', p_descriptores: { brix: 'obligatorio', firmeza: 'opcional' },
    });
    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/esta especie no usa: Firmeza/);
  });

  it('en las evaluaciones nuevas no figura como «no evaluado»; en la que ya trae valor se sigue leyendo', async () => {
    const { data, error } = await ctx.admin.rpc('obtener_estados_evaluacion', { p_evaluacion_id: evaluacion });
    expect(error).toBeNull();
    const estados = (data as Fila).estados as Record<string, string>;
    expect(estados.firmeza).toBe('medido');
    expect(estados.bloom).toBe('no_evaluado');
    await desactivar(ctx.admin, 'bloom');
    const { data: d2 } = await ctx.admin.rpc('obtener_estados_evaluacion', { p_evaluacion_id: evaluacion });
    expect('bloom' in ((d2 as Fila).estados as Fila)).toBe(false);
  });

  it('no afecta a otra especie', async () => {
    const { data } = await ctx.operario.rpc('descriptor_activo_en_especie', { p_fase: 'evaluacion_anual', p_clave: 'firmeza', p_especie_id: otra.especieId });
    expect(data).toBe(true);
  });

  it('volver a activarlo (o borrar la fila) restituye el puntaje de siempre', async () => {
    const { error } = await ctx.admin.from('esquema_campo_especie').delete().eq('especie_id', ctx.especieId).in('clave', ['firmeza', 'dano_calor', 'bloom']);
    expect(error).toBeNull();
    expect(Number((await rankingDelIndividuo()).puntaje)).toBeCloseTo(0.6, 6);
  });
});
