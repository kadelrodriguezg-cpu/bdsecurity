/**
 * Helpers compartidos por las pruebas de auditoría del grupo G6 (scoring y
 * resultados). Cada archivo de prueba crea su propio contexto aislado: una
 * especie propia, usuarios propios (`aud-g6-...@test.local`), una versión de
 * scoring específica de esa especie (así la versión global activa queda
 * intacta) y cruces `es_prueba = true` con código `AUD-G6-...`.
 *
 * La preparación de datos usa SIEMPRE el cliente service_role; los permisos se
 * prueban con clientes logueados con la clave anon (sujetos al RLS).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

export interface ContextoG6 {
  creds: LocalCreds;
  service: SupabaseClient;
  anon: SupabaseClient;
  admin: SupabaseClient;
  adminId: string;
  operario: SupabaseClient;
  operarioId: string;
  /** Operario con puede_ver_linaje = true. */
  operarioLinaje: SupabaseClient;
  operarioLinajeId: string;
  especieId: string;
  /** Especies adicionales creadas con especieAdicional (se borran con el contexto raíz). */
  especiesExtra: string[];
  R: number;
  tema: string;
}

export type CategoriaScoring = 'fenologia' | 'fruto_calidad' | 'produccion' | 'estres';

export interface MetricaFixture {
  metrica: string;
  categoria: CategoriaScoring;
  peso: number;
  direccion?: 'mayor' | 'menor';
  /** Escala fija (metodo 'escala'). */
  min?: number;
  max?: number;
  /** Alternativa: id de rango_referencia (metodo 'rango_referencia'). */
  rangoId?: string;
}

export async function iniciarContexto(tema: string): Promise<ContextoG6> {
  const R = Date.now();
  const creds = getLocalCreds();
  const service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g6-${tema}-admin-${R}@test.local`, rol: 'admin' });
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g6-${tema}-operario-${R}@test.local`, rol: 'operario' });
  const opl = await crearUsuarioDePrueba(creds, service, { email: `aud-g6-${tema}-operario-linaje-${R}@test.local`, rol: 'operario', puedeVerLinaje: true });

  const { data: especie, error } = await service.from('especies').insert({ nombre: `AUD-G6 ${tema} ${R}` }).select('id').single();
  if (error || !especie) throw new Error(`setup especie: ${error?.message}`);

  return {
    creds, service, anon,
    admin: ad.client, adminId: ad.userId,
    operario: op.client, operarioId: op.userId,
    operarioLinaje: opl.client, operarioLinajeId: opl.userId,
    especieId: especie.id, especiesExtra: [], R, tema,
  };
}

export async function crearRango(
  ctx: ContextoG6,
  input: { metrica: string; min: number | null; max: number | null; limInf?: number | null; limSup?: number | null; vigenteDesde?: string },
): Promise<string> {
  const { data, error } = await ctx.service
    .from('rango_referencia')
    .insert({
      especie_id: ctx.especieId, metrica: input.metrica, fase: 'evaluacion_anual',
      minimo_esperado: input.min, maximo_esperado: input.max,
      limite_revision_inferior: input.limInf ?? null, limite_revision_superior: input.limSup ?? null,
      vigente_desde: input.vigenteDesde ?? '2020-01-01', activo: true, created_by: ctx.adminId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup rango: ${error?.message}`);
  return data.id;
}

export async function crearVersion(
  ctx: ContextoG6,
  input: {
    nombre: string;
    vigenteDesde: string;
    estado?: 'borrador' | 'activa' | 'inactiva';
    pesos?: Partial<Record<CategoriaScoring, number>>;
    metricas: MetricaFixture[];
  },
): Promise<string> {
  const { data: version, error } = await ctx.service
    .from('scoring_version')
    .insert({
      nombre: input.nombre, especie_id: ctx.especieId, fase: 'evaluacion_anual',
      vigente_desde: input.vigenteDesde, estado: input.estado ?? 'activa', created_by: ctx.adminId,
    })
    .select('id')
    .single();
  if (error || !version) throw new Error(`setup version: ${error?.message}`);
  if (input.pesos) {
    const filas = Object.entries(input.pesos).map(([categoria, peso]) => ({ scoring_version_id: version.id, categoria, peso }));
    const { error: errPesos } = await ctx.service.from('scoring_categoria_peso').insert(filas);
    if (errPesos) throw new Error(`setup pesos: ${errPesos.message}`);
  }
  if (input.metricas.length > 0) {
    const filas = input.metricas.map((m, i) => ({
      scoring_version_id: version.id, metrica: m.metrica, categoria: m.categoria, peso: m.peso,
      direccion_favorable: m.direccion ?? 'mayor', orden: i + 1,
      metodo_normalizacion: m.rangoId ? 'rango_referencia' : 'escala',
      minimo_normalizacion: m.rangoId ? null : m.min, maximo_normalizacion: m.rangoId ? null : m.max,
      rango_referencia_id: m.rangoId ?? null,
    }));
    const { error: errMetricas } = await ctx.service.from('scoring_metrica').insert(filas);
    if (errMetricas) throw new Error(`setup metricas: ${errMetricas.message}`);
  }
  return version.id;
}

export async function crearCruce(
  ctx: ContextoG6,
  input: { codigo: string; estado?: string; esPrueba?: boolean; mamaId?: string | null; papaId?: string | null; eliminado?: boolean },
): Promise<string> {
  const { data, error } = await ctx.service
    .from('plantas')
    .insert({
      codigo_sistema: input.codigo, especie_id: ctx.especieId, estado: input.estado ?? 'evaluacion_anual',
      es_prueba: input.esPrueba ?? true, mama_id: input.mamaId ?? null, papa_id: input.papaId ?? null,
      eliminado_at: input.eliminado ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce ${input.codigo}: ${error?.message}`);
  return data.id;
}

export async function crearIndividuos(ctx: ContextoG6, plantaId: string, cantidad: number): Promise<Array<{ id: string; codigo_display: string }>> {
  const creados: Array<{ id: string; codigo_display: string }> = [];
  const lote = Math.min(cantidad, 250);
  for (let hechos = 0; hechos < cantidad; hechos += lote) {
    const n = Math.min(lote, cantidad - hechos);
    const filas = Array.from({ length: n }, () => ({ planta_id: plantaId, codigo_display: 'GENERADO-POR-TRIGGER', created_by: ctx.adminId }));
    const { data, error } = await ctx.service.from('individuos').insert(filas).select('id, codigo_display');
    if (error || !data) throw new Error(`setup individuos: ${error?.message}`);
    creados.push(...data);
  }
  return creados;
}

export async function crearRonda(ctx: ContextoG6, individuoId: string, numero = 1, tipo: 'anual' | 'multisitio' = 'anual'): Promise<string> {
  const { data, error } = await ctx.service
    .from('ronda_evaluacion_anual')
    .insert({ individuo_id: individuoId, numero_ronda: numero, anio: 2026, fecha_inicio: '2026-06-01', tipo_ronda: tipo, created_by: ctx.adminId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup ronda: ${error?.message}`);
  return data.id;
}

export async function crearEvaluacion(
  ctx: ContextoG6,
  rondaId: string,
  campos: Record<string, unknown>,
  opts: { estado?: 'borrador' | 'completa' | 'corregida' | 'anulada'; fecha?: string; createdBy?: string; motivo?: string } = {},
): Promise<string> {
  const { data, error } = await ctx.service
    .from('evaluaciones')
    .insert({
      ronda_id: rondaId, fecha: opts.fecha ?? '2026-06-15', estado: opts.estado ?? 'completa',
      created_by: opts.createdBy ?? ctx.adminId, cantidad_frutos: 10, peso_total_g: 100,
      motivo_cambio: opts.motivo ?? null, ...campos,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup evaluacion: ${error?.message}`);
  return data.id;
}

async function borrarPorLotes(service: SupabaseClient, tabla: string, columna: string, ids: string[], lote = 100): Promise<void> {
  for (let i = 0; i < ids.length; i += lote) {
    const { error } = await service.from(tabla).delete().in(columna, ids.slice(i, i + lote));
    if (error) throw new Error(`limpieza ${tabla}: ${error.message}`);
  }
}

async function idsDe(service: SupabaseClient, tabla: string, columna: string, filtroCol: string, valores: string[]): Promise<string[]> {
  // PostgREST recorta cada respuesta a max_rows (1000): se pagina con range() hasta agotar el resultado.
  const out: string[] = [];
  for (let i = 0; i < valores.length; i += 100) {
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await service.from(tabla).select(columna).in(filtroCol, valores.slice(i, i + 100)).order(columna).range(desde, desde + 999);
      if (error) throw new Error(`limpieza select ${tabla}: ${error.message}`);
      const filas = (data ?? []) as unknown as Array<Record<string, string>>;
      out.push(...filas.map((f) => f[columna]));
      if (filas.length < 1000) break;
    }
  }
  return out;
}

/**
 * Borra todo lo que creó el contexto, en orden de dependencias, con
 * service_role. Lo que queda por diseño: filas de audit_log.
 */
export async function limpiarContexto(ctx: ContextoG6): Promise<void> {
  for (const especieId of [ctx.especieId, ...ctx.especiesExtra]) await limpiarEspecie(ctx, especieId);
  for (const id of [ctx.adminId, ctx.operarioId, ctx.operarioLinajeId]) {
    // perfiles cae en cascada; audit_log.usuario_id queda en NULL (ON DELETE SET NULL).
    await ctx.service.auth.admin.deleteUser(id).catch(() => undefined);
  }
}

/** Crea una especie adicional (aislada) y devuelve un contexto derivado que la usa; se limpia con el contexto raíz. */
export async function especieAdicional(ctx: ContextoG6, etiqueta: string): Promise<ContextoG6> {
  const { data, error } = await ctx.service.from('especies').insert({ nombre: `AUD-G6 ${ctx.tema} ${etiqueta} ${ctx.R}` }).select('id').single();
  if (error || !data) throw new Error(`setup especie adicional: ${error?.message}`);
  ctx.especiesExtra.push(data.id);
  return { ...ctx, especieId: data.id };
}

export async function limpiarEspecie(ctx: Pick<ContextoG6, 'service'>, especieId: string): Promise<void> {
  const { service } = ctx;
  const { data: plantas } = await service.from('plantas').select('id').eq('especie_id', especieId).limit(10000);
  const plantaIds = (plantas ?? []).map((p) => p.id);
  const individuoIds = await idsDe(service, 'individuos', 'id', 'planta_id', plantaIds);
  const rondaIds = await idsDe(service, 'ronda_evaluacion_anual', 'id', 'individuo_id', individuoIds);

  const { data: snaps } = await service.from('ranking_snapshot').select('id').eq('especie_id', especieId);
  const snapIds = (snaps ?? []).map((s) => s.id);
  await borrarPorLotes(service, 'ranking_snapshot_resultado', 'snapshot_id', snapIds);
  await borrarPorLotes(service, 'ranking_snapshot_resultado', 'individuo_id', individuoIds);
  await borrarPorLotes(service, 'ranking_snapshot', 'id', snapIds);

  await borrarPorLotes(service, 'evaluaciones', 'ronda_id', rondaIds);
  await borrarPorLotes(service, 'pcr_analisis', 'ronda_id', rondaIds);
  await borrarPorLotes(service, 'ronda_evaluacion_anual', 'id', rondaIds);
  await borrarPorLotes(service, 'baja_motivo', 'individuo_id', individuoIds);
  await borrarPorLotes(service, 'procedimiento_objetivos', 'individuo_id', individuoIds);
  await borrarPorLotes(service, 'individuos', 'id', individuoIds);
  await borrarPorLotes(service, 'polinizacion_evento', 'planta_id', plantaIds);
  await borrarPorLotes(service, 'registros_evento', 'planta_id', plantaIds);
  await borrarPorLotes(service, 'procedimiento_objetivos', 'planta_id', plantaIds);
  await borrarPorLotes(service, 'plantas', 'id', plantaIds);

  const { data: versiones } = await service.from('scoring_version').select('id').eq('especie_id', especieId);
  const versionIds = (versiones ?? []).map((v) => v.id);
  await borrarPorLotes(service, 'scoring_metrica', 'scoring_version_id', versionIds);
  await borrarPorLotes(service, 'scoring_categoria_peso', 'scoring_version_id', versionIds);
  await borrarPorLotes(service, 'scoring_version', 'id', versionIds);
  const { error: errRango } = await service.from('rango_referencia').delete().eq('especie_id', especieId);
  if (errRango) throw new Error(`limpieza rango_referencia: ${errRango.message}`);
  const { error: errVar } = await service.from('variedades').delete().eq('especie_id', especieId);
  if (errVar) throw new Error(`limpieza variedades: ${errVar.message}`);
  const { error: errEsp } = await service.from('especies').delete().eq('id', especieId);
  if (errEsp) throw new Error(`limpieza especies: ${errEsp.message}`);
}

/** Filas de audit_log de una acción hecha por un usuario (aísla la prueba de lo que hagan otros agentes). */
export async function auditoriaDe(
  ctx: ContextoG6,
  usuarioId: string,
  accion: string,
): Promise<Array<{ id: number; planta_id: string | null; campos_expuestos: string[]; detalle: Fila }>> {
  const { data, error } = await ctx.service
    .from('audit_log')
    .select('id, planta_id, campos_expuestos, detalle')
    .eq('usuario_id', usuarioId)
    .eq('accion', accion)
    .order('id');
  if (error) throw new Error(`audit_log: ${error.message}`);
  return (data ?? []) as never;
}

/** Cuenta filas de audit_log por acción (con service_role: por RLS solo un admin las lee). */
export async function contarAuditoria(ctx: ContextoG6, accion: string, filtro?: (detalle: Record<string, unknown>) => boolean): Promise<number> {
  const { data, error } = await ctx.service.from('audit_log').select('detalle').eq('accion', accion).limit(100000);
  if (error) throw new Error(`audit_log: ${error.message}`);
  const filas = (data ?? []) as Array<{ detalle: Record<string, unknown> }>;
  return filtro ? filas.filter((f) => filtro(f.detalle ?? {})).length : filas.length;
}

export function redondear4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

export type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
