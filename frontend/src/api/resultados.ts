/**
 * Lecturas de Resultados v3 que no traen las RPC del ranking (N33): las categorías y sus pesos, y las métricas de la
 * versión de puntaje activa. Nunca se fijan en el código: si la migración de scoring agrega una quinta categoría,
 * aparece sola. Tablas con lectura para cualquier autenticado (RLS); no contienen linaje.
 */
import { supabase, traducirError } from './client';
import { CATEGORIA_LABEL, METRICA_LABEL } from './scoring';

export interface PesoCategoria {
  categoria: string;
  /** Peso en 0–1 tal como lo guarda la versión. */
  peso: number;
}

export interface MetricaVersion {
  metrica: string;
  categoria: string;
  peso: number;
}

/** Categorías de la versión con su peso, de mayor a menor peso (orden de las columnas). */
export async function obtenerPesosCategorias(versionId: string): Promise<PesoCategoria[]> {
  const { data, error } = await supabase
    .from('scoring_categoria_peso')
    .select('categoria, peso')
    .eq('scoring_version_id', versionId);
  if (error) throw traducirError(error);
  return ((data ?? []) as Array<{ categoria: string; peso: number | string }>)
    .map((fila) => ({ categoria: fila.categoria, peso: Number(fila.peso) }))
    .filter((fila) => fila.peso > 0)
    .sort((a, b) => b.peso - a.peso || a.categoria.localeCompare(b.categoria));
}

/** Métricas (descriptores) de la versión: las que se pueden agregar como columnas. */
export async function obtenerMetricasVersion(versionId: string): Promise<MetricaVersion[]> {
  const { data, error } = await supabase
    .from('scoring_metrica')
    .select('metrica, categoria, peso, orden')
    .eq('scoring_version_id', versionId)
    .order('orden');
  if (error) throw traducirError(error);
  return ((data ?? []) as Array<{ metrica: string; categoria: string; peso: number | string }>)
    .map((fila) => ({ metrica: fila.metrica, categoria: fila.categoria, peso: Number(fila.peso) }));
}

const legible = (clave: string) => {
  const texto = clave.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

/** Nombre de una categoría; una categoría nueva sin nombre registrado se muestra con su clave legible. */
export const etiquetaCategoria = (categoria: string) => (CATEGORIA_LABEL as Record<string, string>)[categoria] ?? legible(categoria);

/** Nombre de una métrica; igual criterio. */
export const etiquetaMetrica = (metrica: string) => METRICA_LABEL[metrica] ?? legible(metrica);
