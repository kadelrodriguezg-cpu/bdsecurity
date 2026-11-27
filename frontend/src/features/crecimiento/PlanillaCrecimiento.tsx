/**
 * Planilla de avance de Crecimiento (S2-6; mismo patrón que la planilla de la
 * Evaluación anual, docs/diseno/v2/01 y 07): una fila por individuo vivo del
 * cruce, en orden de recorrido (número de planta), con el estado de su
 * evaluación reducida: pendiente o hecha, con fecha y quién la cargó. No hay
 * rondas ni borradores. El avance se mide por individuos evaluados, nunca por
 * valores medidos.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, ClipboardList, ScanQrCode, Search } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatearFechaCivil } from '@/lib/fechas';
import { rutaEvaluarCrecimiento } from '@/lib/rutasIndividuo';
import { BarraAvance, ChipEstadoPlanilla, PildorasFiltro } from '@/features/evaluaciones/PlanillaPiezas';
import { Paginacion } from '@/components/shared/Paginacion';
import { usePaginacionUrl } from '@/lib/usePaginacionUrl';
import { buscarPorCodigo } from '@/lib/buscarCodigo';
import { codigoCorto, resumenMedicion, useFilasCrecimiento, type FilaCrecimiento } from './filas';

type Filtro = 'todos' | 'pendientes' | 'hechas';

const CUMPLE: Record<Filtro, (f: FilaCrecimiento) => boolean> = {
  todos: () => true,
  pendientes: (f) => f.estado === 'pendiente',
  hechas: (f) => f.estado === 'hecha',
};
const ETIQUETA_FILTRO: Record<Filtro, string> = { todos: 'Todos', pendientes: 'Pendientes', hechas: 'Hechas' };

const ChipEstado = ({ fila }: { fila: FilaCrecimiento }) => (
  <ChipEstadoPlanilla estado={fila.estado === 'hecha' ? 'completa' : 'pendiente'} texto={fila.estado === 'hecha' ? 'Hecha' : 'Pendiente'} />
);

/** Quién la cargó: «Tú», su nombre (N15) o, si la base aún no lo entrega, «Otra persona». */
function autorDe(f: FilaCrecimiento, usuarioId: string | undefined): string | null {
  const e = f.ultima;
  if (!e) return null;
  if (e.created_by && e.created_by === usuarioId) return 'Tú';
  return e.autor_nombre ?? (e.created_by ? 'Otra persona' : null);
}

export function PlanillaCrecimiento({ plantaId, onAbrir }: {
  plantaId: string;
  /** Abre el individuo en el expediente (pestaña Individuos). */
  onAbrir: (individuoId: string) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { filas = [], isPending, isError, isFetching, refetch } = useFilasCrecimiento(plantaId);
  // En celular se sale a terreno: lo primero son los pendientes (referencia 07).
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const conteos = useMemo(
    () => Object.fromEntries((Object.keys(CUMPLE) as Filtro[]).map((f) => [f, filas.filter(CUMPLE[f]).length])) as Record<Filtro, number>,
    [filas],
  );
  const enCelular = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
  const filtroActivo: Filtro = filtro ?? (enCelular && conteos.pendientes > 0 ? 'pendientes' : 'todos');
  // G14: el número exacto primero. G18: paginación numerada (la página en la URL); cambiar el filtro o la búsqueda vuelve a la 1.
  const visibles = useMemo(
    () => buscarPorCodigo(filas.filter((f) => CUMPLE[filtroActivo](f)), busqueda, (f) => ({ codigo: f.individuo.codigo_display, numero: f.numero })),
    [filas, filtroActivo, busqueda],
  );
  const paginacion = usePaginacionUrl(visibles, { reinicio: [filtroActivo, busqueda] });
  const { pagina } = paginacion;
  const siguiente = filas.find((f) => f.estado === 'pendiente');

  if (isPending) return <p role="status" className="text-small text-ink-3">Cargando planilla de Crecimiento…</p>;
  if (isError) {
    return (
      <Alert>
        No se pudo cargar la planilla de Crecimiento.{' '}
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>Reintentar</Button>
      </Alert>
    );
  }
  if (filas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center">
        <ClipboardList className="h-5 w-5 text-ink-3" aria-hidden="true" />
        <p className="text-body text-ink-3">Este cruce todavía no tiene individuos vivos para evaluar.</p>
      </div>
    );
  }

  const evaluar = (f: FilaCrecimiento) => navigate(rutaEvaluarCrecimiento(plantaId, f.individuo.id));
  const hechas = conteos.hechas;
  const recorrido = filas.filter((f) => f.estado === 'pendiente').slice(0, 4);
  const accion = (f: FilaCrecimiento) => (f.estado === 'pendiente'
    ? <button type="button" className="min-h-tap px-2 text-small text-brand underline-offset-4 hover:underline" onClick={() => evaluar(f)}>Evaluar</button>
    : <button type="button" className="min-h-tap px-2 text-small text-brand underline-offset-4 hover:underline" onClick={() => onAbrir(f.individuo.id)}>Ver</button>);
  // Celular: la fila entera es el botón; una pendiente abre la evaluación, una hecha el expediente.
  const tocarFila = (f: FilaCrecimiento) => (f.estado === 'pendiente' ? evaluar(f) : onAbrir(f.individuo.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 space-y-1.5 sm:min-w-[18rem]">
          <p className="text-body text-ink">
            <span className="font-semibold">Evaluación reducida</span>
            <span className="text-ink-3"> · crecimiento · </span>
            <span className="tabular-nums">{hechas} de {filas.length} evaluados</span>
          </p>
          <BarraAvance etiqueta="Avance de la evaluación de Crecimiento" avance={{ vivos: filas.length, completas: hechas, pendientes: conteos.pendientes }} />
        </div>
        <p className="min-w-0 max-w-sm flex-1 text-small text-ink-2 max-md:hidden">
          Talla, entrenudos, vigor, multibrotes y raíces de cada individuo vivo. Un individuo puede tener más de una evaluación; aquí se ve la última.
        </p>
        {siguiente && (
          <Button size="sm" className="max-md:min-h-[52px] max-md:w-full max-md:text-body-l" onClick={() => evaluar(siguiente)}>
            Evaluar siguiente · <span className="font-mono">{codigoCorto(siguiente.individuo.codigo_display)}</span>
          </Button>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-tap min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink-3 md:max-w-xs">
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">Buscar individuo por número o código</span>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Número o código"
                className="min-w-0 flex-1 bg-transparent py-2 text-body text-ink outline-none placeholder:text-ink-3"
              />
            </label>
            <Button type="button" variant="outline" onClick={() => navigate('/escanear')}>
              <ScanQrCode className="h-4 w-4" aria-hidden="true" /> <span className="max-md:hidden">Escanear </span>QR
            </Button>
          </div>

          <PildorasFiltro
            etiqueta="Filtrar individuos"
            opciones={(Object.keys(CUMPLE) as Filtro[]).map((f) => ({ clave: f, etiqueta: ETIQUETA_FILTRO[f], conteo: conteos[f] }))}
            activa={filtroActivo}
            onElegir={setFiltro}
          />

          {visibles.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-small text-ink-3">Ningún individuo con ese filtro.</p>
          ) : (
            <>
              {/* Escritorio: tabla. */}
              <table className="hidden w-full text-left text-small md:table">
                <caption className="sr-only">Individuos vivos en orden de recorrido</caption>
                <thead className="border-b border-line text-ink-3">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-normal">Individuo</th>
                    <th scope="col" className="py-2 pr-3 font-normal">Estado</th>
                    <th scope="col" className="py-2 pr-3 font-normal">Medido</th>
                    <th scope="col" className="py-2 pr-3 font-normal">Evaluador</th>
                    <th scope="col" className="py-2 pr-3 font-normal">Fecha</th>
                    <th scope="col" className="py-2 text-right font-normal"><span className="sr-only">Acción</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.map((f) => (
                    <tr key={f.individuo.id} className={cn('border-b border-line-soft', siguiente?.individuo.id === f.individuo.id && 'bg-brand-l')}>
                      <td className="py-1.5 pr-3"><button type="button" className="min-h-tap font-mono text-ink underline-offset-4 hover:text-brand hover:underline" title="Abrir en Individuos" onClick={() => onAbrir(f.individuo.id)}>{codigoCorto(f.individuo.codigo_display)}</button></td>
                      <td className="py-1.5 pr-3"><ChipEstado fila={f} /></td>
                      <td className="py-1.5 pr-3 text-ink-2">{f.ultima ? resumenMedicion(f.ultima) || 'Solo observaciones' : <span className="text-ink-3">—</span>}</td>
                      <td className="max-w-[9rem] truncate whitespace-nowrap py-1.5 pr-3 text-ink-2">{autorDe(f, user?.id) ?? '—'}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-ink-3">{f.ultima ? formatearFechaCivil(f.ultima.created_at) : '—'}</td>
                      <td className="py-1.5 text-right">{accion(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Celular: filas táctiles en orden de recorrido. */}
              <ul className="space-y-2 md:hidden">
                {pagina.map((f) => {
                  const esSiguiente = siguiente?.individuo.id === f.individuo.id;
                  const medido = f.ultima ? resumenMedicion(f.ultima) : '';
                  return (
                    <li key={f.individuo.id}>
                      <button
                        type="button"
                        onClick={() => tocarFila(f)}
                        className={cn('flex min-h-[60px] w-full items-center gap-3 rounded-lg border bg-surface px-4 py-2 text-left',
                          esSiguiente ? 'border-brand ring-1 ring-brand' : 'border-line')}
                      >
                        <span className="w-14 shrink-0 font-mono text-body-l font-semibold text-ink">{codigoCorto(f.individuo.codigo_display)}</span>
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <ChipEstado fila={f} />
                            {f.ultima && <span className="text-small tabular-nums text-ink-3">{formatearFechaCivil(f.ultima.created_at)}</span>}
                            {esSiguiente && <span className="text-small text-brand">siguiente</span>}
                          </span>
                          {medido && <span className="block truncate text-small text-ink-3">{medido}</span>}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>

              <Paginacion estado={paginacion} sufijo={visibles.length !== filas.length ? ` (de ${filas.length} vivos)` : undefined} />
            </>
          )}
        </div>

        {/* Escritorio ancho: lo que sigue en el recorrido. */}
        <aside className="hidden space-y-4 xl:block">
          {recorrido.length > 0 && (
            <section aria-label="Sigue en el recorrido" className="rounded-lg border border-line p-4">
              <h3 className="text-body font-semibold text-ink">Sigue en el recorrido</h3>
              <ul className="mt-2 divide-y divide-line-soft">
                {recorrido.map((f, i) => (
                  <li key={f.individuo.id} className="flex min-h-[44px] items-center gap-3 py-1.5">
                    <span className="w-12 font-mono text-ink">{codigoCorto(f.individuo.codigo_display)}</span>
                    <ChipEstado fila={f} />
                    {i === 0 && <Button size="sm" className="ml-auto" onClick={() => evaluar(f)}>Evaluar</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
