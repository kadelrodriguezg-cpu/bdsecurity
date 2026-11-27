/**
 * Auditoría integral, Corrida 1, grupo G11: la temporada simulada de punta a punta.
 *
 * Ayudas compartidas por `g11-temporada-simulada.test.ts`:
 *
 *  - contexto con usuarios propios (`aud-g11-...@test.local`: un admin y dos
 *    operarios) y una especie propia, de modo que la versión de scoring global
 *    activa (la real) nunca se toca ni se ve alterada por la temporada;
 *  - un cálculo INDEPENDIENTE del puntaje (no llama a la base) con la
 *    configuración de la versión V1, para comparar a mano contra el motor;
 *  - un modelo de la unificación de visitas parciales por descriptor;
 *  - la limpieza (`limpiarTemporada`) que deja la base como estaba, salvo lo
 *    que es inborrable por diseño (audit_log, usuarios con FK).
 *
 * La preparación y la limpieza usan `service_role`; los permisos se prueban
 * siempre con clientes logueados con la clave anon (sujetos al RLS), con las
 * mismas llamadas que hace `frontend/src/api/*.ts`.
 */
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';
import { PESOS_CATEGORIA, METRICAS, type CategoriaScoring } from '../scoring-esperado';

export const CONTENEDOR_DB = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_dbsecurity-frutales';

// ---------------------------------------------------------------------------
// SQL de superusuario (solo preparar y limpiar datos PROPIOS)
// ---------------------------------------------------------------------------

export function psqlRoot(sql: string): string {
  const r = spawnSync(
    'docker',
    ['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: sql, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`psqlRoot falló: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** Fecha de hoy según la base (UTC), que es la que usa `current_date` en el motor. */
export function hoyDeLaBase(): string {
  return psqlRoot('select current_date');
}

/** Suma `n` días a una fecha ISO (YYYY-MM-DD) sin pasar por la zona horaria local. */
export function sumarDias(fechaIso: string, n: number): string {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

export interface ContextoG11 {
  creds: LocalCreds;
  service: SupabaseClient;
  anon: SupabaseClient;
  admin: SupabaseClient;
  adminId: string;
  opA: SupabaseClient;
  opAId: string;
  opB: SupabaseClient;
  opBId: string;
  especieId: string;
  R: number;
  hoy: string;
  /** Fecha relativa a hoy (la base y la prueba comparten el mismo «hoy»). */
  d: (n: number) => string;
}

export async function prepararContexto(): Promise<ContextoG11> {
  const R = Date.now();
  const creds = getLocalCreds();
  const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;
  const service = createClient(creds.url, creds.serviceKey, opts);
  const anon = createClient(creds.url, creds.anonKey, opts);
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g11-admin-${R}@test.local`, rol: 'admin' });
  const a = await crearUsuarioDePrueba(creds, service, { email: `aud-g11-operarioa-${R}@test.local`, rol: 'operario' });
  const b = await crearUsuarioDePrueba(creds, service, { email: `aud-g11-operariob-${R}@test.local`, rol: 'operario' });
  const { data: especie, error } = await service.from('especies').insert({ nombre: `AUD-G11 Temporada ${R}` }).select('id').single();
  if (error || !especie) throw new Error(`setup especie: ${error?.message}`);
  const hoy = hoyDeLaBase();
  return {
    creds, service, anon,
    admin: ad.client, adminId: ad.userId,
    opA: a.client, opAId: a.userId,
    opB: b.client, opBId: b.userId,
    especieId: especie.id as string, R, hoy,
    d: (n: number) => sumarDias(hoy, n),
  };
}

// ---------------------------------------------------------------------------
// Configuración de scoring y cálculo independiente
// ---------------------------------------------------------------------------

export type Direccion = 'mayor' | 'menor';

export interface MetricaCfg {
  categoria: CategoriaScoring;
  peso: number;
  dir: Direccion;
  min: number;
  max: number;
}

export interface ConfigScoring {
  metricas: Record<string, MetricaCfg>;
  pesosCategoria: Record<CategoriaScoring, number>;
}

/**
 * Copia escrita a mano de la versión global provisional (4-3-2-1) que usa la
 * base (consulta a `scoring_metrica` del 22-10-2026). Se declara aquí, y no se
 * lee de la base, para que el cálculo esperado sea independiente del motor.
 * Brix y calibre usan el rango de referencia global (10-18 y 14-24); en la
 * versión de la temporada se cargan como escala directa.
 */
export const CONFIG_V1: ConfigScoring = {
  pesosCategoria: { ...PESOS_CATEGORIA },
  metricas: {
    firmeza: { categoria: 'fruto_calidad', peso: 4, dir: 'mayor', min: 1, max: 5 },
    calibre_mm: { categoria: 'fruto_calidad', peso: 3, dir: 'mayor', min: 14, max: 24 },
    brix: { categoria: 'fruto_calidad', peso: 2, dir: 'mayor', min: 10, max: 18 },
    bloom: { categoria: 'fruto_calidad', peso: 1, dir: 'mayor', min: 1, max: 5 },
    brotacion: { categoria: 'fenologia', peso: 0.034, dir: 'mayor', min: 1, max: 5 },
    floracion: { categoria: 'fenologia', peso: 0.034, dir: 'mayor', min: 1, max: 5 },
    cuaja: { categoria: 'fenologia', peso: 0.033, dir: 'mayor', min: 1, max: 5 },
    concentracion_cosecha: { categoria: 'fenologia', peso: 0.033, dir: 'mayor', min: 1, max: 5 },
    presencia_yemas_florales: { categoria: 'fenologia', peso: 0.033, dir: 'mayor', min: 0, max: 5 },
    precocidad: { categoria: 'fenologia', peso: 0.033, dir: 'mayor', min: 1, max: 5 },
    rend_kg_planta: { categoria: 'produccion', peso: 0.06, dir: 'mayor', min: 1, max: 5 },
    rend_t_ha: { categoria: 'produccion', peso: 0.06, dir: 'mayor', min: 1, max: 5 },
    pct_fruta_exportable: { categoria: 'produccion', peso: 0.06, dir: 'mayor', min: 0, max: 100 },
    pct_flores: { categoria: 'produccion', peso: 0.06, dir: 'mayor', min: 0, max: 100 },
    pct_frutos: { categoria: 'produccion', peso: 0.06, dir: 'mayor', min: 0, max: 100 },
    dano_calor: { categoria: 'estres', peso: 0.02, dir: 'menor', min: 1, max: 5 },
    golpe_sol: { categoria: 'estres', peso: 0.02, dir: 'menor', min: 1, max: 5 },
    caida_fruto: { categoria: 'estres', peso: 0.02, dir: 'menor', min: 1, max: 5 },
    vigor_vegetativo: { categoria: 'estres', peso: 0.02, dir: 'mayor', min: 1, max: 5 },
    color_follaje: { categoria: 'estres', peso: 0.02, dir: 'mayor', min: 1, max: 5 },
  },
};

/**
 * V2 de la temporada: el admin duplica V1 y cambia dos pesos dentro de
 * «fruto/calidad» (firmeza 4 → 1 y brix 2 → 5), lo que invierte el orden entre
 * individuos con mucha firmeza y mucho brix. Las categorías no cambian.
 */
export const CONFIG_V2: ConfigScoring = {
  pesosCategoria: { ...PESOS_CATEGORIA },
  metricas: {
    ...CONFIG_V1.metricas,
    firmeza: { ...CONFIG_V1.metricas.firmeza, peso: 1 },
    brix: { ...CONFIG_V1.metricas.brix, peso: 5 },
  },
};

export const NOMBRES_METRICAS = Object.keys(CONFIG_V1.metricas);

function normalizar(valor: number, c: MetricaCfg): number {
  const base = c.dir === 'mayor' ? (valor - c.min) / (c.max - c.min) : (c.max - valor) / (c.max - c.min);
  return Math.min(1, Math.max(0, base));
}

export interface PuntajeIndependiente {
  /** Las 20 métricas presentes: sin eso el motor no puntúa. */
  elegible: boolean;
  puntaje: number | null;
  subpuntajes: Record<CategoriaScoring, number | null>;
  normalizados: Record<string, number>;
}

/** Puntaje esperado a partir de los VALORES CRUDOS de las 20 métricas (con pct_flores/pct_frutos ya derivados). */
export function puntajeIndependiente(valores: Record<string, number | null | undefined>, cfg: ConfigScoring): PuntajeIndependiente {
  const normalizados: Record<string, number> = {};
  const acum: Record<CategoriaScoring, [number, number]> = { fenologia: [0, 0], fruto_calidad: [0, 0], produccion: [0, 0], estres: [0, 0] };
  let presentes = 0;
  for (const [metrica, c] of Object.entries(cfg.metricas)) {
    const v = valores[metrica];
    if (v === null || v === undefined) continue;
    presentes += 1;
    const n = normalizar(Number(v), c);
    normalizados[metrica] = n;
    acum[c.categoria][0] += n * c.peso;
    acum[c.categoria][1] += c.peso;
  }
  const subpuntajes = {} as Record<CategoriaScoring, number | null>;
  let num = 0;
  let den = 0;
  for (const cat of Object.keys(acum) as CategoriaScoring[]) {
    subpuntajes[cat] = acum[cat][1] > 0 ? acum[cat][0] / acum[cat][1] : null;
    if (subpuntajes[cat] !== null) {
      num += (subpuntajes[cat] as number) * cfg.pesosCategoria[cat];
      den += cfg.pesosCategoria[cat];
    }
  }
  const elegible = presentes === Object.keys(cfg.metricas).length;
  return { elegible, puntaje: den > 0 ? redondear4(num / den) : null, subpuntajes, normalizados };
}

export const redondear4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Compara con la tolerancia del redondeo a 4 decimales del motor. */
export const casiIgual = (a: number | null | undefined, b: number | null | undefined, tol = 1.1e-4) =>
  a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(Number(a) - Number(b)) <= tol;

// ---------------------------------------------------------------------------
// Evaluaciones: plantilla de captura completa y modelo de unificación
// ---------------------------------------------------------------------------

/** Columnas de captura que alimentan las 20 métricas (pct_flores/pct_frutos salen de las varas). */
export const BASE_COMPLETA: Record<string, number> = {
  brotacion: 3, floracion: 3, cuaja: 3, concentracion_cosecha: 3, presencia_yemas_florales: 3, precocidad: 3,
  firmeza: 3, calibre_mm: 19, brix: 14, bloom: 3,
  rend_kg_planta: 3, rend_t_ha: 3, pct_fruta_exportable: 60,
  n_varas_basales: 10, n_varas_con_flor: 6, n_flores_varas_basales: 20, n_frutos_varas_basales: 10,
  dano_calor: 3, golpe_sol: 3, caida_fruto: 3, vigor_vegetativo: 3, color_follaje: 3,
  cantidad_frutos: 10, peso_total_g: 120,
};

export const completa = (extra: Record<string, number> = {}): Record<string, number> => ({ ...BASE_COMPLETA, ...extra });

/** Columnas de captura → valores de métrica (deriva pct_flores y pct_frutos como las columnas generadas). */
export function metricasDeCaptura(c: Record<string, number | null | undefined>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const m of NOMBRES_METRICAS) out[m] = (c[m] ?? null) as number | null;
  out.pct_flores = c.n_varas_basales ? ((c.n_varas_con_flor ?? 0) / c.n_varas_basales) * 100 : null;
  if (c.n_varas_con_flor === undefined || c.n_varas_con_flor === null) out.pct_flores = null;
  out.pct_frutos = c.n_flores_varas_basales ? ((c.n_frutos_varas_basales ?? 0) / c.n_flores_varas_basales) * 100 : null;
  if (c.n_frutos_varas_basales === undefined || c.n_frutos_varas_basales === null) out.pct_frutos = null;
  return out;
}

export interface VisitaModelo {
  fecha: string;
  /** Orden de actualización (mayor = más reciente); desempata visitas con la misma fecha. */
  orden: number;
  captura: Record<string, number | null | undefined>;
}

/**
 * Regla de la unificación (D2): por descriptor, el valor no nulo de la visita
 * más reciente (fecha y, a igual fecha, la actualizada más tarde).
 */
export function unificarModelo(visitas: VisitaModelo[]): Record<string, number | null> {
  const ordenadas = [...visitas].sort((a, b) => (a.fecha === b.fecha ? b.orden - a.orden : a.fecha < b.fecha ? 1 : -1));
  const out: Record<string, number | null> = {};
  for (const v of ordenadas) {
    const m = metricasDeCaptura(v.captura);
    for (const [k, val] of Object.entries(m)) if (out[k] === undefined || out[k] === null) out[k] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Etiquetas y escáner (réplica de frontend/src/features/qr/qrContenido.ts y QRScanner.tsx)
// ---------------------------------------------------------------------------

const UUID_COMPLETO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const INDIVIDUO_RE = /(?:^|\/)individuo\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

/** Lo que imprime la etiqueta de un individuo (`corto` = etiqueta pequeña, sin origen). */
export function contenidoQrIndividuo(individuoId: string, corto: boolean, origin = 'https://app.test'): string {
  if (!UUID_COMPLETO_RE.test(individuoId)) throw new Error('El individuo no tiene un id válido para el QR.');
  const ruta = `/individuo/${individuoId}`;
  return corto ? ruta : `${origin}${ruta}`;
}

export function interpretarQR(contenido: string): { tipo: 'id' | 'individuo'; valor: string } | null {
  const individuo = contenido.match(INDIVIDUO_RE);
  if (individuo) return { tipo: 'individuo', valor: individuo[1].toLowerCase() };
  const uuid = contenido.match(UUID_RE);
  if (uuid) return { tipo: 'id', valor: uuid[0].toLowerCase() };
  return null;
}

// ---------------------------------------------------------------------------
// Versión de scoring de la temporada
// ---------------------------------------------------------------------------

/**
 * Crea la V1 de la especie propia, activa desde 2026-01-01, con las 20 métricas
 * y los 4 pesos de categoría de CONFIG_V1. Hace de «versión vigente de la
 * especie»: en producción esta alta se hace por SQL (S04 no tiene pantalla).
 */
export async function crearVersionV1(ctx: ContextoG11, nombre: string): Promise<string> {
  const { data: version, error } = await ctx.service
    .from('scoring_version')
    .insert({
      nombre, especie_id: ctx.especieId, fase: 'evaluacion_anual',
      vigente_desde: '2026-01-01', estado: 'activa', created_by: ctx.adminId,
    })
    .select('id')
    .single();
  if (error || !version) throw new Error(`setup V1: ${error?.message}`);
  const pesos = (Object.keys(CONFIG_V1.pesosCategoria) as CategoriaScoring[]).map((categoria) => ({
    scoring_version_id: version.id, categoria, peso: CONFIG_V1.pesosCategoria[categoria],
  }));
  const { error: errPesos } = await ctx.service.from('scoring_categoria_peso').insert(pesos);
  if (errPesos) throw new Error(`setup pesos V1: ${errPesos.message}`);
  const filas = Object.entries(CONFIG_V1.metricas).map(([metrica, c], i) => ({
    scoring_version_id: version.id, metrica, categoria: c.categoria, peso: c.peso,
    direccion_favorable: c.dir, metodo_normalizacion: 'escala',
    minimo_normalizacion: c.min, maximo_normalizacion: c.max, orden: i + 1,
  }));
  const { error: errMetricas } = await ctx.service.from('scoring_metrica').insert(filas);
  if (errMetricas) throw new Error(`setup metricas V1: ${errMetricas.message}`);
  return version.id as string;
}

// ---------------------------------------------------------------------------
// audit_log
// ---------------------------------------------------------------------------

export async function maxAuditId(ctx: ContextoG11): Promise<number> {
  const { data, error } = await ctx.service.from('audit_log').select('id').order('id', { ascending: false }).limit(1);
  if (error) throw error;
  return Number(data?.[0]?.id ?? 0);
}

export interface FilaAudit {
  id: number;
  usuario_id: string | null;
  planta_id: string | null;
  accion: string;
  campos_expuestos: string[];
  detalle: Record<string, any>;
  ocurrido_en: string;
}

/** Filas de audit_log posteriores a una marca, de ciertos usuarios (los de la temporada) y opcionalmente de una acción. */
export async function auditDesde(
  ctx: ContextoG11,
  marca: number,
  filtro: { usuarioIds?: string[]; accion?: string; plantaId?: string } = {},
): Promise<FilaAudit[]> {
  // Por defecto solo los usuarios de la temporada: otras suites escriben en audit_log en paralelo.
  let q = ctx.service.from('audit_log').select('*').gt('id', marca).order('id');
  q = q.in('usuario_id', filtro.usuarioIds ?? [ctx.adminId, ctx.opAId, ctx.opBId]);
  if (filtro.accion) q = q.eq('accion', filtro.accion);
  if (filtro.plantaId) q = q.eq('planta_id', filtro.plantaId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as FilaAudit[];
}

export async function auditDeCruce(ctx: ContextoG11, plantaId: string, accion: string): Promise<FilaAudit[]> {
  const { data, error } = await ctx.service.from('audit_log').select('*').eq('planta_id', plantaId).eq('accion', accion).order('id');
  if (error) throw error;
  return (data ?? []) as FilaAudit[];
}

// ---------------------------------------------------------------------------
// Limpieza
// ---------------------------------------------------------------------------

export interface EstadoLimpieza {
  plantaIds: string[];
  snapshotIds: string[];
  versionIds: string[];
  predioIds: string[];
  catalogo: { insumos: string[]; sustratos: string[]; contenedores: string[] };
  variedadIds: string[];
  storagePaths: string[];
  usuarioIds: string[];
  especieId: string | null;
}

export interface ResultadoLimpieza {
  avisos: string[];
  restos: Record<string, number>;
}

/**
 * Deja la base como estaba, salvo lo inborrable por diseño. Cada paso va en
 * try/catch: una falla en uno no impide intentar los siguientes. Orden:
 * Storage → snapshots → evaluaciones/PCR/rondas → emplazamientos (el trigger
 * `bloquear_borrado_emplazamiento` frena incluso a service_role, de modo que se
 * borran con `session_replication_role = replica` SOLO los de individuos
 * propios) → purga hard de cada cruce → predios → catálogo → versiones →
 * variedades → especie → usuarios.
 */
export async function limpiarTemporada(ctx: ContextoG11, e: EstadoLimpieza): Promise<ResultadoLimpieza> {
  const avisos: string[] = [];
  const intentar = async (nombre: string, f: () => Promise<unknown> | unknown) => {
    try { await f(); } catch (err) { avisos.push(`${nombre}: ${(err as Error).message}`); }
  };
  const lista = (ids: string[]) => ids.map((i) => `'${i}'`).join(',');

  if (e.storagePaths.length > 0) {
    await intentar('storage', async () => {
      const { error } = await ctx.service.storage.from('media-plantas').remove(e.storagePaths);
      if (error) throw error;
    });
  }

  // Individuos propios (para emplazamientos, evaluaciones y rondas).
  let individuoIds: string[] = [];
  await intentar('listar individuos', async () => {
    if (e.plantaIds.length === 0) return;
    const { data, error } = await ctx.service.from('individuos').select('id').in('planta_id', e.plantaIds);
    if (error) throw error;
    individuoIds = (data ?? []).map((i) => i.id as string);
  });

  // Snapshots propios (FK RESTRICT hacia evaluaciones, individuos y perfiles).
  await intentar('snapshots', async () => {
    const ids = [...e.snapshotIds];
    if (e.especieId) {
      const { data } = await ctx.service.from('ranking_snapshot').select('id').eq('especie_id', e.especieId);
      for (const s of data ?? []) if (!ids.includes(s.id as string)) ids.push(s.id as string);
    }
    if (ids.length === 0) return;
    const r1 = await ctx.service.from('ranking_snapshot_resultado').delete().in('snapshot_id', ids);
    if (r1.error) throw r1.error;
    const r2 = await ctx.service.from('ranking_snapshot').delete().in('id', ids);
    if (r2.error) throw r2.error;
  });

  await intentar('evaluaciones/pcr', async () => {
    if (individuoIds.length === 0) return;
    const { data: rondas } = await ctx.service.from('ronda_evaluacion_anual').select('id').in('individuo_id', individuoIds);
    const rondaIds = (rondas ?? []).map((r) => r.id as string);
    if (rondaIds.length === 0) return;
    const r1 = await ctx.service.from('evaluaciones').delete().in('ronda_id', rondaIds);
    if (r1.error) throw r1.error;
    const r2 = await ctx.service.from('pcr_analisis').delete().in('ronda_id', rondaIds);
    if (r2.error) throw r2.error;
  });

  await intentar('emplazamientos', () => {
    if (individuoIds.length === 0) return;
    psqlRoot(`
      set session_replication_role = replica;
      delete from emplazamiento_coordenada where emplazamiento_id in (select id from emplazamiento_individuo where individuo_id in (${lista(individuoIds)}));
      delete from emplazamiento_individuo where individuo_id in (${lista(individuoIds)});
    `);
  });

  // Purga hard: restaura primero los archivados (el hard acepta archivados, pero así queda un solo camino).
  for (const plantaId of e.plantaIds) {
    await intentar(`purga ${plantaId}`, async () => {
      const { error } = await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
      if (error) throw error;
    });
  }

  for (const predioId of e.predioIds) {
    await intentar(`predio ${predioId}`, async () => {
      const r1 = await ctx.service.from('sector').delete().eq('predio_id', predioId);
      if (r1.error) throw r1.error;
      const r2 = await ctx.service.from('predio').delete().eq('id', predioId);
      if (r2.error) throw r2.error;
    });
  }

  for (const [tabla, ids] of [['insumo', e.catalogo.insumos], ['sustrato', e.catalogo.sustratos], ['contenedor', e.catalogo.contenedores]] as const) {
    if (ids.length === 0) continue;
    await intentar(tabla, async () => {
      const r = await ctx.service.from(tabla).delete().in('id', ids);
      if (r.error) throw r.error;
    });
  }

  // Versiones propias: sus rondas ya no existen. Con replica para saltar la inmutabilidad «en uso».
  await intentar('versiones', () => {
    const ids = [...e.versionIds];
    const extra = psqlRoot(`select id from scoring_version where especie_id = '${e.especieId}'`);
    for (const id of extra.split('\n').filter(Boolean)) if (!ids.includes(id)) ids.push(id);
    if (ids.length === 0) return;
    psqlRoot(`
      set session_replication_role = replica;
      delete from scoring_metrica where scoring_version_id in (${lista(ids)});
      delete from scoring_categoria_peso where scoring_version_id in (${lista(ids)});
      delete from scoring_version where id in (${lista(ids)});
    `);
  });

  if (e.variedadIds.length > 0) {
    await intentar('variedades', async () => {
      const r = await ctx.service.from('variedades').delete().in('id', e.variedadIds);
      if (r.error) throw r.error;
    });
  }

  if (e.especieId) {
    await intentar('rangos de referencia propios', async () => {
      const r0 = await ctx.service.from('rango_referencia').delete().eq('especie_id', e.especieId!);
      if (r0.error) throw r0.error;
    });
    await intentar('especie', async () => {
      const r = await ctx.service.from('especies').delete().eq('id', e.especieId!);
      if (r.error) throw r.error;
    });
  }

  for (const uid of e.usuarioIds) {
    await intentar(`usuario ${uid}`, async () => {
      const r = await ctx.service.auth.admin.deleteUser(uid);
      if (r.error) throw r.error;
    });
  }

  // Restos verificables.
  const restos: Record<string, number> = {};
  const contar = async (nombre: string, f: () => Promise<number>) => {
    try { restos[nombre] = await f(); } catch { restos[nombre] = -1; }
  };
  await contar('plantas AUD-G11', async () => {
    const { count } = await ctx.service.from('plantas').select('id', { count: 'exact', head: true }).like('codigo_sistema', `AUD-G11-%-${ctx.R}`);
    return count ?? 0;
  });
  await contar('individuos', async () => {
    if (e.plantaIds.length === 0) return 0;
    const { count } = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).in('planta_id', e.plantaIds);
    return count ?? 0;
  });
  // audit_log es append-only y no se puede limpiar: sus filas quedan, con planta_id y usuario_id en NULL (FK ON DELETE SET NULL).
  await contar('filas de audit_log que quedan (append-only; con código AUD-G11 de esta corrida)', async () =>
    Number(psqlRoot(`select count(*) from audit_log where detalle::text like '%AUD-G11-%-${ctx.R}%'`)));
  await contar('usuarios sin borrar', async () => {
    const { data } = await ctx.service.auth.admin.listUsers({ perPage: 1000 });
    return (data?.users ?? []).filter((u) => (u.email ?? '').startsWith('aud-g11-') && (u.email ?? '').includes(String(ctx.R))).length;
  });
  return { avisos, restos };
}

export { METRICAS };
