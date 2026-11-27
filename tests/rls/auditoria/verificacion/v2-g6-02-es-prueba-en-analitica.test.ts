/**
 * Verificación independiente de A1-G6-02: las funciones analíticas no filtran
 * `plantas.es_prueba`, aunque la app (NuevaPlantaPage, RankingPage) promete que
 * un cruce de prueba «queda fuera de los listados y del ranking».
 *
 * Especie y versión de scoring propias, para no depender de datos de otros.
 * Control: un cruce archivado (eliminado_at) SÍ queda fuera, así que el filtro
 * existe para otras marcas y solo falta para es_prueba.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoV2, psql } from './v2-comun';

const ctx = new ContextoV2('g6-02');
let admin: Awaited<ReturnType<ContextoV2['usuario']>>;
let operario: Awaited<ReturnType<ContextoV2['usuario']>>;
let especieId: string;
let versionId: string;
let cruceBase: string; // cruce de prueba, vivo en el sistema
let cruceArchivado: string; // control: archivado
let indivPrueba: string;
let indivArchivado: string;
let variedadId: string;
const snapshots: string[] = [];

async function crear<T>(tabla: string, fila: Record<string, unknown>, cols = 'id'): Promise<T> {
  const { data, error } = await ctx.service.from(tabla).insert(fila).select(cols).single();
  if (error || !data) throw new Error(`${tabla}: ${error?.message}`);
  return data as T;
}

async function individuoConEvaluacion(plantaId: string, codigo: string): Promise<string> {
  const ind = await crear<{ id: string }>('individuos', {
    planta_id: plantaId, codigo_display: `AUD-V2-${codigo}-${ctx.sufijo}`, created_by: admin.userId,
  });
  const ronda = await crear<{ id: string }>('ronda_evaluacion_anual', {
    individuo_id: ind.id, tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, fecha_inicio: '2026-01-15', created_by: admin.userId,
  });
  await crear('evaluaciones', {
    ronda_id: ronda.id, fecha: '2026-06-01', created_by: admin.userId,
    firmeza: 4, brix: 15, estado: 'completa', cantidad_frutos: 10, peso_total_g: 120,
  });
  return ind.id;
}

beforeAll(async () => {
  admin = await ctx.usuario('admin');
  operario = await ctx.usuario('operario');
  especieId = (await crear<{ id: string }>('especies', { nombre: `AUD-V2 g6-02 ${ctx.sufijo}` })).id;
  versionId = (await crear<{ id: string }>('scoring_version', {
    nombre: `AUD-V2 g6-02 ${ctx.sufijo}`, especie_id: especieId, fase: 'evaluacion_anual',
    vigente_desde: '2026-01-01', vigente_hasta: null, estado: 'activa',
  })).id;
  await ctx.service.from('scoring_metrica').insert([
    { scoring_version_id: versionId, categoria: 'fruto_calidad', metrica: 'firmeza', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 1 },
    { scoring_version_id: versionId, categoria: 'fruto_calidad', metrica: 'brix', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 10, maximo_normalizacion: 20, orden: 2 },
  ]);
  variedadId = (await crear<{ id: string }>('variedades', { especie_id: especieId, nombre: `AUD-V2 var ${ctx.sufijo}` })).id;
  cruceBase = (await crear<{ id: string }>('plantas', {
    codigo_sistema: `AUD-V2-PRUEBA-${ctx.sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true, mama_id: variedadId,
  })).id;
  cruceArchivado = (await crear<{ id: string }>('plantas', {
    codigo_sistema: `AUD-V2-ARCH-${ctx.sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true,
  })).id;
  indivPrueba = await individuoConEvaluacion(cruceBase, 'IPRUEBA');
  indivArchivado = await individuoConEvaluacion(cruceArchivado, 'IARCH');
  await ctx.service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', cruceArchivado);
  await crear('polinizacion_evento', { planta_id: cruceBase, fecha: '2026-03-01', n_flores_cruzadas: 77, created_by: admin.userId });
}, 90_000);

afterAll(async () => {
  const ids = [cruceBase, cruceArchivado].map((i) => `'${i}'`).join(',');
  // Datos propios. Se desactivan los triggers solo para esta limpieza (los snapshots y
  // los individuos no se pueden borrar por la API por diseño).
  psql(`
    set session_replication_role = replica;
    delete from ranking_snapshot_resultado where snapshot_id in (select id from ranking_snapshot where especie_id = '${especieId}');
    delete from ranking_snapshot where especie_id = '${especieId}';
    delete from evaluaciones where ronda_id in (select r.id from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id where i.planta_id in (${ids}));
    delete from ronda_evaluacion_anual where individuo_id in (select id from individuos where planta_id in (${ids}));
    delete from polinizacion_evento where planta_id in (${ids});
    delete from individuos where planta_id in (${ids});
    delete from registros_evento where planta_id in (${ids});
    delete from plantas where id in (${ids});
    delete from variedades where id = '${variedadId}';
    delete from scoring_metrica where scoring_version_id = '${versionId}';
    delete from scoring_version where id = '${versionId}';
    delete from especies where id = '${especieId}';
  `);
  const fallos = await ctx.borrarUsuarios();
  if (fallos.length) console.warn('[v2-g6-02] usuarios no borrados:', fallos);
}, 90_000);

describe('A1-G6-02 — es_prueba en el análisis', () => {
  it('ranking por especie: el individuo del cruce de prueba aparece y es elegible; el del cruce archivado no', async () => {
    const { data, error } = await operario.client.rpc('obtener_ranking_operativo', { p_especie_id: especieId, p_limite: 100 });
    expect(error).toBeNull();
    const items = (data as { items: Array<Record<string, unknown>> }).items;
    const prueba = items.find((i) => i.individuo_id === indivPrueba);
    expect(prueba?.elegible).toBe(true);
    expect(items.find((i) => i.individuo_id === indivArchivado)).toBeUndefined();
    expect((data as { poblacion_comparada: number }).poblacion_comparada).toBe(1);
  });

  it('dashboard científico de la especie cuenta el cruce de prueba como cruce activo', async () => {
    const { data, error } = await operario.client.rpc('obtener_dashboard_cientifico', { p_especie_id: especieId, p_limite: 25 });
    expect(error).toBeNull();
    const texto = JSON.stringify(data);
    // El código del cruce de prueba aparece en el resultado (destacados / pendientes / actividad).
    expect(texto).toContain(`AUD-V2-PRUEBA-${ctx.sufijo}`);
    expect(texto).not.toContain(`AUD-V2-ARCH-${ctx.sufijo}`);
  });

  it('un admin puede congelar el ranking de la especie con el individuo de prueba dentro', async () => {
    const { data, error } = await admin.client.rpc('congelar_ranking', { p_nombre: `AUD-V2 snapshot ${ctx.sufijo}`, p_especie_id: especieId });
    expect(error).toBeNull();
    snapshots.push(data as string);
    const filas = psql(`select individuo_id from ranking_snapshot_resultado where snapshot_id = '${data}'`);
    expect(filas).toBe(indivPrueba);
  });

  it('ranking varietal de polinización: las flores del cruce de prueba se suman a la variedad y al total de campo', async () => {
    const { data, error } = await admin.client.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieId, p_rol: 'ambos' });
    expect(error).toBeNull();
    const filas = data as Array<{ tipo_fila: string; variedad_id: string | null; flores_totales: number; flores_reales: number }>;
    const fila = filas.find((f) => f.variedad_id === variedadId);
    expect(Number(fila?.flores_totales)).toBe(77);
    const resumen = filas.find((f) => f.tipo_fila !== 'variedad' && f.variedad_id === null) ?? filas[0];
    expect(Number(resumen.flores_reales)).toBe(77);
  });
});
