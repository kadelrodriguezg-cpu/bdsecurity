/** Comparar rondas de un individuo (Fase 2, S3-3; referencia docs/diseno/v2/05). Se llega desde la evaluación pasada. */
import { useParams } from 'react-router';
import { CompararRondasIndividuo } from '@/features/comparacion/CompararRondasIndividuo';

export function CompararRondasPage() {
  const { id: plantaId = '', individuoId = '' } = useParams();
  return <CompararRondasIndividuo plantaId={plantaId} individuoId={individuoId} />;
}
