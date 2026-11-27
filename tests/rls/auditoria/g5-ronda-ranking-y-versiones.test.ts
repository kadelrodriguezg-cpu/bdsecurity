/**
 * G5 / E01 + E03 — Efecto de iniciar una ronda sobre el ranking y ligadura de
 * la ronda a la versión de scoring cuando la versión ya fue reemplazada.
 *
 * Todo con una especie PROPIA y versiones de scoring PROPIAS, para no
 * depender de la versión global ni de lo que activen otros agentes.
 *
 * - A1-G5-08: «Iniciar ronda N+1» no se puede deshacer y, apenas se crea,
 *   el individuo deja de puntuar en el ranking del cruce (la «ronda actual»
 *   es la de mayor número) aunque su ronda anterior esté completa.
 * - A1-G5-11: `ligar_ronda_a_version_scoring` usa `resolver_scoring_version`,
 *   que solo considera versiones en estado `activa`. Una evaluación con fecha
 *   dentro de la vigencia de una versión YA REEMPLAZADA (carga tardía) deja
 *   la ronda sin versión (`it.fails`).
 */
import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  borrarVersionesScoring,
  camposCompletaConMuestra,
  crearCruce,
  crearIndividuo,
  crearVersionScoring,
  prepararContexto,
  purgarCruces,
  type ContextoG5,
} from './g5-setup';

let ctx: ContextoG5;
let cruce: string;
const versiones: string[] = [];
let n = 0;

beforeAll(async () => {
  ctx = await prepararContexto('rver', { especiePropia: true });
  cruce = await crearCruce(ctx, 'RVER', 'evaluacion_anual');
}, 60_000);

afterAll(async () => {
  await purgarCruces(ctx, [cruce], { especieIds: [] });
  borrarVersionesScoring(versiones);
  await ctx.service.from('especies').delete().eq('id', ctx.especieId);
});

async function iniciarRonda(individuo: string): Promise<string> {
  const { data, error } = await iniciarRondaAnual(ctx.operario, individuo);
  if (error) throw new Error(`iniciar ronda: ${error.message}`);
  return (data as { ronda_id: string }).ronda_id;
}

async function scoringDe(individuo: string) {
  const { data, error } = await ctx.operario.rpc('obtener_scoring_planta', { p_planta_id: cruce });
  if (error) throw new Error(`scoring: ${error.message}`);
  return (data as Array<Record<string, unknown>>).find((f) => f.individuo_id === individuo);
}

async function cerrar(rondaId: string, fecha: string, extra: Record<string, unknown> = {}) {
  return ctx.operario
    .from('evaluaciones')
    .insert({ ronda_id: rondaId, fecha, created_by: ctx.operarioId, firmeza: 4, brix: 15, ...camposCompletaConMuestra(), ...extra })
    .select('id')
    .single();
}

async function versionDeRonda(rondaId: string): Promise<string | null> {
  const { data } = await ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', rondaId).single();
  return (data?.scoring_version_id as string | null) ?? null;
}

describe('A1-G5-08 — iniciar la ronda siguiente saca al individuo del ranking, sin aviso ni deshacer', () => {
  let v1: string;
  beforeAll(async () => {
    v1 = await crearVersionScoring(ctx, ctx.especieId, { nombre: 'rver-activa', desde: '2026-01-01', estado: 'activa' });
    versiones.push(v1);
  });

  it('con la ronda 1 completa el individuo puntúa; al iniciar la ronda 2 (vacía) pierde el puntaje y la posición', async () => {
    const individuo = await crearIndividuo(ctx, cruce, `RVER-${++n}`);
    const ronda1 = await iniciarRonda(individuo);
    const cierre = await cerrar(ronda1, '2026-06-01');
    expect(cierre.error).toBeNull();

    const antes = await scoringDe(individuo);
    expect(antes?.elegible).toBe(true);
    expect(Number(antes?.puntaje_ponderado)).toBeGreaterThan(0);
    expect(antes?.numero_ronda).toBe(1);

    // Un toque en «Iniciar ronda 2» (RondasSeccion.tsx:193 / ExpedienteIndividuo.tsx:390), sin confirmación.
    await iniciarRonda(individuo);

    const despues = await scoringDe(individuo);
    expect(despues?.elegible).toBe(false);
    expect(despues?.puntaje_ponderado).toBeNull();
    expect(despues?.evaluacion_id).toBeNull();
    expect(despues?.numero_ronda).toBe(2);
    expect(despues?.motivo_exclusion).toBe('sin_evaluacion_completa_en_ronda_actual');
  });

  it('la ronda vacía no se puede retirar: ni el operario ni el admin la borran o la editan por la API', async () => {
    const individuo = await crearIndividuo(ctx, cruce, `RVER-${++n}`);
    const ronda1 = await iniciarRonda(individuo);
    await cerrar(ronda1, '2026-06-01');
    const ronda2 = await iniciarRonda(individuo);
    for (const cliente of [ctx.operario, ctx.admin]) {
      const borrar = await cliente.from('ronda_evaluacion_anual').delete().eq('id', ronda2);
      expect(borrar.error?.code).toBe('42501');
    }
    const { count } = await ctx.service.from('ronda_evaluacion_anual').select('id', { count: 'exact', head: true }).eq('id', ronda2);
    expect(count).toBe(1);
  });

  it('A1-G5-01 corregido: INSERT directo de ronda 3 se rechaza y conserva el ranking evaluado', async () => {
    const individuo = await crearIndividuo(ctx, cruce, `RVER-${++n}`);
    const ronda1 = await iniciarRonda(individuo);
    await cerrar(ronda1, '2026-06-01');
    expect((await scoringDe(individuo))?.elegible).toBe(true);

    // Intentar saltar el correlativo (1 -> 3) fuera de la RPC.
    const { data, error } = await ctx.operario
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo, tipo_ronda: 'anual', numero_ronda: 3, anio: 2026, created_by: ctx.operarioId })
      .select('id')
      .single();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();

    const fila = await scoringDe(individuo);
    expect(fila?.elegible).toBe(true);
    expect(fila?.numero_ronda).toBe(1);

    const borrar = await ctx.admin.from('ronda_evaluacion_anual').delete().eq('id', ronda1);
    expect(borrar.error?.code).toBe('42501');
  });

  it('basta evaluar la ronda 2 para volver al ranking (el efecto se corrige cargando datos, no deshaciendo la ronda)', async () => {
    const individuo = await crearIndividuo(ctx, cruce, `RVER-${++n}`);
    const ronda1 = await iniciarRonda(individuo);
    await cerrar(ronda1, '2026-06-01');
    const ronda2 = await iniciarRonda(individuo);
    await cerrar(ronda2, '2026-06-10');
    const fila = await scoringDe(individuo);
    expect(fila?.elegible).toBe(true);
    expect(fila?.numero_ronda).toBe(2);
  });
});

describe('A1-G5-11 — ligadura de la ronda cuando la versión de la fecha ya fue reemplazada', () => {
  let vieja: string;
  let nueva: string;

  beforeAll(async () => {
    // Especie propia distinta para no mezclar con la versión de la sección anterior.
    const { data: especie, error } = await ctx.service.from('especies').insert({ nombre: `AUD-G5 rver2 ${ctx.sufijo}` }).select('id').single();
    if (error || !especie) throw new Error(`setup especie 2: ${error?.message}`);
    especieSegunda = especie.id as string;
    cruceSegundo = await crearCruce(ctx, 'RVER2', 'evaluacion_anual', especieSegunda);
    vieja = await crearVersionScoring(ctx, especieSegunda, { nombre: 'v1', desde: '2026-01-01', estado: 'activa' });
    nueva = await crearVersionScoring(ctx, especieSegunda, { nombre: 'v2', desde: '2026-07-01', estado: 'inactiva' });
    versiones.push(vieja, nueva);
  });

  afterAll(async () => {
    await purgarCruces(ctx, [cruceSegundo]);
    borrarVersionesScoring([vieja, nueva]);
    await ctx.service.from('especies').delete().eq('id', especieSegunda);
  });

  let especieSegunda: string;
  let cruceSegundo: string;

  async function rondaDelSegundo(): Promise<string> {
    const individuo = await crearIndividuo(ctx, cruceSegundo, `RVER2-${++n}`);
    return iniciarRonda(individuo);
  }

  it('control: mientras V1 es la activa, una evaluación fechada en su vigencia liga la ronda a V1', async () => {
    const ronda = await rondaDelSegundo();
    expect((await cerrar(ronda, '2026-05-10')).error).toBeNull();
    expect(await versionDeRonda(ronda)).toBe(vieja);
  });

  it.fails('debería ligarse a V1 una evaluación fechada en la vigencia de V1 aunque se cargue DESPUÉS de activar V2 (A1-G5-11)', async () => {
    const activar = await ctx.admin.rpc('activar_version_scoring', { p_version_id: nueva });
    expect(activar.error).toBeNull();
    const { data: v1 } = await ctx.service.from('scoring_version').select('estado, vigente_hasta').eq('id', vieja).single();
    expect(v1).toEqual({ estado: 'inactiva', vigente_hasta: '2026-06-30' });

    const ronda = await rondaDelSegundo();
    expect((await cerrar(ronda, '2026-05-10')).error).toBeNull();
    // Hoy queda null o ligada a la versión global: resolver_scoring_version ignora V1 por estar 'inactiva'.
    expect(await versionDeRonda(ronda)).toBe(vieja);
  });

  it('documenta el estado actual: tras activar V2, la misma fecha NO liga a V1 (queda sin versión o ligada a la versión global de respaldo) y una fecha de V2 sí liga a V2', async () => {
    // (la activación ocurrió en la prueba anterior; es idempotente si ya estaba activa)
    await ctx.admin.rpc('activar_version_scoring', { p_version_id: nueva });
    const tardia = await rondaDelSegundo();
    await cerrar(tardia, '2026-05-10');
    const ligada = await versionDeRonda(tardia);
    // Sin versión propia vigente, resolver_scoring_version cae a la versión
    // global (especie_id nulo) si existe, o a nada: nunca a V1.
    expect(ligada).not.toBe(vieja);
    expect(ligada).not.toBe(nueva);

    const vigente = await rondaDelSegundo();
    await cerrar(vigente, '2026-08-01');
    expect(await versionDeRonda(vigente)).toBe(nueva);
  });
});
