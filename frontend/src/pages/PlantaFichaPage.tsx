/**
 * Ficha de planta — la pantalla central del sistema (destino del QR).
 *
 * v3, paso 3 (docs/rediseno_v3/ficha.md): UNA sola ficha para todas las fases
 * (encabezado + pestañas, `FichaConPestanas`). La ficha por zonas de las fases
 * Sin empezar → Trasplante se eliminó: su formulario va en la pestaña «Fase».
 *
 * La lectura pasa por obtener_planta() (RPC auditada). El backend decide qué
 * campos devolver; el frontend elige la variante con fichaTieneLinaje() —
 * o sea, según lo que el backend REALMENTE devolvió, no según lo que el
 * cliente cree que es su rol.
 */
import { useLocation, useNavigate, useParams, useSearchParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, SearchX } from 'lucide-react';
import { obtenerFicha } from '@/api/plantas';
import { useCambioAutomaticoEspecie } from '@/features/especies/EspacioEspecie';
import { listarEspecies } from '@/api/especies';
import { listarIndividuosDePlanta } from '@/api/individuos';
import { type FichaPlanta } from '@/types/domain';
import { FichaConPestanas } from '@/features/plantas/FichaPestanas';
import { Button } from '@/components/ui/button';
import { individuoDesdeBusqueda } from '@/lib/rutasIndividuo';
import { qk } from '@/lib/queryKeys';
import { tipoErrorApi } from '@/api/client';
import { destinoInterno, destinoLogin } from '@/lib/destinoInterno';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function FichaContenido({ ficha, especieNombre, volverA, individuoFocoId }: { ficha: FichaPlanta; especieNombre?: string; volverA: string; individuoFocoId: string | null }) {
  // Misma clave de caché que la lista de individuos: no es una consulta nueva.
  const individuosQuery = useQuery({
    queryKey: qk.individuos.lista(ficha.id),
    queryFn: () => listarIndividuosDePlanta(ficha.id),
  });
  // `?individuo=` apunta a un individuo que no es de este cruce (QR mal armado o de otro cruce): se ignora con un aviso.
  const focoAusente = !!individuoFocoId && individuosQuery.isSuccess && !individuosQuery.data.some((i) => i.id === individuoFocoId);
  return <FichaConPestanas ficha={ficha} especieNombre={especieNombre} volverA={volverA} individuoFocoId={individuoFocoId} focoAusente={focoAusente} />;
}

export function PlantaFichaPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [busqueda] = useSearchParams();
  const individuoFocoId = individuoDesdeBusqueda(busqueda.get('individuo'));
  const rutaActual = `${location.pathname}${location.search}${location.hash}`;
  const contexto = destinoInterno((location.state as { volverA?: unknown } | null)?.volverA, '/plantas');
  const volverA = contexto === rutaActual ? '/plantas' : contexto;
  const idValido = !!id && UUID_RE.test(id);

  const { data: ficha, isLoading, isError, isSuccess, error, refetch, isFetching } = useQuery({
    queryKey: qk.planta.detalle(id ?? ''),
    queryFn: () => obtenerFicha(id!),
    enabled: idValido,
    retry: false, // "no existe" no se arregla reintentando
  });

  const { data: especies } = useQuery({ queryKey: qk.especies.all, queryFn: listarEspecies });
  const especieNombre = especies?.find((e) => e.id === ficha?.especie_id)?.nombre;
  // Fase 4: un cruce de otra especie (búsqueda por código, QR o enlace) cambia el espacio y lo avisa.
  useCambioAutomaticoEspecie(ficha?.especie_id);

  if (!idValido || isError || (isSuccess && !ficha)) {
    const tipo = !idValido ? 'invalido' : tipoErrorApi(error);
    const mensajes = {
      invalido: ['Código no válido', 'El código escaneado no tiene el formato de un cruce de este sistema.'],
      no_encontrado: ['Cruce no encontrado', 'El cruce no existe o ya no está disponible. Comprueba el código o busca otro cruce.'],
      sin_permiso: ['No tienes permiso para ver este cruce', 'Tu cuenta no tiene acceso a esta ficha. Puedes volver a la lista.'],
      sin_sesion: ['Vuelve a iniciar sesión', 'Tu sesión no permite cargar esta ficha. Inicia sesión para continuar.'],
      red: ['No se pudo conectar', 'Revisa tu conexión e intenta cargar la ficha de nuevo.'],
      desconocido: ['No se pudo cargar el cruce', 'Hubo un problema al cargar la ficha. Intenta de nuevo.'],
    } as const;
    const [titulo, mensaje] = mensajes[tipo];
    const reintentable = tipo === 'red' || tipo === 'desconocido';
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <SearchX aria-hidden="true" className="h-12 w-12 text-ink-3" />
        <div role="alert" className="space-y-2">
          <h1 className="text-lg font-semibold">{titulo}</h1>
          <p className="max-w-sm text-sm text-ink-3">{mensaje}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(volverA)}>
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
          {reintentable && <Button size="sm" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? 'Cargando…' : 'Reintentar'}</Button>}
          <Link to={tipo === 'sin_sesion' ? destinoLogin(rutaActual) : '/escanear'} className="inline-flex min-h-tap items-center rounded-md border border-line px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {tipo === 'sin_sesion' ? 'Iniciar sesión' : 'Buscar o escanear otro cruce'}
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !ficha) {
    return <div role="status" aria-label="Cargando ficha" className="space-y-4"><span className="sr-only">Cargando ficha…</span><div aria-hidden="true" className="h-40 animate-pulse rounded-lg bg-neutral-l" /><div aria-hidden="true" className="h-64 animate-pulse rounded-lg bg-neutral-l" /></div>;
  }

  return <FichaContenido ficha={ficha} especieNombre={especieNombre} volverA={volverA} individuoFocoId={individuoFocoId} />;
}
