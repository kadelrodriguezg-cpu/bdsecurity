/**
 * «Otras vistas» de Resultados (resultados.md; N21): muestran otra cosa que la lista de individuos, por eso son
 * pantallas aparte con «← Resultados» para volver. Mapa territorial y Tendencias reúsan los componentes de la antigua
 * Visualizar (mismo contenido por rol); Polinización por variedad es solo para el admin (la base lo vuelve a exigir).
 */
import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp } from 'lucide-react';
import { obtenerSeriesHistoricas } from '@/api/visualizacion';
import { obtenerRankingPolinizacionVarietal, type RankingPolinizacionVarietalItem, type RolParentalPolinizacion } from '@/api/rankingPolinizacion';
import { useAuth } from '@/features/auth/AuthContext';
import { useEspacioEspecie } from '@/features/especies/EspacioEspecie';
import { HistoricalCharts } from '@/features/visualizacion/HistoricalCharts';
import { TerritorialMap } from '@/features/visualizacion/TerritorialMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTableFrame } from '@/components/ui/data-table-frame';
import { EncabezadoPagina, EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';

/** Fase 4: la especie es la del encabezado; estas vistas ya no tienen selector propio. */
function useEspecie() {
  const [parametros] = useSearchParams();
  const { activa } = useEspacioEspecie();
  const especieId = activa?.id ?? '';
  const selector = null;
  return { especieId, selector, parametros };
}

function Volver({ especieId: _especieId }: { especieId: string }) {
  const { parametro } = useEspacioEspecie();
  return (
    <Link to={`/resultados?especie=${parametro}`} className="inline-flex min-h-tap items-center gap-1 text-small text-brand">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Resultados
    </Link>
  );
}

export function MapaTerritorialPage() {
  const { esAdmin } = useAuth();
  const { especieId, selector } = useEspecie();
  return (
    <div className="space-y-4">
      <Volver especieId={especieId} />
      <EncabezadoPagina titulo="Mapa territorial" subtitulo={esAdmin ? 'Dónde están los cruces y sus individuos, con su ubicación exacta.' : 'Dónde están los cruces y sus individuos, por sitio, predio y sector.'} />
      <div className="max-w-xs">{selector}</div>
      <TerritorialMap especieId={especieId || undefined} />
    </div>
  );
}

export function TendenciasPage() {
  const { especieId, selector } = useEspecie();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const series = useQuery({
    queryKey: qk.visualizacion.series({ especieId, fechaDesde: desde, fechaHasta: hasta }),
    queryFn: () => obtenerSeriesHistoricas({ especieId, fechaDesde: desde || undefined, fechaHasta: hasta || undefined }),
    enabled: !!especieId,
  });
  return (
    <div className="space-y-4">
      <Volver especieId={especieId} />
      <EncabezadoPagina titulo="Tendencias" subtitulo="Series históricas de la especie: puntaje promedio de las evaluaciones comparables, individuos vivos y procedimientos." />
      <div className="flex flex-wrap items-end gap-3">
        {selector}
        <div className="space-y-1"><Label htmlFor="tend-desde">Desde</Label><Input id="tend-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="tend-hasta">Hasta</Label><Input id="tend-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>
      {!especieId ? <EstadoVacio titulo="Elige una especie" descripcion="Las tendencias se leen por especie: elígela en el encabezado." />
        : series.isPending ? <EstadoCargando etiqueta="Cargando las series…" forma="esqueleto" />
          : series.isError ? <EstadoError mensaje="No se pudieron cargar las series." onReintentar={() => void series.refetch()} />
            : <HistoricalCharts scoring={series.data.scoring} individuosVivos={series.data.individuos_vivos} procedimientos={series.data.procedimientos} />}
    </div>
  );
}

type ColumnaPolinizacion = 'variedad_nombre' | 'flores_totales' | 'sesiones_polinizacion' | 'cruces_distintos';
const ROLES: Array<{ valor: RolParentalPolinizacion; etiqueta: string }> = [
  { valor: 'ambos', etiqueta: 'Mamá o papá' },
  { valor: 'mama', etiqueta: 'Solo mamá' },
  { valor: 'papa', etiqueta: 'Solo papá' },
];
const numero = new Intl.NumberFormat('es-CL');
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/** Polinización por variedad (solo admin): sin columna «#», porque no es un ranking de desempeño. */
export function PolinizacionVariedadPage() {
  const { esAdmin } = useAuth();
  const { especieId, selector } = useEspecie();
  const [rol, setRol] = useState<RolParentalPolinizacion>('ambos');
  const [orden, setOrden] = useState<{ columna: ColumnaPolinizacion; dir: 'asc' | 'desc' }>({ columna: 'flores_totales', dir: 'desc' });
  const datos = useQuery({
    queryKey: qk.ranking.polinizacionVarietal(especieId, rol),
    queryFn: () => obtenerRankingPolinizacionVarietal(especieId, rol),
    enabled: esAdmin && !!especieId,
  });
  const filas = useMemo(() => {
    const lista = [...(datos.data?.filas ?? [])];
    const s = orden.dir === 'asc' ? 1 : -1;
    return lista.sort((a, b) => (orden.columna === 'variedad_nombre' ? collator.compare(a.variedad_nombre, b.variedad_nombre) : (a[orden.columna] - b[orden.columna])) * s || collator.compare(a.variedad_nombre, b.variedad_nombre));
  }, [datos.data, orden]);
  if (!esAdmin) return <Navigate to="/resultados" replace />;
  const max = Math.max(0, ...filas.map((f) => f.flores_totales));
  const encabezado = (columna: ColumnaPolinizacion, etiqueta: string) => {
    const activa = orden.columna === columna;
    return (
      <th scope="col" aria-sort={activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-3 py-2 text-left font-medium">
        <button type="button" onClick={() => setOrden(activa ? { columna, dir: orden.dir === 'asc' ? 'desc' : 'asc' } : { columna, dir: columna === 'variedad_nombre' ? 'asc' : 'desc' })} className="inline-flex items-center gap-1 rounded text-small text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {etiqueta}{activa && (orden.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />)}
        </button>
      </th>
    );
  };
  return (
    <div className="space-y-4">
      <Volver especieId={especieId} />
      <EncabezadoPagina
        titulo="Polinización por variedad"
        subtitulo={<><span className="mr-2 inline-flex rounded-full bg-danger-l px-2 py-0.5 text-micro font-medium text-danger">Linaje confidencial · solo admin</span>Actividad de polinización acumulada por variedad parental en los cruces activos de la especie.</>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-4">
          {selector}
          <div className="space-y-1">
            <span className="block text-small font-medium text-ink-2" id="pol-rol">Participación como</span>
            <div role="group" aria-labelledby="pol-rol" className="flex rounded-md border border-line-strong p-0.5">
              {ROLES.map((r) => <Button key={r.valor} size="sm" variant={rol === r.valor ? 'default' : 'ghost'} aria-pressed={rol === r.valor} onClick={() => setRol(r.valor)}>{r.etiqueta}</Button>)}
            </div>
          </div>
        </div>
        <section aria-label="Flores realmente polinizadas" className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-small font-semibold text-ink-2">Flores realmente polinizadas</h2>
          <p className="text-[2rem] font-semibold tabular-nums text-ink">{datos.data ? numero.format(datos.data.resumen.flores_reales) : '—'}</p>
          <p className="text-small text-ink-3">Cada sesión cuenta una sola vez; no es la suma de la tabla.</p>
        </section>
      </div>
      {datos.isPending ? <EstadoCargando etiqueta="Cargando la polinización…" forma="esqueleto" />
        : datos.isError ? <EstadoError mensaje="No se pudo cargar la polinización por variedad." onReintentar={() => void datos.refetch()} />
          : filas.length === 0 ? <EstadoVacio titulo="No hay sesiones de polinización en los cruces activos de esta especie." />
            : (
              <div className="rounded-lg border border-line bg-surface">
                <DataTableFrame label="Polinización por variedad">
                  <table className="w-full min-w-[640px] text-small">
                    <thead className="border-b border-line">
                      <tr>{encabezado('variedad_nombre', 'Variedad parental')}{encabezado('flores_totales', 'Flores asociadas')}{encabezado('sesiones_polinizacion', 'Sesiones')}{encabezado('cruces_distintos', 'Cruces distintos')}</tr>
                    </thead>
                    <tbody>
                      {filas.map((f: RankingPolinizacionVarietalItem) => (
                        <tr key={f.variedad_id} className="border-b border-line-soft last:border-0">
                          <td className="px-3 py-2.5 font-semibold text-ink">{f.variedad_nombre}</td>
                          <td className="px-3 py-2.5">
                            <span className="flex items-center gap-3">
                              <span className="w-12 text-right tabular-nums text-ink">{numero.format(f.flores_totales)}</span>
                              <span aria-hidden="true" className="h-2 flex-1 rounded-full bg-track"><span className="block h-2 rounded-full bg-primary" style={{ width: `${max > 0 ? (f.flores_totales / max) * 100 : 0}%` }} /></span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-ink">{numero.format(f.sesiones_polinizacion)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-ink">{numero.format(f.cruces_distintos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTableFrame>
              </div>
            )}
      <p className="text-small text-ink-3">Ordenado por {orden.columna === 'flores_totales' ? 'flores asociadas' : 'la columna elegida'}. Toca un encabezado para ordenar por otra columna. Sin columna «#»: esto no es un ranking de desempeño.</p>
    </div>
  );
}
