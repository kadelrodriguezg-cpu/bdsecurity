/**
 * Fase 5, hallazgo 2 de la guía (decisión G2 y su aclaración): la temporada sigue siendo la ronda anual N. Solo cambia la
 * etiqueta que se muestra: una ronda iniciada entre julio y diciembre de AAAA es «AAAA-AAAA+1»; entre enero y junio,
 * «AAAA-1-AAAA». El año guardado en las rondas no cambia. El cierre de temporada sugiere «Temporada AAAA-AAAA+1» y acepta
 * otro nombre; si ya existe en la especie, avisa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, crearVersion, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;
let cruce: string;
let rondas: string[] = [];

beforeAll(async () => {
  ctx = await iniciarContexto('fase5-temporada');
  await crearVersion(ctx, {
    nombre: `F5 temporada ${ctx.R}`, vigenteDesde: '2020-01-01', pesos: { fruto_calidad: 1 },
    metricas: [{ metrica: 'brix', categoria: 'fruto_calidad', peso: 1, min: 10, max: 20 }],
  });
  // Cruce real (los congelados no incluyen pruebas). crearRonda inicia las rondas el 01-06-2026 (anio 2026).
  cruce = await crearCruce(ctx, { codigo: `F5-TEMP-${ctx.R}`, esPrueba: false });
  const individuos = await crearIndividuos(ctx, cruce, 5);
  rondas = [];
  for (const [n, ind] of individuos.entries()) {
    const r = await crearRonda(ctx, ind.id);
    rondas.push(r);
    await crearEvaluacion(ctx, r, { brix: 12 + n }, { fecha: '2026-06-15' });
  }
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

describe('etiqueta_temporada', () => {
  it.each([
    ['2026-07-01', '2026-2027'],
    ['2026-12-31', '2026-2027'],
    ['2027-01-01', '2026-2027'],
    ['2026-06-30', '2025-2026'],
  ])('una ronda iniciada el %s es de la temporada %s', async (fecha, etiqueta) => {
    const { data, error } = await ctx.operario.rpc('etiqueta_temporada', { p_fecha: fecha });
    expect(error).toBeNull();
    expect(data).toBe(etiqueta);
  });
});

describe('temporada_sugerida y temporadas_especie', () => {
  it('la temporada de la ronda 1 es la más frecuente entre sus plantas, sin tocar el año guardado', async () => {
    const { data, error } = await ctx.operario.rpc('temporada_sugerida', { p_especie_id: ctx.especieId, p_numero_ronda: 1 });
    expect(error).toBeNull();
    expect(data).toBe('2025-2026');
    const { data: guardadas } = await ctx.service.from('ronda_evaluacion_anual').select('anio').in('id', rondas);
    expect((guardadas as Fila[]).every((r) => r.anio === 2026)).toBe(true);
  });

  it('temporadas_especie da la etiqueta por cruce y la de toda la especie', async () => {
    const { data, error } = await ctx.operario.rpc('temporadas_especie', { p_especie_id: ctx.especieId });
    expect(error).toBeNull();
    const filas = data as Fila[];
    expect(filas).toEqual(expect.arrayContaining([
      expect.objectContaining({ planta_id: cruce, tipo_ronda: 'anual', numero_ronda: 1, etiqueta: '2025-2026' }),
      expect.objectContaining({ planta_id: null, tipo_ronda: 'anual', numero_ronda: 1, etiqueta: '2025-2026' }),
    ]));
  });

  it('sin fecha de inicio usa el día en que se creó la ronda', async () => {
    const [ind] = await crearIndividuos(ctx, await crearCruce(ctx, { codigo: `F5-TEMP-SF-${ctx.R}` }), 1);
    const { data: r } = await ctx.service.from('ronda_evaluacion_anual')
      .insert({ individuo_id: ind.id, numero_ronda: 1, anio: 2026, fecha_inicio: null, tipo_ronda: 'anual', created_by: ctx.adminId, created_at: '2026-09-10T15:00:00Z' })
      .select('id').single();
    const { data } = await ctx.operario.rpc('temporadas_especie', { p_especie_id: ctx.especieId });
    const fila = (data as Fila[]).find((f) => f.numero_ronda === 1 && f.planta_id && f.planta_id !== cruce);
    expect(fila?.etiqueta).toBe('2026-2027');
    await ctx.service.from('ronda_evaluacion_anual').delete().eq('id', (r as Fila).id);
  });
});

describe('cerrar_temporada_ranking con nombre editable', () => {
  it('el operario no puede cerrar', async () => {
    const { error } = await ctx.operario.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 1 });
    expect(error?.code).toBe('42501');
  });

  it('sin nombre usa el sugerido «Temporada 2025-2026»', async () => {
    const { data, error } = await ctx.admin.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 1 });
    expect(error).toBeNull();
    expect((data as Fila).nombre).toBe('Temporada 2025-2026');
    const { data: snap } = await ctx.admin.from('ranking_snapshot').select('criterios').eq('id', (data as Fila).snapshot_id).single();
    expect((snap as Fila).criterios).toMatchObject({ cierre_temporada: true, numero_ronda: 1, temporada: '2025-2026' });
  });

  it('el mismo nombre en la misma especie avisa y no duplica (sin distinguir mayúsculas)', async () => {
    const { error } = await ctx.admin.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 1, p_nombre: '  temporada 2025-2026 ' });
    expect(error?.code).toBe('23505');
    expect(error?.message).toBe('Ya existe «temporada 2025-2026» en esta especie');
  });

  it('acepta un nombre propio de la empresa', async () => {
    const { data, error } = await ctx.admin.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 1, p_nombre: 'Temporada 2025-2026 · cierre definitivo' });
    expect(error).toBeNull();
    expect((data as Fila).nombre).toBe('Temporada 2025-2026 · cierre definitivo');
  });

  it('un nombre de más de 120 caracteres se rechaza', async () => {
    const { error } = await ctx.admin.rpc('cerrar_temporada_ranking', { p_especie_id: ctx.especieId, p_numero_ronda: 1, p_nombre: 'x'.repeat(121) });
    expect(error?.code).toBe('22023');
  });
});
