/**
 * G5 / E02 — Validación de valores en el servidor y efecto de las fechas en
 * la unificación de visitas (`unificar_evaluacion_ronda`).
 *
 * Lo que se demuestra:
 * - el servidor solo exige rangos técnicos (no negativo, 1-5, 0-100): una
 *   cobertura floral de 1000 %, un Brix de 999, un rendimiento de 1 000 000
 *   kg/planta o una fecha del año 9999 se guardan, y solo calibre >= 40 mm
 *   activa `requiere_revision` (no hay límites de revisión para Brix ni para
 *   los otros descriptores) (A1-G5-15);
 * - la regla «hijo <= padre» (varas con flor <= varas basales, frutos <=
 *   flores) es solo una advertencia de la UI (A1-G5-15, `it.fails`);
 * - una fecha mal tipeada hacia el futuro gana la unificación de la ronda
 *   frente a visitas posteriores reales (A1-G5-12);
 * - control positivo: `obtener_procedencia_calidad_ronda` sí marca el
 *   descriptor que viene de una visita con calibre fuera de rango aunque la
 *   visita más reciente esté limpia.
 */
import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  camposCompletaConMuestra,
  crearCruce,
  crearIndividuo,
  prepararContexto,
  purgarCruces,
  type ContextoG5,
} from './g5-setup';

let ctx: ContextoG5;
let cruce: string;
let n = 0;

beforeAll(async () => {
  ctx = await prepararContexto('val');
  cruce = await crearCruce(ctx, 'VAL', 'evaluacion_anual');
}, 60_000);

afterAll(async () => {
  await purgarCruces(ctx, [cruce]);
});

async function rondaNueva(): Promise<string> {
  const individuo = await crearIndividuo(ctx, cruce, `VAL-${++n}`);
  const { data, error } = await iniciarRondaAnual(ctx.operario, individuo);
  if (error) throw new Error(`setup ronda: ${error.message}`);
  return (data as { ronda_id: string }).ronda_id;
}

async function insertarBorrador(ronda: string, campos: Record<string, unknown>) {
  return ctx.operario
    .from('evaluaciones')
    .insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'borrador', created_by: ctx.operarioId, ...campos })
    .select('id, anio, requiere_revision, pct_flores, pct_frutos, peso_promedio_g')
    .single();
}

describe('A1-G5-15 — rangos: lo que el servidor deja pasar', () => {
  it('Brix 999 y rendimiento de 1 000 000 kg/planta se guardan sin requiere_revision (no hay límite de revisión para ellos)', async () => {
    const ronda = await rondaNueva();
    const { data, error } = await insertarBorrador(ronda, { brix: 999, rend_kg_planta: 1_000_000, rend_t_ha: 5_000_000 });
    expect(error).toBeNull();
    expect(data!.requiere_revision).toBe(false);
  });

  it('control: calibre >= 40 mm sí activa requiere_revision (único límite de revisión configurado hoy)', async () => {
    const ronda = await rondaNueva();
    const { data } = await insertarBorrador(ronda, { calibre_mm: 45 });
    expect(data!.requiere_revision).toBe(true);
    const { data: bajo } = await insertarBorrador(await rondaNueva(), { calibre_mm: 0.5 });
    expect(bajo!.requiere_revision).toBe(false); // sin límite inferior
  });

  it('pct_flores y pct_frutos pueden pasar de 100 % (varas con flor > varas basales): la columna generada no acota', async () => {
    const ronda = await rondaNueva();
    const { data, error } = await insertarBorrador(ronda, {
      n_varas_basales: 4, n_varas_con_flor: 40, n_flores_varas_basales: 10, n_frutos_varas_basales: 90,
    });
    expect(error).toBeNull();
    expect(Number(data!.pct_flores)).toBe(1000);
    expect(Number(data!.pct_frutos)).toBe(900);
  });

  it.fails('debería rechazar n_varas_con_flor > n_varas_basales y n_frutos > n_flores en el servidor (hoy solo advierte la UI) (A1-G5-15)', async () => {
    const ronda = await rondaNueva();
    const { error } = await insertarBorrador(ronda, { n_varas_basales: 4, n_varas_con_flor: 40 });
    expect(error).not.toBeNull();
  });

  it('cerrar con cantidad_frutos = 0 y peso > 0 es posible solo con sin_muestra = true; peso_promedio_g queda nulo', async () => {
    const ronda = await rondaNueva();
    const sinFlag = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'completa', created_by: ctx.operarioId, cantidad_frutos: 0, peso_total_g: 50 });
    expect(sinFlag.error?.code).toBe('23514');
    const conFlag = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'completa', created_by: ctx.operarioId, cantidad_frutos: 0, peso_total_g: 50, sin_muestra: true })
      .select('peso_promedio_g')
      .single();
    expect(conFlag.error).toBeNull();
    expect(conFlag.data!.peso_promedio_g).toBeNull();
  });

  it('fechas absurdas (año 1 y año 9999) se guardan y fijan `anio` con ese valor', async () => {
    const antigua = await insertarBorrador(await rondaNueva(), { fecha: '0001-01-01' });
    expect(antigua.error).toBeNull();
    expect(antigua.data!.anio).toBe(1);
    const lejana = await insertarBorrador(await rondaNueva(), { fecha: '9999-12-31' });
    expect(lejana.error).toBeNull();
    expect(lejana.data!.anio).toBe(9999);
  });
});

describe('A1-G5-12 — una fecha mal tipeada gana la unificación de la ronda', () => {
  it('la visita con fecha 2062 prevalece sobre una visita real posterior para cada descriptor que midió', async () => {
    const ronda = await rondaNueva();
    const base = { ronda_id: ronda, created_by: ctx.operarioId, ...camposCompletaConMuestra() };
    // Visita real de junio.
    expect((await ctx.operario.from('evaluaciones').insert({ ...base, fecha: '2026-06-01', brix: 14, firmeza: 4 })).error).toBeNull();
    // Visita con año mal tipeado (2062 en vez de 2026): solo la UI advierte, el servidor acepta.
    expect((await ctx.operario.from('evaluaciones').insert({ ...base, fecha: '2062-06-15', brix: 9, firmeza: 2 })).error).toBeNull();
    // Visita real posterior, la que el equipo cree que manda.
    expect((await ctx.operario.from('evaluaciones').insert({ ...base, fecha: '2026-07-01', brix: 17, firmeza: 5 })).error).toBeNull();

    const { data, error } = await ctx.operario.rpc('unificar_evaluacion_ronda', { p_ronda_id: ronda });
    expect(error).toBeNull();
    const unificada = (data as Array<{ brix: number; firmeza: number; fecha: string }>)[0];
    expect(Number(unificada.brix)).toBe(9);
    expect(unificada.firmeza).toBe(2);
    expect(unificada.fecha).toBe('2062-06-15');
  });
});

describe('control — la procedencia de calidad sí detecta el descriptor viciado aunque la visita más reciente esté limpia', () => {
  it('calibre 45 en una visita vieja + visita nueva sin ese dato: calibre_mm figura en descriptores_con_revision', async () => {
    const ronda = await rondaNueva();
    const base = { ronda_id: ronda, created_by: ctx.operarioId };
    expect((await ctx.operario.from('evaluaciones').insert({ ...base, fecha: '2026-06-01', ...camposCompletaConMuestra({ calibre_mm: 45 }) })).error).toBeNull();
    expect((await ctx.operario.from('evaluaciones').insert({ ...base, fecha: '2026-07-01', estado: 'completa', sin_muestra: true, firmeza: 4 })).error).toBeNull();

    const { data: unificada } = await ctx.operario.rpc('unificar_evaluacion_ronda', { p_ronda_id: ronda });
    const fila = (unificada as Array<{ requiere_revision: boolean; calibre_mm: number }>)[0];
    expect(fila.requiere_revision).toBe(false); // la fila representante (julio) está limpia
    expect(Number(fila.calibre_mm)).toBe(45); // pero el calibre viene de junio

    const { data: procedencia } = await ctx.operario.rpc('obtener_procedencia_calidad_ronda', { p_ronda_id: ronda });
    const p = (Array.isArray(procedencia) ? procedencia[0] : procedencia) as { descriptores_con_revision: string[] };
    expect(p.descriptores_con_revision).toContain('calibre_mm');
  });
});
