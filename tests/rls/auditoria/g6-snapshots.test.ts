/**
 * Auditoría Corrida 1 — G6 / S02 y S03: congelar ranking (snapshots), listar,
 * ver el detalle congelado y compararlo con el ranking vivo.
 *
 * Cubre: congelar_ranking llamada por operario / anon, alcance inválido, nombre
 * vacío o duplicado, ranking vacío, modo por ronda (versión sellada de cada
 * ronda), cruces de prueba, quién puede borrar o editar un snapshot,
 * concurrencia, listado paginado y comparación contra el ranking vivo.
 *
 * Correr solo este archivo: npx vitest run tests/rls/auditoria/g6-snapshots.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { psql } from './g4-helpers';
import {
  auditoriaDe,
  crearCruce,
  crearEvaluacion,
  crearIndividuos,
  crearRonda,
  crearVersion,
  especieAdicional,
  iniciarContexto,
  limpiarContexto,
  type ContextoG6,
  type Fila,
} from './g6-helpers';

let raiz: ContextoG6;
let ctx: ContextoG6;
let v1: string;
let cruceA: string;
let cruceB: string;
let A: Array<{ id: string; codigo_display: string }>;

const sufijo = (codigo: string) => String(codigo).split('-').pop()!;

async function congelar(cliente: ContextoG6['admin'], args: Record<string, unknown>) {
  const { data, error } = await cliente.rpc('congelar_ranking', args);
  return { id: data as string | null, error };
}

it('A1-152: una evaluación que cambia entre cabecera y detalle no rompe la población congelada', async () => {
  const evaluacion = await raiz.service.from('ronda_evaluacion_anual').select('id').eq('individuo_id', A[0].id).single();
  expect(evaluacion.error).toBeNull();
  const e = await raiz.service.from('evaluaciones').select('id').eq('ronda_id', evaluacion.data!.id).eq('estado', 'completa').single();
  expect(e.error).toBeNull();
  const nombre = `FIX152-${raiz.R}`;
  // La alteración se fuerza DESPUÉS de crear cabecera, sin temporizadores.
  // Trigger, evaluación, snapshot y auditorías del ensayo se revierten juntos.
  const r = await psql(`BEGIN;
    CREATE FUNCTION pg_temp.fix152_cambiar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    BEGIN
      IF NEW.nombre = '${nombre}' THEN
        UPDATE public.evaluaciones SET estado='anulada', motivo_cambio='Ensayo local de concurrencia A1-152' WHERE id='${e.data!.id}';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER fix152_ensayo AFTER INSERT ON public.ranking_snapshot FOR EACH ROW EXECUTE FUNCTION pg_temp.fix152_cambiar();
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','${raiz.adminId}',true);
    SELECT public.congelar_ranking('${nombre}','${cruceA}',null);
    DO $$ DECLARE v_id uuid; v_poblacion integer; BEGIN
      SELECT id,poblacion_comparada INTO STRICT v_id,v_poblacion FROM public.ranking_snapshot WHERE nombre='${nombre}';
      IF v_poblacion <> (SELECT count(*) FROM public.ranking_snapshot_resultado WHERE snapshot_id=v_id) THEN RAISE EXCEPTION 'Cabecera distinta del detalle'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.evaluaciones WHERE id='${e.data!.id}' AND estado='anulada') THEN RAISE EXCEPTION 'No se forzo el cambio'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.ranking_snapshot_resultado WHERE snapshot_id=v_id AND evaluacion_id='${e.data!.id}') THEN RAISE EXCEPTION 'Se recalculo el detalle'; END IF;
      RAISE NOTICE 'CHECK152_OK';
    END $$;
    ROLLBACK;`);
  expect(r.salida).not.toContain('ERROR:'); expect(r.salida).toContain('CHECK152_OK');
  const despues = await raiz.service.from('evaluaciones').select('estado').eq('id', e.data!.id).single();
  expect(despues.error).toBeNull(); expect(despues.data!.estado).toBe('completa');
  const snapshot = await raiz.service.from('ranking_snapshot').select('id').eq('nombre', nombre);
  expect(snapshot.error).toBeNull(); expect(snapshot.data).toHaveLength(0);
});

async function detalle(snapshotId: string): Promise<Fila> {
  const { data, error } = await raiz.operario.rpc('obtener_detalle_snapshot', { p_snapshot_id: snapshotId });
  if (error) throw new Error(`detalle: ${error.message}`);
  return data as Fila;
}

async function crearVersionDosMetricas(c: ContextoG6, nombre: string) {
  return crearVersion(c, {
    nombre,
    vigenteDesde: '2026-01-01',
    pesos: { fenologia: 0.5, fruto_calidad: 0.5 },
    metricas: [
      { metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 },
      { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 },
    ],
  });
}

beforeAll(async () => {
  raiz = await iniciarContexto('s02');
  ctx = await especieAdicional(raiz, 'base');
  v1 = await crearVersionDosMetricas(ctx, `AUD-G6 S02 v1 ${raiz.R}`);
  cruceA = await crearCruce(ctx, { codigo: `AUD-G6-S02A-${raiz.R}` });
  cruceB = await crearCruce(ctx, { codigo: `AUD-G6-S02B-${raiz.R}` });
  A = await crearIndividuos(ctx, cruceA, 5);
  const B = await crearIndividuos(ctx, cruceB, 2);
  // Cruce A: P1 = 1.0, P2 = 0.5, P3 = 0.0, P4 parcial (sin brotación), P5 sin ronda.
  await crearEvaluacion(ctx, await crearRonda(ctx, A[0].id), { brotacion: 5, firmeza: 5 });
  await crearEvaluacion(ctx, await crearRonda(ctx, A[1].id), { brotacion: 3, firmeza: 3 });
  await crearEvaluacion(ctx, await crearRonda(ctx, A[2].id), { brotacion: 1, firmeza: 1 });
  await crearEvaluacion(ctx, await crearRonda(ctx, A[3].id), { firmeza: 4 });
  // Cruce B: Q1 = 0.75, Q2 = 0.5 (empata con P2: desempate por número de código).
  await crearEvaluacion(ctx, await crearRonda(ctx, B[0].id), { brotacion: 4, firmeza: 4 });
  await crearEvaluacion(ctx, await crearRonda(ctx, B[1].id), { brotacion: 2, firmeza: 4 });
}, 90_000);

afterAll(async () => {
  if (raiz) await limpiarContexto(raiz);
});

describe('S02 — quién puede congelar y con qué argumentos', () => {
  it('un operario (con o sin puede_ver_linaje) y anon no pueden congelar: sin snapshot y sin auditoría', async () => {
    for (const [cliente, id] of [[raiz.operario, raiz.operarioId], [raiz.operarioLinaje, raiz.operarioLinajeId]] as const) {
      const r = await congelar(cliente, { p_nombre: 'intento operario', p_planta_id: cruceA });
      expect(r.error?.code).toBe('42501');
      expect((await auditoriaDe(raiz, id, 'congelacion_ranking')).length).toBe(0);
    }
    const anon = await congelar(raiz.anon, { p_nombre: 'intento anon', p_planta_id: cruceA });
    expect(anon.error).not.toBeNull();
    const { count } = await raiz.service.from('ranking_snapshot').select('id', { count: 'exact', head: true }).eq('especie_id', ctx.especieId);
    expect(count).toBe(0);
  });

  it('exige exactamente un alcance (cruce o especie), un nombre no vacío y un cruce existente y no archivado', async () => {
    const ninguno = await congelar(raiz.admin, { p_nombre: 'x' });
    expect(ninguno.error?.code).toBe('22023');
    const ambos = await congelar(raiz.admin, { p_nombre: 'x', p_planta_id: cruceA, p_especie_id: ctx.especieId });
    expect(ambos.error?.code).toBe('22023');
    for (const nombre of ['', '   ', null]) {
      const r = await congelar(raiz.admin, { p_nombre: nombre, p_planta_id: cruceA });
      expect(r.error?.code, String(nombre)).toBe('23514');
    }
    const inexistente = await congelar(raiz.admin, { p_nombre: 'x', p_planta_id: '00000000-0000-0000-0000-000000000000' });
    expect(inexistente.error?.code).toBe('P0002');
    const archivado = await crearCruce(ctx, { codigo: `AUD-G6-S02ARCH-${raiz.R}`, eliminado: true });
    const r = await congelar(raiz.admin, { p_nombre: 'x', p_planta_id: archivado });
    expect(r.error?.code).toBe('P0002');
    const { count } = await raiz.service.from('ranking_snapshot').select('id', { count: 'exact', head: true }).eq('especie_id', ctx.especieId);
    expect(count).toBe(0);
  });

  it('un ranking sin población elegible no se congela (23514) y no deja snapshot ni auditoría', async () => {
    const vacia = await especieAdicional(raiz, 'vacia');
    await crearVersionDosMetricas(vacia, `AUD-G6 S02 vacia v1 ${raiz.R}`);
    const cruce = await crearCruce(vacia, { codigo: `AUD-G6-S02V-${raiz.R}` });
    await crearIndividuos(vacia, cruce, 2); // vivos, sin evaluación
    const antes = (await auditoriaDe(raiz, raiz.adminId, 'congelacion_ranking')).length;
    for (const args of [{ p_planta_id: cruce }, { p_especie_id: vacia.especieId }]) {
      const r = await congelar(raiz.admin, { p_nombre: 'vacío', ...args });
      expect(r.error?.code).toBe('23514');
    }
    expect((await auditoriaDe(raiz, raiz.adminId, 'congelacion_ranking')).length).toBe(antes);
    const { count } = await raiz.service.from('ranking_snapshot').select('id', { count: 'exact', head: true }).eq('especie_id', vacia.especieId);
    expect(count).toBe(0);
  });
});

describe('S02 — contenido del snapshot', () => {
  it('congelar un cruce guarda solo la población elegible, con posición, puntaje, detalle y versión; audita con autor', async () => {
    const antes = (await auditoriaDe(raiz, raiz.adminId, 'congelacion_ranking')).length;
    const r = await congelar(raiz.admin, { p_nombre: '  Cierre cruce A  ', p_planta_id: cruceA });
    expect(r.error).toBeNull();
    const d = await detalle(r.id!);
    expect(d.snapshot).toMatchObject({ nombre: 'Cierre cruce A', alcance: 'cruzamiento', planta_id: cruceA, especie_id: ctx.especieId, scoring_version_id: v1, poblacion_comparada: 3, created_by: raiz.adminId });
    expect(d.resultados.map((x: Fila) => [sufijo(x.codigo_display), x.posicion, Number(x.puntaje)])).toEqual([['P1', 1, 1], ['P2', 2, 0.5], ['P3', 3, 0]]);
    expect(d.resultados[0].detalle).toMatchObject({ numero_ronda: 1, scoring_version_id: v1, estado_evaluacion: 'completa' });
    expect(d.resultados[0].detalle.metricas.firmeza).toMatchObject({ valor: 5, normalizado: 1 });
    expect(d.resultados[0].detalle.categorias).toMatchObject({ fenologia: 1, fruto_calidad: 1, produccion: null, estres: null });
    // Los no elegibles (parcial, sin ronda) no están.
    expect(d.resultados.map((x: Fila) => sufijo(x.codigo_display))).not.toContain('P4');
    const filas = await auditoriaDe(raiz, raiz.adminId, 'congelacion_ranking');
    expect(filas.length - antes).toBe(1);
    expect(filas.at(-1)).toMatchObject({ planta_id: cruceA });
    expect(filas.at(-1)!.detalle).toMatchObject({ snapshot_id: r.id, especie_id: ctx.especieId, poblacion: 3, scoring_version_id: v1 });
    expect(filas.at(-1)!.campos_expuestos).toEqual(['scoring_version_id', 'evaluacion_id', 'puntaje']);
  });

  it('congelar la especie reúne los dos cruces; las posiciones desempatan por número de código y coinciden con el ranking vivo', async () => {
    const r = await congelar(raiz.admin, { p_nombre: 'Cierre especie', p_especie_id: ctx.especieId });
    expect(r.error).toBeNull();
    const d = await detalle(r.id!);
    expect(d.snapshot).toMatchObject({ alcance: 'especie', planta_id: null, poblacion_comparada: 5 });
    expect(d.resultados).toHaveLength(5);
    const { data: vivo } = await raiz.operario.rpc('obtener_ranking_operativo', { p_especie_id: ctx.especieId, p_limite: 100 });
    const posVivo = new Map<string, number>((vivo as Fila).items.filter((i: Fila) => i.elegible).map((i: Fila) => [i.individuo_id, i.posicion]));
    for (const res of d.resultados as Fila[]) expect(res.posicion, res.codigo_display).toBe(posVivo.get(res.individuo_id));
    const posiciones = (d.resultados as Fila[]).map((x) => x.posicion);
    expect(posiciones).toEqual([1, 2, 3, 4, 5]);
    // Auditoría de especie: planta_id nulo.
    const filas = await auditoriaDe(raiz, raiz.adminId, 'congelacion_ranking');
    expect(filas.at(-1)!.planta_id).toBeNull();
  });

  it('el nombre identifica el snapshot del alcance y el reintento recupera el mismo — A1-G6-11', async () => {
    const a = await congelar(raiz.admin, { p_nombre: 'Duplicado', p_planta_id: cruceB });
    const b = await congelar(raiz.admin, { p_nombre: '  DUPLICADO  ', p_planta_id: cruceB });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.id).toBe(b.id);
    const { data: lista } = await raiz.operario.rpc('listar_snapshots_ranking', { p_planta_id: cruceB });
    expect((lista as Fila).items.filter((i: Fila) => i.nombre === 'Duplicado')).toHaveLength(1);
  });

  it('A1-147: dos envíos simultáneos con el mismo nombre producen una sola cabecera y auditoría', async () => {
    const nombre = `Mismo intento ${raiz.R}`;
    const resultados = await Promise.all([1, 2].map(() => congelar(raiz.admin, { p_nombre: nombre, p_planta_id: cruceB })));
    expect(resultados.every(r => r.error === null)).toBe(true);
    expect(resultados[0].id).toBe(resultados[1].id);
    const logs = (await auditoriaDe(raiz, raiz.adminId, 'congelacion_ranking')).filter(f => f.detalle.snapshot_id === resultados[0].id);
    expect(logs).toHaveLength(1);
    const otroAlcance = await congelar(raiz.admin, { p_nombre: nombre, p_planta_id: cruceA });
    expect(otroAlcance.error).toBeNull(); expect(otroAlcance.id).not.toBe(resultados[0].id);
  });

  it('tres congelaciones simultáneas del mismo ranking producen tres snapshots completos y consistentes', async () => {
    const r = await Promise.all([1, 2, 3].map((n) => congelar(raiz.admin, { p_nombre: `Concurrente ${n}`, p_planta_id: cruceA })));
    expect(r.every((x) => x.error === null)).toBe(true);
    for (const x of r) {
      const d = await detalle(x.id!);
      expect(d.resultados).toHaveLength(3);
      expect(d.snapshot.poblacion_comparada).toBe(3);
    }
  });

  it('A1-147: duplicados históricos se conservan y la RPC exige otro nombre sin elegir uno arbitrario', async () => {
    const nombre = `Historico ambiguo ${raiz.R}`;
    const creado = await congelar(raiz.admin, { p_nombre: nombre, p_planta_id: cruceB });
    expect(creado.error).toBeNull();
    const original = await raiz.service.from('ranking_snapshot').select('nombre,alcance,scoring_version_id,especie_id,planta_id,poblacion_comparada,criterios,created_by').eq('id', creado.id!).single();
    expect(original.error).toBeNull();
    expect((await raiz.service.from('ranking_snapshot').insert(original.data!)).error).toBeNull();
    const repetido = await congelar(raiz.admin, { p_nombre: nombre, p_planta_id: cruceB });
    expect(repetido.error?.code).toBe('23505'); expect(repetido.id).toBeNull();
    const cabeceras = await raiz.service.from('ranking_snapshot').select('id').eq('nombre', nombre);
    expect(cabeceras.error).toBeNull(); expect(cabeceras.data).toHaveLength(2);
  });

  // A1-G6-02: el ranking y los snapshots por especie incluyen cruces es_prueba = true.
  it.fails('congelar el ranking de una especie excluye los cruces de prueba (A1-G6-02)', async () => {
    // Todos los cruces de la especie del fixture son es_prueba: sin cruces reales no hay población.
    const r = await congelar(raiz.admin, { p_nombre: 'Solo pruebas', p_especie_id: ctx.especieId });
    expect(r.error?.code).toBe('23514');
  });
});

describe('S02 — modo por ronda: cada ronda se congela con la versión con que se cerró', () => {
  it('tras activar una versión nueva, el snapshot usa la versión sellada de cada ronda, pero el encabezado guarda la versión activa', async () => {
    const e = await especieAdicional(raiz, 'ronda');
    const vA = await crearVersionDosMetricas(e, `AUD-G6 S02 ronda v1 ${raiz.R}`);
    const cruce = await crearCruce(e, { codigo: `AUD-G6-S02R-${raiz.R}` });
    const ind = await crearIndividuos(e, cruce, 1);
    await crearEvaluacion(e, await crearRonda(e, ind[0].id), { brotacion: 5, firmeza: 5 }); // sella vA; puntaje 1.0
    const { data: vB } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: vA, p_nombre: `AUD-G6 S02 ronda v2 ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    await raiz.admin.from('scoring_metrica').update({ maximo_normalizacion: 10 }).eq('scoring_version_id', vB as string).eq('metrica', 'firmeza');
    await raiz.admin.rpc('activar_version_scoring', { p_version_id: vB as string });

    const operativo = ((await raiz.operario.rpc('obtener_ranking_operativo', { p_planta_id: cruce })).data as Fila).items[0];
    expect(operativo.scoring_version_id).toBe(vB);
    expect(Number(operativo.puntaje_ponderado)).toBe(0.7222); // 0.5*1 + 0.5*(5-1)/9

    const r = await congelar(raiz.admin, { p_nombre: 'Tras v2', p_planta_id: cruce });
    expect(r.error).toBeNull();
    const d = await detalle(r.id!);
    expect(d.snapshot.scoring_version_id).toBe(vB); // encabezado: versión activa al congelar
    expect(d.resultados[0].detalle.scoring_version_id).toBe(vA); // fila: versión sellada de su ronda
    expect(Number(d.resultados[0].puntaje)).toBe(1); // 0.5*1 + 0.5*1 con la escala 1-5 de v1
    expect(Number(d.resultados[0].puntaje)).not.toBe(Number(operativo.puntaje_ponderado));
  });
});

describe('S02 — editar o borrar un snapshot', () => {
  it('nadie puede borrar, renombrar ni escribir snapshots por la API (ni el admin): solo service_role', async () => {
    const r = await congelar(raiz.admin, { p_nombre: 'Intocable', p_planta_id: cruceB });
    expect(r.error).toBeNull();
    for (const [nombre, cliente] of [['admin', raiz.admin], ['operario', raiz.operario]] as const) {
      const del = await cliente.from('ranking_snapshot').delete().eq('id', r.id!);
      expect(del.error?.code, `${nombre} delete`).toBe('42501');
      const upd = await cliente.from('ranking_snapshot').update({ nombre: 'renombrado' }).eq('id', r.id!);
      expect(upd.error?.code, `${nombre} update`).toBe('42501');
      const ins = await cliente.from('ranking_snapshot').insert({ nombre: 'directo', alcance: 'especie', scoring_version_id: v1, especie_id: ctx.especieId, poblacion_comparada: 1, created_by: raiz.adminId });
      expect(ins.error?.code, `${nombre} insert`).toBe('42501');
      const delRes = await cliente.from('ranking_snapshot_resultado').delete().eq('snapshot_id', r.id!);
      expect(delRes.error?.code, `${nombre} delete resultado`).toBe('42501');
      const updRes = await cliente.from('ranking_snapshot_resultado').update({ puntaje: 0.99 }).eq('snapshot_id', r.id!);
      expect(updRes.error?.code, `${nombre} update resultado`).toBe('42501');
    }
    const anon = await raiz.anon.from('ranking_snapshot').select('id').limit(1);
    expect(anon.error).not.toBeNull();
    const { count } = await raiz.service.from('ranking_snapshot').select('id', { count: 'exact', head: true }).eq('id', r.id!);
    expect(count).toBe(1);
  });

  it('el borrado físico de un individuo con snapshot está bloqueado por FK (RESTRICT): los snapshots fijan al individuo', async () => {
    const { data } = await raiz.service.from('ranking_snapshot').select('id').eq('planta_id', cruceA).limit(1);
    const { data: res } = await raiz.service.from('ranking_snapshot_resultado').select('individuo_id').eq('snapshot_id', data![0].id).limit(1);
    const del = await raiz.service.from('individuos').delete().eq('id', res![0].individuo_id);
    expect(del.error?.code).toBe('23503');
  });
});

describe('S02 — efecto lateral sobre las cuentas', () => {
  it('un admin que congeló un snapshot no puede borrarse como usuario mientras exista el snapshot (FK RESTRICT sobre created_by)', async () => {
    const { crearUsuarioDePrueba } = await import('../helpers');
    const extra = await crearUsuarioDePrueba(raiz.creds, raiz.service, { email: `aud-g6-s02-admin2-${raiz.R}@test.local`, rol: 'admin' });
    const r = await congelar(extra.client, { p_nombre: 'De otro admin', p_planta_id: cruceB });
    expect(r.error).toBeNull();
    const intento = await raiz.service.auth.admin.deleteUser(extra.userId);
    expect(intento.error).not.toBeNull(); // el borrado de la cuenta falla de forma opaca ("Database error deleting user")
    // Limpieza: sin el snapshot sí se puede.
    await raiz.service.from('ranking_snapshot_resultado').delete().eq('snapshot_id', r.id!);
    await raiz.service.from('ranking_snapshot').delete().eq('id', r.id!);
    const ok = await raiz.service.auth.admin.deleteUser(extra.userId);
    expect(ok.error).toBeNull();
  });
});

describe('S03 — listar, ver el detalle y paginar', () => {
  it('lista por cruce y por especie por separado, ordenado del más reciente al más antiguo, con total y paginación', async () => {
    const porCruce = (await raiz.operario.rpc('listar_snapshots_ranking', { p_planta_id: cruceA, p_limite: 100 })).data as Fila;
    expect(porCruce.total).toBeGreaterThanOrEqual(4); // Cierre cruce A + 3 concurrentes
    expect(porCruce.items.every((i: Fila) => i.alcance === 'cruzamiento' && i.planta_id === cruceA)).toBe(true);
    const fechas = porCruce.items.map((i: Fila) => i.created_at);
    expect([...fechas].sort().reverse()).toEqual(fechas);
    const porEspecie = (await raiz.operario.rpc('listar_snapshots_ranking', { p_especie_id: ctx.especieId })).data as Fila;
    expect(porEspecie.items.every((i: Fila) => i.alcance === 'especie')).toBe(true);
    const pagina = (await raiz.operario.rpc('listar_snapshots_ranking', { p_planta_id: cruceA, p_limite: 2, p_offset: 2 })).data as Fila;
    expect(pagina.items).toHaveLength(2);
    expect(pagina.total).toBe(porCruce.total);
    expect(pagina.items.map((i: Fila) => i.id)).toEqual(porCruce.items.slice(2, 4).map((i: Fila) => i.id));
  });

  it('valida alcance y paginación, y rechaza un snapshot inexistente; anon no lee', async () => {
    const neither = await raiz.operario.rpc('listar_snapshots_ranking', {});
    expect(neither.error?.code).toBe('22023');
    const lim = await raiz.operario.rpc('listar_snapshots_ranking', { p_planta_id: cruceA, p_limite: 101 });
    expect(lim.error?.code).toBe('22023');
    const det = await raiz.operario.rpc('obtener_detalle_snapshot', { p_snapshot_id: '00000000-0000-0000-0000-000000000000' });
    expect(det.error?.code).toBe('P0002');
    const cmp = await raiz.operario.rpc('comparar_snapshot_vivo', { p_snapshot_id: '00000000-0000-0000-0000-000000000000' });
    expect(cmp.error?.code).toBe('P0002');
    for (const [fn, args] of [['listar_snapshots_ranking', { p_planta_id: cruceA }], ['obtener_detalle_snapshot', { p_snapshot_id: cruceA }], ['comparar_snapshot_vivo', { p_snapshot_id: cruceA }]] as const) {
      const r = await raiz.anon.rpc(fn, args);
      expect(r.error, fn).not.toBeNull();
    }
  });

  it('la lectura de snapshots no expone linaje: ninguna clave de mamá/papá/cruzamiento en cabecera ni detalle', async () => {
    const d = await detalle((await raiz.operario.rpc('listar_snapshots_ranking', { p_planta_id: cruceA })).data.items[0].id);
    const texto = JSON.stringify(d);
    for (const clave of ['cruzamiento', 'mama', 'papa', 'mama_id', 'papa_id', 'genetica_a', 'genetica_b']) expect(texto).not.toMatch(new RegExp(`"${clave}":`));
  });
});

describe('S03 — comparar contra el ranking vivo', () => {
  it('detecta quién entró, quién salió y los deltas con su etiqueta; el detalle congelado no cambia', async () => {
    const e = await especieAdicional(raiz, 'cmp');
    const vC = await crearVersionDosMetricas(e, `AUD-G6 S03 cmp v1 ${raiz.R}`);
    const cruce = await crearCruce(e, { codigo: `AUD-G6-S03-${raiz.R}` });
    const ind = await crearIndividuos(e, cruce, 4);
    await crearEvaluacion(e, await crearRonda(e, ind[0].id), { brotacion: 5, firmeza: 5 }); // P1 = 1.0
    await crearEvaluacion(e, await crearRonda(e, ind[1].id), { brotacion: 3, firmeza: 3 }); // P2 = 0.5
    await crearEvaluacion(e, await crearRonda(e, ind[2].id), { brotacion: 1, firmeza: 1 }); // P3 = 0.0
    const rondaP4 = await crearRonda(e, ind[3].id);
    await crearEvaluacion(e, rondaP4, { firmeza: 5 }); // P4 parcial: no entra al snapshot

    const snap = await congelar(raiz.admin, { p_nombre: 'Base comparación', p_planta_id: cruce });
    expect(snap.error).toBeNull();
    const detalleAntes = await detalle(snap.id!);

    // Cambios posteriores: P1 empeora (segunda visita), P3 se descarta, P4 completa su brotación.
    const rondaP1 = (await raiz.service.from('ronda_evaluacion_anual').select('id').eq('individuo_id', ind[0].id).single()).data!.id;
    await crearEvaluacion(e, rondaP1, { brotacion: 1, firmeza: 1 }, { fecha: '2026-08-01' });
    await raiz.service.from('individuos').update({ estado_vital: 'descartado', fecha_baja: '2026-08-01' }).eq('id', ind[2].id);
    await crearEvaluacion(e, rondaP4, { brotacion: 4 }, { fecha: '2026-08-02' }); // P4 = 0.5*0.75 + 0.5*1 = 0.875

    const { data, error } = await raiz.operario.rpc('comparar_snapshot_vivo', { p_snapshot_id: snap.id! });
    expect(error).toBeNull();
    const c = data as Fila;
    expect(c).toMatchObject({ snapshot_id: snap.id, scoring_version_snapshot_id: vC, scoring_version_viva_id: vC, version_cambio: false });
    expect(c.umbrales).toMatchObject({ leve: 0.05, marcado: 0.15 });
    const porCodigo = new Map<string, Fila>(c.individuos.map((i: Fila) => [sufijo(i.codigo_display), i]));
    expect(porCodigo.get('P1')).toMatchObject({ estaba_en_snapshot: true, esta_en_vivo: true, puntaje_snapshot: 1, puntaje_vivo: 0, etiqueta: 'empeoro_marcado' });
    expect(Number(porCodigo.get('P1')!.delta)).toBe(-1);
    expect(porCodigo.get('P2')).toMatchObject({ puntaje_snapshot: 0.5, puntaje_vivo: 0.5, etiqueta: 'estable' });
    expect(porCodigo.get('P3')).toMatchObject({ estaba_en_snapshot: true, esta_en_vivo: false, puntaje_vivo: null, delta: null, etiqueta: null });
    expect(porCodigo.get('P4')).toMatchObject({ estaba_en_snapshot: false, esta_en_vivo: true, puntaje_snapshot: null, delta: null });
    expect(Number(porCodigo.get('P4')!.puntaje_vivo)).toBe(0.875);
    // Lo congelado es inmutable.
    expect(await detalle(snap.id!)).toEqual(detalleAntes);
  });

  it('tras activar una versión nueva marca version_cambio, pero el lado vivo sigue midiendo cada ronda con su versión sellada (delta 0) — A1-G6-12', async () => {
    const e = await especieAdicional(raiz, 'cmp2');
    const vA = await crearVersionDosMetricas(e, `AUD-G6 S03 cmp2 v1 ${raiz.R}`);
    const cruce = await crearCruce(e, { codigo: `AUD-G6-S03B-${raiz.R}` });
    const ind = await crearIndividuos(e, cruce, 1);
    await crearEvaluacion(e, await crearRonda(e, ind[0].id), { brotacion: 5, firmeza: 5 });
    const snap = await congelar(raiz.admin, { p_nombre: 'Antes de v2', p_planta_id: cruce });
    const { data: vB } = await raiz.admin.rpc('nueva_version_scoring', { p_version_base_id: vA, p_nombre: `AUD-G6 S03 cmp2 v2 ${raiz.R}`, p_vigente_desde: '2026-07-01' });
    await raiz.admin.from('scoring_metrica').update({ maximo_normalizacion: 10 }).eq('scoring_version_id', vB as string).eq('metrica', 'firmeza');
    await raiz.admin.rpc('activar_version_scoring', { p_version_id: vB as string });
    const c = (await raiz.operario.rpc('comparar_snapshot_vivo', { p_snapshot_id: snap.id! })).data as Fila;
    expect(c.version_cambio).toBe(true);
    expect(c.scoring_version_viva_id).toBe(vB);
    // El aviso de la pantalla ("parte del delta puede deberse al cambio de configuración") aparece,
    // pero el delta es 0: la comparación vivo-vs-snapshot no refleja la versión nueva.
    expect(c.individuos[0]).toMatchObject({ puntaje_snapshot: 1, puntaje_vivo: 1, etiqueta: 'estable' });
    const operativo = ((await raiz.operario.rpc('obtener_ranking_operativo', { p_planta_id: cruce })).data as Fila).items[0];
    expect(Number(operativo.puntaje_ponderado)).toBe(0.7222); // la pestaña Ranking sí usa v2
  });
});
