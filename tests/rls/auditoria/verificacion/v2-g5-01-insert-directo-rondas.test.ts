/**
 * Verificación independiente de A1-G5-01 (INSERT directo en ronda_evaluacion_anual).
 *
 * Qué se comprueba, con un operario propio y SIN usar la RPC iniciar_ronda_evaluacion:
 *  a) puede insertar una ronda sobre un individuo MUERTO y en un cruce que NO está
 *     en evaluación anual, con número no correlativo y versión de scoring elegida
 *     a mano (la RPC rechaza lo mismo: control);
 *  b) puede sacar del ranking a un individuo ya evaluado (ronda 3 vacía), y nadie
 *     (ni admin) puede borrar esa ronda por la API;
 *  c) la fila queda auditada igual que una ronda legítima (no hay marca de bypass).
 */
import { iniciarRondaAnual } from '../../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoV2, psql } from './v2-comun';

const ctx = new ContextoV2('g5-01');
let operario: Awaited<ReturnType<ContextoV2['usuario']>>;
let admin: Awaited<ReturnType<ContextoV2['usuario']>>;
let especieId: string;
let versionActiva: string;
let versionOtra: string;
let cruceEval: string; // fase evaluacion_anual
let cruceCrec: string; // fase crecimiento
const individuos: Record<string, string> = {};

async function nuevoCruce(sufijo: string, estado: string): Promise<string> {
  const { data, error } = await ctx.service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-V2-${sufijo}-${ctx.sufijo}`, especie_id: especieId, estado, es_prueba: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`cruce ${sufijo}: ${error?.message}`);
  return data.id as string;
}

async function nuevoIndividuo(plantaId: string, codigo: string): Promise<string> {
  const { data, error } = await ctx.service
    .from('individuos')
    .insert({ planta_id: plantaId, codigo_display: `AUD-V2-${codigo}-${ctx.sufijo}`, created_by: admin.userId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`individuo ${codigo}: ${error?.message}`);
  return data.id as string;
}

async function crearVersion(nombre: string, estado: 'activa' | 'inactiva'): Promise<string> {
  const { data, error } = await ctx.service
    .from('scoring_version')
    .insert({
      nombre: `AUD-V2 ${nombre} ${ctx.sufijo}`,
      especie_id: especieId,
      fase: 'evaluacion_anual',
      vigente_desde: '2026-01-01',
      vigente_hasta: null,
      estado,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`version ${nombre}: ${error?.message}`);
  const { error: e2 } = await ctx.service.from('scoring_metrica').insert([
    { scoring_version_id: data.id, categoria: 'fruto_calidad', metrica: 'firmeza', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 1 },
    { scoring_version_id: data.id, categoria: 'fruto_calidad', metrica: 'brix', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 10, maximo_normalizacion: 20, orden: 2 },
  ]);
  if (e2) throw new Error(`metricas ${nombre}: ${e2.message}`);
  return data.id as string;
}

beforeAll(async () => {
  admin = await ctx.usuario('admin');
  operario = await ctx.usuario('operario');
  const { data: esp, error } = await ctx.service.from('especies').insert({ nombre: `AUD-V2 g5-01 ${ctx.sufijo}` }).select('id').single();
  if (error || !esp) throw new Error(`especie: ${error?.message}`);
  especieId = esp.id as string;
  versionActiva = await crearVersion('activa', 'activa');
  versionOtra = await crearVersion('otra', 'inactiva');
  cruceEval = await nuevoCruce('EVAL', 'evaluacion_anual');
  cruceCrec = await nuevoCruce('CREC', 'crecimiento');
  individuos.vivoEval = await nuevoIndividuo(cruceEval, 'VIVOEVAL');
  individuos.muertoEval = await nuevoIndividuo(cruceEval, 'MUERTO');
  individuos.vivoCrec = await nuevoIndividuo(cruceCrec, 'VIVOCREC');
  await ctx.service.from('individuos').update({ estado_vital: 'muerto', fecha_baja: '2026-10-01' }).eq('id', individuos.muertoEval);
}, 90_000);

afterAll(async () => {
  const lista = Object.values(individuos).map((i) => `'${i}'`).join(',');
  // Datos propios: evaluaciones de las rondas de estos individuos, luego los cruces (hard delete de la app).
  psql(`delete from evaluaciones where ronda_id in (select id from ronda_evaluacion_anual where individuo_id in (${lista}));`);
  for (const planta of [cruceEval, cruceCrec]) {
    const { error } = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: planta, p_tipo: 'hard' });
    if (error) console.warn(`[v2-g5-01] no se pudo purgar ${planta}: ${error.message}`);
  }
  psql(`delete from scoring_metrica where scoring_version_id in ('${versionActiva}','${versionOtra}');
        delete from scoring_version where id in ('${versionActiva}','${versionOtra}');
        delete from especies where id = '${especieId}';`);
  const fallos = await ctx.borrarUsuarios();
  if (fallos.length) console.warn('[v2-g5-01] usuarios no borrados:', fallos);
}, 90_000);

describe('A1-G5-01 — INSERT directo de rondas', () => {
  it('control: la RPC rechaza individuo muerto y cruce fuera de evaluación anual', async () => {
    const muerto = await iniciarRondaAnual(operario.client, individuos.muertoEval);
    expect(muerto.error?.code).toBe('42501');
    const fase = await iniciarRondaAnual(operario.client, individuos.vivoCrec);
    expect(fase.error?.code).toBe('42501');
  });

  it('A1-007 rechaza INSERT directo sobre individuo muerto, año 1999, número 3 y versión elegida', async () => {
    const { data, error } = await operario.client
      .from('ronda_evaluacion_anual')
      .insert({
        individuo_id: individuos.muertoEval,
        tipo_ronda: 'anual',
        numero_ronda: 3,
        anio: 1999,
        scoring_version_id: versionOtra,
        created_by: operario.userId,
      })
      .select('id')
      .single();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
    expect(psql(`select count(*) from ronda_evaluacion_anual where individuo_id='${individuos.muertoEval}'`)).toBe('0');
  });

  it('A1-007 rechaza INSERT directo en un cruce en fase crecimiento', async () => {
    const { error } = await operario.client
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuos.vivoCrec, tipo_ronda: 'anual', numero_ronda: 2, anio: 2026, created_by: operario.userId });
    expect(error?.code).toBe('42501');
  });

  it('con otro created_by la policy lo rechaza (control de que RLS sí actúa)', async () => {
    const { error } = await operario.client
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuos.vivoEval, tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, created_by: admin.userId });
    expect(error?.code).toBe('42501');
  });

  it('A1-007 rechaza ronda 3 directa y conserva el ranking de la ronda legítima, que sigue sin DELETE', async () => {
    const r1 = await iniciarRondaAnual(operario.client, individuos.vivoEval);
    expect(r1.error).toBeNull();
    const rondaId = (r1.data as { ronda_id: string }).ronda_id;
    const ev = await operario.client.from('evaluaciones').insert({
      ronda_id: rondaId, fecha: '2026-06-01', created_by: operario.userId,
      firmeza: 4, brix: 15, estado: 'completa', cantidad_frutos: 10, peso_total_g: 120,
    });
    expect(ev.error).toBeNull();

    const rank = async () => {
      const { data, error } = await operario.client.rpc('obtener_ranking_operativo', { p_planta_id: cruceEval, p_limite: 100 });
      expect(error).toBeNull();
      const items = (data as { items: Array<Record<string, unknown>> }).items;
      return items.find((i) => i.individuo_id === individuos.vivoEval);
    };
    const antes = await rank();
    expect(antes?.elegible).toBe(true);

    const ins = await operario.client
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuos.vivoEval, tipo_ronda: 'anual', numero_ronda: 3, anio: 2026, created_by: operario.userId })
      .select('id')
      .single();
    expect(ins.error?.code).toBe('42501');
    expect(ins.data).toBeNull();

    const despues = await rank();
    expect(despues?.elegible).toBe(true);
    expect(despues?.numero_ronda).toBe(antes?.numero_ronda);

    const delOp = await operario.client.from('ronda_evaluacion_anual').delete().eq('id', rondaId).select('id');
    const delAd = await admin.client.from('ronda_evaluacion_anual').delete().eq('id', rondaId).select('id');
    // Sin grant DELETE: error 42501 (o, a lo sumo, 0 filas). En ambos casos la fila sigue.
    expect(delOp.data ?? []).toHaveLength(0);
    expect(delAd.data ?? []).toHaveLength(0);
    expect(psql(`select count(*) from ronda_evaluacion_anual where id='${rondaId}'`)).toBe('1');
  });

  it('la ronda rechazada no deja falsa auditoría y la RPC conserva la auditoría de creación', async () => {
    const filas = psql(`
      select a.accion, a.usuario_id = '${operario.userId}', (a.detalle ? 'ronda_id'), (a.detalle ? 'numero_ronda'), (a.detalle->>'numero_ronda')
      from audit_log a
      where a.accion = 'creacion_ronda_evaluacion_anual'
        and a.detalle->>'individuo_id' = '${individuos.muertoEval}'`);
    expect(filas).toBe('');
    const legitima = psql(`select count(*) from audit_log where accion='creacion_ronda_evaluacion_anual' and detalle->>'individuo_id'='${individuos.vivoEval}' and usuario_id='${operario.userId}'`);
    expect(legitima).toBe('1');
  });
});
