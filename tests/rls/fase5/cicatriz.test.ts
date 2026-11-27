/**
 * Fase 5, segunda parte (decisión G9, EF21): descriptor «Cicatriz» en Fruto/Calidad, escala 1–5 provisional
 * (1 = grande, húmeda o desgarrada; 5 = pequeña y seca), opcional y con peso 0 (no tiene fila en scoring_metrica).
 * Es un descriptor de fruto: exige la muestra de frutos como los demás.
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

const CONTENEDOR = 'supabase_db_dbsecurity-frutales';
const psql = (sql: string) => execFileSync('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
  input: sql, encoding: 'utf8',
}).trim();

let ctx: ContextoG6;

beforeAll(async () => {
  ctx = await iniciarContexto('fase5-cicatriz');
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

async function rondaNueva(codigo: string): Promise<string> {
  const cruce = await crearCruce(ctx, { codigo: `${codigo}-${ctx.R}` });
  const [a] = await crearIndividuos(ctx, cruce, 1);
  return crearRonda(ctx, a.id);
}

describe('descriptor «Cicatriz»', () => {
  it('el esquema lo declara en Fruto/Calidad, justo después del Brix, con la escala 1–5 y sus extremos', async () => {
    const { data, error } = await ctx.operario.from('esquema_fase_campo').select('*').eq('fase', 'evaluacion_anual').eq('clave', 'cicatriz').single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      seccion: 'fruto', etiqueta: 'Cicatriz', rol: 'descriptor', tipo: 'escala', orden: 22, escala_minimo: 1, escala_maximo: 5,
      etiqueta_minimo: 'Grande, húmeda o desgarrada', etiqueta_maximo: 'Pequeña y seca', exige_muestra: true, activo: true,
      etiquetas_nivel: null, vigente_desde: '2026-10-26',
    });
  });

  it('los órdenes del esquema siguen contiguos (1 a 36) y la muestra de frutos queda después del Brix y la cicatriz', async () => {
    const { data } = await ctx.operario.from('esquema_fase_campo').select('clave, orden').eq('fase', 'evaluacion_anual').order('orden');
    const filas = (data ?? []) as Fila[];
    expect(filas.map((c) => c.orden)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    expect(filas.slice(20, 23).map((c) => c.clave)).toEqual(['brix', 'cicatriz', 'cantidad_frutos']);
  });

  it('acepta 1 a 5 y rechaza 0 y 6 con su restricción', async () => {
    const ronda = await rondaNueva('F5-CIC-A');
    for (const malo of [0, 6]) {
      const { error } = await ctx.operario.from('evaluaciones')
        .insert({ ronda_id: ronda, fecha: '2026-06-20', estado: 'borrador', cicatriz: malo, created_by: ctx.operarioId });
      expect(error?.code).toBe('23514');
      expect(error?.message).toContain('evaluaciones_cicatriz_check');
    }
    const id = await crearEvaluacion(ctx, ronda, { cicatriz: 4 });
    const { data } = await ctx.operario.from('evaluaciones').select('cicatriz').eq('id', id).single();
    expect(data?.cicatriz).toBe(4);
  });

  it('es un descriptor de fruto: con cicatriz y sin muestra no se puede cerrar (regla de frutos)', async () => {
    const ronda = await rondaNueva('F5-CIC-B');
    const { error } = await ctx.service.from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-21', estado: 'completa', cicatriz: 3, created_by: ctx.adminId });
    expect(error).not.toBeNull();
  });

  it('la fotografía de la ronda toma el valor no nulo más reciente', async () => {
    const ronda = await rondaNueva('F5-CIC-C');
    await crearEvaluacion(ctx, ronda, { cicatriz: 2, brotacion: 3 }, { fecha: '2026-06-10' });
    await crearEvaluacion(ctx, ronda, { cicatriz: 5 }, { fecha: '2026-06-17' });
    await crearEvaluacion(ctx, ronda, { brotacion: 4 }, { fecha: '2026-06-24' });
    const { data, error } = await ctx.service.rpc('unificar_evaluacion_ronda', { p_ronda_id: ronda });
    expect(error).toBeNull();
    const fila = (Array.isArray(data) ? data[0] : data) as Fila;
    expect(fila.cicatriz).toBe(5);
    expect(fila.brotacion).toBe(4);
  });

  it('un protocolo puede pedirla y estados_descriptores la informa', async () => {
    expect(psql(`select coalesce(public.validar_descriptores_protocolo('{"cicatriz":"opcional"}'::jsonb), 'VALIDO')`)).toBe('VALIDO');
    const ronda = await rondaNueva('F5-CIC-D');
    const id = await crearEvaluacion(ctx, ronda, { cicatriz: 3 }, { fecha: '2026-10-27' });
    const estados = JSON.parse(psql(`select public.estados_descriptores(e) from public.evaluaciones e where e.id = '${id}'`)) as Record<string, string>;
    expect(estados.cicatriz).toBe('medido');
  });

  it('no entra a ninguna versión de puntaje (peso 0)', async () => {
    const { data } = await ctx.service.from('scoring_metrica').select('id').eq('metrica', 'cicatriz');
    expect(data).toEqual([]);
  });
});
