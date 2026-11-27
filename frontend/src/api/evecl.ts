import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase, traducirError } from './client';

const clienteEvecl = supabase as unknown as SupabaseClient;
const BUCKET_FOTOS = 'evecl-fotos';

export type EveclEje = 'fenologia' | 'adaptabilidad' | 'calidad' | 'productividad';
export type EveclTipoFicha = 'evaluacion' | 'testigo';
export type EveclTipoDescriptor = 'estado' | 'valor';

export interface EveclEnsayo {
  id: number;
  codigo_parcela: string;
  nombre_productor: string | null;
  empresa: string | null;
  encargado_predio: string | null;
  localidad: string | null;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  area_evaluada: string | null;
  notas: string | null;
  created_by: string;
  created_at: string;
  total_fichas: number;
  total_variedades: number;
}

export interface EveclFichaLista {
  id: number;
  ensayo_id: number;
  variedad: string;
  tipo: EveclTipoFicha;
  numero_repeticion: number;
  codigo_planta: string | null;
  fecha_evaluacion: string;
  respondidos: number;
  total_descriptores: number;
}

export interface EveclDescriptorEstado {
  nota: number;
  label: string;
  orden: number;
}

export interface EveclDescriptor {
  id: number;
  codigo_upov: number | null;
  nombre: string;
  tipo: EveclTipoDescriptor;
  eje: EveclEje;
  unidad: string | null;
  nota_especial: string | null;
  rankeable: boolean;
  direccion_ranking: 'mayor' | 'menor' | 'distancia_18' | null;
  orden: number;
  estados: EveclDescriptorEstado[];
}

/**
 * Descriptores activos de un eje, según el catálogo real (no un listado
 * fijo por eje). Compartida entre FichaForm y EveclCompararPage: ambos
 * deciden si un bloque/tarjeta de eje se muestra según si esto devuelve
 * algo, nunca hardcodeando qué eje ocultar — si el catálogo cambia
 * (ej. se agregan descriptores a adaptabilidad), ambos reaccionan solos.
 */
export function descriptoresPorEje(catalogo: EveclDescriptor[], eje: EveclEje): EveclDescriptor[] {
  return catalogo.filter((descriptor) => descriptor.eje === eje);
}

export interface EveclRespuesta {
  descriptor_id: number;
  nota: number | null;
  valor_numerico: number | null;
  valor_texto: string | null;
  foto_path: string | null;
  fecha_observada: string | null;
  descriptor: Pick<EveclDescriptor, 'nombre' | 'tipo' | 'eje' | 'unidad' | 'orden'> & { activo?: boolean };
}

export interface EveclFicha {
  id: number;
  ensayo_id: number;
  variedad: string;
  codigo_genotipo: string | null;
  origen_cruza: string | null;
  tipo: EveclTipoFicha;
  numero_repeticion: number;
  codigo_planta: string | null;
  encargado: string | null;
  fecha_siembra: string | null;
  fecha_evaluacion: string;
  notas: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  ensayo: Pick<EveclEnsayo, 'id' | 'codigo_parcela' | 'nombre_productor' | 'empresa' | 'localidad'>;
  respuestas: EveclRespuesta[];
}

export interface EveclEnsayoEntrada {
  id?: number;
  codigo_parcela: string;
  nombre_productor?: string | null;
  empresa?: string | null;
  encargado_predio?: string | null;
  localidad?: string | null;
  direccion?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  area_evaluada?: string | null;
  notas?: string | null;
}

export interface EveclRespuestaEntrada {
  descriptor_id: number;
  nota?: number | null;
  valor_numerico?: number | null;
  valor_texto?: string | null;
  foto_path?: string | null;
  fecha_observada?: string | null;
}

export interface EveclFichaEntrada {
  id?: number;
  ensayo_id: number;
  variedad: string;
  codigo_genotipo?: string | null;
  origen_cruza?: string | null;
  tipo: EveclTipoFicha;
  numero_repeticion: number;
  codigo_planta?: string | null;
  encargado?: string | null;
  fecha_siembra?: string | null;
  fecha_evaluacion: string;
  notas?: string | null;
  respuestas: EveclRespuestaEntrada[];
  idempotency_key?: string;
}

export interface EveclFotoPendiente {
  descriptorId: number;
  archivo: File;
  fotoPathAnterior: string | null;
}

export type EveclModoComparacion = 'entre_fichas' | 'entre_grupos';
export type EveclConjuntoComparacion = 'todos' | 'solo_evaluacion' | 'evaluacion_vs_testigo';

export interface EveclRankingItem {
  grupo_key: string;
  grupo_label: string;
  variedad: string;
  ensayo_id: number;
  tipo: EveclTipoFicha;
  puntaje: number;
  n_con_dato: number;
  n_total: number;
}

export interface EveclPerfilItem {
  grupo_key: string;
  grupo_label: string;
  descriptor: string;
  nota_moda: number;
  label_moda: string;
  divergente: boolean;
  n_con_dato: number;
  n_total: number;
}

export interface EveclComparacion {
  modo: EveclModoComparacion;
  conjunto: EveclConjuntoComparacion | null;
  nota_metodologica: string;
  ranking_calidad: EveclRankingItem[];
  ranking_productividad: EveclRankingItem[];
  perfil_fenologia: EveclPerfilItem[];
  perfil_adaptabilidad: EveclPerfilItem[];
}

export interface EveclComparacionFiltros {
  modo: EveclModoComparacion;
  ensayoId?: number;
  variedad?: string;
  conjunto?: EveclConjuntoComparacion;
}

function numero(value: unknown): number {
  return Number(value);
}

function normalizarEnsayo(fila: EveclEnsayo): EveclEnsayo {
  return {
    ...fila,
    id: numero(fila.id),
    latitud: fila.latitud == null ? null : numero(fila.latitud),
    longitud: fila.longitud == null ? null : numero(fila.longitud),
    total_fichas: numero(fila.total_fichas),
    total_variedades: numero(fila.total_variedades),
  };
}

export async function listarEnsayosEvecl(): Promise<EveclEnsayo[]> {
  const { data, error } = await clienteEvecl.rpc('evecl_obtener_ensayos');
  if (error) throw traducirError(error);
  return ((data ?? []) as EveclEnsayo[]).map(normalizarEnsayo);
}

export async function obtenerEnsayoEvecl(ensayoId: number): Promise<EveclEnsayo> {
  const ensayo = (await listarEnsayosEvecl()).find((fila) => fila.id === ensayoId);
  if (!ensayo) throw new Error('El ensayo EVECL no existe o fue eliminado.');
  return ensayo;
}

export async function listarFichasEvecl(ensayoId: number, variedad?: string): Promise<EveclFichaLista[]> {
  const { data, error } = await clienteEvecl.rpc('evecl_obtener_fichas', {
    p_ensayo_id: ensayoId,
    p_variedad: variedad?.trim() || null,
  });
  if (error) throw traducirError(error);
  return ((data ?? []) as EveclFichaLista[]).map((fila) => ({
    ...fila,
    id: numero(fila.id),
    ensayo_id: numero(fila.ensayo_id),
    numero_repeticion: numero(fila.numero_repeticion),
    respondidos: numero(fila.respondidos),
    total_descriptores: numero(fila.total_descriptores),
  }));
}

export async function obtenerFichaEvecl(fichaId: number): Promise<EveclFicha> {
  const { data, error } = await clienteEvecl.rpc('evecl_obtener_ficha', { p_ficha_id: fichaId });
  if (error) throw traducirError(error);
  const ficha = data as EveclFicha;
  return {
    ...ficha,
    id: numero(ficha.id),
    ensayo_id: numero(ficha.ensayo_id),
    numero_repeticion: numero(ficha.numero_repeticion),
    ensayo: { ...ficha.ensayo, id: numero(ficha.ensayo.id) },
    respuestas: ficha.respuestas.map((respuesta) => ({
      ...respuesta,
      descriptor_id: numero(respuesta.descriptor_id),
      nota: respuesta.nota == null ? null : numero(respuesta.nota),
      valor_numerico: respuesta.valor_numerico == null ? null : numero(respuesta.valor_numerico),
    })),
  };
}

export async function obtenerCatalogoEvecl(): Promise<EveclDescriptor[]> {
  const { data, error } = await clienteEvecl.rpc('evecl_obtener_catalogo');
  if (error) throw traducirError(error);
  return ((data ?? []) as EveclDescriptor[]).map((descriptor) => ({
    ...descriptor,
    id: numero(descriptor.id),
    codigo_upov: descriptor.codigo_upov == null ? null : numero(descriptor.codigo_upov),
    orden: numero(descriptor.orden),
    estados: descriptor.estados.map((estado) => ({ ...estado, nota: numero(estado.nota), orden: numero(estado.orden) })),
  }));
}

export async function compararEvecl(filtros: EveclComparacionFiltros): Promise<EveclComparacion> {
  const { data, error } = await clienteEvecl.rpc('evecl_comparar', {
    p_modo: filtros.modo,
    p_ensayo_id: filtros.modo === 'entre_fichas' ? filtros.ensayoId ?? null : null,
    p_variedad: filtros.modo === 'entre_fichas' ? filtros.variedad?.trim() || null : null,
    p_conjunto: filtros.modo === 'entre_grupos' ? filtros.conjunto ?? 'todos' : 'todos',
  });
  if (error) throw traducirError(error);

  const comparacion = data as EveclComparacion;
  return {
    ...comparacion,
    ranking_calidad: comparacion.ranking_calidad.map((item) => ({
      ...item,
      ensayo_id: numero(item.ensayo_id),
      puntaje: numero(item.puntaje),
      n_con_dato: numero(item.n_con_dato),
      n_total: numero(item.n_total),
    })),
    ranking_productividad: comparacion.ranking_productividad.map((item) => ({
      ...item,
      ensayo_id: numero(item.ensayo_id),
      puntaje: numero(item.puntaje),
      n_con_dato: numero(item.n_con_dato),
      n_total: numero(item.n_total),
    })),
    perfil_fenologia: comparacion.perfil_fenologia.map((item) => ({
      ...item,
      nota_moda: numero(item.nota_moda),
      n_con_dato: numero(item.n_con_dato),
      n_total: numero(item.n_total),
    })),
    perfil_adaptabilidad: comparacion.perfil_adaptabilidad.map((item) => ({
      ...item,
      nota_moda: numero(item.nota_moda),
      n_con_dato: numero(item.n_con_dato),
      n_total: numero(item.n_total),
    })),
  };
}

export async function guardarEnsayoEvecl(entrada: EveclEnsayoEntrada): Promise<number> {
  const { data, error } = await clienteEvecl.rpc('evecl_guardar_ensayo', {
    p_id: entrada.id ?? null,
    p_codigo_parcela: entrada.codigo_parcela,
    p_nombre_productor: entrada.nombre_productor ?? null,
    p_empresa: entrada.empresa ?? null,
    p_encargado_predio: entrada.encargado_predio ?? null,
    p_localidad: entrada.localidad ?? null,
    p_direccion: entrada.direccion ?? null,
    p_latitud: entrada.latitud ?? null,
    p_longitud: entrada.longitud ?? null,
    p_area_evaluada: entrada.area_evaluada ?? null,
    p_notas: entrada.notas ?? null,
  });
  if (error) throw traducirError(error);
  return numero(data);
}

async function ejecutarGuardarFicha(entrada: EveclFichaEntrada, id?: number, incluirIdempotencia = true, eliminar: number[] = []): Promise<number> {
  const { data, error } = await clienteEvecl.rpc('evecl_guardar_ficha_con_bajas', { p_entrada: {
    p_id: id ?? entrada.id ?? null,
    p_ensayo_id: entrada.ensayo_id,
    p_variedad: entrada.variedad,
    p_codigo_genotipo: entrada.codigo_genotipo ?? null,
    p_origen_cruza: entrada.origen_cruza ?? null,
    p_tipo: entrada.tipo,
    p_numero_repeticion: entrada.numero_repeticion,
    p_codigo_planta: entrada.codigo_planta ?? null,
    p_encargado: entrada.encargado ?? null,
    p_fecha_siembra: entrada.fecha_siembra ?? null,
    p_fecha_evaluacion: entrada.fecha_evaluacion,
    p_notas: entrada.notas ?? null,
    p_respuestas: entrada.respuestas,
    p_idempotency_key: incluirIdempotencia ? entrada.idempotency_key ?? null : null,
  }, p_descriptores_eliminar: eliminar });
  if (error) throw traducirError(error);
  return numero(data);
}

function tieneDato(respuesta: EveclRespuestaEntrada): boolean {
  return respuesta.nota != null
    || respuesta.valor_numerico != null
    || Boolean(respuesta.valor_texto?.trim())
    || Boolean(respuesta.foto_path);
}

function pathFoto(ensayoId: number, fichaId: number, descriptorId: number): string {
  return `evecl/${ensayoId}/${fichaId}/${descriptorId}.jpg`;
}

export async function subirFotoDescriptorEvecl(
  ensayoId: number,
  fichaId: number,
  descriptorId: number,
  archivo: File,
): Promise<string> {
  const path = pathFoto(ensayoId, fichaId, descriptorId);
  const { error } = await clienteEvecl.storage.from(BUCKET_FOTOS).upload(path, archivo, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
    upsert: true,
  });
  if (error) throw new Error('No se pudo subir la foto comprimida. Revisa la conexión e inténtalo nuevamente.');
  return path;
}

export async function eliminarFotoStorageEvecl(path: string): Promise<void> {
  const { error } = await clienteEvecl.storage.from(BUCKET_FOTOS).remove([path]);
  if (error) throw new Error('No se pudo borrar la foto de Storage. La respuesta se conservó sin cambios.');
}

export async function eliminarRespuestaEvecl(fichaId: number, descriptorId: number, fotoPath?: string | null): Promise<void> {
  if (fotoPath) await eliminarFotoStorageEvecl(fotoPath);
  const { error } = await clienteEvecl
    .from('evecl_respuesta')
    .delete()
    .eq('ficha_id', fichaId)
    .eq('descriptor_id', descriptorId);
  if (error) throw traducirError(error);
}

export async function eliminarFotoDeRespuestaEvecl(
  fichaId: number,
  descriptorId: number,
  fotoPath: string,
  conservaRespuesta: boolean,
): Promise<void> {
  await eliminarFotoStorageEvecl(fotoPath);
  const consulta = clienteEvecl.from('evecl_respuesta');
  const { error } = conservaRespuesta
    ? await consulta.update({ foto_path: null }).eq('ficha_id', fichaId).eq('descriptor_id', descriptorId)
    : await consulta.delete().eq('ficha_id', fichaId).eq('descriptor_id', descriptorId);
  if (error) throw traducirError(error);
}

export async function guardarFichaEvecl(
  entrada: EveclFichaEntrada,
  fotos: EveclFotoPendiente[],
  respuestasAnteriores: Map<number, EveclRespuesta>,
): Promise<number> {
  const actuales = new Map(entrada.respuestas.map((respuesta) => [respuesta.descriptor_id, respuesta]));
  const eliminar: number[] = [];
  const fotosRetiradas: string[] = [];

  for (const [descriptorId, anterior] of respuestasAnteriores) {
    if (anterior.descriptor.activo === false) continue;
    const actual = actuales.get(descriptorId);
    if (!actual || !tieneDato(actual)) {
      eliminar.push(descriptorId);
      if (anterior.foto_path) fotosRetiradas.push(anterior.foto_path);
      actuales.delete(descriptorId);
    } else if (anterior.foto_path && !actual.foto_path && !fotos.some((foto) => foto.descriptorId === descriptorId)) {
      fotosRetiradas.push(anterior.foto_path);
    }
  }

  const primeraEntrada = { ...entrada, respuestas: [...actuales.values()].filter(tieneDato) };
  const fichaId = await ejecutarGuardarFicha(primeraEntrada, undefined, true, eliminar);
  // Una falla de validación/permiso en SQL conserva respuestas y objetos.
  // Si falla Storage después, la ficha ya está guardada: informar ese estado.
  if (fotosRetiradas.length) {
    const { error } = await clienteEvecl.storage.from(BUCKET_FOTOS).remove([...new Set(fotosRetiradas)]);
    if (error) throw new Error('La ficha se guardó, pero no se pudieron retirar las fotos de Storage.');
  }
  if (fotos.length === 0) return fichaId;

  const subidas: Array<{ path: string; eraNueva: boolean }> = [];
  try {
    const nuevasRutas = await Promise.all(fotos.map(async (foto) => {
      const path = await subirFotoDescriptorEvecl(entrada.ensayo_id, fichaId, foto.descriptorId, foto.archivo);
      subidas.push({ path, eraNueva: !foto.fotoPathAnterior });
      return [foto.descriptorId, path] as const;
    }));
    const rutas = new Map(nuevasRutas);
    const respuestasConFotos = [...actuales.values()].map((respuesta) => ({
      ...respuesta,
      foto_path: rutas.get(respuesta.descriptor_id) ?? respuesta.foto_path ?? null,
    }));
    for (const [descriptorId, path] of rutas) {
      if (!respuestasConFotos.some((respuesta) => respuesta.descriptor_id === descriptorId)) {
        respuestasConFotos.push({ descriptor_id: descriptorId, foto_path: path });
      }
    }
    await ejecutarGuardarFicha({ ...entrada, respuestas: respuestasConFotos }, fichaId, false);
    return fichaId;
  } catch (error) {
    const nuevas = subidas.filter((subida) => subida.eraNueva).map((subida) => subida.path);
    if (nuevas.length > 0) await clienteEvecl.storage.from(BUCKET_FOTOS).remove(nuevas);
    throw error;
  }
}

export async function obtenerUrlFirmadaFotoEvecl(path: string): Promise<string> {
  const { data, error } = await clienteEvecl.storage.from(BUCKET_FOTOS).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw new Error('No se pudo abrir la foto privada.');
  return data.signedUrl;
}
