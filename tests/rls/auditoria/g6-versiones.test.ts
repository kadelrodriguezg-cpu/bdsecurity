/**
 * Auditoría Corrida 1 — G6 / S04: versiones de scoring (sin pantalla).
 *
 * nueva_version_scoring / activar_version_scoring por operario y por admin,
 * edición de la configuración de una versión en uso y fuera de uso, dos
 * activas, activar sin métricas, huecos de vigencia, auditoría y concurrencia.
 *
 * Aislamiento: cada escenario usa una ESPECIE PROPIA, así la versión global
 * activa de la base ("Selección de fruto v1 provisional") nunca se toca; la
 * primera prueba la anota y la última comprueba que sigue igual.
 *
 * Correr solo este archivo: npx vitest run tests/rls/auditoria/g6-versiones.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditoriaDe,
  crearCruce,
  crearEvaluacion,
  crearIndividuos,
  crearRango,
  crearRonda,
  crearVersion,
  especieAdicional,
  iniciarContexto,
  limpiarContexto,
  type ContextoG6,
  type Fila,
} from './g6-helpers';

let raiz: ContextoG6;
let globalAntes: Fila;

/** Escenario mínimo: especie propia + versión activa v1 (2 métricas) + 3 individuos evaluados (cerrados). */
async function escenario(etiqueta: string, opts: { evaluar?: boolean; vigenteDesde?: string } = {}) {
  const ctx = await especieAdicional(raiz, etiqueta);
  const v1 = await crearVersion(ctx, {
    nombre: `AUD-G6 ${etiqueta} v1 ${raiz.R}`,
    vigenteDesde: opts.vigenteDesde ?? '2026-01-01',
    pesos: { fenologia: 0.5, fruto_calidad: 0.5 },
    metricas: [
      { metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 },
      { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 },
    ],
  });
  const planta = await crearCruce(ctx, { codigo: `AUD-G6-${etiqueta.toUpperCase()}-${raiz.R}` });
  const individuos = await crearIndividuos(ctx, planta, 3);
  if (opts.evaluar !== false) {
    const valores = [{ brotacion: 5, firmeza: 5 }, { brotacion: 3, firmeza: 3 }, { brotacion: 1, firmeza: 1 }];
    for (const [i, ind] of individuos.entries()) {
      await crearEvaluacion(ctx, await crearRonda(ctx, ind.id, 1), valores[i], { fecha: '2026-06-15' });
    }
  }
  return { ctx, v1, planta, individuos };
}

async function filaVersion(id: string): Promise<Fila> {
  const { data, error } = await raiz.service.from('scoring_version').select('*').eq('id', id).single();
  if (error || !data) throw new Error(`version ${id}: ${error?.message}`);
  return data;
}

async function resolver(ctx: ContextoG6): Promise<string | null> {
  const { data, error } = await ctx.operario.rpc('resolver_scoring_version', { p_especie_id: ctx.especieId });
  if (error) throw new Error(`resolver: ${error.message}`);
  return data as string | null;
}

beforeAll(async () => {
  raiz = await iniciarContexto('s04');
  const { data, error } = await raiz.service
    .from('scoring_version')
    .select('id, nombre, estado, vigente_desde, vigente_hasta, especie_id, fase')
    .eq('estado', 'activa')
    .is('especie_id', null);
  if (error) throw new Error(`global activa: ${error.message}`);
  globalAntes = { activas: data };
}, 60_000);

afterAll(async () => {
  if (raiz) await limpiarContexto(raiz);
});

describe('S04 — permisos: solo admin crea y activa versiones', () => {
  it('un operario (con o sin puede_ver_linaje) no puede ejecutar nueva_version_scoring ni activar_version_scoring', async () => {
    const e = await escenario('perm');
    for (const cliente of [raiz.operario, raiz.operarioLinaje]) {
      const nueva = await cliente.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 hack ${raiz.R}`, p_vigente_desde: '2027-01-01' });
      expect(nueva.error?.code).toBe('42501');
      const activar = await cliente.rpc('activar_version_scoring', { p_version_id: e.v1 });
      expect(activar.error?.code).toBe('42501');
    }
    const { count } = await raiz.service.from('scoring_version').select('id', { count: 'exact', head: true }).eq('especie_id', e.ctx.especieId);
    expect(count).toBe(1);
  });

  it('anon no puede ejecutar ninguna de las dos RPC', async () => {
    const e = await escenario('anon');
    const nueva = await raiz.anon.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 anon ${raiz.R}`, p_vigente_desde: '2027-01-01' });
    expect(nueva.error).not.toBeNull();
    const activar = await raiz.anon.rpc('activar_version_scoring', { p_version_id: e.v1 });
    expect(activar.error).not.toBeNull();
  });

  it('el camino directo por PostgREST también está cerrado para un operario: INSERT rechazado, UPDATE sin efecto', async () => {
    const e = await escenario('directo', { evaluar: false });
    const ins = await raiz.operario.from('scoring_version').insert({ nombre: `AUD-G6 directo ${raiz.R}`, especie_id: e.ctx.especieId, fase: 'evaluacion_anual', vigente_desde: '2027-01-01', estado: 'borrador' });
    expect(ins.error?.code).toBe('42501');
    const insMetrica = await raiz.operario.from('scoring_metrica').insert({ scoring_version_id: e.v1, metrica: 'cuaja', categoria: 'fenologia', peso: 1, direccion_favorable: 'mayor', orden: 9, metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 });
    expect(insMetrica.error?.code).toBe('42501');
    const upd = await raiz.operario.from('scoring_version').update({ estado: 'inactiva' }).eq('id', e.v1).select('id');
    expect(upd.data ?? []).toHaveLength(0); // RLS filtra la fila: 0 filas afectadas, sin error
    const updPeso = await raiz.operario.from('scoring_categoria_peso').update({ peso: 0.9 }).eq('scoring_version_id', e.v1).select('id');
    expect(updPeso.data ?? []).toHaveLength(0);
    expect((await filaVersion(e.v1)).estado).toBe('activa');
  });
});

describe('S04 — nueva_version_scoring (admin)', () => {
  it('copia métricas y pesos a un borrador, deja una fila de auditoría con autor y deja la base intacta', async () => {
    const e = await escenario('nueva');
    const antes = await auditoriaDe(raiz, raiz.adminId, 'nueva_version_scoring');
    const { data: id, error } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 nueva v2 ${raiz.R}`, p_vigente_desde: '2026-07-01', p_nota: 'prueba' });
    expect(error).toBeNull();
    const v2 = await filaVersion(id as string);
    expect(v2).toMatchObject({ estado: 'borrador', especie_id: e.ctx.especieId, fase: 'evaluacion_anual', vigente_desde: '2026-07-01', vigente_hasta: null, created_by: raiz.adminId, nota: 'prueba' });
    const { data: metricas } = await raiz.service.from('scoring_metrica').select('metrica, peso, categoria, orden').eq('scoring_version_id', id as string).order('orden');
    expect(metricas!.map((m) => m.metrica)).toEqual(['brotacion', 'firmeza']);
    const { data: pesos } = await raiz.service.from('scoring_categoria_peso').select('categoria, peso').eq('scoring_version_id', id as string).order('categoria');
    expect(pesos!.map((p) => [p.categoria, Number(p.peso)])).toEqual([['fenologia', 0.5], ['fruto_calidad', 0.5]]);
    expect((await filaVersion(e.v1)).estado).toBe('activa'); // la base no se toca
    const despues = await auditoriaDe(raiz, raiz.adminId, 'nueva_version_scoring');
    expect(despues.length - antes.length).toBe(1);
    expect(despues.at(-1)!.detalle).toMatchObject({ version_base_id: e.v1, version_nueva_id: id, nombre: `AUD-G6 nueva v2 ${raiz.R}` });
    // El borrador no cambia lo que resuelve el ranking.
    expect(await resolver(e.ctx)).toBe(e.v1);
  });

  it('valida nombre vacío, fecha nula, base inexistente y nombre repetido', async () => {
    const e = await escenario('nuevaval');
    const vacio = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: '   ', p_vigente_desde: '2026-07-01' });
    expect(vacio.error?.code).toBe('23514');
    const sinFecha = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 sinfecha ${raiz.R}`, p_vigente_desde: null });
    expect(sinFecha.error?.code).toBe('23514');
    const inexistente = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: '00000000-0000-0000-0000-000000000000', p_nombre: `AUD-G6 inex ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    expect(inexistente.error?.code).toBe('P0002');
    const repetido = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 nuevaval v1 ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    // El nombre de la v1 del escenario ya existe: unique (nombre). Mensaje técnico, sin pantalla que lo traduzca.
    expect(repetido.error?.code).toBe('23505');
  });

  it('el borrador comparte los rango_referencia de la base (no los copia): deja rangos de una versión en uso atados a la nueva', async () => {
    const e = await escenario('rango', { evaluar: false });
    const rango = await crearRango(e.ctx, { metrica: 'brix', min: 10, max: 18 });
    const vConRango = await crearVersion(e.ctx, {
      nombre: `AUD-G6 rango base ${raiz.R}`, vigenteDesde: '2026-02-01', estado: 'inactiva',
      metricas: [{ metrica: 'brix', categoria: 'fruto_calidad', peso: 1, rangoId: rango }],
    });
    const { data: nueva } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: vConRango, p_nombre: `AUD-G6 rango v2 ${raiz.R}`, p_vigente_desde: '2026-08-01' });
    const { data: m } = await raiz.service.from('scoring_metrica').select('rango_referencia_id').eq('scoring_version_id', nueva as string).single();
    expect(m!.rango_referencia_id).toBe(rango);
  });
});

describe('S04 — activar_version_scoring (admin)', () => {
  it('activa el borrador, retira la anterior con vigente_hasta = desde-1, sella aprobación y audita ambas ids', async () => {
    const e = await escenario('activar');
    const { data: v2 } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 activar v2 ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    const antes = await auditoriaDe(raiz, raiz.adminId, 'activacion_version_scoring');
    const { data, error } = await raiz.admin.rpc('activar_version_scoring', { p_version_id: v2 as string });
    expect(error).toBeNull();
    expect(data).toBe(v2);
    expect(await filaVersion(e.v1)).toMatchObject({ estado: 'inactiva', vigente_hasta: '2026-06-30' });
    expect(await filaVersion(v2 as string)).toMatchObject({ estado: 'activa', aprobado_by: raiz.adminId });
    expect((await filaVersion(v2 as string)).aprobado_at).not.toBeNull();
    const despues = await auditoriaDe(raiz, raiz.adminId, 'activacion_version_scoring');
    expect(despues.length - antes.length).toBe(1);
    expect(despues.at(-1)!.detalle).toMatchObject({ version_activada_id: v2, version_retirada_id: e.v1 });
    expect(await resolver(e.ctx)).toBe(v2);
  });

  it('es idempotente: activar la que ya está activa devuelve la misma id y no escribe otra auditoría', async () => {
    const e = await escenario('idem');
    const antes = await auditoriaDe(raiz, raiz.adminId, 'activacion_version_scoring');
    const { data, error } = await raiz.admin.rpc('activar_version_scoring', { p_version_id: e.v1 });
    expect(error).toBeNull();
    expect(data).toBe(e.v1);
    expect((await auditoriaDe(raiz, raiz.adminId, 'activacion_version_scoring')).length).toBe(antes.length);
  });

  it('rechaza activar una versión sin métricas (23514) y una id inexistente (P0002), sin tocar la activa', async () => {
    const e = await escenario('vacia');
    const vacia = await crearVersion(e.ctx, { nombre: `AUD-G6 vacia ${raiz.R}`, vigenteDesde: '2026-07-01', estado: 'borrador', metricas: [] });
    const sinMetricas = await raiz.admin.rpc('activar_version_scoring', { p_version_id: vacia });
    expect(sinMetricas.error?.code).toBe('23514');
    const inexistente = await raiz.admin.rpc('activar_version_scoring', { p_version_id: '00000000-0000-0000-0000-000000000000' });
    expect(inexistente.error?.code).toBe('P0002');
    expect((await filaVersion(e.v1)).estado).toBe('activa');
    expect((await filaVersion(vacia)).estado).toBe('borrador');
  });

  it('dos activas son imposibles: el índice único (especie, fase) frena el UPDATE directo del admin', async () => {
    const e = await escenario('dosact');
    const otra = await crearVersion(e.ctx, {
      nombre: `AUD-G6 dosact otra ${raiz.R}`, vigenteDesde: '2026-07-01', estado: 'borrador',
      pesos: { fenologia: 1 }, metricas: [{ metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 }],
    });
    const { error } = await raiz.admin.from('scoring_version').update({ estado: 'activa' }).eq('id', otra);
    expect(error?.code).toBe('23505');
  });

  it('dos admins activando dos borradores a la vez: queda exactamente una activa (el perdedor recibe un error técnico de índice, sin pantalla que lo explique)', async () => {
    const e = await escenario('conc');
    const crear = async (n: number) => {
      const { data } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 conc b${n} ${raiz.R}`, p_vigente_desde: `2026-0${n + 6}-01` });
      return data as string;
    };
    const [a, b] = [await crear(1), await crear(2)];
    const resultados = await Promise.all([raiz.admin.rpc('activar_version_scoring', { p_version_id: a }), raiz.admin.rpc('activar_version_scoring', { p_version_id: b })]);
    const { data: activas } = await raiz.service.from('scoring_version').select('id').eq('especie_id', e.ctx.especieId).eq('estado', 'activa');
    expect(activas).toHaveLength(1);
    const errores = resultados.filter((r) => r.error);
    // Una o ninguna falla (según el orden de los bloqueos); si falla, es el índice único.
    expect(errores.length).toBeLessThanOrEqual(1);
    for (const r of errores) expect(r.error!.code).toBe('23505');
    // eslint-disable-next-line no-console
    console.info(`[G6 S04] activación concurrente: ${errores.length} error(es) ${errores.map((r) => r.error!.message).join(' | ')}`);
  });

  // A1-G6-05: huecos de vigencia. Activar una versión con vigente_desde futura retira
  // la actual de inmediato: hasta esa fecha la especie no resuelve versión propia
  // (cae a la global o a "sin versión") aunque el ranking sigue consultándose.
  it.fails('activar una versión con vigencia futura no deja a la especie sin su versión vigente hoy (A1-G6-05)', async () => {
    const e = await escenario('futura');
    const futura = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const { data: v2 } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 futura v2 ${raiz.R}`, p_vigente_desde: futura });
    const { error } = await raiz.admin.rpc('activar_version_scoring', { p_version_id: v2 as string });
    expect(error).toBeNull();
    const resuelta = await resolver(e.ctx);
    // Hoy: devuelve la versión GLOBAL (otra especie de configuración), no v1 ni v2.
    expect([e.v1, v2]).toContain(resuelta);
  });

  it('A1-G6-05 (demostración): con vigencia futura el ranking de la especie cae a la versión global sin aviso', async () => {
    const e = await escenario('futura2');
    const futura = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const { data: v2 } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 futura2 v2 ${raiz.R}`, p_vigente_desde: futura });
    await raiz.admin.rpc('activar_version_scoring', { p_version_id: v2 as string });
    const resuelta = await resolver(e.ctx);
    expect(resuelta).not.toBe(e.v1);
    expect(resuelta).not.toBe(v2);
    const { data: global } = await raiz.service.from('scoring_version').select('id, especie_id').eq('id', resuelta as string).maybeSingle();
    expect(global === null || global.especie_id === null).toBe(true); // null (sin versión) o la global
    const { data: ranking } = await raiz.operario.rpc('obtener_ranking_operativo', { p_planta_id: e.planta, p_limite: 10 });
    const r = ranking as Fila;
    expect(r.scoring_version_id).toBe(resuelta);
    // Con la global, las 2 métricas de la v1 de la especie ya no son las que puntúan.
    expect(r.scoring_version_id).not.toBe(e.v1);
  });

  // A1-G6-05 (segunda forma): reactivar una versión retirada la deja 'activa' pero con
  // vigente_hasta vencido, de modo que el resolutor no la devuelve.
  it.fails('reactivar una versión retirada (deshacer una activación) la deja vigente y resoluble (A1-G6-05)', async () => {
    const e = await escenario('react');
    const { data: v2 } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 react v2 ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    await raiz.admin.rpc('activar_version_scoring', { p_version_id: v2 as string });
    expect(await resolver(e.ctx)).toBe(v2);
    // Deshacer: volver a la v1 (inactiva, con vigente_hasta = 2026-06-30).
    const { error } = await raiz.admin.rpc('activar_version_scoring', { p_version_id: e.v1 });
    expect(error).toBeNull();
    expect((await filaVersion(e.v1)).estado).toBe('activa');
    expect(await resolver(e.ctx)).toBe(e.v1);
  });

  it('con la ronda ya sellada, activar una versión nueva cambia el ranking operativo pero no el histórico por ronda (decisión B6)', async () => {
    const e = await escenario('sello');
    // Las rondas cerradas bajo v1 quedan selladas con v1.
    const { data: rondas } = await raiz.service.from('ronda_evaluacion_anual').select('scoring_version_id').in('individuo_id', e.individuos.map((i) => i.id));
    expect(new Set(rondas!.map((r) => r.scoring_version_id))).toEqual(new Set([e.v1]));
    // v2: misma métrica de fenología, firmeza con escala 1-10 (cambia la normalización).
    const { data: v2 } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 sello v2 ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    await raiz.admin.from('scoring_metrica').update({ maximo_normalizacion: 10 }).eq('scoring_version_id', v2 as string).eq('metrica', 'firmeza');
    await raiz.admin.rpc('activar_version_scoring', { p_version_id: v2 as string });
    const operativo = (await raiz.operario.rpc('obtener_ranking_operativo', { p_planta_id: e.planta, p_limite: 10 })).data as Fila;
    expect(operativo.scoring_version_id).toBe(v2);
    const p1 = (operativo.items as Fila[]).find((i) => String(i.codigo_display).endsWith('-P1'))!;
    // v2: fen = (5-1)/4 = 1; fruto = (5-1)/9 = 0.4444; puntaje = .5*1 + .5*.4444 = 0.7222
    expect(Number(p1.puntaje_ponderado)).toBe(0.7222);
    const { data: porRonda } = await raiz.operario.rpc('calcular_ranking_operativo', { p_scoring_version_id: v2 as string, p_planta_id: e.planta, p_por_ronda: true });
    const r1 = (porRonda as Fila[]).find((i) => String(i.codigo_display).endsWith('-P1'))!;
    expect(r1.scoring_version_id).toBe(e.v1);
    expect(Number(r1.puntaje_ponderado)).toBe(1); // v1: fen 1, fruto 1
  });
});

describe('S04 — sellado de la ronda con la versión vigente en la fecha de la evaluación', () => {
  // A1-G6-06: ligar_ronda_a_version_scoring usa resolver_scoring_version, que solo devuelve versiones
  // en estado 'activa'. Una evaluación cargada tarde, con fecha dentro de la vigencia de una versión
  // ya retirada, no puede sellarse con ella: queda sin sellar o sellada con OTRA configuración.
  it.fails('una evaluación con fecha dentro de la vigencia de una versión retirada se sella con esa versión (A1-G6-06)', async () => {
    const e = await escenario('tarde', { evaluar: false });
    const { data: v2 } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 tarde v2 ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    await raiz.admin.rpc('activar_version_scoring', { p_version_id: v2 as string });
    expect((await filaVersion(e.v1))).toMatchObject({ estado: 'inactiva', vigente_hasta: '2026-06-30' });
    const ind = await crearIndividuos(e.ctx, e.planta, 1);
    const ronda = await crearRonda(e.ctx, ind[0].id, 1);
    await crearEvaluacion(e.ctx, ronda, { brotacion: 4, firmeza: 4 }, { fecha: '2026-05-10' }); // dentro de la vigencia de v1
    const { data } = await raiz.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', ronda).single();
    expect(data!.scoring_version_id).toBe(e.v1);
  });

  it('A1-G6-06 (demostración): esa misma ronda queda sin sellar o sellada con la versión global, y la versión retirada no se considera en uso', async () => {
    const e = await escenario('tarde2', { evaluar: false });
    const { data: v2 } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: e.v1, p_nombre: `AUD-G6 tarde2 v2 ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    await raiz.admin.rpc('activar_version_scoring', { p_version_id: v2 as string });
    const ind = await crearIndividuos(e.ctx, e.planta, 1);
    const ronda = await crearRonda(e.ctx, ind[0].id, 1);
    await crearEvaluacion(e.ctx, ronda, { brotacion: 4, firmeza: 4 }, { fecha: '2026-05-10' });
    const { data } = await raiz.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', ronda).single();
    expect(data!.scoring_version_id).not.toBe(e.v1);
    if (data!.scoring_version_id !== null) {
      const { data: v } = await raiz.service.from('scoring_version').select('especie_id').eq('id', data!.scoring_version_id).single();
      expect(v!.especie_id).toBeNull(); // la global: configuración de otra especie/ámbito
    }
    const { data: enUso } = await raiz.operario.rpc('scoring_version_en_uso', { p_version_id: e.v1 });
    expect(enUso).toBe(false);
  });
});

describe('S04 — editar la configuración: versión en uso y fuera de uso', () => {
  it('rechaza (55000) los cambios del admin sobre la v1 sellada: UPDATE de peso, INSERT de métrica, UPDATE de peso de categoría y de vigencia', async () => {
    const e = await escenario('enuso2');
    const upd = await raiz.admin.from('scoring_metrica').update({ peso: 9 }).eq('scoring_version_id', e.v1).eq('metrica', 'firmeza');
    expect(upd.error?.code).toBe('55000');
    const ins = await raiz.admin.from('scoring_metrica').insert({ scoring_version_id: e.v1, metrica: 'cuaja', categoria: 'fenologia', peso: 1, direccion_favorable: 'mayor', orden: 9, metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 });
    expect(ins.error?.code).toBe('55000');
    const peso = await raiz.admin.from('scoring_categoria_peso').update({ peso: 0.6 }).eq('scoring_version_id', e.v1).eq('categoria', 'fenologia');
    expect(peso.error?.code).toBe('55000');
    const vigencia = await raiz.admin.from('scoring_version').update({ vigente_desde: '2025-01-01' }).eq('id', e.v1);
    expect(vigencia.error?.code).toBe('55000');
    const umbral = await raiz.admin.from('scoring_version').update({ umbral_delta_leve: 0.01 }).eq('id', e.v1);
    expect(umbral.error?.code).toBe('55000');
  });

  it('el rango_referencia de una métrica de una versión en uso no cambia de mínimo/máximo (55000); sus límites de revisión y su estado activo sí se pueden mover, y la versión admite retirarse (intencional)', async () => {
    const e = await escenario('enuso3', { evaluar: false });
    const rango = await crearRango(e.ctx, { metrica: 'brix', min: 10, max: 18, limInf: 5, limSup: 30 });
    const v = await crearVersion(e.ctx, {
      nombre: `AUD-G6 enuso3 vr ${raiz.R}`, vigenteDesde: '2026-02-01', estado: 'inactiva',
      metricas: [{ metrica: 'brix', categoria: 'fruto_calidad', peso: 1, rangoId: rango }],
    });
    // La versión pasa a "en uso" al sellar una ronda con ella.
    const ind = (await crearIndividuos(e.ctx, e.planta, 1))[0];
    const r = await crearRonda(e.ctx, ind.id, 1);
    await raiz.service.from('ronda_evaluacion_anual').update({ scoring_version_id: v }).eq('id', r);
    const minmax = await raiz.admin.from('rango_referencia').update({ minimo_esperado: 8 }).eq('id', rango);
    expect(minmax.error?.code).toBe('55000');
    // Lo que el trigger NO bloquea. vigente_hasta/estado de la versión: intencional (la migración 20261021141000 lo
    // declara para poder retirarla). Límites de revisión y 'activo' del rango: no declarado; se anota en A1-G6-07.
    const limites = await raiz.admin.from('rango_referencia').update({ limite_revision_superior: 99 }).eq('id', rango);
    expect(limites.error).toBeNull();
    const desactivar = await raiz.admin.from('rango_referencia').update({ activo: false }).eq('id', rango);
    expect(desactivar.error).toBeNull();
    const estadoVersion = await raiz.admin.from('scoring_version').update({ vigente_hasta: '2026-03-01' }).eq('id', v);
    expect(estadoVersion.error).toBeNull(); // retirar una versión en uso es intencional
  });

  it('el admin puede retirar a mano (UPDATE de estado, intencional) la versión activa EN USO, pero sin la RPC no queda fila de auditoría y la especie cae a la versión global (A1-G6-07)', async () => {
    const e = await escenario('directoest');
    const { count: antes } = await raiz.service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', raiz.adminId);
    const { error } = await raiz.admin.from('scoring_version').update({ estado: 'inactiva' }).eq('id', e.v1);
    expect(error).toBeNull(); // la guardia de inmutabilidad admite cambiar 'estado' a propósito (retirar)
    const { count: despues } = await raiz.service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', raiz.adminId);
    expect(despues).toBe(antes);
    const resuelta = await resolver(e.ctx);
    expect(resuelta).not.toBe(e.v1);
  });

  it('el nombre de una métrica solo puede ser una columna numérica real de evaluaciones (23514)', async () => {
    const e = await escenario('colnum', { evaluar: false });
    const borrador = await crearVersion(e.ctx, { nombre: `AUD-G6 colnum b ${raiz.R}`, vigenteDesde: '2026-07-01', estado: 'borrador', metricas: [] });
    const base = { scoring_version_id: borrador, categoria: 'fenologia', peso: 1, direccion_favorable: 'mayor', orden: 1, metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5 };
    const inexistente = await raiz.admin.from('scoring_metrica').insert({ ...base, metrica: 'no_existe' });
    expect(inexistente.error?.code).toBe('23514');
    const texto = await raiz.admin.from('scoring_metrica').insert({ ...base, metrica: 'observaciones' });
    expect(texto.error?.code).toBe('23514');
    const ok = await raiz.admin.from('scoring_metrica').insert({ ...base, metrica: 'cuaja' });
    expect(ok.error).toBeNull();
  });

  it('los pesos por categoría deben sumar 1 al confirmar la transacción (23514)', async () => {
    const e = await escenario('suma', { evaluar: false });
    const borrador = await crearVersion(e.ctx, { nombre: `AUD-G6 suma b ${raiz.R}`, vigenteDesde: '2026-07-01', estado: 'borrador', metricas: [] });
    const mal = await raiz.admin.from('scoring_categoria_peso').insert([{ scoring_version_id: borrador, categoria: 'fenologia', peso: 0.5 }]);
    expect(mal.error?.code).toBe('23514');
    const bien = await raiz.admin.from('scoring_categoria_peso').insert([{ scoring_version_id: borrador, categoria: 'fenologia', peso: 0.5 }, { scoring_version_id: borrador, categoria: 'fruto_calidad', peso: 0.5 }]);
    expect(bien.error).toBeNull();
    // Cambiar un peso de a uno es imposible (cada UPDATE rompe la suma): hay que borrar y reinsertar, y el admin no tiene DELETE.
    const cambio = await raiz.admin.from('scoring_categoria_peso').update({ peso: 0.6 }).eq('scoring_version_id', borrador).eq('categoria', 'fenologia');
    expect(cambio.error?.code).toBe('23514');
  });

  // A1-G6-07: una versión fuera de uso se edita en sitio y cambia el ranking vivo sin
  // dejar fila en audit_log (la configuración científica no tiene bitácora de cambios).
  it.fails('cambiar el peso de una métrica de la versión activa deja una fila en audit_log (A1-G6-07)', async () => {
    const e = await escenario('sinaudit', { evaluar: false });
    const ind = await crearIndividuos(e.ctx, e.planta, 1);
    await crearEvaluacion(e.ctx, await crearRonda(e.ctx, ind[0].id, 1), { brotacion: 5, firmeza: 1 }, { estado: 'borrador' });
    const { count: antes } = await raiz.service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', raiz.adminId);
    const { error } = await raiz.admin.from('scoring_metrica').update({ peso: 7 }).eq('scoring_version_id', e.v1).eq('metrica', 'firmeza');
    expect(error).toBeNull(); // permitido: la versión aún no está en uso
    const { count: despues } = await raiz.service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', raiz.adminId);
    expect(despues! - antes!).toBeGreaterThan(0);
  });

  it('la edición en sitio de una versión no usada altera el ranking vivo (demostración de A1-G6-07)', async () => {
    const e = await escenario('sinaudit2', { evaluar: false });
    const ind = await crearIndividuos(e.ctx, e.planta, 2);
    // P1: brotación 5, firmeza 1; P2: brotación 1, firmeza 5. Con pesos de métrica iguales empatan en 0.5.
    await crearEvaluacion(e.ctx, await crearRonda(e.ctx, ind[0].id, 1), { brotacion: 5, firmeza: 1 }, { estado: 'completa' });
    await crearEvaluacion(e.ctx, await crearRonda(e.ctx, ind[1].id, 1), { brotacion: 1, firmeza: 5 }, { estado: 'completa' });
    // Estas evaluaciones selladas ponen la v1 "en uso": para probar la edición libre se usa otra versión no sellada.
    const libre = await crearVersion(e.ctx, {
      nombre: `AUD-G6 sinaudit2 libre ${raiz.R}`, vigenteDesde: '2026-02-01', estado: 'inactiva',
      pesos: { fenologia: 0.5, fruto_calidad: 0.5 },
      metricas: [{ metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 }, { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 }],
    });
    const calcular = async () => ((await raiz.operario.rpc('calcular_ranking_operativo', { p_scoring_version_id: libre, p_planta_id: e.planta })).data as Fila[]);
    const puntajes = async () => (await calcular()).filter((f) => f.elegible).map((f) => Number(f.puntaje_ponderado)).sort();
    const antes = await puntajes();
    expect(antes).toEqual([0.5, 0.5]);
    const upd = await raiz.admin.from('scoring_categoria_peso').update({ peso: 0.5 }).eq('scoring_version_id', libre).eq('categoria', 'fenologia');
    expect(upd.error).toBeNull(); // mismo valor: la suma sigue en 1; la edición en sitio está permitida
    const cambioMetrica = await raiz.admin.from('scoring_metrica').update({ maximo_normalizacion: 10 }).eq('scoring_version_id', libre).eq('metrica', 'firmeza');
    expect(cambioMetrica.error).toBeNull();
    const despues = await puntajes();
    expect(despues).not.toEqual(antes);
  });
});

describe('S04 — configuraciones que el motor acepta pero puntúan distinto de lo configurado', () => {
  // A1-G6-01: una categoría con peso pero sin métricas se renormaliza; una métrica cuya
  // categoría no tiene peso es obligatoria para ser elegible pero no suma al puntaje.
  it('categoría con peso y sin métricas: el puntaje renormaliza los pesos restantes en silencio', async () => {
    const e = await escenario('catsin', { evaluar: false });
    const v = await crearVersion(e.ctx, {
      nombre: `AUD-G6 catsin v ${raiz.R}`, vigenteDesde: '2026-02-01', estado: 'inactiva',
      pesos: { fenologia: 0.5, fruto_calidad: 0.3, estres: 0.2 }, // estres sin métricas
      metricas: [{ metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 }, { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 }],
    });
    const ind = await crearIndividuos(e.ctx, e.planta, 1);
    await crearEvaluacion(e.ctx, await crearRonda(e.ctx, ind[0].id, 1), { brotacion: 5, firmeza: 1 });
    const { data } = await raiz.operario.rpc('calcular_ranking_operativo', { p_scoring_version_id: v, p_planta_id: e.planta });
    const fila = (data as Fila[]).find((f) => f.evaluacion_id !== null)!;
    // fen = 1, fruto = 0, estres sin métricas (NULL). Configurado: .5*1 + .3*0 + .2*? ; aplicado: (.5*1 + .3*0) / .8 = 0.625
    expect(fila.elegible).toBe(true);
    expect(Number(fila.puntaje_ponderado)).toBe(0.625);
    expect(fila.detalle_categorias.estres).toBeNull();
  });

  it.fails('una métrica cuya categoría no tiene peso configurado se rechaza o suma al puntaje (A1-G6-01)', async () => {
    const e = await escenario('metsin', { evaluar: false });
    const v = await crearVersion(e.ctx, {
      nombre: `AUD-G6 metsin v ${raiz.R}`, vigenteDesde: '2026-02-01', estado: 'inactiva',
      pesos: { fenologia: 0.5, fruto_calidad: 0.5 }, // la métrica de estrés no tiene categoría con peso
      metricas: [
        { metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 },
        { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 },
        { metrica: 'dano_calor', categoria: 'estres', peso: 1, direccion: 'menor', min: 1, max: 5 },
      ],
    });
    const ind = await crearIndividuos(e.ctx, e.planta, 2);
    await crearEvaluacion(e.ctx, await crearRonda(e.ctx, ind[0].id, 1), { brotacion: 3, firmeza: 3, dano_calor: 1 }); // estrés perfecto
    await crearEvaluacion(e.ctx, await crearRonda(e.ctx, ind[1].id, 1), { brotacion: 3, firmeza: 3, dano_calor: 5 }); // estrés pésimo
    const { data } = await raiz.operario.rpc('calcular_ranking_operativo', { p_scoring_version_id: v, p_planta_id: e.planta });
    const filas = (data as Fila[]).filter((f) => f.evaluacion_id !== null);
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.elegible)).toBe(true); // exige la métrica de estrés para ser elegible...
    const puntajes = filas.map((f) => Number(f.puntaje_ponderado));
    // ...pero la métrica no influye: ambos individuos empatan aunque el estrés difiere por completo.
    expect(new Set(puntajes).size).toBe(2);
  });
});

describe('S04 — cierre', () => {
  it('la versión global activa quedó exactamente como estaba al empezar', async () => {
    const { data } = await raiz.service
      .from('scoring_version')
      .select('id, nombre, estado, vigente_desde, vigente_hasta, especie_id, fase')
      .eq('estado', 'activa')
      .is('especie_id', null);
    expect(data).toEqual(globalAntes.activas);
  });
});
