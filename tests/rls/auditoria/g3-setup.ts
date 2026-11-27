/**
 * Auditoría integral, Corrida 1, grupo G3 (C11 administración de cruces,
 * C12 bitácora con archivos, C13 procedimientos): utilidades compartidas.
 *
 * Todo lo que se crea acá es de prueba: usuarios `aud-g3-<tag>-<rol>-<ts>@test.local`,
 * cruces `AUD-G3-<tag>-<ts>-<n>` con `es_prueba = true`. `limpiar()` lo borra al
 * final, salvo lo que el diseño no deja borrar (individuos con historial
 * territorial, filas de `audit_log`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

export const BUCKET = 'media-plantas';

export interface Contexto {
  creds: LocalCreds;
  tag: string;
  R: number;
  service: SupabaseClient;
  anon: SupabaseClient;
  admin: SupabaseClient;
  adminId: string;
  admin2: SupabaseClient;
  admin2Id: string;
  opA: SupabaseClient;
  opAId: string;
  opB: SupabaseClient;
  opBId: string;
  especieId: string;
  plantas: string[];
  usuarios: string[];
  objetosStorage: string[];
  procedimientos: string[];
  n: number;
}

const sinSesion = { auth: { persistSession: false, autoRefreshToken: false } };

export async function crearContexto(tag: string): Promise<Contexto> {
  const creds = getLocalCreds();
  const R = Date.now();
  const service = createClient(creds.url, creds.serviceKey, sinSesion);
  const anon = createClient(creds.url, creds.anonKey, sinSesion);
  const usuarios: string[] = [];
  const mk = async (rol: 'admin' | 'operario', sufijo: string) => {
    const r = await crearUsuarioDePrueba(creds, service, { email: `aud-g3-${tag}-${sufijo}-${R}@test.local`, rol });
    usuarios.push(r.userId);
    return r;
  };
  const ad = await mk('admin', 'admin');
  const ad2 = await mk('admin', 'admin2');
  const a = await mk('operario', 'opa');
  const b = await mk('operario', 'opb');
  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').limit(1).single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  return {
    creds, tag, R, service, anon,
    admin: ad.client, adminId: ad.userId,
    admin2: ad2.client, admin2Id: ad2.userId,
    opA: a.client, opAId: a.userId,
    opB: b.client, opBId: b.userId,
    especieId: esp.id,
    plantas: [], usuarios, objetosStorage: [], procedimientos: [], n: 0,
  };
}

/** Crea un cruce de prueba con el service_role (preparación, no prueba de permisos). */
export async function nuevoCruce(
  ctx: Contexto,
  estado = 'sin_empezar',
  extra: Record<string, unknown> = {},
): Promise<{ id: string; codigo: string }> {
  const codigo = `AUD-G3-${ctx.tag.toUpperCase()}-${ctx.R}-${++ctx.n}`;
  const { data, error } = await ctx.service
    .from('plantas')
    .insert({ codigo_sistema: codigo, especie_id: ctx.especieId, estado, es_prueba: true, ...extra })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
  ctx.plantas.push(data.id);
  return { id: data.id, codigo };
}

/** Individuo en un cruce (service_role). */
export async function nuevoIndividuo(ctx: Contexto, plantaId: string, codigo: string, n = 1): Promise<string> {
  const { data, error } = await ctx.service
    .from('individuos')
    .insert({ planta_id: plantaId, codigo_display: `${codigo}-P${String(n).padStart(2, '0')}`, created_by: ctx.adminId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup individuo: ${error?.message}`);
  return data.id;
}

export async function auditoriasDe(ctx: Contexto, plantaId: string, accion?: string) {
  let q = ctx.service
    .from('audit_log')
    .select('accion, usuario_id, detalle, campos_expuestos')
    .eq('planta_id', plantaId)
    .order('ocurrido_en');
  if (accion) q = q.eq('accion', accion);
  const { data, error } = await q;
  if (error) throw new Error(`auditoriasDe: ${error.message}`);
  return data ?? [];
}

/** ¿Existe el objeto en el bucket? Se consulta con service_role (ve todo). */
export async function existeObjeto(ctx: Contexto, path: string): Promise<boolean> {
  const i = path.lastIndexOf('/');
  const carpeta = path.slice(0, i);
  const nombre = path.slice(i + 1);
  const { data, error } = await ctx.service.storage.from(BUCKET).list(carpeta, { search: nombre, limit: 100 });
  if (error) throw new Error(`existeObjeto: ${error.message}`);
  return (data ?? []).some((o) => o.name === nombre);
}

/** Sube un objeto como el cliente y lo registra para limpieza. */
export async function subirObjeto(
  ctx: Contexto,
  cliente: SupabaseClient,
  path: string,
  contenido: Blob | Uint8Array | string,
  contentType?: string,
) {
  ctx.objetosStorage.push(path);
  const cuerpo = typeof contenido === 'string' ? new Blob([contenido], { type: contentType }) : contenido;
  return cliente.storage.from(BUCKET).upload(path, cuerpo, contentType ? { contentType } : undefined);
}

/** JPEG mínimo válido (1x1) para las pruebas de adjuntos. */
export const JPEG_1X1 = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
);

/**
 * Borra lo que creó la prueba. Orden: objetos de Storage (service), procedimientos
 * (service, hijos primero), cruces (hard por RPC; si el diseño lo impide, se archivan
 * o se borran con service_role) y usuarios (los que no se pueden borrar quedan).
 */
export async function limpiar(ctx: Contexto): Promise<{ plantasNoPurgables: string[] }> {
  if (ctx.objetosStorage.length) {
    await ctx.service.storage.from(BUCKET).remove(ctx.objetosStorage);
  }
  for (const id of ctx.procedimientos) {
    await ctx.service.from('procedimiento_reasignaciones').delete().eq('procedimiento_id', id);
    await ctx.service.from('procedimiento_insumos').delete().eq('procedimiento_id', id);
    await ctx.service.from('procedimiento_objetivos').delete().eq('procedimiento_id', id);
    await ctx.service.from('procedimientos').delete().eq('id', id);
  }
  const noPurgables: string[] = [];
  // Algunas pruebas pasan un cruce a es_prueba = false a propósito (para probar el DELETE directo de un cruce real) y no
  // siempre lo devuelven a true: sin la marca la purga hard se niega y el cruce quedaría archivado como «real».
  for (let i = 0; i < ctx.plantas.length; i += 100) {
    await ctx.service.from('plantas').update({ es_prueba: true }).in('id', ctx.plantas.slice(i, i + 100));
  }
  for (const id of ctx.plantas) {
    const { data: existe } = await ctx.service.from('plantas').select('id').eq('id', id).maybeSingle();
    if (!existe) continue;
    let { error } = await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
    if (error) {
      // Evaluaciones terminadas (puerta 2 de la purga): son datos de la propia prueba, se borran con service_role y se reintenta.
      const { data: inds } = await ctx.service.from('individuos').select('id').eq('planta_id', id);
      const indIds = (inds ?? []).map((i) => i.id);
      if (indIds.length) {
        const { data: rondas } = await ctx.service.from('ronda_evaluacion_anual').select('id').in('individuo_id', indIds);
        const rondaIds = (rondas ?? []).map((r) => r.id);
        if (rondaIds.length) await ctx.service.from('evaluaciones').delete().in('ronda_id', rondaIds);
      }
      ({ error } = await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' }));
    }
    if (error) {
      // Historial territorial u otra restricción de diseño: el cruce queda archivado.
      await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' });
      noPurgables.push(id);
    }
  }
  // Filas de audit_log identificables como de esta prueba (las demás, sin autor ni cruce, no se pueden atribuir y quedan).
  const prefijo = `AUD-G3-${ctx.tag.toUpperCase()}-${ctx.R}`;
  const purgadas = ctx.plantas.filter((id) => !noPurgables.includes(id));
  await ctx.service.from('audit_log').delete().in('usuario_id', ctx.usuarios);
  await ctx.service.from('audit_log').delete().like('detalle->>codigo_sistema', `${prefijo}%`);
  await ctx.service.from('audit_log').delete().like('detalle->>codigo_display', `${prefijo}%`);
  if (purgadas.length) await ctx.service.from('audit_log').delete().in('planta_id', purgadas);
  for (const uid of ctx.usuarios) {
    await ctx.service.auth.admin.deleteUser(uid);
  }
  return { plantasNoPurgables: noPurgables };
}
