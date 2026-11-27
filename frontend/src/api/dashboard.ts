/** Contrato agregado del dashboard científico. Todo el cálculo ocurre en PostgreSQL. */
import { supabase, traducirError } from './client';
import type { RankingItem } from './scoring';
import type { EstadoPlanta } from '@/types/domain';

export interface DashboardResumen {
  cruces_activos: number;
  individuos_vivos: number;
  evaluaciones_ultimos_30_dias: number;
  procedimientos_pendientes: number;
  cruces_con_pendientes: number;
}

export interface CambioReciente {
  planta_id: string;
  codigo_sistema: string;
  especie_nombre: string;
  estado: EstadoPlanta;
  fecha: string;
  tipo: 'cambio_etapa' | 'registro_campo' | 'evaluacion';
}

export interface CrucePendiente {
  planta_id: string;
  codigo_sistema: string;
  estado: EstadoPlanta;
  individuos_pendientes: number;
}

export interface DashboardCientifico {
  generado_at: string;
  especie_id: string | null;
  resumen: DashboardResumen;
  cambios_recientes: CambioReciente[];
  destacados: RankingItem[];
  pendientes: CrucePendiente[];
  scoring_version_id: string | null;
  scoring_version_nombre: string | null;
}

export async function obtenerDashboardCientifico(especieId?: string, limite = 8, incluirPruebas = false): Promise<DashboardCientifico> {
  const { data, error } = await supabase.rpc('obtener_dashboard_cientifico', {
    p_especie_id: especieId || undefined,
    p_limite: limite,
    // v3 (migración 20261024090000): sin cruces de prueba salvo que un admin los pida.
    p_incluir_pruebas: incluirPruebas,
  } as never);
  if (error) throw traducirError(error);
  return data as unknown as DashboardCientifico;
}
