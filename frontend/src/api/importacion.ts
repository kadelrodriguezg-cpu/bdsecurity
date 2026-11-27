/**
 * Importación masiva de cruces (B1). Solo admin: las RPC lo validan en la
 * base (es_admin) y la ruta está detrás de AdminRoute. El linaje viaja en las
 * filas, igual que en el alta manual, y cada cruce creado queda auditado
 * como alta_cruce por el trigger de B3.
 */
import { supabase, traducirError } from './client';

/** Campos que el importador sabe cargar; el archivo se asigna a estos nombres. */
export const CAMPOS_IMPORTACION = ['codigo_sistema', 'especie', 'cruzamiento', 'mama', 'papa', 'es_prueba'] as const;
export type CampoImportacion = (typeof CAMPOS_IMPORTACION)[number];
export type FilaImportacion = Partial<Record<CampoImportacion, string>>;

export const CAMPO_IMPORTACION_LABEL: Record<CampoImportacion, string> = {
  codigo_sistema: 'Código del cruce',
  especie: 'Especie',
  cruzamiento: 'Cruzamiento',
  mama: 'Mamá (variedad)',
  papa: 'Papá (variedad)',
  es_prueba: 'Es de prueba (sí/no)',
};

export const CAMPOS_OBLIGATORIOS: CampoImportacion[] = ['codigo_sistema', 'especie'];

export const ERROR_IMPORTACION_LABEL: Record<string, string> = {
  codigo_vacio: 'Falta el código',
  codigo_repetido_en_archivo: 'Código repetido en el archivo',
  codigo_existente: 'El código ya existe en el sistema',
  especie_vacia: 'Falta la especie',
  especie_inexistente: 'La especie no existe',
  mama_parecida_a_existente: 'La mamá se parece a una variedad existente',
  papa_parecida_a_existente: 'El papá se parece a una variedad existente',
};

export interface FilaPrevisualizada {
  n: number;
  codigo_sistema: string | null;
  errores: string[];
  variedades_faltantes: string[];
  sugerencias: { mama?: string; papa?: string };
}

export interface Previsualizacion {
  lote_id: string;
  filas_total: number;
  filas_con_error: number;
  variedades_nuevas: string[];
  filas: FilaPrevisualizada[];
}

export interface ResultadoImportacion {
  lote_id: string;
  cruces_creados: number;
  variedades_creadas: number;
  repetido: boolean;
}

/** Valida el archivo y lo guarda como lote previsualizado. No crea cruces. */
export async function previsualizarImportacion(filas: FilaImportacion[], archivoNombre: string): Promise<Previsualizacion> {
  const { data, error } = await supabase.rpc('previsualizar_importacion_cruces', { p_filas: filas, p_archivo_nombre: archivoNombre });
  if (error) throw traducirError(error);
  return data as unknown as Previsualizacion;
}

/** Descarta las filas sensibles de una previsualización que se reemplaza. */
export async function descartarImportacion(loteId: string): Promise<void> {
  const { error } = await supabase.rpc('descartar_importacion_cruces', { p_lote_id: loteId });
  if (error) throw traducirError(error);
}

/** Crea todos los cruces del lote en una transacción. La misma clave repetida devuelve el mismo resultado. */
export async function confirmarImportacion(loteId: string, crearVariedades: boolean, claveIdempotencia: string): Promise<ResultadoImportacion> {
  const { data, error } = await supabase.rpc('confirmar_importacion_cruces', {
    p_lote_id: loteId,
    p_crear_variedades: crearVariedades,
    p_idempotency_key: claveIdempotencia,
  });
  if (error) throw traducirError(error);
  return data as unknown as ResultadoImportacion;
}

/** Archiva los cruces del lote si ninguno tiene individuos todavía. */
export async function revertirImportacion(loteId: string): Promise<{ lote_id: string; cruces_archivados: number }> {
  const { data, error } = await supabase.rpc('revertir_importacion', { p_lote_id: loteId });
  if (error) throw traducirError(error);
  return data as unknown as { lote_id: string; cruces_archivados: number };
}
