/**
 * Lista de evaluaciones completas ya cargadas de una ronda (más reciente
 * primero). El filtro por tipo de v3 desaparece: la ronda ya agrupa el
 * contexto (Prompt 7 — el número de ronda reemplaza a `evaluaciones.tipo`).
 * Cada evaluación lleva a LA lectura de evaluación (`/planta/:id/evaluacion/:id`,
 * v3 paso 3): ya no hay un detalle desplegable propio. Solo lectura.
 */
import { formatearFecha } from '@/lib/v3/formatos';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { listarEvaluacionesDeRonda, type EvaluacionRow } from '@/api/rondas';
import { qk } from '@/lib/queryKeys';
import { ESTADO_EVALUACION_LABEL, resumenDescriptores } from './DetalleEvaluacion';

/** Una evaluación de la ronda: resumen y enlace a LA lectura de evaluación (`/planta/:id/evaluacion/:id`, v3 paso 3). */
function FilaEvaluacion({ evaluacion, plantaId }: { evaluacion: EvaluacionRow; plantaId?: string }) {
  const { pathname, search } = useLocation();
  const contenido = (
    <>
      <span className="flex items-center gap-1.5">
        <span className="tabular-nums text-ink-2">{formatearFecha(evaluacion.fecha)}</span>
        <span className="text-ink-3">· {resumenDescriptores(evaluacion)}</span>
      </span>
      <span className="flex items-center gap-2 text-ink-3">
        <span className="rounded-full border px-2 py-0.5">{ESTADO_EVALUACION_LABEL[evaluacion.estado]}</span>
        {evaluacion.anio}
        {plantaId && <ChevronRight className="h-3.5 w-3.5 text-brand" aria-hidden="true" />}
      </span>
    </>
  );
  const clase = 'flex min-h-tap w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs';
  return (
    <li className="rounded-md border">
      {plantaId ? (
        <Link
          to={`/planta/${plantaId}/evaluacion/${evaluacion.id}`}
          state={{ volverA: `${pathname}${search}` }}
          aria-label={`Ver la evaluación del ${formatearFecha(evaluacion.fecha)}`}
          className={`${clase} hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
        >
          {contenido}
        </Link>
      ) : <div className={clase}>{contenido}</div>}
    </li>
  );
}

export function EvaluacionesLista({ rondaId, plantaId }: { rondaId: string; plantaId?: string }) {
  const { data: evaluaciones, isLoading } = useQuery({
    queryKey: qk.evaluaciones.ronda(rondaId),
    queryFn: () => listarEvaluacionesDeRonda(rondaId),
  });

  if (isLoading) return <p className="text-xs text-ink-3">Cargando evaluaciones…</p>;

  if (!evaluaciones || evaluaciones.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed py-4 text-center">
        <ClipboardList className="h-5 w-5 text-ink-3" />
        <p className="text-xs text-ink-3">Esta ronda todavía no tiene evaluaciones cargadas.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {evaluaciones.map((ev) => <FilaEvaluacion key={ev.id} evaluacion={ev} plantaId={plantaId} />)}
    </ul>
  );
}
