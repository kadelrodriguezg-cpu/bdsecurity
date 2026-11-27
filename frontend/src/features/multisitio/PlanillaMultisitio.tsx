/**
 * Planilla de la ronda multisitio de un cruce, con el avance de cada predio
 * (S2-6; referencias docs/diseno/v2/06 y 07). Es la planilla de siempre
 * (PlanillaRonda) sobre la serie `multisitio`, más el predio de cada individuo,
 * que sale de su emplazamiento vigente (obtener_resumen_individuos). Solo
 * avance: nunca ranking ni comparación de puntajes entre predios.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { obtenerResumenIndividuos } from '@/api/individuos';
import { useAuth } from '@/features/auth/AuthContext';
import { nombreCorto } from '@/lib/nombres';
import { PlanillaRonda } from '@/features/evaluaciones/PlanillaRonda';
import { Alert } from '@/components/ui/alert';
import { qk } from '@/lib/queryKeys';
import { rutaEvaluarMultisitio } from '@/lib/rutasIndividuo';
import { parametrosRecorrido } from '@/features/evaluaciones/recorrido';

export function PlanillaMultisitio({ plantaId, onAbrir }: {
  plantaId: string;
  /** Abre el individuo en el expediente (pestaña Individuos), donde se registra su traslado. */
  onAbrir: (individuoId: string) => void;
}) {
  const navigate = useNavigate();
  const { esAdmin, perfil } = useAuth();
  // Misma consulta (y caché) que la pestaña Individuos.
  const resumen = useQuery({ queryKey: qk.individuos.resumen(plantaId), queryFn: () => obtenerResumenIndividuos(plantaId) });
  const datos = resumen.data;
  const predioDe = useCallback((individuoId: string) => datos?.[individuoId]?.emplazamiento_predio_nombre ?? null, [datos]);

  if (resumen.isPending) return <p role="status" className="text-small text-ink-3">Cargando predios…</p>;
  return (
    <div className="space-y-4">
      {resumen.isError && <Alert>No se pudo cargar el predio de cada individuo: la planilla se muestra sin el avance por predio.</Alert>}
      <PlanillaRonda
        plantaId={plantaId}
        esAdmin={esAdmin}
        miNombre={nombreCorto(perfil?.nombre)}
        tipo="multisitio"
        predioDe={resumen.isError ? undefined : predioDe}
        onAbrir={onAbrir}
        onEvaluar={(individuoId, contexto) => navigate(`${rutaEvaluarMultisitio(plantaId, individuoId)}${contexto ? `?${parametrosRecorrido(contexto.filtro, contexto.planilla)}` : ''}`)}
      />
    </div>
  );
}
