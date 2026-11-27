/**
 * Resumen (siempre visible, sin importar si el formulario de carga está
 * disponible ahora) de las evaluaciones reducidas ya cargadas de una fase.
 * Separado de EvaluacionReducidaForm (que ahora es un formulario puro para
 * el modal) — North Star v5, rediseño de UX Parte D.
 */
import { useQuery } from '@tanstack/react-query';
import { listarEvaluacionesReducidas, type FaseEvaluacionReducida } from '@/api/evaluacionReducida';
import { qk } from '@/lib/queryKeys';
import { formatearFechaCivil } from '@/lib/fechas';

export function EvaluacionReducidaResumen({ individuoId, fase }: { individuoId: string; fase: FaseEvaluacionReducida }) {
  const { data: previas, isLoading } = useQuery({
    queryKey: qk.evaluacionReducida.individuo(individuoId, fase),
    queryFn: () => listarEvaluacionesReducidas(individuoId, fase),
  });

  if (isLoading) return <p className="text-xs text-ink-3">Cargando…</p>;
  if (!previas || previas.length === 0) {
    return <p className="text-xs text-ink-3">Todavía no hay evaluaciones cargadas.</p>;
  }

  return (
    <ul className="divide-y text-xs">
      {previas.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-3 py-1.5">
          <span className="text-ink-3">{formatearFechaCivil(p.created_at)}</span>
          {p.talla != null && <span>Talla: <strong>{p.talla}</strong></span>}
          {p.numero_entrenudos != null && <span>Entrenudos: <strong>{p.numero_entrenudos}</strong></span>}
          {p.vigor != null && <span>Vigor: <strong>{p.vigor}</strong></span>}
          {p.multibrotes != null && <span>Multibrotes: <strong>{p.multibrotes}</strong></span>}
          {p.presencia_raices != null && <span>Raíces: <strong>{p.presencia_raices}</strong></span>}
          {p.observaciones && <span className="text-ink-3">Obs.: {p.observaciones}</span>}
        </li>
      ))}
    </ul>
  );
}
