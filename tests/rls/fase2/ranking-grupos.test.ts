// Fase 2, Sprint 1 — ranking por grupos de categorías
// (20261023100000_fase2_ranking_por_grupos.sql).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';
import { limpiarPrueba } from '../limpieza-pruebas';

interface Item {
  individuo_id: string;
  codigo_display: string;
  grupo: string[];
  estado_ranking: string;
  tamano_grupo: number | null;
  posicion_grupo: number | null;
  puntaje: number | null;
  cobertura: Record<string, { con_valor: number; total: number }>;
}
interface Respuesta {
  minimo_evaluaciones_grupo: number;
  poblacion: Record<string, number>;
  grupos: { categorias: string[]; n: number; con_posicion: boolean }[];
  items: Item[];
  criterios: { orden: string[]; empates: string; incluye_pruebas: boolean };
}

describe('ranking por grupos de categorías (Fase 2)', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let admin: SupabaseClient;
  let operarioId: string;
  let especieId: string;
  let plantaId: string;
  let pruebaId: string;
  let empatesId: string;
  let secuencia = 0;
  const sufijo = Date.now();

  async function crearPlanta(codigo: string, esPrueba = false): Promise<string> {
    const { data, error } = await service.from('plantas')
      .insert({ codigo_sistema: codigo, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: esPrueba })
      .select('id').single();
    if (error || !data) throw error ?? new Error('No se creó la planta');
    return data.id as string;
  }

  async function individuoConEvaluacion(planta: string, campos: Record<string, unknown> | null): Promise<string> {
    secuencia += 1;
    const { data: ind, error: e1 } = await service.from('individuos').insert({
      planta_id: planta, codigo_display: 'GENERADO-POR-TRIGGER',
      fecha_individualizacion: `2027-01-${String((secuencia % 28) + 1).padStart(2, '0')}`, created_by: operarioId,
    }).select('id').single();
    if (e1 || !ind) throw e1 ?? new Error('No se creó el individuo');
    if (campos === null) return ind.id as string;
    const { data: ronda, error: e2 } = await service.from('ronda_evaluacion_anual').insert({
      individuo_id: ind.id, numero_ronda: 1, anio: 2027, fecha_inicio: '2027-01-01', created_by: operarioId,
    }).select('id').single();
    if (e2 || !ronda) throw e2 ?? new Error('No se creó la ronda');
    const { error: e3 } = await operario.from('evaluaciones').insert({
      ronda_id: ronda.id, fecha: '2027-03-01', estado: 'completa', created_by: operarioId, ...campos,
    });
    if (e3) throw e3;
    return ind.id as string;
  }

  const ranking = async (args: Record<string, unknown>, cliente = operario): Promise<Respuesta> => {
    const { data, error } = await cliente.rpc('obtener_ranking_por_grupos', args);
    if (error) throw error;
    return data as Respuesta;
  };

  beforeAll(async () => {
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const u = await crearUsuarioDePrueba(creds, service, { email: `ranking-grupos-op-${sufijo}@test.local`, rol: 'operario' });
    operario = u.client;
    operarioId = u.userId;
    admin = (await crearUsuarioDePrueba(creds, service, { email: 'ranking-grupos-admin@test.local', rol: 'admin' })).client;
    const { data: esp, error } = await service.from('especies').insert({ nombre: `Ranking grupos ${sufijo}` }).select('id').single();
    if (error || !esp) throw error ?? new Error('No se creó la especie');
    especieId = esp.id as string;
    plantaId = await crearPlanta(`RG-${sufijo}`);
    // Grupo «solo fenología»: 5 plantas con puntajes distintos.
    for (const v of [5, 4, 3, 2, 1]) await individuoConEvaluacion(plantaId, { brotacion: v, floracion: v });
    // Grupo «fenología + estrés»: 1 planta.
    await individuoConEvaluacion(plantaId, { brotacion: 3, dano_calor: 2 });
    // No comparable explícita y sin evaluación.
    await individuoConEvaluacion(plantaId, { brotacion: 4, no_comparable: true });
    await individuoConEvaluacion(plantaId, null);
    // Cruce de prueba de la misma especie con 5 evaluaciones del mismo grupo.
    pruebaId = await crearPlanta(`RGP-${sufijo}`, true);
    for (const v of [5, 5, 5, 5, 5]) await individuoConEvaluacion(pruebaId, { brotacion: v, floracion: v });
    // Empates: 5, 4, 4, 2, 1 → posiciones 1, 2, 2, 4, 5.
    empatesId = await crearPlanta(`RGE-${sufijo}`);
    for (const v of [5, 4, 4, 2, 1]) await individuoConEvaluacion(empatesId, { brotacion: v, floracion: v });
  }, 120_000);

  afterAll(async () => {
    await admin.from('configuracion_ranking').update({ minimo_evaluaciones_grupo: 5 }).eq('id', 1);
    // RG y RGE son cruces REALES a propósito (es_prueba = false): el ranking excluye los de prueba, que es lo que se contrasta con RGP.
    await limpiarPrueba(service, { plantaIds: [plantaId, pruebaId, empatesId], especieIds: [especieId], usuarioIds: [operarioId] }, 'ranking-grupos');
  }, 60_000);

  it('agrupa por categorías con datos y da posición solo dentro del grupo', async () => {
    const r = await ranking({ p_planta_id: plantaId });
    const fenologia = r.items.filter((i) => i.grupo.join(',') === 'fenologia' && i.estado_ranking === 'comparable');
    expect(fenologia).toHaveLength(5);
    expect(fenologia.map((i) => i.posicion_grupo)).toEqual([1, 2, 3, 4, 5]);
    const puntajes = fenologia.map((i) => Number(i.puntaje));
    expect([...puntajes].sort((a, b) => b - a)).toEqual(puntajes);
    expect(fenologia.every((i) => i.estado_ranking === 'comparable' && i.tamano_grupo === 5)).toBe(true);
    expect(fenologia[0].cobertura.fenologia).toEqual({ con_valor: 2, total: 6 });
  });

  it('los grupos bajo el mínimo quedan sin puesto («pocas plantas»)', async () => {
    const r = await ranking({ p_planta_id: plantaId });
    const chico = r.items.filter((i) => i.grupo.join(',') === 'fenologia,estres');
    expect(chico).toHaveLength(1);
    expect(chico[0]).toMatchObject({ estado_ranking: 'pocas_plantas', posicion_grupo: null, tamano_grupo: 1 });
    expect(r.grupos.find((g) => g.categorias.join(',') === 'fenologia,estres')).toMatchObject({ n: 1, con_posicion: false });
  });

  it('el mismo puntaje comparte posición (1, 2, 2, 4) y no se desempata por código', async () => {
    const r = await ranking({ p_planta_id: empatesId });
    const filas = r.items.filter((i) => i.estado_ranking === 'comparable');
    expect(filas.map((i) => i.posicion_grupo)).toEqual([1, 2, 2, 4, 5]);
    const empatadas = filas.filter((i) => i.posicion_grupo === 2);
    expect(empatadas[0].puntaje).toBe(empatadas[1].puntaje);
    // Cinco puntajes iguales: los cinco comparten el primer puesto.
    const todos = (await ranking({ p_planta_id: pruebaId })).items.filter((i) => i.estado_ranking === 'comparable');
    expect(todos.map((i) => i.posicion_grupo)).toEqual([1, 1, 1, 1, 1]);
  });

  it('cuenta completa de la población y regla de empates declarada tal cual', async () => {
    const r = await ranking({ p_planta_id: plantaId });
    expect(r.poblacion).toMatchObject({
      total: 8, comparables: 6, con_posicion: 5, pocas_plantas: 1, no_comparables: 1, sin_evaluacion: 1, excluidas_revision: 0,
    });
    expect(r.items).toHaveLength(8);
    expect(r.criterios.orden).toEqual(['puntaje_desc']);
    expect(r.criterios.empates).toMatch(/comparte posicion/);
  });

  it('el mínimo es configurable solo por un admin, y queda auditado', async () => {
    const op = await operario.from('configuracion_ranking').update({ minimo_evaluaciones_grupo: 2 }).eq('id', 1).select('id');
    expect(op.error !== null || (op.data ?? []).length === 0).toBe(true);
    const ad = await admin.from('configuracion_ranking').update({ minimo_evaluaciones_grupo: 6 }).eq('id', 1).select('minimo_evaluaciones_grupo');
    expect(ad.error).toBeNull();
    expect(ad.data?.[0]?.minimo_evaluaciones_grupo).toBe(6);
    const r = await ranking({ p_planta_id: plantaId });
    expect(r.minimo_evaluaciones_grupo).toBe(6);
    expect(r.poblacion.con_posicion).toBe(0);
    const { data: audit } = await admin.from('audit_log').select('detalle').eq('accion', 'cambio_configuracion_ranking')
      .order('id', { ascending: false }).limit(1);
    expect(audit?.[0]?.detalle).toMatchObject({ nuevo: { minimo_evaluaciones_grupo: 6 } });
    await admin.from('configuracion_ranking').update({ minimo_evaluaciones_grupo: 5 }).eq('id', 1);
  });

  it('por especie excluye los cruces de prueba, salvo que se pidan', async () => {
    const sin = await ranking({ p_especie_id: especieId });
    expect(sin.items.some((i) => i.codigo_display.startsWith(`RGP-${sufijo}`))).toBe(false);
    expect(sin.criterios.incluye_pruebas).toBe(false);
    const con = await ranking({ p_especie_id: especieId, p_incluir_pruebas: true });
    expect(con.items.filter((i) => i.codigo_display.startsWith(`RGP-${sufijo}`))).toHaveLength(5);
    expect(con.items.filter((i) => i.grupo.join(',') === 'fenologia' && i.estado_ranking === 'comparable')).toHaveLength(15); // RG (5) + RGE de empates (5) + RGP de prueba (5)
  });

  it('una métrica marcada por revisión excluye la evaluación', async () => {
    const { data: rr } = await service.from('rango_referencia').select('limite_revision_superior')
      .eq('metrica', 'calibre_mm').eq('activo', true).not('limite_revision_superior', 'is', null).limit(1);
    const limite = Number(rr?.[0]?.limite_revision_superior ?? NaN);
    if (!Number.isFinite(limite)) return; // sin límite de revisión configurado en esta base
    const id = await individuoConEvaluacion(plantaId, { calibre_mm: limite + 5, cantidad_frutos: 5, peso_total_g: 10 });
    const r = await ranking({ p_planta_id: plantaId });
    expect(r.items.find((i) => i.individuo_id === id)?.estado_ranking).toBe('excluida_revision');
  });

  it('el snapshot por grupos guarda grupo, cobertura y posición en el grupo; solo admin', async () => {
    const op = await operario.rpc('congelar_ranking_grupos', { p_nombre: `RG ${sufijo}`, p_planta_id: plantaId });
    expect(op.error?.code).toBe('42501');
    const { data: id, error } = await admin.rpc('congelar_ranking_grupos', { p_nombre: `RG ${sufijo}`, p_planta_id: plantaId });
    expect(error).toBeNull();
    const { data: filas } = await admin.from('ranking_snapshot_resultado')
      .select('grupo, cobertura, posicion_grupo, posicion').eq('snapshot_id', id).order('posicion');
    expect(filas).toHaveLength(5);
    expect(filas!.map((f) => f.posicion_grupo)).toEqual([1, 2, 3, 4, 5]);
    expect(filas![0].grupo).toEqual(['fenologia']);
    expect(filas![0].cobertura).toHaveProperty('fenologia');
    const { data: snap } = await admin.from('ranking_snapshot').select('criterios').eq('id', id).single();
    expect(snap?.criterios).toMatchObject({ modo: 'grupos', minimo_evaluaciones_grupo: 5, orden: ['puntaje_desc'] });
    expect(snap?.criterios).not.toHaveProperty('desempate');
  });

  it('el detalle del snapshot por grupos trae grupo y posición; la comparación usa el ranking por grupos vivo', async () => {
    const { data: id, error } = await admin.rpc('congelar_ranking_grupos', { p_nombre: `RGE ${sufijo}`, p_planta_id: empatesId });
    expect(error).toBeNull();
    const { data: det } = await operario.rpc('obtener_detalle_snapshot', { p_snapshot_id: id });
    const resultados = (det as { resultados: { posicion_grupo: number; grupo: string[] }[] }).resultados;
    expect(resultados.map((r) => r.posicion_grupo)).toEqual([1, 2, 2, 4, 5]);
    expect(resultados[0].grupo).toEqual(['fenologia']);
    const { data: cmp, error: e2 } = await operario.rpc('comparar_snapshot_vivo', { p_snapshot_id: id });
    expect(e2).toBeNull();
    // Con el ranking operativo de siempre ninguno estaría «en vivo» (no tienen las 20 métricas).
    const individuos = (cmp as { individuos: { esta_en_vivo: boolean; delta: number | null }[] }).individuos;
    expect(individuos).toHaveLength(5);
    expect(individuos.every((i) => i.esta_en_vivo && Number(i.delta) === 0)).toBe(true);
  });

  it('el ranking operativo de siempre no cambia: sigue exigiendo las 20 métricas', async () => {
    const { data, error } = await operario.rpc('obtener_ranking_operativo', { p_planta_id: plantaId, p_limite: 50 });
    expect(error).toBeNull();
    const items = (data as { items: { elegible: boolean; motivo_exclusion: string | null }[] }).items;
    expect(items.every((i) => !i.elegible)).toBe(true);
    expect(items.filter((i) => i.motivo_exclusion === 'evaluacion_parcial_en_curso').length).toBeGreaterThanOrEqual(6);
  });
});
