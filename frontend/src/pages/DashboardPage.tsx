/**
 * Inicio (v3, paso 5; docs/rediseno_v3/inicio_cruces.md). Mobile-first: lo primero es continuar el trabajo o
 * escanear el QR que se tiene delante. Del Panel científico entra lo útil para decidir qué hacer hoy (N21): la
 * actividad pendiente (todos) y, para el admin, el resumen en 4 cifras y los cambios recientes. Una sola llamada
 * a `obtener_dashboard_cientifico` con límite 5; los «Ver todo» van a Cruces con pendientes y a Resultados (paso 7) [Provisional].
 * Fase 4: todo se cuenta en la especie activa del encabezado; con «Todas las especies», Inicio muestra el panorama.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Activity, AlertCircle, ArrowRight, Leaf, MessageSquareWarning, Plus, QrCode } from 'lucide-react';
import { listarPlantasPagina } from '@/api/plantas';
import { obtenerDashboardCientifico, type CambioReciente } from '@/api/dashboard';
import { listarCorreccionesPedidas } from '@/api/correcciones';
import { ESTADO_LABEL, type EstadoPlanta } from '@/types/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { useAuth } from '@/features/auth/AuthContext';
import { useEspacioEspecie } from '@/features/especies/EspacioEspecie';
import { Panorama } from '@/features/especies/Panorama';
import { formatearActividad } from '@/lib/v3/formatos';
import { useIncluirPruebas } from '@/lib/preferencias';
import { qk } from '@/lib/queryKeys';
import { compararCodigos } from '@/lib/ordenNatural';

const NO_ACTIVOS: EstadoPlanta[] = ['sin_empezar', 'proceso_finalizado'];
const TIPO_CAMBIO: Record<CambioReciente['tipo'], string> = {
  cambio_etapa: 'Cambio de fase',
  registro_campo: 'Registro de campo',
  evaluacion: 'Evaluación',
};

function Bloque({ titulo, icono, accion, children }: { titulo: string; icono: React.ReactNode; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface p-4" aria-label={titulo}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-body font-semibold text-ink">{icono}{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}

const verTodo = (to: string, etiqueta = 'Ver todo') => (
  <Link to={to} className="inline-flex min-h-tap items-center text-small font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{etiqueta}</Link>
);

export function DashboardPage() {
  const { perfil, esAdmin } = useAuth();
  const [incluirPruebas] = useIncluirPruebas();
  const { activa, panorama } = useEspacioEspecie();
  const especieId = activa?.id;
  // Los 5 activos con cambio de fase más reciente, filtrados y paginados en el servidor (B8); sin cruces de prueba salvo la opción de admin.
  const recientes = useQuery({
    queryKey: qk.plantas.lista({ inicio: 'recientes', incluirPruebas, especieId }),
    queryFn: () => listarPlantasPagina({ excluirEstados: NO_ACTIVOS, incluirPruebas, especieId }, { limite: 5 }),
    enabled: !!especieId,
  });
  const panel = useQuery({
    queryKey: [...qk.dashboard.all, 'inicio', incluirPruebas, especieId],
    queryFn: () => obtenerDashboardCientifico(especieId, 5, incluirPruebas),
    enabled: !!especieId,
  });

  // Fase 5 (G15): los pedidos de corrección abiertos, solo para el admin; se muestran los de la especie activa.
  const pedidas = useQuery({ queryKey: qk.evaluaciones.pedidosAbiertos, queryFn: listarCorreccionesPedidas, enabled: esAdmin });
  const pedidasEspecie = (pedidas.data ?? []).filter((p) => p.especie_id === especieId);

  // «N activos» cuenta lo mismo que la lista de abajo (sin Sin empezar ni Fin ni cruces de prueba): sale del panorama de la especie.
  const activos = panorama?.find((p) => p.id === especieId)?.cruces_activos;
  const datos = panel.data;

  if (!activa) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-title font-semibold">Hola, {perfil?.nombre ?? '…'}</h1>
          <p className="text-body text-ink-2">Elige una especie para continuar, o escanea el QR que tienes delante.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:max-w-xl sm:grid-cols-2">
          <Link to="/escanear"><Button size="lg" className="w-full"><QrCode className="h-5 w-5" /> Escanear QR</Button></Link>
        </div>
        <Panorama />
      </div>
    );
  }

  const continuar = (
    <Bloque titulo="Continuar trabajo" icono={<Leaf className="h-4 w-4 text-primary" aria-hidden="true" />} accion={activos !== undefined ? verTodo('/plantas', `${activos} activos`) : undefined}>
      {recientes.isLoading ? <EstadoCargando etiqueta="Cargando cruces…" /> : recientes.isError ? (
        <EstadoError mensaje="No se pudieron cargar los cruces." onReintentar={() => void recientes.refetch()} />
      ) : (recientes.data?.items.length ?? 0) === 0 ? (
        <EstadoVacio titulo="No hay cruces activos para continuar." />
      ) : (
        <ul className="divide-y divide-line-soft">
          {recientes.data?.items.map((cruce) => (
            <li key={cruce.id}>
              <Link to={`/planta/${cruce.id}`} state={{ volverA: '/' }} className="flex min-h-tap items-center gap-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="shrink-0 font-mono text-sm font-semibold">{cruce.codigo_sistema}</span>
                <span className="min-w-0 flex-1 truncate text-small text-ink-3">{cruce.especie_nombre}</span>
                <Badge variant="outline" className="shrink-0">{ESTADO_LABEL[cruce.estado]}</Badge>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Bloque>
  );

  const pendiente = (
    <Bloque titulo="Actividad pendiente" icono={<AlertCircle className="h-4 w-4 text-warn" aria-hidden="true" />} accion={verTodo('/plantas?pendientes=1')}>
      {panel.isLoading ? <EstadoCargando etiqueta="Cargando pendientes…" /> : panel.isError ? (
        <EstadoError mensaje="No se pudo cargar la actividad pendiente." onReintentar={() => void panel.refetch()} />
      ) : (datos?.pendientes.length ?? 0) === 0 ? (
        <EstadoVacio titulo="No hay cruces con individuos sin evaluación cerrada." />
      ) : (
        <ul className="divide-y divide-line-soft">
          {[...(datos?.pendientes ?? [])].sort((a, b) => b.individuos_pendientes - a.individuos_pendientes || compararCodigos(a.codigo_sistema, b.codigo_sistema)).map((p) => (
            <li key={p.planta_id}>
              <Link to={`/planta/${p.planta_id}`} state={{ volverA: '/' }} className="flex min-h-tap items-center gap-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="shrink-0 font-mono text-sm font-semibold">{p.codigo_sistema}</span>
                <span className="min-w-0 flex-1 truncate text-small text-ink-3">{ESTADO_LABEL[p.estado]}</span>
                {/* N26: se cuenta como la planilla (vivos sin evaluación cerrada en la última ronda). */}
                <span className="ml-auto shrink-0 text-small font-medium tabular-nums text-warn">{p.individuos_pendientes} sin evaluación cerrada</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Bloque>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-title font-semibold">Hola, {perfil?.nombre ?? '…'}</h1>
        <p className="text-body text-ink-2">Continúa una tarea o escanea el QR que tienes delante.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:max-w-xl sm:grid-cols-2">
        <Link to="/escanear"><Button size="lg" className="w-full"><QrCode className="h-5 w-5" /> Escanear QR</Button></Link>
        <Link to="/plantas"><Button size="lg" variant="outline" className="w-full"><Leaf className="h-5 w-5" /> Buscar un cruce</Button></Link>
      </div>

      {incluirPruebas && <p role="status" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-small text-ink-2">Se incluyen los cruces de prueba (opción del menú de cuenta).</p>}

      <div className={esAdmin ? 'grid items-start gap-4 lg:grid-cols-2' : 'space-y-4'}>
        <div className="space-y-4">
          {continuar}
          {pendiente}
        </div>
        {esAdmin && (
          <div className="space-y-4">
            <Bloque titulo="Correcciones pedidas" icono={<MessageSquareWarning className="h-4 w-4 text-warn" aria-hidden="true" />}>
              {pedidas.isLoading ? <EstadoCargando etiqueta="Cargando correcciones pedidas…" /> : pedidas.isError ? (
                <EstadoError mensaje="No se pudieron cargar las correcciones pedidas." onReintentar={() => void pedidas.refetch()} />
              ) : pedidasEspecie.length === 0 ? (
                <EstadoVacio titulo="No hay correcciones pedidas." />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {pedidasEspecie.map((p) => (
                    <li key={p.id}>
                      <Link to={`/planta/${p.planta_id}/evaluacion/${p.evaluacion_id}`} state={{ volverA: '/' }} className="block min-h-tap space-y-0.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <span className="flex flex-wrap items-baseline gap-x-3">
                          <span className="font-mono text-sm font-semibold">{p.codigo_display}</span>
                          <span className="text-small text-ink-3">Ronda {p.numero_ronda}</span>
                          <span className="ml-auto text-small tabular-nums text-ink-3">{p.pedido_por} · {formatearActividad(p.pedido_en)}</span>
                        </span>
                        <span className="block truncate text-small text-ink-2">«{p.nota}»</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Bloque>
            <Bloque titulo="Resumen" icono={<Activity className="h-4 w-4 text-primary" aria-hidden="true" />}>
              {panel.isLoading ? <EstadoCargando etiqueta="Cargando resumen…" /> : datos ? (
                <dl className="grid grid-cols-2 gap-3">
                  {([
                    ['Cruces activos', datos.resumen.cruces_activos],
                    ['Individuos vivos', datos.resumen.individuos_vivos],
                    ['Evaluaciones en 30 días', datos.resumen.evaluaciones_ultimos_30_dias],
                    ['Cruces con pendientes', datos.resumen.cruces_con_pendientes],
                  ] as const).map(([etiqueta, valor]) => (
                    <div key={etiqueta} className="rounded-md bg-surface-2 p-3">
                      <dt className="text-small text-ink-3">{etiqueta}</dt>
                      <dd className="text-title font-semibold tabular-nums text-ink">{valor}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Bloque>
            <Bloque titulo="Cambios recientes" icono={<Activity className="h-4 w-4 text-primary" aria-hidden="true" />} accion={verTodo('/resultados')}>
              {panel.isLoading ? <EstadoCargando etiqueta="Cargando cambios…" /> : (datos?.cambios_recientes.length ?? 0) === 0 ? (
                <EstadoVacio titulo="No hay actividad reciente." />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {datos?.cambios_recientes.map((c) => (
                    <li key={`${c.planta_id}-${c.fecha}`}>
                      <Link to={`/planta/${c.planta_id}`} state={{ volverA: '/' }} className="flex min-h-tap flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <span className="font-mono text-sm font-semibold">{c.codigo_sistema}</span>
                        <span className="text-small text-ink-2">{TIPO_CAMBIO[c.tipo]} · {ESTADO_LABEL[c.estado]}</span>
                        <span className="ml-auto text-small tabular-nums text-ink-3">{formatearActividad(c.fecha)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Bloque>
          </div>
        )}
      </div>

      {esAdmin && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="mr-auto text-small text-ink-3">Administración</span>
          <Link to="/nueva-planta"><Button variant="outline" size="sm"><Plus className="h-4 w-4" /> Nuevo cruce</Button></Link>
          <Link to="/resultados"><Button variant="ghost" size="sm">Ver resultados</Button></Link>
        </div>
      )}
    </div>
  );
}
