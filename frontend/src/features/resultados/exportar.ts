/**
 * «Exportar» de Resultados (N36): solo admin; CSV; sin linaje (código del individuo y del cruce, nunca mamá, papá ni
 * cruzamiento); el puntaje en 0–1 con precisión completa más el visible 0–100; la ronda y la fecha de exportación en el nombre del archivo; la versión
 * de puntaje, la ronda y la fecha en una fila de encabezado (la versión no va en el nombre del archivo para que no se vea suelta).
 *
 * Formato pensado para Excel en español (Chile): separador «;», coma decimal y BOM UTF-8.
 */
import { etiquetaCategoria, etiquetaMetrica, type PesoCategoria } from '@/api/resultados';
import { formatearFechaHora } from '@/lib/fechas';
import { formatearPuntos } from '@/lib/v3/puntaje';
import { valorMetrica, type Cambio, type FilaResultado, type ValoresMetricas } from './modelo';

export interface ContextoExportacion {
  especie: string;
  cruce: string | null;
  version: string;
  /** Texto de la ronda: «Ronda 1», «La última de cada individuo» o el nombre del ranking congelado. */
  ronda: string;
  /** Para el nombre del archivo: «ronda-1», «ultima» o «congelado». */
  rondaCorta: string;
  grupo: string;
  ahora: Date;
}

const SEP = ';';
/** Precisión completa con coma decimal (sin redondear). */
const exacto = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Number(v)).replace('.', ','));
const celda = (texto: string) => (/[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto);
const linea = (valores: string[]) => valores.map(celda).join(SEP);
const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const fechaArchivo = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function nombreArchivo(c: ContextoExportacion): string {
  return `resultados_${slug(c.especie)}${c.cruce ? `_${slug(c.cruce)}` : ''}_${c.rondaCorta}_${fechaArchivo(c.ahora)}.csv`;
}

export function construirCsv(filas: readonly FilaResultado[], c: ContextoExportacion, extra: {
  pesosGrupo: readonly PesoCategoria[];
  columnas: readonly string[];
  valores: ValoresMetricas | undefined;
  cambios: Map<string, Cambio> | undefined;
}): string {
  const encabezado = linea([
    `Resultados · Especie: ${c.especie} · ${c.cruce ? `Cruce: ${c.cruce}` : 'Toda la especie'} · Versión de puntaje: ${c.version} · ${c.ronda} · Grupo: ${c.grupo} · Exportado: ${formatearFechaHora(c.ahora.toISOString())}`,
  ]);
  const columnas = linea([
    'Puesto', 'De', 'Individuo', 'Cruce', 'Ronda', 'Fecha de evaluación', 'Puntaje (0-1)', 'Puntaje (0-100)',
    ...extra.pesosGrupo.map((p) => `${etiquetaCategoria(p.categoria)} (0-1)`),
    ...extra.columnas.map((m) => etiquetaMetrica(m)),
    ...(extra.cambios ? ['Cambio (0-1)', 'Cambio'] : []),
  ]);
  const cuerpo = filas.map((f) => {
    const cambio = extra.cambios?.get(f.individuo_id);
    return linea([
      f.posicion === null ? '' : String(f.posicion), f.tamano === null ? '' : String(f.tamano),
      f.codigo_display, f.codigo_sistema ?? '', f.numero_ronda === null ? '' : String(f.numero_ronda), f.fecha_evaluacion ?? '',
      exacto(f.puntaje), f.puntaje === null ? '' : formatearPuntos(f.puntaje),
      ...extra.pesosGrupo.map((p) => exacto(f.categorias[p.categoria])),
      ...extra.columnas.map((m) => exacto(valorMetrica(extra.valores, f.individuo_id, m))),
      ...(extra.cambios ? [exacto(cambio?.delta), cambio ? cambio.etiqueta : ''] : []),
    ]);
  });
  return `﻿${[encabezado, columnas, ...cuerpo].join('\r\n')}\r\n`;
}

/** Descarga el CSV en el navegador. */
export function descargarCsv(nombre: string, contenido: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
