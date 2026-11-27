/**
 * Fase 5, segunda parte (decisión G6; Efraín, EF16 y EF17): puntaje v3, igual a la v2 salvo
 *   - calibre: 12 mm = 0 y 25 mm = 1; Brix: 10 °Bx = 0 y 20 °Bx = 1 (se acotan fuera del rango);
 *   - rendimiento por planta según la edad (edad = número de la temporada de evaluación anual): año 1 de 0 a 2 kg, año 2 de 0 a 5 kg,
 *     año 3 en adelante de 0 a 10 kg.
 * Nace inactiva (borrador). Los rangos por edad viven en la tabla scoring_metrica_rango_edad (con RLS, de solo lectura para la app e
 * inmutable cuando la versión está en uso). La activación es un paso aparte (docs/migraciones_pendientes/scoring_v3_activar.sql).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

const CONTENEDOR = 'supabase_db_dbsecurity-frutales';
const RAIZ = join(__dirname, '..', '..', '..');
const NOMBRE_V2 = 'Selección v2 (5 categorías 40-30-15-10-5) provisional';
const NOMBRE_V3 = 'Selección v3 (calibre, Brix y rendimiento por edad) provisional';
const psql = (sql: string) => execFileSync('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
  input: sql, encoding: 'utf8',
}).trim();
const archivo = (...ruta: string[]) => readFileSync(join(RAIZ, ...ruta), 'utf8');

let ctx: ContextoG6;
let v2Id: string;
let v3Id: string;
const versionesCreadas: string[] = [];

beforeAll(async () => {
  ctx = await iniciarContexto('fase5-scoring-v3');
  const { data: v2 } = await ctx.service.from('scoring_version').select('id').eq('nombre', NOMBRE_V2).single();
  const { data: v3 } = await ctx.service.from('scoring_version').select('id').eq('nombre', NOMBRE_V3).maybeSingle();
  v2Id = v2!.id;
  v3Id = v3?.id;
}, 120_000);

afterAll(async () => {
  for (const id of versionesCreadas) {
    psql(`delete from public.scoring_metrica_rango_edad where scoring_metrica_id in (select id from public.scoring_metrica where scoring_version_id = '${id}');
delete from public.scoring_metrica where scoring_version_id = '${id}';
delete from public.scoring_categoria_peso where scoring_version_id = '${id}';
delete from public.scoring_version where id = '${id}';`);
  }
  await limpiarContexto(ctx);
}, 60_000);

async function metricas(versionId: string): Promise<Record<string, Fila>> {
  const { data } = await ctx.service.from('scoring_metrica')
    .select('id, metrica, categoria, peso, direccion_favorable, metodo_normalizacion, minimo_normalizacion, maximo_normalizacion, rango_referencia_id')
    .eq('scoring_version_id', versionId);
  return Object.fromEntries(((data ?? []) as Fila[]).map((m) => [m.metrica, m]));
}

describe('versión v3', () => {
  it('existe y nace inactiva (borrador)', async () => {
    expect(v3Id).toBeTruthy();
    const { data } = await ctx.service.from('scoring_version').select('estado, especie_id, fase').eq('id', v3Id).single();
    expect(data).toMatchObject({ estado: 'borrador', especie_id: null, fase: 'evaluacion_anual' });
  });

  it('tiene las mismas 19 métricas, pesos, direcciones y categorías que la v2', async () => {
    const [m2, m3] = [await metricas(v2Id), await metricas(v3Id)];
    expect(Object.keys(m3).sort()).toEqual(Object.keys(m2).sort());
    expect(Object.keys(m3)).toHaveLength(19);
    for (const k of Object.keys(m2)) {
      expect([m3[k].categoria, Number(m3[k].peso), m3[k].direccion_favorable]).toEqual([m2[k].categoria, Number(m2[k].peso), m2[k].direccion_favorable]);
    }
    const { data: c2 } = await ctx.service.from('scoring_categoria_peso').select('categoria, peso').eq('scoring_version_id', v2Id).order('categoria');
    const { data: c3 } = await ctx.service.from('scoring_categoria_peso').select('categoria, peso').eq('scoring_version_id', v3Id).order('categoria');
    expect(c3).toEqual(c2);
  });

  it('las demás métricas normalizan igual que en la v2', async () => {
    const [m2, m3] = [await metricas(v2Id), await metricas(v3Id)];
    for (const k of Object.keys(m2).filter((x) => !['calibre_mm', 'brix', 'rend_kg_planta'].includes(x))) {
      const campos = (m: Fila) => [m.metodo_normalizacion, m.minimo_normalizacion, m.maximo_normalizacion, m.rango_referencia_id];
      expect(campos(m3[k])).toEqual(campos(m2[k]));
    }
  });

  it('calibre normaliza de 12 a 25 mm y Brix de 10 a 20 °Bx, con rangos propios que no dan avisos en el formulario', async () => {
    const m3 = await metricas(v3Id);
    const { data } = await ctx.service.from('rango_referencia').select('id, metrica, minimo_esperado, maximo_esperado, activo, especie_id')
      .in('id', [m3.calibre_mm.rango_referencia_id, m3.brix.rango_referencia_id]);
    const por = Object.fromEntries(((data ?? []) as Fila[]).map((r) => [r.metrica, r]));
    expect(por.calibre_mm).toMatchObject({ minimo_esperado: 12, maximo_esperado: 25, activo: false, especie_id: null });
    expect(por.brix).toMatchObject({ minimo_esperado: 10, maximo_esperado: 20, activo: false, especie_id: null });
    // El formulario sigue avisando con los rangos de hoy (A3): los rangos de la v3 están inactivos.
    const { data: activos } = await ctx.service.from('rango_referencia').select('metrica, minimo_esperado, maximo_esperado').eq('activo', true).in('metrica', ['calibre_mm', 'brix']);
    expect(Object.fromEntries(((activos ?? []) as Fila[]).map((r) => [r.metrica, [r.minimo_esperado, r.maximo_esperado]]))).toEqual({ calibre_mm: [14, 24], brix: [10, 18] });
  });

  it('el rendimiento por planta normaliza según la edad: año 1 de 0 a 2, año 2 de 0 a 5, desde el año 3 de 0 a 10', async () => {
    const m3 = await metricas(v3Id);
    expect([m3.rend_kg_planta.metodo_normalizacion, Number(m3.rend_kg_planta.minimo_normalizacion), Number(m3.rend_kg_planta.maximo_normalizacion)]).toEqual(['escala', 0, 10]);
    const { data } = await ctx.operario.from('scoring_metrica_rango_edad').select('edad_desde, minimo, maximo').eq('scoring_metrica_id', m3.rend_kg_planta.id).order('edad_desde');
    expect((data ?? []).map((r) => [r.edad_desde, Number(r.minimo), Number(r.maximo)])).toEqual([[1, 0, 2], [2, 0, 5], [3, 0, 10]]);
    const { data: otras } = await ctx.admin.from('scoring_metrica_rango_edad').select('scoring_metrica_id').neq('scoring_metrica_id', m3.rend_kg_planta.id)
      .in('scoring_metrica_id', Object.values(m3).map((m) => m.id));
    expect(otras).toEqual([]);
  });
});

describe('tabla scoring_metrica_rango_edad', () => {
  it('tiene RLS: el operario lee, pero nadie de la app escribe; anon no lee', async () => {
    const m3 = await metricas(v3Id);
    const { data, error } = await ctx.operario.from('scoring_metrica_rango_edad').select('edad_desde').eq('scoring_metrica_id', m3.rend_kg_planta.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    const ins = await ctx.admin.from('scoring_metrica_rango_edad').insert({ scoring_metrica_id: m3.rend_kg_planta.id, edad_desde: 4, minimo: 0, maximo: 12 });
    expect(ins.error).not.toBeNull();
    const upd = await ctx.admin.from('scoring_metrica_rango_edad').update({ maximo: 99 }).eq('scoring_metrica_id', m3.rend_kg_planta.id).select('id');
    expect(upd.data ?? []).toEqual([]);
    const anon = await ctx.anon.from('scoring_metrica_rango_edad').select('edad_desde');
    expect(anon.data ?? []).toEqual([]);
    expect(psql(`select relrowsecurity from pg_class where oid = 'public.scoring_metrica_rango_edad'::regclass`)).toBe('t');
  });

  it('valida el rango (máximo mayor que mínimo, edad desde 1) y no repite la edad', () => {
    expect(() => psql(`begin;\ninsert into public.scoring_metrica_rango_edad (scoring_metrica_id, edad_desde, minimo, maximo) select id, 5, 3, 3 from public.scoring_metrica where scoring_version_id = '${v3Id}' and metrica = 'rend_kg_planta';\nrollback;`)).toThrow();
    expect(() => psql(`begin;\ninsert into public.scoring_metrica_rango_edad (scoring_metrica_id, edad_desde, minimo, maximo) select id, 0, 0, 3 from public.scoring_metrica where scoring_version_id = '${v3Id}' and metrica = 'rend_kg_planta';\nrollback;`)).toThrow();
    expect(() => psql(`begin;\ninsert into public.scoring_metrica_rango_edad (scoring_metrica_id, edad_desde, minimo, maximo) select id, 2, 0, 7 from public.scoring_metrica where scoring_version_id = '${v3Id}' and metrica = 'rend_kg_planta';\nrollback;`)).toThrow();
  });

  it('con la versión en uso, sus rangos por edad no se pueden cambiar', () => {
    const salida = () => psql(`begin;
insert into public.ranking_snapshot (nombre, alcance, scoring_version_id, especie_id, poblacion_comparada, criterios, created_by)
  values ('prueba en uso', 'especie', '${v3Id}', '${ctx.especieId}', 1, '{}', '${ctx.adminId}');
update public.scoring_metrica_rango_edad set maximo = 6 where edad_desde = 2 and scoring_metrica_id in (select id from public.scoring_metrica where scoring_version_id = '${v3Id}');
rollback;`);
    expect(salida).toThrow(/en uso/);
  });

  it('nueva_version_scoring copia también los rangos por edad', async () => {
    const { data: nueva, error } = await ctx.admin.rpc('nueva_version_scoring', { p_version_base_id: v3Id, p_nombre: `Copia v3 ${ctx.R}`, p_vigente_desde: '2026-10-26' });
    expect(error).toBeNull();
    versionesCreadas.push(nueva as string);
    const mn = await metricas(nueva as string);
    const { data } = await ctx.admin.from('scoring_metrica_rango_edad').select('edad_desde, minimo, maximo').eq('scoring_metrica_id', mn.rend_kg_planta.id).order('edad_desde');
    expect((data ?? []).map((r) => [r.edad_desde, Number(r.minimo), Number(r.maximo)])).toEqual([[1, 0, 2], [2, 0, 5], [3, 0, 10]]);
  });
});

describe('el motor con la v3 (calcular_ranking_nucleo y calcular_metricas_evaluacion)', () => {
  let cruce: string;
  const ind: Record<string, { id: string; ronda: string; evaluacion: string }> = {};

  beforeAll(async () => {
    cruce = await crearCruce(ctx, { codigo: `F5-V3-${ctx.R}` });
    const [a, b, c, d, e] = await crearIndividuos(ctx, cruce, 5);
    // Edad = número de la ronda anual. Cada individuo se puntúa con su última ronda cerrada.
    const conRondas = async (clave: string, individuo: { id: string }, rondas: number, ultima: Record<string, unknown>, previas: Record<string, unknown> = { rend_kg_planta: 1 }) => {
      let ronda = '';
      let evaluacion = '';
      for (let n = 1; n <= rondas; n += 1) {
        ronda = await crearRonda(ctx, individuo.id, n);
        evaluacion = await crearEvaluacion(ctx, ronda, n === rondas ? ultima : previas, { fecha: `2026-0${n + 1}-15` });
      }
      ind[clave] = { id: individuo.id, ronda, evaluacion };
    };
    await conRondas('a', a, 1, { rend_kg_planta: 1, calibre_mm: 18.5, brix: 15 });
    await conRondas('b', b, 2, { rend_kg_planta: 2.5, calibre_mm: 30, brix: 9 });
    await conRondas('c', c, 3, { rend_kg_planta: 5, calibre_mm: 11, brix: 25 });
    await conRondas('d', d, 3, { rend_kg_planta: 12 });
    await conRondas('e', e, 1, { rend_kg_planta: 3 });
  }, 120_000);

  const nucleo = (version: string, numero = 'null') => JSON.parse(psql(`select coalesce(jsonb_object_agg(individuo_id, jsonb_build_object('ronda', numero_ronda, 'detalle', detalle_metricas)), '{}') from public.calcular_ranking_nucleo('${version}', '${cruce}', null, false, true, true, ${numero})`)) as Record<string, Fila>;
  const normalizado = (fila: Fila, metrica: string) => Number(fila.detalle[metrica].normalizado);

  it('rendimiento: 1 kg en el año 1, 2,5 kg en el año 2 y 5 kg en el año 3 valen lo mismo (0,5); 12 kg en el año 3 se acota a 1; 3 kg en el año 1 a 1', () => {
    const r = nucleo(v3Id);
    expect(r[ind.a.id].ronda).toBe(1);
    expect(normalizado(r[ind.a.id], 'rend_kg_planta')).toBeCloseTo(0.5, 6);
    expect(normalizado(r[ind.b.id], 'rend_kg_planta')).toBeCloseTo(0.5, 6);
    expect(normalizado(r[ind.c.id], 'rend_kg_planta')).toBeCloseTo(0.5, 6);
    expect(normalizado(r[ind.d.id], 'rend_kg_planta')).toBeCloseTo(1, 6);
    expect(normalizado(r[ind.e.id], 'rend_kg_planta')).toBeCloseTo(1, 6);
  });

  it('con la v2 el rendimiento sigue con un solo rango (0 a 6 kg), sin importar la edad', () => {
    const r = nucleo(v2Id);
    expect(normalizado(r[ind.a.id], 'rend_kg_planta')).toBeCloseTo(1 / 6, 6);
    expect(normalizado(r[ind.c.id], 'rend_kg_planta')).toBeCloseTo(5 / 6, 6);
  });

  it('calibre y Brix: 18,5 mm y 15 °Bx valen 0,5; fuera del rango se acotan y quedan marcados', () => {
    const r = nucleo(v3Id);
    expect(normalizado(r[ind.a.id], 'calibre_mm')).toBeCloseTo(0.5, 6);
    expect(normalizado(r[ind.a.id], 'brix')).toBeCloseTo(0.5, 6);
    expect(normalizado(r[ind.b.id], 'calibre_mm')).toBe(1);
    expect(r[ind.b.id].detalle.calibre_mm.fuera_rango_superior).toBe(true);
    expect(normalizado(r[ind.b.id], 'brix')).toBe(0);
    expect(r[ind.b.id].detalle.brix.fuera_rango_inferior).toBe(true);
    expect(normalizado(r[ind.c.id], 'calibre_mm')).toBe(0);
    expect(normalizado(r[ind.c.id], 'brix')).toBe(1);
    // Con la v2, el mismo calibre de 18,5 mm valía (18,5 − 14) / 10.
    expect(normalizado(nucleo(v2Id)[ind.a.id], 'calibre_mm')).toBeCloseTo(0.45, 6);
  });

  it('pidiendo la temporada 1, la edad es 1 también para quien ya va en la ronda 3', () => {
    const r = nucleo(v3Id, '1::smallint');
    expect(r[ind.c.id].ronda).toBe(1);
    expect(normalizado(r[ind.c.id], 'rend_kg_planta')).toBeCloseTo(0.5, 6);
  });

  it('calcular_metricas_evaluacion usa la edad de la ronda de la evaluación', () => {
    const valor = (evaluacion: string) => Number(psql(`select m.normalizado from public.evaluaciones e, public.calcular_metricas_evaluacion(e, '${v3Id}') m where e.id = '${evaluacion}' and m.metrica = 'rend_kg_planta'`));
    expect(valor(ind.b.evaluacion)).toBeCloseTo(0.5, 6);
    expect(valor(ind.c.evaluacion)).toBeCloseTo(0.5, 6);
    expect(valor(ind.a.evaluacion)).toBeCloseTo(0.5, 6);
  });
});

describe('activación de la v3 y su rollback (dentro de una transacción que se descarta)', () => {
  const activarV2 = () => archivo('docs', 'migraciones_pendientes', 'scoring_v2_activar.sql');
  const activarV3 = () => archivo('docs', 'migraciones_pendientes', 'scoring_v3_activar.sql');
  const revertirV3 = () => archivo('docs', 'fase5', 'rollback', '61_activar_v3.sql');
  const estados = `select string_agg(nombre || '=' || estado::text || '=' || coalesce(vigente_hasta::text, '-'), ' | ' order by nombre) from scoring_version where especie_id is null`;

  it('con la v2 activa (como en producción), activar deja la v3 activa y la v2 inactiva; el rollback lo deja como estaba', () => {
    const v2Activa = psql(`select estado::text from scoring_version where id = '${v2Id}'`) === 'activa';
    const salida = psql(`begin;
${v2Activa ? '' : activarV2()}
select 'antes:' || (${estados});
${activarV3()}
select 'activada:' || (${estados});
select 'resuelve:' || (select nombre from scoring_version where id = public.resolver_scoring_version(null, 'evaluacion_anual', current_date));
${revertirV3()}
select 'revertida:' || (${estados});
rollback;`);
    const l = Object.fromEntries(salida.split('\n').filter((x) => /^(antes|activada|resuelve|revertida):/.test(x)).map((x) => [x.split(':')[0], x.slice(x.indexOf(':') + 1)]));
    expect(l.antes).toContain(`${NOMBRE_V2}=activa=-`);
    expect(l.antes).toContain(`${NOMBRE_V3}=borrador=-`);
    expect(l.activada).toContain(`${NOMBRE_V3}=activa=-`);
    expect(l.activada).toMatch(new RegExp(`${NOMBRE_V2.replace(/[()]/g, '\\$&')}=inactiva=\\d{4}-\\d{2}-\\d{2}`));
    expect(l.resuelve).toBe(NOMBRE_V3);
    expect(l.revertida).toBe(l.antes);
  });

  it('sin la v2 activa, activar la v3 se niega', () => {
    const v2Activa = psql(`select estado::text from scoring_version where id = '${v2Id}'`) === 'activa';
    if (v2Activa) return;
    expect(() => psql(`begin;\n${activarV3()}\nrollback;`)).toThrow(/activar v3/);
  });
});
