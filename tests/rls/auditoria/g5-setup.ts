/**
 * Preparación común de las pruebas del grupo G5 (auditoría integral, Corrida 1):
 * evaluación anual y multisitio. Usuarios propios `aud-g5-*@test.local`,
 * cruces `es_prueba = true` con código `AUD-G5-*`.
 *
 * Solo el cliente `service` (service_role) se usa para preparar y limpiar
 * datos; los permisos se prueban siempre con clientes logueados con la clave
 * anon (sujetos al RLS).
 */
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

export const CONTENEDOR_DB = 'supabase_db_dbsecurity-frutales';
export const ESPECIE_ARANDANO = 'Arándano';

export interface ContextoG5 {
  creds: LocalCreds;
  service: SupabaseClient;
  anon: SupabaseClient;
  admin: SupabaseClient;
  adminId: string;
  operario: SupabaseClient;
  operarioId: string;
  operario2: SupabaseClient;
  operario2Id: string;
  especieId: string;
  sufijo: number;
}

export async function prepararContexto(tema: string, opts: { especiePropia?: boolean } = {}): Promise<ContextoG5> {
  const creds = getLocalCreds();
  const sufijo = Date.now();
  const service = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(creds.url, creds.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g5-${tema}-admin-${sufijo}@test.local`, rol: 'admin' });
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g5-${tema}-operario-${sufijo}@test.local`, rol: 'operario' });
  const op2 = await crearUsuarioDePrueba(creds, service, { email: `aud-g5-${tema}-operario2-${sufijo}@test.local`, rol: 'operario' });

  let especieId: string;
  if (opts.especiePropia) {
    const { data, error } = await service.from('especies').insert({ nombre: `AUD-G5 ${tema} ${sufijo}` }).select('id').single();
    if (error || !data) throw new Error(`setup especie propia: ${error?.message}`);
    especieId = data.id;
  } else {
    const { data, error } = await service.from('especies').select('id').eq('nombre', ESPECIE_ARANDANO).single();
    if (error || !data) throw new Error(`setup especie: ${error?.message}`);
    especieId = data.id;
  }

  return {
    creds, service, anon,
    admin: ad.client, adminId: ad.userId,
    operario: op.client, operarioId: op.userId,
    operario2: op2.client, operario2Id: op2.userId,
    especieId, sufijo,
  };
}

export type EstadoPlanta =
  | 'sin_empezar' | 'polinizacion' | 'cosecha' | 'siembra_semilla' | 'germinacion' | 'trasplante'
  | 'crecimiento' | 'evaluacion_anual' | 'traslado_destino' | 'proceso_finalizado';

/** Cruce de prueba (`es_prueba = true`) en la fase pedida. */
export async function crearCruce(ctx: ContextoG5, codigo: string, estado: EstadoPlanta = 'evaluacion_anual', especieId = ctx.especieId): Promise<string> {
  const { data, error } = await ctx.service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-G5-${codigo}-${ctx.sufijo}`, especie_id: especieId, estado, es_prueba: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce ${codigo}: ${error?.message}`);
  return data.id as string;
}

export async function crearIndividuo(ctx: ContextoG5, plantaId: string, codigo: string): Promise<string> {
  const { data, error } = await ctx.service
    .from('individuos')
    .insert({ planta_id: plantaId, codigo_display: `AUD-G5-${codigo}-${ctx.sufijo}`, created_by: ctx.adminId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup individuo ${codigo}: ${error?.message}`);
  return data.id as string;
}

/** Baja de un individuo hecha con service_role (sin pasar por la RPC de baja). */
export async function darDeBaja(ctx: ContextoG5, individuoId: string): Promise<void> {
  const { error } = await ctx.service
    .from('individuos')
    .update({ estado_vital: 'muerto', fecha_baja: '2026-10-01' })
    .eq('id', individuoId);
  if (error) throw new Error(`setup baja: ${error.message}`);
}

/** Ronda creada con service_role (como hacen las pruebas existentes), sin pasar por la RPC. */
export async function crearRondaServicio(
  ctx: ContextoG5,
  individuoId: string,
  opts: { numero?: number; tipo?: 'anual' | 'multisitio'; anio?: number | null; predioId?: string | null } = {},
): Promise<string> {
  const tipo = opts.tipo ?? 'anual';
  const { data, error } = await ctx.service
    .from('ronda_evaluacion_anual')
    .insert({
      individuo_id: individuoId,
      tipo_ronda: tipo,
      numero_ronda: opts.numero ?? 1,
      anio: opts.anio === undefined ? (tipo === 'anual' ? 2026 : null) : opts.anio,
      fecha_inicio: '2026-01-15',
      predio_id: opts.predioId ?? null,
      created_by: ctx.adminId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup ronda: ${error?.message}`);
  return data.id as string;
}

/**
 * Cierra una ronda con una evaluación completa creada con service_role. Desde
 * S2-1 la ronda N+1 solo se abre con la N cerrada: las pruebas que abren 2 o 3
 * rondas por RPC deben cerrar la anterior antes.
 */
export async function cerrarRondaServicio(ctx: ContextoG5, rondaId: string): Promise<void> {
  const { error } = await ctx.service
    .from('evaluaciones')
    .insert({ ronda_id: rondaId, fecha: '2026-03-01', created_by: ctx.adminId, ...camposCompletaConMuestra() });
  if (error) throw new Error(`setup cierre de ronda: ${error.message}`);
}

export async function crearPredio(ctx: ContextoG5, nombre: string, activo = true): Promise<string> {
  const { data, error } = await ctx.service
    .from('predio')
    .insert({ nombre: `AUD-G5 ${nombre} ${ctx.sufijo}`, activo })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup predio: ${error?.message}`);
  return data.id as string;
}

/** Última fila de audit_log de una acción, filtrando por una clave del detalle. */
export async function ultimoAudit(ctx: ContextoG5, accion: string, claveDetalle: string, valor: string) {
  const { data, error } = await ctx.service
    .from('audit_log')
    .select('*')
    .eq('accion', accion)
    .eq(`detalle->>${claveDetalle}`, valor)
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function contarAudit(ctx: ContextoG5, accion: string, claveDetalle: string, valor: string): Promise<number> {
  const { count, error } = await ctx.service
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('accion', accion)
    .eq(`detalle->>${claveDetalle}`, valor);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Purga de los cruces de prueba creados. `borrar_cruzamiento(hard)` rechaza
 * cruces con evaluaciones cerradas, así que primero se borran con service_role
 * las evaluaciones y PCR de sus rondas (son datos de esta misma prueba).
 * Los predios y especies propios se borran después, si quedaron sin uso.
 */
export async function purgarCruces(ctx: ContextoG5, plantaIds: string[], extras: { predioIds?: string[]; especieIds?: string[] } = {}): Promise<void> {
  for (const plantaId of plantaIds) {
    const { data: individuos } = await ctx.service.from('individuos').select('id').eq('planta_id', plantaId);
    const individuoIds = (individuos ?? []).map((i) => i.id as string);
    if (individuoIds.length > 0) {
      const { data: rondas } = await ctx.service.from('ronda_evaluacion_anual').select('id').in('individuo_id', individuoIds);
      const rondaIds = (rondas ?? []).map((r) => r.id as string);
      if (rondaIds.length > 0) {
        await ctx.service.from('evaluaciones').delete().in('ronda_id', rondaIds);
        await ctx.service.from('pcr_analisis').delete().in('ronda_id', rondaIds);
      }
    }
    const { error } = await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`[g5] no se pudo purgar el cruce ${plantaId}: ${error.message}`);
    }
  }
  for (const predioId of extras.predioIds ?? []) {
    // Un predio nuevo auto-provisiona un sector (FK sector_predio_id_fkey):
    // hay que borrarlo antes o el DELETE del predio falla en silencio.
    await ctx.service.from('sector').delete().eq('predio_id', predioId);
    await ctx.service.from('predio').delete().eq('id', predioId);
  }
  for (const especieId of extras.especieIds ?? []) {
    await ctx.service.from('especies').delete().eq('id', especieId);
  }
}

/** Evaluación mínima cerrable con muestra. */
export function camposCompletaConMuestra(extra: Record<string, unknown> = {}) {
  return { estado: 'completa', cantidad_frutos: 10, peso_total_g: 120, ...extra };
}

/**
 * SQL como superusuario en el contenedor local. Solo para PREPARAR y LIMPIAR
 * datos propios (cargas masivas, borrado de lo que creó la prueba); los
 * permisos se prueban siempre con clientes logueados.
 */
export function psqlRoot(sql: string): string {
  const r = spawnSync(
    'docker',
    ['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: sql, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`psqlRoot falló: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/**
 * Versión de scoring PROPIA de una especie PROPIA (así no depende de la
 * versión global ni de lo que activen otros agentes). Dos métricas: firmeza y brix.
 */
export async function crearVersionScoring(
  ctx: ContextoG5,
  especieId: string,
  opts: { nombre: string; desde: string; hasta?: string | null; estado: 'activa' | 'inactiva' },
): Promise<string> {
  const { data, error } = await ctx.service
    .from('scoring_version')
    .insert({
      nombre: `AUD-G5 ${opts.nombre} ${ctx.sufijo}`,
      especie_id: especieId,
      fase: 'evaluacion_anual',
      vigente_desde: opts.desde,
      vigente_hasta: opts.hasta ?? null,
      estado: opts.estado,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup version: ${error?.message}`);
  const { error: errMetricas } = await ctx.service.from('scoring_metrica').insert([
    { scoring_version_id: data.id, categoria: 'fruto_calidad', metrica: 'firmeza', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 1 },
    { scoring_version_id: data.id, categoria: 'fruto_calidad', metrica: 'brix', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 10, maximo_normalizacion: 20, orden: 2 },
  ]);
  if (errMetricas) throw new Error(`setup metricas: ${errMetricas.message}`);
  return data.id as string;
}

/** Borra versiones de scoring propias (las rondas que las referencian ya deben haberse purgado). */
export function borrarVersionesScoring(versionIds: string[]): void {
  if (versionIds.length === 0) return;
  const lista = versionIds.map((v) => `'${v}'`).join(',');
  psqlRoot(`
    set session_replication_role = replica;
    delete from scoring_metrica where scoring_version_id in (${lista});
    delete from scoring_categoria_peso where scoring_version_id in (${lista});
    delete from scoring_version where id in (${lista});
  `);
}
