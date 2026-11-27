/**
 * Historial de correcciones de las evaluaciones de un individuo (decisión A8; migración 20261024100000). Lo ven el
 * admin y el operario: quién corrigió (solo el nombre, N15), cuándo y por qué.
 */
import { useQuery } from '@tanstack/react-query';
import { obtenerCorrecciones, type Correccion } from '@/api/correcciones';
import { formatearFechaHora } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';

export function useCorrecciones(individuoId: string, habilitado = true) {
  return useQuery({ queryKey: qk.evaluaciones.correcciones(individuoId), queryFn: () => obtenerCorrecciones(individuoId), staleTime: 30_000, enabled: habilitado });
}

export function textoCorreccion(c: Correccion): string {
  return `Corregida por ${c.corregido_por} el ${formatearFechaHora(c.fecha)}${c.motivo ? ` · Motivo: ${c.motivo}` : ''}`;
}

/** Todas las correcciones de una evaluación, la más reciente primero (para la lectura de la evaluación). */
export function HistorialCorrecciones({ individuoId, evaluacionId }: { individuoId: string; evaluacionId: string }) {
  const correcciones = useCorrecciones(individuoId);
  const deEsta = (correcciones.data ?? []).filter((c) => c.evaluacion_id === evaluacionId);
  if (correcciones.isPending) return null;
  if (correcciones.isError) return <p className="text-small text-ink-3">No se pudo leer el historial de correcciones.</p>;
  if (deEsta.length === 0) return null;
  return (
    <section aria-label="Correcciones" className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-body-l font-semibold text-ink">Correcciones</h2>
      <ul className="space-y-1.5 text-small text-ink-2">
        {deEsta.map((c) => <li key={`${c.fecha}-${c.motivo}`}>{textoCorreccion(c)}</li>)}
      </ul>
    </section>
  );
}
