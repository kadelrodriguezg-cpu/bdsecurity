/**
 * Auditoría Corrida 1 — G6 / S06: ranking de polinización varietal
 * (`obtener_ranking_polinizacion_varietal`, SECURITY DEFINER, solo admin).
 *
 * Un caso calculado a mano en una especie propia: autopolinización, cruce
 * archivado, cruces sin padres, variedades con cero sesiones, resumen de
 * flores reales y las tres lentes (ambos / mamá / papá). Además: permisos,
 * una sola fila de auditoría por consulta, y qué se puede inferir del
 * resultado cuando una variedad participa en un solo cruce.
 *
 * Correr solo este archivo: npx vitest run tests/rls/auditoria/g6-polinizacion-varietal.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoriaDe, crearCruce, iniciarContexto, limpiarContexto, type ContextoG6, type Fila } from './g6-helpers';

let ctx: ContextoG6;
const V: Record<string, string> = {};

async function variedad(nombre: string): Promise<string> {
  const { data, error } = await ctx.service.from('variedades').insert({ especie_id: ctx.especieId, nombre: `AUD-G6 ${nombre} ${ctx.R}` }).select('id').single();
  if (error || !data) throw new Error(`variedad ${nombre}: ${error?.message}`);
  return data.id;
}

async function sesion(plantaId: string, flores: number, fecha = '2026-09-01') {
  const { error } = await ctx.service.from('polinizacion_evento').insert({ planta_id: plantaId, fecha, n_flores_cruzadas: flores, created_by: ctx.adminId });
  if (error) throw new Error(`sesion: ${error.message}`);
}

async function ranking(cliente: ContextoG6['admin'], rol?: string, especieId = ctx.especieId) {
  const { data, error } = await cliente.rpc('obtener_ranking_polinizacion_varietal', rol === undefined ? { p_especie_id: especieId } : { p_especie_id: especieId, p_rol: rol });
  const filas = (data ?? []) as Fila[];
  return {
    error,
    filas: filas.filter((f) => f.tipo_fila === 'variedad'),
    resumen: filas.filter((f) => f.tipo_fila === 'resumen'),
    todas: filas,
  };
}

const quitar = (nombre: string) => nombre.replace(/^AUD-G6 /, '').replace(new RegExp(` ${ctx.R}$`), '');
const resumenFilas = (filas: Fila[]) => filas.map((f) => [quitar(f.variedad_nombre), Number(f.flores_totales), Number(f.sesiones_polinizacion), Number(f.cruces_distintos)]);

beforeAll(async () => {
  ctx = await iniciarContexto('s06');
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X', 'Y']) V[n] = await variedad(n);
  const cruce = (codigo: string, mama: string | null, papa: string | null, eliminado = false) =>
    crearCruce(ctx, { codigo: `AUD-G6-S06-${codigo}-${ctx.R}`, estado: 'polinizacion', mamaId: mama, papaId: papa, eliminado });
  const c1 = await cruce('C1', V.A, V.B); await sesion(c1, 10); await sesion(c1, 5, '2026-09-08');
  const c2 = await cruce('C2', V.A, V.C); await sesion(c2, 7);
  const c3 = await cruce('C3', V.B, V.B); await sesion(c3, 3); // autopolinización
  const c4 = await cruce('C4', V.D, V.E, true); await sesion(c4, 100); // archivado: fuera de todo
  await cruce('C5', V.F, V.G); // sin sesiones: el cero comunica "asignada, sin actividad"
  const c6 = await cruce('C6', null, null); await sesion(c6, 4); // sin padres: cuenta en flores reales
  const c7 = await cruce('C7', V.H, null); await sesion(c7, 6); // un solo padre
  const c9 = await cruce('C9', V.X, V.Y); await sesion(c9, 12); // X e Y solo participan aquí
}, 90_000);

afterAll(async () => {
  if (ctx) await limpiarContexto(ctx);
});

describe('S06 — quién puede consultar', () => {
  it('un operario, con o sin puede_ver_linaje, no obtiene nada: 42501 y sin fila de auditoría', async () => {
    for (const [cliente, id] of [[ctx.operario, ctx.operarioId], [ctx.operarioLinaje, ctx.operarioLinajeId]] as const) {
      const r = await ranking(cliente);
      expect(r.error?.code).toBe('42501');
      expect(r.todas).toEqual([]);
      expect((await auditoriaDe(ctx, id, 'lectura_ranking_polinizacion_varietal')).length).toBe(0);
    }
  });

  it('anon no puede ejecutar la función', async () => {
    const r = await ranking(ctx.anon);
    expect(r.error).not.toBeNull();
    expect(r.todas).toEqual([]);
  });

  it('el intento denegado de un operario no queda auditado (solo hay rastro de lo que se devuelve)', async () => {
    const { data } = await ctx.service.from('audit_log').select('id').eq('accion', 'lectura_ranking_polinizacion_varietal').eq('usuario_id', ctx.operarioId);
    expect(data).toEqual([]);
  });
});

describe('S06 — cálculo (ambos roles, mamá, papá)', () => {
  it('ambos: une mamá y papá por cruce; la autopolinización cuenta una vez; el archivado no aparece; las variedades sin sesiones salen con cero', async () => {
    const r = await ranking(ctx.admin, 'ambos');
    expect(r.error).toBeNull();
    expect(resumenFilas(r.filas)).toEqual([
      ['A', 22, 3, 2],
      ['B', 18, 3, 2], // C1 (15) + C3 (3): la autopolinización B×B suma una sola vez
      ['X', 12, 1, 1],
      ['Y', 12, 1, 1],
      ['C', 7, 1, 1],
      ['H', 6, 1, 1],
      ['F', 0, 0, 1],
      ['G', 0, 0, 1],
    ]);
    const nombres = r.filas.map((f) => quitar(f.variedad_nombre));
    expect(nombres).not.toContain('D');
    expect(nombres).not.toContain('E');
  });

  it('solo mamá y solo papá muestran únicamente a las variedades que participaron en ese rol', async () => {
    const mama = await ranking(ctx.admin, 'mama');
    expect(resumenFilas(mama.filas)).toEqual([['A', 22, 3, 2], ['X', 12, 1, 1], ['H', 6, 1, 1], ['B', 3, 1, 1], ['F', 0, 0, 1]]);
    const papa = await ranking(ctx.admin, 'papa');
    expect(resumenFilas(papa.filas)).toEqual([['B', 18, 3, 2], ['Y', 12, 1, 1], ['C', 7, 1, 1], ['G', 0, 0, 1]]);
  });

  it('el resumen trae una sola fila "resumen" al final, con flores_reales (cada sesión una vez, incluido el cruce sin padres) independiente del rol', async () => {
    for (const rol of ['ambos', 'mama', 'papa']) {
      const r = await ranking(ctx.admin, rol);
      expect(r.resumen, rol).toHaveLength(1);
      expect(r.todas.at(-1)!.tipo_fila).toBe('resumen');
      expect(Number(r.resumen[0].flores_reales), rol).toBe(10 + 5 + 7 + 3 + 4 + 6 + 12); // 47: sin el cruce archivado (100)
      expect(r.resumen[0]).toMatchObject({ variedad_id: null, variedad_nombre: null, flores_totales: null, sesiones_polinizacion: null, cruces_distintos: null });
      expect(r.filas.every((f) => f.flores_reales === null)).toBe(true);
    }
    // La suma de las filas de "ambos" (22+18+12+12+7+6) supera las flores reales: por eso el resumen existe.
    const ambos = await ranking(ctx.admin, 'ambos');
    const sumaFilas = ambos.filas.reduce((suma, f) => suma + Number(f.flores_totales), 0);
    expect(sumaFilas).toBe(77);
    expect(sumaFilas).toBeGreaterThan(Number(ambos.resumen[0].flores_reales));
  });

  it('valida especie y rol; una especie sin cruces devuelve solo el resumen en cero', async () => {
    const sinEspecie = await ctx.admin.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: null });
    expect(sinEspecie.error?.code).toBe('22023');
    const rolMalo = await ranking(ctx.admin, 'padre');
    expect(rolMalo.error?.code).toBe('22023');
    const nulo = await ctx.admin.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: ctx.especieId, p_rol: null });
    expect(nulo.error?.code).toBe('22023');
    const vacia = await ranking(ctx.admin, 'ambos', '00000000-0000-0000-0000-000000000000');
    expect(vacia.error).toBeNull();
    expect(vacia.filas).toEqual([]);
    expect(Number(vacia.resumen[0].flores_reales)).toBe(0);
  });
});

describe('S06 — auditoría', () => {
  it('deja exactamente una fila por consulta, con autor, especie, rol y campos expuestos; las consultas rechazadas no dejan fila', async () => {
    const antes = (await auditoriaDe(ctx, ctx.adminId, 'lectura_ranking_polinizacion_varietal')).length;
    await ranking(ctx.admin, 'ambos');
    await ranking(ctx.admin, 'mama');
    await ranking(ctx.admin, 'padre'); // inválida: no audita
    await ctx.admin.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: null }); // inválida: no audita
    const filas = await auditoriaDe(ctx, ctx.adminId, 'lectura_ranking_polinizacion_varietal');
    expect(filas.length - antes).toBe(2);
    expect(filas.at(-2)!.detalle).toEqual({ especie_id: ctx.especieId, participacion_parental: 'ambos' });
    expect(filas.at(-1)!.detalle).toEqual({ especie_id: ctx.especieId, participacion_parental: 'mama' });
    expect(filas.at(-1)!.planta_id).toBeNull();
    expect(filas.at(-1)!.campos_expuestos).toEqual(['variedad_nombre', 'flores_totales', 'sesiones_polinizacion', 'cruces_distintos', 'flores_reales']);
  });

  it('tres consultas simultáneas dejan tres filas (ni una más, ni una menos)', async () => {
    const antes = (await auditoriaDe(ctx, ctx.adminId, 'lectura_ranking_polinizacion_varietal')).length;
    await Promise.all([ranking(ctx.admin), ranking(ctx.admin, 'papa'), ranking(ctx.admin, 'mama')]);
    expect((await auditoriaDe(ctx, ctx.adminId, 'lectura_ranking_polinizacion_varietal')).length - antes).toBe(3);
  });

  it('la auditoría registra la lectura aunque la especie no exista (la fila precede al cálculo)', async () => {
    const antes = (await auditoriaDe(ctx, ctx.adminId, 'lectura_ranking_polinizacion_varietal')).length;
    await ranking(ctx.admin, 'ambos', '00000000-0000-0000-0000-000000000000');
    expect((await auditoriaDe(ctx, ctx.adminId, 'lectura_ranking_polinizacion_varietal')).length - antes).toBe(1);
  });
});

describe('S06 — qué revela el resultado', () => {
  it('no devuelve identificadores de cruces, códigos de cruce ni columnas de linaje por fila', async () => {
    const r = await ranking(ctx.admin);
    const claves = new Set(r.todas.flatMap((f) => Object.keys(f)));
    expect([...claves].sort()).toEqual(['cruces_distintos', 'flores_reales', 'flores_totales', 'sesiones_polinizacion', 'tipo_fila', 'variedad_id', 'variedad_nombre']);
    expect(JSON.stringify(r.todas)).not.toContain('AUD-G6-S06-C');
  });

  // A1-G6-14: el documento (Maestro 2.9) dice que el resultado "nunca permite inferir un cruce".
  // Una variedad que participa en un solo cruce expone los totales de ese cruce; la pareja de
  // variedades con tripleta idéntica delata el cruce, y comparar las lentes mamá y papá delata
  // quién es madre y quién padre. Solo lo ve un admin (que ya ve el linaje): se anota como latente.
  it.fails('con una variedad por cruce no se puede inferir qué dos variedades se cruzaron (A1-G6-14)', async () => {
    const ambos = await ranking(ctx.admin, 'ambos');
    const x = ambos.filas.find((f) => quitar(f.variedad_nombre) === 'X')!;
    const gemelas = ambos.filas.filter((f) => f.cruces_distintos === 1 && f.flores_totales === x.flores_totales && f.sesiones_polinizacion === x.sesiones_polinizacion);
    expect(gemelas).toHaveLength(1); // hoy son X e Y: la pareja queda a la vista
  });

  it('demostración de A1-G6-14: las lentes mamá y papá revelan el rol de cada variedad en un cruce único', async () => {
    const mama = (await ranking(ctx.admin, 'mama')).filas.map((f) => quitar(f.variedad_nombre));
    const papa = (await ranking(ctx.admin, 'papa')).filas.map((f) => quitar(f.variedad_nombre));
    expect(mama).toContain('X');
    expect(mama).not.toContain('Y');
    expect(papa).toContain('Y');
    expect(papa).not.toContain('X');
  });

  // A1-G6-02: el ranking varietal suma sesiones de cruces es_prueba = true.
  it.fails('el ranking varietal excluye los cruces de prueba (A1-G6-02)', async () => {
    const r = await ranking(ctx.admin, 'ambos'); // todos los cruces del fixture son es_prueba
    expect(r.filas).toEqual([]);
  });
});
