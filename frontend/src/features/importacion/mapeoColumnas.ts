/**
 * Asignación de columnas del archivo a los campos del importador (B1). El
 * formato del archivo de origen todavía no está fijado, así que el admin
 * elige qué columna es cada campo; esto solo propone una asignación inicial
 * por nombre de cabecera.
 */
import { CAMPOS_IMPORTACION, type CampoImportacion, type FilaImportacion } from '@/api/importacion';

export type AsignacionColumnas = Partial<Record<CampoImportacion, number>>;

const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Nombres de cabecera (ya normalizados) que se reconocen para cada campo. */
const SINONIMOS: Record<CampoImportacion, string[]> = {
  codigo_sistema: ['codigosistema', 'codigo', 'cod', 'codigocruce', 'cruce', 'id'],
  especie: ['especie', 'cultivo'],
  cruzamiento: ['cruzamiento', 'cruza', 'cruzamientos'],
  mama: ['mama', 'madre', 'progenitorfemenino', 'hembra'],
  papa: ['papa', 'padre', 'progenitormasculino', 'macho', 'polinizador'],
  es_prueba: ['esprueba', 'prueba', 'test'],
};

export function proponerAsignacion(columnas: string[]): AsignacionColumnas {
  const normalizadas = columnas.map(normalizar);
  const asignacion: AsignacionColumnas = {};
  for (const campo of CAMPOS_IMPORTACION) {
    const indice = normalizadas.findIndex((c) => SINONIMOS[campo].includes(c));
    if (indice >= 0 && !Object.values(asignacion).includes(indice)) asignacion[campo] = indice;
  }
  return asignacion;
}

/** Arma las filas que recibe la RPC. Un campo sin columna asignada no viaja. */
export function construirFilas(filas: string[][], asignacion: AsignacionColumnas): FilaImportacion[] {
  return filas.map((fila) => {
    const resultado: FilaImportacion = {};
    for (const campo of CAMPOS_IMPORTACION) {
      const indice = asignacion[campo];
      if (indice !== undefined) resultado[campo] = fila[indice] ?? '';
    }
    return resultado;
  });
}
