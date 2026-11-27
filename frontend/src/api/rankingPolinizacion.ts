/**
 * Ranking agregado de actividad de polinización por variedad parental.
 * La agregación ocurre exclusivamente en la RPC: el cliente nunca recibe
 * mamá/papá por cruce ni compone el resultado iterando fichas individuales.
 */
import { supabase, traducirError } from './client';

export type RolParentalPolinizacion = 'ambos' | 'mama' | 'papa';

export interface RankingPolinizacionVarietalItem {
  variedad_id: string;
  variedad_nombre: string;
  flores_totales: number;
  sesiones_polinizacion: number;
  cruces_distintos: number;
}

export interface RankingPolinizacionVarietalResultado {
  filas: RankingPolinizacionVarietalItem[];
  resumen: {
    flores_reales: number;
  };
}

export async function obtenerRankingPolinizacionVarietal(
  especieId: string,
  rol: RolParentalPolinizacion = 'ambos',
): Promise<RankingPolinizacionVarietalResultado> {
  if (!especieId) throw new Error('Selecciona una especie antes de consultar el ranking de polinización.');

  const { data, error } = await supabase.rpc('obtener_ranking_polinizacion_varietal', {
    p_especie_id: especieId,
    p_rol: rol,
  });
  if (error) throw traducirError(error);

  const filasRpc = data ?? [];
  const resumen = filasRpc.find((fila) => fila.tipo_fila === 'resumen');

  return {
    filas: filasRpc.reduce<RankingPolinizacionVarietalItem[]>((acumuladas, fila) => {
      if (fila.tipo_fila !== 'variedad' || fila.variedad_id === null || fila.variedad_nombre === null) {
        return acumuladas;
      }

      acumuladas.push({
        variedad_id: fila.variedad_id,
        variedad_nombre: fila.variedad_nombre,
        flores_totales: fila.flores_totales ?? 0,
        sesiones_polinizacion: fila.sesiones_polinizacion ?? 0,
        cruces_distintos: fila.cruces_distintos ?? 0,
      });
      return acumuladas;
    }, []),
    resumen: {
      flores_reales: resumen?.flores_reales ?? 0,
    },
  };
}
