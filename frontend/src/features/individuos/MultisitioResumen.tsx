/** Historial territorial visible para cualquier usuario autenticado. */
import { formatearFecha } from '@/lib/v3/formatos';
import { useQuery } from '@tanstack/react-query';
import { listarEmplazamientos } from '@/api/emplazamientos';
import { qk } from '@/lib/queryKeys';

export function MultisitioResumen({ individuoId }: { individuoId: string }) {
  const { data: historial, isLoading } = useQuery({
    queryKey: qk.territorio.emplazamientos(individuoId),
    queryFn: () => listarEmplazamientos(individuoId),
  });

  if (isLoading) return <p className="text-xs text-ink-3">Cargando…</p>;
  if (!historial || historial.length === 0) return <p className="text-xs text-ink-3">Todavía no hay emplazamientos registrados.</p>;

  return (
    <ul className="divide-y rounded-md border text-xs">
      {historial.map((emplazamiento) => (
        <li key={emplazamiento.id} className="space-y-0.5 px-2 py-1.5">
          <p className="font-medium">{emplazamiento.sitio_nombre} · {emplazamiento.predio_nombre} · {emplazamiento.sector_nombre}</p>
          <p className="text-ink-3">
            {formatearFecha(emplazamiento.fecha_inicio)} — {emplazamiento.fecha_fin ? formatearFecha(emplazamiento.fecha_fin) : 'actual'}
          </p>
        </li>
      ))}
    </ul>
  );
}
