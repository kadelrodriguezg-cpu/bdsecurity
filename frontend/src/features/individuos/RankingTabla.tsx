/**
 * Ranking del cruce dentro de la ficha. Desde la Fase 2 es el mismo ranking
 * por grupos de la página /ranking (mismo componente y misma consulta): no
 * puede haber dos rankings que digan cosas distintas. «Congelar ranking»
 * congela ese mismo ranking (congelar_ranking_grupos).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { congelarRankingGrupos, obtenerRankingPorGrupos } from '@/api/rankingGrupos';
import type { Individuo } from '@/api/individuos';
import { qk } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useAuth } from '@/features/auth/AuthContext';
import { RankingGeneral } from '@/features/ranking/RankingGeneral';
import { hoyChileISO } from '@/lib/fechas';

export function RankingTabla({ plantaId, individuos }: { plantaId: string; individuos: Individuo[] }) {
  const { esAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [snapshotCreado, setSnapshotCreado] = useState<string | null>(null);
  // Misma clave que RankingGeneral con este alcance: una sola lectura.
  const ranking = useQuery({
    queryKey: qk.ranking.grupos({ plantaId, especieId: undefined, incluirPruebas: false }),
    queryFn: () => obtenerRankingPorGrupos({ plantaId, especieId: undefined, incluirPruebas: false }),
  });

  const snapshot = useMutation({
    mutationFn: () => congelarRankingGrupos({ plantaId, nombre: `Ranking de cruzamiento ${hoyChileISO()}` }),
    onSuccess: (id) => {
      setSnapshotCreado(id);
      // La pestaña Snapshots de /ranking usa la misma clave.
      void queryClient.invalidateQueries({ queryKey: qk.snapshots.all });
    },
  });

  const noVivos = individuos.filter((individuo) => individuo.estado_vital !== 'vivo').length;
  const conPosicion = ranking.data?.poblacion.con_posicion ?? 0;

  return (
    <div className="space-y-3">
      {(noVivos > 0 || (esAdmin && conPosicion > 0)) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-ink-3">{noVivos > 0 ? `${noVivos} no vivos fuera del ranking.` : ''}</p>
          {esAdmin && conPosicion > 0 && (
            <Button type="button" variant="outline" disabled={snapshot.isPending} onClick={() => snapshot.mutate()}>
              <Camera className="h-4 w-4" />
              {snapshot.isPending ? 'Congelando…' : 'Congelar ranking'}
            </Button>
          )}
        </div>
      )}
      {snapshotCreado && <Alert variant="success">Ranking congelado. Lo encuentras en Resultados, opción «Congelado…».</Alert>}
      {snapshot.isError && <Alert>No se pudo congelar el ranking: {snapshot.error.message}</Alert>}
      <RankingGeneral plantaId={plantaId} />
    </div>
  );
}
