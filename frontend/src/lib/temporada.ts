/**
 * Etiqueta de temporada de una ronda (fase 5, decisión G2 y su aclaración). La temporada no es una entidad: sigue siendo la
 * ronda anual N (R5); solo se calcula esta etiqueta para mostrarla. Una ronda iniciada entre julio y diciembre de AAAA es de la
 * temporada «AAAA-AAAA+1»; una iniciada entre enero y junio de AAAA, de la «AAAA-1-AAAA». Es la misma regla que la base
 * (etiqueta_temporada, migración 20261026160000). El año guardado en la ronda no se usa.
 */
import { hoyChileISO } from './fechas';

/** 'AAAA-MM-DD' (o un instante ISO, que se lleva al día en Chile) → «AAAA-AAAA+1». */
export function etiquetaTemporada(fecha: string | null | undefined): string | null {
  if (!fecha) return null;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : hoyChileISO(new Date(fecha));
  const anio = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7));
  if (!Number.isFinite(anio) || !Number.isFinite(mes)) return null;
  return mes >= 7 ? `${anio}-${anio + 1}` : `${anio - 1}-${anio}`;
}

/** La fecha de inicio de la ronda y, si falta, el día en que se creó. */
export function temporadaDeRonda(ronda: { fecha_inicio?: string | null; created_at?: string | null }): string | null {
  return etiquetaTemporada(ronda.fecha_inicio ?? ronda.created_at ?? null);
}
