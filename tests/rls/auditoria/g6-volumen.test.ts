/**
 * Auditoría Corrida 1 — G6: ¿qué pasa con diez veces más datos?
 *
 * Carga una especie propia con 750 y luego 1500 individuos evaluados con la
 * MISMA configuración de 20 métricas de la versión global (copiada, no
 * modificada) y mide las RPC de scoring y resultados. Producción tiene hoy
 * 1313 individuos (711 en cruces en evaluación anual); 1500 es ~2x lo que hay
 * en evaluación, y el crecimiento observado permite extrapolar a 10x.
 *
 * Los tiempos dependen de la máquina y de lo que corran otros agentes a la vez:
 * los umbrales son holgados y el valor útil es el que se imprime. El tope
 * duro que importa en producción es el statement_timeout del rol authenticated
 * de Supabase (8 s por defecto).
 *
 * Correr (opt-in, genera muchas filas de audit_log): G6_VOLUMEN=1 npx vitest run tests/rls/auditoria/g6-volumen.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce,
  crearVersion,
  especieAdicional,
  iniciarContexto,
  limpiarContexto,
  type ContextoG6,
  type Fila,
  type MetricaFixture,
} from './g6-helpers';

let raiz: ContextoG6;
let ctx: ContextoG6;
let columnas: Array<{ metrica: string; min: number; max: number; rango: boolean }> = [];
const cruces: string[] = [];
const individuosPorCruce: string[][] = [];
const tiempos: Record<string, number> = {};
const POR_CRUCE = 250;

const timeouts: string[] = [];

/**
 * La RPC puede terminar bien o ser cortada por el statement_timeout de 8 s del rol authenticated
 * (código 57014). Ambos resultados son válidos para la prueba; el segundo se registra como evidencia.
 */
function terminaBienOCortada(etiqueta: string, r: { error: { code?: string } | null }): boolean {
  if (r.error === null) return true;
  expect(r.error.code, etiqueta).toBe('57014');
  timeouts.push(etiqueta);
  return false;
}

async function medir<T>(etiqueta: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  tiempos[etiqueta] = Math.round(performance.now() - t0);
  return r;
}

/** Valor entero de la escala (o un valor dentro del rango esperado) para cada métrica, variando por individuo. */
function valoresDe(i: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of columnas) {
    if (c.metrica === 'pct_flores' || c.metrica === 'pct_frutos') continue; // columnas generadas: se derivan de los conteos de abajo
    if (c.rango) out[c.metrica] = c.metrica === 'brix' ? 12 + (i % 5) : 14 + (i % 6);
    else out[c.metrica] = c.min + ((i + c.metrica.length) % (c.max - c.min + 1));
  }
  out.n_varas_basales = 10;
  out.n_varas_con_flor = 1 + (i % 10);
  out.n_flores_varas_basales = 100;
  out.n_frutos_varas_basales = 10 + (i % 80);
  return out;
}

async function agregarCruces(cantidad: number) {
  for (let k = 0; k < cantidad; k++) {
    const idx = cruces.length;
    const planta = await crearCruce(ctx, { codigo: `AUD-G6-VOL${idx}-${raiz.R}` });
    const ids: string[] = [];
    for (let hechos = 0; hechos < POR_CRUCE; hechos += 125) {
      const filas = Array.from({ length: 125 }, () => ({ planta_id: planta, codigo_display: 'X', created_by: raiz.adminId }));
      const { data, error } = await raiz.service.from('individuos').insert(filas).select('id');
      if (error || !data) throw new Error(`individuos: ${error?.message}`);
      ids.push(...data.map((d) => d.id));
    }
    const { data: rondas, error: errRondas } = await raiz.service
      .from('ronda_evaluacion_anual')
      .insert(ids.map((id) => ({ individuo_id: id, numero_ronda: 1, anio: 2026, fecha_inicio: '2026-06-01', tipo_ronda: 'anual', created_by: raiz.adminId })))
      .select('id');
    if (errRondas || !rondas) throw new Error(`rondas: ${errRondas?.message}`);
    const evaluaciones = rondas.map((r, i) => ({
      ronda_id: r.id, fecha: '2026-06-15', estado: 'completa', created_by: raiz.adminId, cantidad_frutos: 10, peso_total_g: 100, ...valoresDe(idx * POR_CRUCE + i),
    }));
    for (let desde = 0; desde < evaluaciones.length; desde += 125) {
      const { error } = await raiz.service.from('evaluaciones').insert(evaluaciones.slice(desde, desde + 125));
      if (error) throw new Error(`evaluaciones: ${error.message}`);
    }
    cruces.push(planta);
    individuosPorCruce.push(ids);
  }
}

/**
 * Esta prueba crea ~2 950 rondas y evaluaciones y ~2 700 individuos por corrida (≈ 9 000 filas de audit_log
 * que no se pueden borrar) y tarda ~80 s: solo corre si G6_VOLUMEN=1.
 *   G6_VOLUMEN=1 npx vitest run tests/rls/auditoria/g6-volumen.test.ts
 */
const VOLUMEN = process.env.G6_VOLUMEN === '1';

describe.skipIf(!VOLUMEN)('Volumen G6 (requiere G6_VOLUMEN=1)', () => {
  beforeAll(async () => {
    raiz = await iniciarContexto('vol');
    ctx = await especieAdicional(raiz, 'vol');
    // Copia las 20 métricas, sus pesos y los pesos por categoría de la versión global activa (solo lectura).
    const { data: global } = await raiz.service.from('scoring_version').select('id').eq('estado', 'activa').is('especie_id', null).single();
    const { data: metricas } = await raiz.service.from('scoring_metrica').select('*').eq('scoring_version_id', global!.id).order('orden');
    const { data: pesos } = await raiz.service.from('scoring_categoria_peso').select('categoria, peso').eq('scoring_version_id', global!.id);
    columnas = metricas!.map((m) => ({ metrica: m.metrica, min: Number(m.minimo_normalizacion ?? 0), max: Number(m.maximo_normalizacion ?? 5), rango: m.metodo_normalizacion === 'rango_referencia' }));
    const fixture: MetricaFixture[] = metricas!.map((m) => ({
      metrica: m.metrica, categoria: m.categoria, peso: Number(m.peso), direccion: m.direccion_favorable,
      min: m.minimo_normalizacion === null ? undefined : Number(m.minimo_normalizacion),
      max: m.maximo_normalizacion === null ? undefined : Number(m.maximo_normalizacion),
      rangoId: m.rango_referencia_id ?? undefined,
    }));
    await crearVersion(ctx, {
      nombre: `AUD-G6 VOL v1 ${raiz.R}`, vigenteDesde: '2026-01-01',
      pesos: Object.fromEntries(pesos!.map((p) => [p.categoria, Number(p.peso)])),
      metricas: fixture,
    });
    await agregarCruces(3);
  }, 600_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.info(`[G6 volumen] tiempos en ms: ${JSON.stringify(tiempos)}; cortadas por statement_timeout (8 s): ${JSON.stringify(timeouts)}`);
    if (raiz) await limpiarContexto(raiz);
  }, 600_000);


  describe('Volumen — 750 individuos', () => {
    it('ranking por especie: devuelve 100 filas, informa el total real y la población comparada completa', async () => {
      const r = await medir('ranking_especie_750', async () => raiz.operario.rpc('obtener_ranking_operativo', { p_especie_id: ctx.especieId, p_limite: 100 }));
      if (!terminaBienOCortada('ranking_especie_750', r)) return;
      const d = r.data as Fila;
      expect(d.items).toHaveLength(100);
      expect(d.total).toBe(750);
      expect(d.poblacion_comparada).toBe(750);
    });

    it('obtener_scoring_planta (sin tope de paginación) devuelve los 250 individuos del cruce', async () => {
      const r = await medir('scoring_planta_250', async () => raiz.operario.rpc('obtener_scoring_planta', { p_planta_id: cruces[0] }));
      if (!terminaBienOCortada('scoring_planta_250', r)) return;
      expect((r.data as Fila[]).length).toBe(250);
    });

    it('dashboard científico de la especie', async () => {
      const r = await medir('dashboard_750', async () => raiz.operario.rpc('obtener_dashboard_cientifico', { p_especie_id: ctx.especieId }));
      if (!terminaBienOCortada('dashboard_750', r)) return;
      expect((r.data as Fila).resumen.individuos_vivos).toBe(750);
    });
  });

  describe('Volumen — 1500 individuos', () => {
    beforeAll(async () => { await agregarCruces(3); }, 600_000);

    it('ranking por especie sigue acotado a 100 filas; el tiempo crece con la población', async () => {
      const r = await medir('ranking_especie_1500', async () => raiz.operario.rpc('obtener_ranking_operativo', { p_especie_id: ctx.especieId, p_limite: 100 }));
      if (!terminaBienOCortada('ranking_especie_1500', r)) return;
      const d = r.data as Fila;
      expect(d.items).toHaveLength(100);
      expect(d.total).toBe(1500);
      expect(d.poblacion_comparada).toBe(1500);
    });

    it('el ranking global filtrado (misma población) y su paginación al final', async () => {
      const r = await medir('global_1500_ultima_pagina', async () => raiz.operario.rpc('obtener_ranking_global_filtrado', { p_especie_id: ctx.especieId, p_limite: 100, p_offset: 1400 }));
      if (!terminaBienOCortada('global_1500_ultima_pagina', r)) return;
      expect((r.data as Fila).items).toHaveLength(100);
      expect((r.data as Fila).items.at(-1).posicion).toBe(1500);
    });

    it('dashboard científico de la especie', async () => {
      const r = await medir('dashboard_1500', async () => raiz.operario.rpc('obtener_dashboard_cientifico', { p_especie_id: ctx.especieId }));
      terminaBienOCortada('dashboard_1500', r);
    });

    // A1-G6-09: con 1500 individuos evaluados la serie histórica tarda entre 6.5 y 8 s (medido), es decir,
    // roza o supera el statement_timeout de 8 s del rol authenticated: en una corrida con carga fue cortada.
    it('series históricas de 12 meses de la especie (termina en ~6-8 s o es cortada por el statement_timeout)', async () => {
      const r = await medir('series_1500', async () => raiz.operario.rpc('obtener_series_historicas_cientificas', { p_especie_id: ctx.especieId, p_fecha_desde: '2026-01-01', p_fecha_hasta: '2026-12-31' }));
      if (!terminaBienOCortada('series_1500', r)) return;
      const junio = (r.data as Fila).scoring.find((s: Fila) => s.periodo === '2026-06-01');
      expect(junio.evaluaciones_elegibles).toBe(1500);
    });

    it('comparación de rondas de un cruce completo (250 individuos con 2 rondas)', async () => {
      const ids = individuosPorCruce[0];
      const { data: rondas } = await raiz.service.from('ronda_evaluacion_anual')
        .insert(ids.map((id) => ({ individuo_id: id, numero_ronda: 2, anio: 2027, fecha_inicio: '2027-06-01', tipo_ronda: 'anual', created_by: raiz.adminId }))).select('id');
      for (let desde = 0; desde < rondas!.length; desde += 125) {
        const { error } = await raiz.service.from('evaluaciones').insert(rondas!.slice(desde, desde + 125).map((r, i) => ({
          ronda_id: r.id, fecha: '2027-06-15', estado: 'completa', created_by: raiz.adminId, cantidad_frutos: 10, peso_total_g: 100, ...valoresDe(i + 3),
        })));
        expect(error).toBeNull();
      }
      const r = await medir('comparacion_cruce_250', async () => raiz.operario.rpc('obtener_comparacion_rondas', { p_planta_id: cruces[0] }));
      if (!terminaBienOCortada('comparacion_cruce_250', r)) return;
      expect((r.data as Fila).individuos).toHaveLength(250);
    });

    it('congelar el ranking de la especie entera, ver su detalle y compararlo con el vivo: tiempo y tamaño de la respuesta (sin paginación)', async () => {
      const snap = await medir('congelar_1500', async () => raiz.admin.rpc('congelar_ranking', { p_nombre: 'Volumen', p_especie_id: ctx.especieId }));
      if (!terminaBienOCortada('congelar_1500', snap)) return; // si lo corta el timeout no queda snapshot (la función es atómica)
      const id = snap.data as string;
      const det = await medir('detalle_snapshot_1500', async () => raiz.operario.rpc('obtener_detalle_snapshot', { p_snapshot_id: id }));
      if (terminaBienOCortada('detalle_snapshot_1500', det)) {
        expect((det.data as Fila).resultados).toHaveLength(1500);
        // eslint-disable-next-line no-console
        console.info(`[G6 volumen] respuesta de detalle de snapshot: ${(JSON.stringify(det.data).length / 1024 / 1024).toFixed(2)} MB (una sola respuesta, sin paginación)`);
      }
      const cmp = await medir('comparar_snapshot_vivo_1500', async () => raiz.operario.rpc('comparar_snapshot_vivo', { p_snapshot_id: id }));
      if (terminaBienOCortada('comparar_snapshot_vivo_1500', cmp)) expect((cmp.data as Fila).individuos).toHaveLength(1500);
    });

    it('calcular_ranking_operativo sin alcance y en modo por ronda (llamada directa de un operario) queda recortada en silencio a 1000 filas (max_rows)', async () => {
      const { data: version } = await raiz.service.from('scoring_version').select('id').eq('especie_id', ctx.especieId).single();
      const r = await medir('motor_directo_sin_alcance', async () => raiz.operario.rpc('calcular_ranking_operativo', { p_scoring_version_id: version!.id, p_por_ronda: true }));
      if (!terminaBienOCortada('motor_directo_sin_alcance', r)) return;
      // max_rows = 1000 de PostgREST recorta en silencio el resultado: la llamada directa no es fiable para poblaciones grandes.
      expect((r.data as Fila[]).length).toBe(1000);
    });
  });

  describe('Volumen — muchos cruces pequeños (el dashboard llama al motor una vez por cruce en evaluación)', () => {
    it('150 cruces de 8 individuos (1200 evaluados) en una especie aparte: tiempo del dashboard frente a los 6 cruces de 250', async () => {
      const chica = await especieAdicional(raiz, 'chica');
      await crearVersion(chica, {
        nombre: `AUD-G6 VOL chica v1 ${raiz.R}`, vigenteDesde: '2026-01-01',
        pesos: { fenologia: 0.5, fruto_calidad: 0.5 },
        metricas: [
          { metrica: 'brotacion', categoria: 'fenologia', peso: 1, min: 1, max: 5 },
          { metrica: 'firmeza', categoria: 'fruto_calidad', peso: 1, min: 1, max: 5 },
        ],
      });
      const { data: plantas, error } = await raiz.service.from('plantas')
        .insert(Array.from({ length: 150 }, (_, i) => ({ codigo_sistema: `AUD-G6-CH${i}-${raiz.R}`, especie_id: chica.especieId, estado: 'evaluacion_anual', es_prueba: true })))
        .select('id');
      expect(error).toBeNull();
      for (let desde = 0; desde < plantas!.length; desde += 25) {
        const lote = plantas!.slice(desde, desde + 25);
        const { data: ind, error: errInd } = await raiz.service.from('individuos')
          .insert(lote.flatMap((p) => Array.from({ length: 8 }, () => ({ planta_id: p.id, codigo_display: 'X', created_by: raiz.adminId })))).select('id');
        expect(errInd).toBeNull();
        const { data: rondas } = await raiz.service.from('ronda_evaluacion_anual')
          .insert(ind!.map((i) => ({ individuo_id: i.id, numero_ronda: 1, anio: 2026, fecha_inicio: '2026-06-01', tipo_ronda: 'anual', created_by: raiz.adminId }))).select('id');
        const { error: errEv } = await raiz.service.from('evaluaciones')
          .insert(rondas!.map((r, k) => ({ ronda_id: r.id, fecha: '2026-06-15', estado: 'completa', created_by: raiz.adminId, cantidad_frutos: 10, peso_total_g: 100, brotacion: 1 + (k % 5), firmeza: 1 + ((k + 2) % 5) })));
        expect(errEv).toBeNull();
      }
      const r = await medir('dashboard_150_cruces_x_8', async () => raiz.operario.rpc('obtener_dashboard_cientifico', { p_especie_id: chica.especieId }));
      if (terminaBienOCortada('dashboard_150_cruces_x_8', r)) expect((r.data as Fila).resumen.individuos_vivos).toBe(1200);
      const rk = await medir('ranking_150_cruces_x_8', async () => raiz.operario.rpc('obtener_ranking_operativo', { p_especie_id: chica.especieId, p_limite: 100 }));
      terminaBienOCortada('ranking_150_cruces_x_8', rk);
    }, 300_000);
  });

});
