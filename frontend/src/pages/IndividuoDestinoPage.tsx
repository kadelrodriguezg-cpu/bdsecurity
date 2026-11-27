/**
 * Destino de `/individuo/:id` — lo que abre la cámara nativa del teléfono (o un
 * enlace) con el QR de la etiqueta de un individuo. No tiene contenido propio:
 * resuelve el individuo a su cruce y redirige a la ficha posicionada en su fila.
 *
 * Solo lectura. El escáner de la app resuelve en el mismo paso (EscanearQRPage)
 * con la misma función; esta página existe para los QR que no pasan por él.
 * La ruta vive dentro de ProtectedRoute: sin sesión, el login conserva este
 * destino y vuelve acá.
 */
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { resolverIndividuo } from '@/api/individuos';
import { tipoErrorApi } from '@/api/client';
import { Button } from '@/components/ui/button';
import { destinoInterno, destinoLogin } from '@/lib/destinoInterno';
import { qk } from '@/lib/queryKeys';
import { rutaFichaIndividuo, UUID_COMPLETO_RE } from '@/lib/rutasIndividuo';

export function IndividuoDestinoPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const valido = !!id && UUID_COMPLETO_RE.test(id);
  const individuoId = valido ? id.toLowerCase() : '';

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: qk.individuos.resuelto(individuoId),
    queryFn: () => resolverIndividuo(individuoId),
    enabled: valido,
    retry: false,
    // Una etiqueta se escanea para ver el estado de ahora: nunca reutilizar una resolución vieja.
    staleTime: 0,
  });

  if (valido && data) {
    const volverA = (location.state as { volverA?: unknown } | null)?.volverA;
    return (
      <Navigate
        to={rutaFichaIndividuo(data.planta_id, data.id)}
        replace
        state={volverA === undefined ? undefined : { volverA: destinoInterno(volverA, '/plantas') }}
      />
    );
  }

  if (valido && isLoading) {
    return (
      <div role="status" aria-label="Buscando individuo" className="space-y-4">
        <span className="sr-only">Buscando individuo…</span>
        <div aria-hidden="true" className="h-40 animate-pulse rounded-lg bg-neutral-l" />
      </div>
    );
  }

  const tipo = !valido ? 'invalido' : isError ? tipoErrorApi(error) : 'no_encontrado';
  const mensajes = {
    invalido: ['Código no válido', 'El código escaneado no tiene el formato de un individuo de este sistema.'],
    no_encontrado: ['Individuo no encontrado', 'No existe un individuo con ese código. Revisa la etiqueta o busca el cruce.'],
    sin_permiso: ['No tienes permiso para ver este individuo', 'Tu cuenta no tiene acceso a este individuo.'],
    sin_sesion: ['Vuelve a iniciar sesión', 'Tu sesión no permite abrir este individuo. Inicia sesión para continuar.'],
    red: ['No se pudo conectar', 'Revisa tu conexión e intenta de nuevo.'],
    desconocido: ['No se pudo abrir el individuo', 'Hubo un problema al buscar el individuo. Intenta de nuevo.'],
  } as const;
  const [titulo, mensaje] = mensajes[tipo];
  const reintentable = tipo === 'red' || tipo === 'desconocido';
  const rutaActual = `${location.pathname}${location.search}${location.hash}`;

  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <SearchX aria-hidden="true" className="h-12 w-12 text-ink-3" />
      <div role="alert" className="space-y-2">
        <h1 className="text-lg font-semibold">{titulo}</h1>
        <p className="max-w-sm text-sm text-ink-3">{mensaje}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {reintentable && (
          <Button size="sm" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? 'Cargando…' : 'Reintentar'}
          </Button>
        )}
        <Link
          to={tipo === 'sin_sesion' ? destinoLogin(rutaActual) : '/escanear'}
          className="inline-flex min-h-tap items-center rounded-md border border-line px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {tipo === 'sin_sesion' ? 'Iniciar sesión' : 'Escanear otra etiqueta'}
        </Link>
      </div>
    </div>
  );
}
