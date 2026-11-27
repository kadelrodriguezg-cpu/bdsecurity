import { useQuery } from '@tanstack/react-query';
import { obtenerUrlFirmadaFotoEvecl } from '@/api/evecl';
import { EstadoError } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';

export function FotoPrivada({ path, alt }: { path: string; alt: string }) {
  const consulta = useQuery({ queryKey: qk.evecl.foto(path), queryFn: () => obtenerUrlFirmadaFotoEvecl(path) });
  if (consulta.isLoading) {
    return (
      <div role="status" aria-busy="true" className="aspect-video rounded-md bg-track motion-safe:animate-pulse">
        <span className="sr-only">Cargando foto privada</span>
      </div>
    );
  }
  if (consulta.isError) {
    return <EstadoError titulo="No se pudo abrir la foto" className="py-4" onReintentar={() => void consulta.refetch()} />;
  }
  return <img src={consulta.data} alt={alt} className="aspect-video w-full rounded-md border border-line object-cover" />;
}
