/**
 * Limpieza de lo que crean las pruebas, con el cliente service_role y en orden
 * de dependencias (casi todas las FK de estas tablas son RESTRICT).
 *
 * Cada prueba que deja cruces, individuos, catálogos o usuarios propios llama a
 * `limpiarPrueba` en su `afterAll`: primero se borran los datos, al final los
 * usuarios (si un usuario sigue siendo autor de filas RESTRICT, Auth responde
 * 500 y el perfil queda para siempre). Referencia de orden: `limpiarEspecie` en
 * `auditoria/g6-helpers.ts`.
 *
 * Lo que la base NO deja borrar por diseño (se informa en consola, no falla):
 * - `protocolo_ronda`: trigger `protocolo_ronda_inmutable` (ni DELETE ni UPDATE).
 *   Un cruce con protocolo definido y sus autores quedan.
 * - `emplazamiento_individuo`: trigger `trg_emplazamiento_sin_borrado`. Un
 *   individuo con emplazamiento (traslado) y su cruce quedan.
 * - `audit_log`: es append-only; borrar un usuario agrega las filas
 *   `baja_perfil`/`cambio_perfil`, y `usuario_id` pasa a NULL (ON DELETE SET NULL).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

type Errores = string[];

export interface OpcionesLimpieza {
  /** Cruces (plantas.id) a borrar con todo lo que cuelga de ellos. */
  plantaIds?: Array<string | null | undefined>;
  /** Especies propias de la prueba: se borran sus cruces, scoring, rangos, variedades y la especie. */
  especieIds?: Array<string | null | undefined>;
  /** Usuarios de Auth creados por la prueba (el perfil cae en cascada). */
  usuarioIds?: Array<string | null | undefined>;
  /** Variedades propias (sin especie propia) a borrar después de los cruces. */
  variedadIds?: Array<string | null | undefined>;
}

const limpios = (ids: Array<string | null | undefined> | undefined): string[] => [...new Set((ids ?? []).filter((x): x is string => !!x))];

async function seleccionar(service: SupabaseClient, tabla: string, columna: string, filtroCol: string, valores: string[]): Promise<string[]> {
  // PostgREST recorta cada respuesta a max_rows (1000): se pagina con range() hasta agotar el resultado.
  const out: string[] = [];
  for (let i = 0; i < valores.length; i += 100) {
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await service.from(tabla).select(columna).in(filtroCol, valores.slice(i, i + 100)).order(columna).range(desde, desde + 999);
      if (error) throw new Error(`select ${tabla}: ${error.message}`);
      const filas = (data ?? []) as unknown as Array<Record<string, string>>;
      out.push(...filas.map((f) => f[columna]));
      if (filas.length < 1000) break;
    }
  }
  return out;
}

async function borrar(service: SupabaseClient, errores: Errores, tabla: string, columna: string, ids: string[], lote = 100): Promise<void> {
  for (let i = 0; i < ids.length; i += lote) {
    const tanda = ids.slice(i, i + lote);
    const { error } = await service.from(tabla).delete().in(columna, tanda);
    if (!error) continue;
    // Una sola fila bloqueada (p. ej. un cruce con emplazamientos) tumba toda la tanda: se reintenta de a una
    // para borrar lo que sí se puede y anotar solo lo que no.
    if (tanda.length === 1) { errores.push(`${tabla}: ${error.message}`); continue; }
    for (const id of tanda) {
      const { error: errorUno } = await service.from(tabla).delete().eq(columna, id);
      if (errorUno) errores.push(`${tabla}: ${errorUno.message}`);
    }
  }
}

/** Borra individuos y todo lo que cuelga de ellos (rondas, evaluaciones, bajas, objetivos, snapshots de ranking). */
export async function borrarIndividuos(service: SupabaseClient, individuoIds: string[], errores: Errores = []): Promise<Errores> {
  if (individuoIds.length === 0) return errores;
  const rondaIds = await seleccionar(service, 'ronda_evaluacion_anual', 'id', 'individuo_id', individuoIds);
  await borrar(service, errores, 'ranking_snapshot_resultado', 'individuo_id', individuoIds);
  await borrar(service, errores, 'evaluaciones', 'ronda_id', rondaIds);
  await borrar(service, errores, 'pcr_analisis', 'ronda_id', rondaIds);
  await borrar(service, errores, 'ronda_evaluacion_anual', 'id', rondaIds);
  await borrar(service, errores, 'multisitio', 'individuo_id', individuoIds);
  await borrar(service, errores, 'baja_motivo', 'individuo_id', individuoIds);
  await borrar(service, errores, 'evaluacion_reducida', 'individuo_id', individuoIds);
  await borrar(service, errores, 'procedimiento_objetivos', 'individuo_id', individuoIds);
  // No se borra por diseño: si hay emplazamientos el individuo no se puede borrar (se informa).
  await borrar(service, errores, 'emplazamiento_individuo', 'individuo_id', individuoIds);
  for (let i = 0; i < individuoIds.length; i += 100) {
    await service.from('individuos').update({ clon_de_id: null }).in('clon_de_id', individuoIds.slice(i, i + 100));
  }
  await borrar(service, errores, 'individuos', 'id', individuoIds);
  return errores;
}

/** Borra cruces con sus individuos, capturas por etapa, procedimientos-objetivo y el propio cruce. */
export async function borrarCruces(service: SupabaseClient, plantaIds: string[], errores: Errores = []): Promise<Errores> {
  if (plantaIds.length === 0) return errores;
  const individuoIds = await seleccionar(service, 'individuos', 'id', 'planta_id', plantaIds);
  await borrarIndividuos(service, individuoIds, errores);
  await borrar(service, errores, 'procedimiento_objetivos', 'planta_id', plantaIds);
  await borrar(service, errores, 'germinacion_evento', 'planta_id', plantaIds);
  await borrar(service, errores, 'cosecha_fruto', 'planta_id', plantaIds);
  await borrar(service, errores, 'polinizacion_evento', 'planta_id', plantaIds);
  await borrar(service, errores, 'procedimiento_cultivo', 'planta_id', plantaIds);
  // registros_evento, plantas_insumo y plantas_sustrato caen en cascada con el cruce.
  await borrar(service, errores, 'plantas', 'id', plantaIds);
  return errores;
}

/** Borra especies propias de una prueba, con sus cruces, scoring, rangos y variedades. */
export async function borrarEspecies(service: SupabaseClient, especieIds: string[], errores: Errores = []): Promise<Errores> {
  if (especieIds.length === 0) return errores;
  const plantaIds = await seleccionar(service, 'plantas', 'id', 'especie_id', especieIds);
  await borrarCruces(service, plantaIds, errores);

  const snapIds = await seleccionar(service, 'ranking_snapshot', 'id', 'especie_id', especieIds);
  await borrar(service, errores, 'ranking_snapshot_resultado', 'snapshot_id', snapIds);
  await borrar(service, errores, 'ranking_snapshot', 'id', snapIds);

  const versionIds = await seleccionar(service, 'scoring_version', 'id', 'especie_id', especieIds);
  await borrar(service, errores, 'scoring_metrica', 'scoring_version_id', versionIds);
  await borrar(service, errores, 'scoring_categoria_peso', 'scoring_version_id', versionIds);
  await borrar(service, errores, 'scoring_version', 'id', versionIds);
  await borrar(service, errores, 'rango_referencia', 'especie_id', especieIds);
  await borrar(service, errores, 'variedades', 'especie_id', especieIds);
  await borrar(service, errores, 'especies', 'id', especieIds);
  return errores;
}

/**
 * Borra los usuarios de Auth (y su perfil, en cascada). Antes quita lo que esos
 * usuarios dejaron en tablas con FK RESTRICT hacia `perfiles`: procedimientos,
 * snapshots de ranking, lotes de importación e individuos propios.
 */
export async function borrarUsuarios(service: SupabaseClient, usuarioIds: string[], errores: Errores = []): Promise<Errores> {
  if (usuarioIds.length === 0) return errores;

  const procIds = new Set<string>();
  for (const col of ['created_by', 'responsable_id']) {
    for (const id of await seleccionar(service, 'procedimientos', 'id', col, usuarioIds)) procIds.add(id);
  }
  const procedimientos = [...procIds];
  await borrar(service, errores, 'procedimiento_reasignaciones', 'procedimiento_id', procedimientos);
  for (const col of ['reasignado_por_id', 'responsable_anterior_id', 'responsable_nuevo_id']) {
    await borrar(service, errores, 'procedimiento_reasignaciones', col, usuarioIds);
  }
  await borrar(service, errores, 'procedimiento_objetivos', 'procedimiento_id', procedimientos);
  await borrar(service, errores, 'procedimiento_insumos', 'procedimiento_id', procedimientos);
  await borrar(service, errores, 'procedimientos', 'id', procedimientos);

  const snapIds = await seleccionar(service, 'ranking_snapshot', 'id', 'created_by', usuarioIds);
  await borrar(service, errores, 'ranking_snapshot_resultado', 'snapshot_id', snapIds);
  await borrar(service, errores, 'ranking_snapshot', 'id', snapIds);

  const individuoIds = await seleccionar(service, 'individuos', 'id', 'created_by', usuarioIds);
  await borrarIndividuos(service, individuoIds, errores);

  const loteIds = await seleccionar(service, 'importacion_lote', 'id', 'created_by', usuarioIds);
  if (loteIds.length) {
    await borrarCruces(service, await seleccionar(service, 'plantas', 'id', 'lote_importacion_id', loteIds), errores);
    await borrar(service, errores, 'importacion_lote', 'id', loteIds);
  }

  for (const id of usuarioIds) {
    const { error } = await service.auth.admin.deleteUser(id);
    // Auth responde 500 con cuerpo vacío cuando una FK RESTRICT lo impide.
    if (error && error.status !== 404) errores.push(`usuario ${id}: HTTP ${error.status ?? '?'} ${error.message}`);
  }
  return errores;
}

/**
 * Limpieza completa de una prueba, en orden: cruces y especies propios, variedades
 * sueltas, usuarios. Nunca lanza: lo que no se pudo borrar se informa en consola.
 */
export async function limpiarPrueba(service: SupabaseClient, opciones: OpcionesLimpieza, etiqueta = 'prueba'): Promise<void> {
  const errores: Errores = [];
  const intentar = async (paso: string, f: () => Promise<unknown>): Promise<void> => {
    try { await f(); } catch (e) { errores.push(`${paso}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  await intentar('cruces', () => borrarCruces(service, limpios(opciones.plantaIds), errores));
  await intentar('especies', () => borrarEspecies(service, limpios(opciones.especieIds), errores));
  await intentar('variedades', () => borrar(service, errores, 'variedades', 'id', limpios(opciones.variedadIds)));
  await intentar('usuarios', () => borrarUsuarios(service, limpios(opciones.usuarioIds), errores));
  if (errores.length) {
    const unicos = [...new Set(errores)];
    console.warn(`[limpieza ${etiqueta}] No se pudo borrar todo (${unicos.length}): ${unicos.slice(0, 5).join(' | ')}`);
  }
}
