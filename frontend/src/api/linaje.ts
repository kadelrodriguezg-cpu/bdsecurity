/**
 * Escritura de linaje genético. Pasa EXCLUSIVAMENTE por la RPC
 * actualizar_linaje (migración 008, firma actualizada en 20260903001000): el
 * UPDATE directo a esas columnas está revocado a nivel de Postgres para
 * todos los usuarios de la API. La RPC valida que seas admin y audita
 * valores anteriores y nuevos.
 *
 * mama/papa dejaron de ser texto libre (Bloque 3, Parte 3C de la auditoría
 * de UX): ahora son mamaId/papaId, referencias al catálogo `variedades`.
 */
import { supabase, traducirError } from './client';

export async function actualizarLinaje(input: {
  plantaId: string;
  cruzamiento: string | null;
  mamaId: string | null;
  papaId: string | null;
}): Promise<void> {
  // Los tipos generados marcan los args como no-nulos (el SQL no declara
  // nullabilidad de parámetros), pero la RPC acepta null para "vaciar" un campo.
  const { error } = await supabase.rpc('actualizar_linaje', {
    p_planta_id: input.plantaId,
    p_cruzamiento: input.cruzamiento as string,
    p_mama_id: input.mamaId as string,
    p_papa_id: input.papaId as string,
  });
  if (error) throw traducirError(error);
}
