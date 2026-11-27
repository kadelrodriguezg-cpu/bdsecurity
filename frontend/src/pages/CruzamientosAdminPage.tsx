/**
 * Administración de cruzamientos (solo admin): reiniciar, archivar y purgar.
 * North Star v4, sección 9. Mismo patrón de acceso que Usuarios/Catálogos
 * (AdminRoute + RLS).
 *
 * Archivar (soft) sirve para CUALQUIER cruce y es reversible.
 *
 * Purgar (hard) es una acción aparte, visible SOLO para cruces marcados como
 * prueba (`es_prueba`). Para un cruce real el control no se renderiza: su
 * linaje genético es información histórica que no se destruye. Esto es UX,
 * no seguridad — `borrar_cruzamiento` rechaza igual en el backend.
 *
 * Salvaguarda obligatoria antes de purgar: se consulta el resumen real
 * (individuos/evaluaciones/PCR/eventos) ANTES de habilitar el botón final, y
 * se exige escribir el código del cruce para confirmar — más fricción que
 * archivar, a propósito.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ArchiveRestore, ChevronLeft, ChevronRight, Plus, RotateCcw, Search, Trash2, AlertTriangle } from 'lucide-react';
import {
  listarTodosLosCruces,
  reiniciarCruzamiento,
  borrarCruzamiento,
  restaurarCruzamiento,
  resumenParaBorrado,
  type CruceAdmin,
} from '@/api/cruzamientosAdmin';
import { ESTADO_LABEL } from '@/types/domain';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Select } from '@/components/ui/select';
import { EncabezadoPagina, EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';

type FiltroEliminados = 'todos' | 'activos' | 'eliminados';
const CRUCES_POR_PAGINA = 12;

export function PanelReiniciar({ cruce, onCerrar }: { cruce: CruceAdmin; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ n_individuos_preexistentes: number } | null>(null);

  const mutacion = useMutation({
    mutationFn: () => reiniciarCruzamiento(cruce.id),
    onSuccess: (res) => {
      setError(null);
      setResultado(res);
      void queryClient.invalidateQueries({ queryKey: qk.adminCruces.all });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo reiniciar el cruce.'),
  });

  if (resultado) {
    return (
      <div className="space-y-2 rounded-md border border-brand-c bg-brand-l p-3 text-sm">
        <p>Cruce <strong>{cruce.codigo_sistema}</strong> reiniciado: volvió a «Sin empezar» y se borraron sus datos de fase.</p>
        {resultado.n_individuos_preexistentes > 0 && (
          <Alert>
            Este cruce ya tenía <strong>{resultado.n_individuos_preexistentes}</strong> individuo(s) creado(s) — no se tocaron,
            siguen existiendo aunque el cruce volvió a "Sin empezar". Revisa si esto es lo esperado.
          </Alert>
        )}
        <Button size="sm" variant="outline" onClick={onCerrar}>Cerrar</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-danger bg-danger-l p-3 text-sm text-danger">
      <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" /> Reiniciar «{cruce.codigo_sistema}»</p>
      <p>Se borran los datos de fase (Polinización/Cosecha/Siembra/Germinación/Traslado) y el historial de este cruce. El cruce vuelve a «Sin empezar». No se toca a los individuos si ya existen.</p>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" onClick={() => mutacion.mutate()} disabled={mutacion.isPending}>
          {mutacion.isPending ? 'Reiniciando…' : 'Confirmar reinicio'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCerrar}>Cancelar</Button>
      </div>
    </div>
  );
}

export function PanelBorrar({ cruce, onCerrar }: { cruce: CruceAdmin; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<'soft' | 'hard' | null>(null);
  const [confirmacionTexto, setConfirmacionTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  const { data: resumen, isLoading: cargandoResumen } = useQuery({
    queryKey: qk.adminCruces.resumenBorrado(cruce.id),
    queryFn: () => resumenParaBorrado(cruce.id),
    enabled: tipo === 'hard',
  });

  const mutacion = useMutation({
    mutationFn: () => borrarCruzamiento(cruce.id, tipo!),
    onSuccess: () => {
      setError(null);
      setHecho(true);
      void queryClient.invalidateQueries({ queryKey: qk.adminCruces.all });
      void queryClient.invalidateQueries({ queryKey: qk.adminCruces.resumenBorrado(cruce.id) });
      void queryClient.invalidateQueries({ queryKey: qk.ranking.all });
      void queryClient.invalidateQueries({ queryKey: qk.resumenFinal.all });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo borrar el cruce.'),
  });

  if (hecho) {
    return (
      <div className="space-y-2 rounded-md border border-line-strong bg-surface-2 p-3 text-sm">
        <p>
          Cruce <strong>{cruce.codigo_sistema}</strong>{' '}
          {tipo === 'soft' ? 'archivado; se puede restaurar.' : 'purgado definitivamente.'}
        </p>
        <Button size="sm" variant="outline" onClick={onCerrar}>Cerrar</Button>
      </div>
    );
  }

  const tieneHistorialTerritorial = (resumen?.n_emplazamientos ?? 0) > 0;
  // Datos científicos reales colados en un cruce de prueba: el backend
  // (PUERTA 2 de borrar_cruzamiento) rechaza la purga, así que acá tampoco se
  // habilita el botón. Es la razón de ser del bloqueo — el caso conocido de
  // "cruce de prueba con individuos reales adjuntos".
  const tieneEvaluacionesReales = (resumen?.n_evaluaciones_terminadas ?? 0) > 0;
  const purgaBloqueada = tieneHistorialTerritorial || tieneEvaluacionesReales;
  const puedeConfirmarHard = resumen && !purgaBloqueada && confirmacionTexto.trim() === cruce.codigo_sistema;

  return (
    <div className="space-y-3 rounded-md border border-danger bg-danger-l p-3 text-sm text-danger">
      <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" /> Eliminar «{cruce.codigo_sistema}»</p>

      {!tipo && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setTipo('soft')}>Archivar (recuperable)</Button>
          {/* La purga solo existe para cruces de prueba. Para un cruce real
              este botón no se renderiza en absoluto, no queda deshabilitado:
              no hay ninguna ruta de UI hacia el hard delete de datos reales. */}
          {cruce.es_prueba && (
            <Button size="sm" variant="destructive" onClick={() => setTipo('hard')}>Purgar cruce de prueba (irreversible)</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCerrar}>Cancelar</Button>
        </div>
      )}
      {!tipo && !cruce.es_prueba && (
        <p className="text-xs">
          Este cruce no está marcado como cruce de prueba, así que solo se puede archivar. Los cruces reales no se
          eliminan de forma permanente: su linaje genético es información histórica.
        </p>
      )}

      {tipo === 'soft' && (
        <>
          <p>El cruce se oculta de los listados normales pero sigue en la base, recuperable. No borra nada de sus datos.</p>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => mutacion.mutate()} disabled={mutacion.isPending}>
              {mutacion.isPending ? 'Archivando…' : 'Confirmar archivo'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setTipo(null)}>Volver</Button>
          </div>
        </>
      )}

      {tipo === 'hard' && (
        <>
          {cargandoResumen ? (
            <p>Calculando qué se va a perder…</p>
          ) : resumen ? (
            <div className="space-y-2">
              {tieneEvaluacionesReales && (
                <Alert>
                  Este cruce está marcado como prueba, pero tiene {resumen.n_evaluaciones_terminadas} evaluación(es)
                  terminada(s) — alguien registró datos reales sobre él. <strong>No se puede purgar.</strong> Revisa
                  esas evaluaciones, o usa «Archivar (recuperable)» en su lugar.
                </Alert>
              )}
              {tieneHistorialTerritorial && (
                <Alert>
                  Este cruce tiene {resumen.n_emplazamientos} registro(s) de historial territorial
                  (traslados/multisitio), que nunca se elimina: es parte del historial y no se puede borrar. <strong>No se puede purgar.</strong> Usa «Archivar (recuperable)» en su lugar.
                </Alert>
              )}
              {/* El conteo se muestra SIEMPRE, incluso cuando la purga está
                  bloqueada: es la información con la que el humano decide. */}
              <p className="font-semibold">
                {resumen.n_individuos > 0
                  ? `Este cruce tiene ${resumen.n_individuos} individuo(s), ${resumen.n_evaluaciones} evaluación(es) (${resumen.n_evaluaciones_terminadas} terminada(s)), ${resumen.n_pcr} PCR y ${resumen.n_registros_evento} evento(s) de historial.`
                  : `Este cruce no tiene individuos. Cuelgan de él ${resumen.n_registros_evento} evento(s) de historial.`}
                {!purgaBloqueada && ' Se eliminarán todos permanentemente. Esta acción es irreversible.'}
              </p>
              {!purgaBloqueada && (
                <div className="space-y-1">
                  <Label htmlFor="confirmar-codigo">Escribe el código del cruce (<strong>{cruce.codigo_sistema}</strong>) para confirmar</Label>
                  <Input id="confirmar-codigo" value={confirmacionTexto} onChange={(e) => setConfirmacionTexto(e.target.value)} />
                </div>
              )}
              {error && <Alert>{error}</Alert>}
              <div className="flex gap-2">
                {!purgaBloqueada && (
                  <Button size="sm" variant="destructive" onClick={() => mutacion.mutate()} disabled={!puedeConfirmarHard || mutacion.isPending}>
                    {mutacion.isPending ? 'Purgando…' : 'Purgar permanentemente'}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setTipo(null)}>Volver</Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function PanelRestaurar({ cruce, onCerrar }: { cruce: CruceAdmin; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const restauracion = useMutation({
    mutationFn: () => restaurarCruzamiento(cruce.id),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.adminCruces.all });
      void queryClient.invalidateQueries({ queryKey: qk.plantas.all });
      // Sus individuos vuelven a ser candidatos de ranking (sección 5,
      // mismo patrón verificado en este sprint para EvaluacionForm).
      void queryClient.invalidateQueries({ queryKey: qk.ranking.all });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo restaurar el cruce.'),
  });

  if (restauracion.data) {
    return (
      <div className="space-y-2 rounded-md border border-brand-c bg-brand-l p-3 text-sm">
        <p><strong>{cruce.codigo_sistema}</strong> fue restaurado sin alterar sus relaciones.</p>
        <p className="text-xs text-ink-3">Conserva {restauracion.data.n_individuos} individuos, {restauracion.data.n_evaluaciones} evaluaciones y {restauracion.data.n_emplazamientos} emplazamientos.</p>
        <Button size="sm" variant="outline" onClick={onCerrar}>Cerrar</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-brand-c bg-brand-l p-3 text-sm">
      <p>El cruce volverá a los listados operativos. Sus individuos, evaluaciones e historial territorial no se modificarán.</p>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => restauracion.mutate()} disabled={restauracion.isPending}>{restauracion.isPending ? 'Restaurando…' : 'Confirmar restauración'}</Button>
        <Button size="sm" variant="outline" onClick={onCerrar}>Cancelar</Button>
      </div>
    </div>
  );
}

function FilaCruce({ cruce }: { cruce: CruceAdmin }) {
  const [accion, setAccion] = useState<'reiniciar' | 'borrar' | 'restaurar' | null>(null);

  return (
    <li className="space-y-2 border-b py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{cruce.codigo_sistema}</span>
          <Badge variant="outline">{ESTADO_LABEL[cruce.estado]}</Badge>
          {cruce.es_prueba && <Badge variant="outline">Prueba</Badge>}
          {cruce.eliminado_at && <Badge variant="danger">Archivado</Badge>}
        </div>
        <div className="flex gap-2">
          {cruce.eliminado_at ? (
            <Button size="sm" variant="link" onClick={() => setAccion(accion === 'restaurar' ? null : 'restaurar')}><ArchiveRestore className="h-3.5 w-3.5" /> Restaurar</Button>
          ) : (
            <>
              <Button size="sm" variant="link" onClick={() => setAccion(accion === 'reiniciar' ? null : 'reiniciar')}><RotateCcw className="h-3.5 w-3.5" /> Reiniciar</Button>
              <Button size="sm" variant="link" className="text-danger" onClick={() => setAccion(accion === 'borrar' ? null : 'borrar')}><Trash2 className="h-3.5 w-3.5" /> Eliminar</Button>
            </>
          )}
        </div>
      </div>
      {accion === 'reiniciar' && <PanelReiniciar cruce={cruce} onCerrar={() => setAccion(null)} />}
      {accion === 'borrar' && <PanelBorrar cruce={cruce} onCerrar={() => setAccion(null)} />}
      {accion === 'restaurar' && <PanelRestaurar cruce={cruce} onCerrar={() => setAccion(null)} />}
    </li>
  );
}

export function CruzamientosAdminPage() {
  const { data: cruces, isLoading, isError, refetch } = useQuery({ queryKey: qk.adminCruces.all, queryFn: listarTodosLosCruces });
  // v3 paso 6: la ficha enlaza con ?cruce=<id> y el cruce aparece elegido (administracion.md).
  const [parametros] = useSearchParams();
  const cruceDeLaFicha = parametros.get('cruce');
  // Sprint 8 (3.g): el restore ya existía (botón + audit_log desde Sprint 5)
  // pero sin filtro dedicado; con la lista creciendo, aislar "eliminados"
  // hace la recuperación descubrible sin scrollear entre los activos.
  const [filtro, setFiltro] = useState<FiltroEliminados>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(0);
  const [seleccionId, setSeleccionId] = useState<string | null>(null);

  useEffect(() => {
    const elegido = cruceDeLaFicha ? cruces?.find((cruce) => cruce.id === cruceDeLaFicha) : undefined;
    if (!elegido) return;
    setBusqueda(elegido.codigo_sistema);
    setPagina(0);
    setSeleccionId(elegido.id);
  }, [cruceDeLaFicha, cruces]);

  const cantidadEliminados = useMemo(() => (cruces ?? []).filter((c) => c.eliminado_at !== null).length, [cruces]);

  const crucesFiltrados = useMemo(() => {
    if (!cruces) return cruces;
    const porEstado = filtro === 'activos'
      ? cruces.filter((c) => c.eliminado_at === null)
      : filtro === 'eliminados'
        ? cruces.filter((c) => c.eliminado_at !== null)
        : cruces;
    const termino = busqueda.trim().toLocaleLowerCase('es-CL');
    return termino ? porEstado.filter((c) => c.codigo_sistema.toLocaleLowerCase('es-CL').includes(termino)) : porEstado;
  }, [busqueda, cruces, filtro]);

  const totalPaginas = Math.max(1, Math.ceil((crucesFiltrados?.length ?? 0) / CRUCES_POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas - 1);
  const crucesPagina = crucesFiltrados?.slice(paginaActual * CRUCES_POR_PAGINA, (paginaActual + 1) * CRUCES_POR_PAGINA);
  const cruceSeleccionado = cruces?.find((cruce) => cruce.id === seleccionId) ?? null;

  return (
    <div className="space-y-4">
      <EncabezadoPagina
        titulo="Administrar cruces"
        subtitulo="Reiniciar, archivar de forma recuperable o eliminar definitivamente un cruce. Se ven también los cruces de prueba."
        // El mismo formulario de alta que el atajo de la lista de Cruces (/nueva-planta, el único).
        acciones={<Link to="/nueva-planta"><Button size="sm"><Plus className="h-4 w-4" /> Nuevo cruce</Button></Link>}
      />
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-sm">Seleccionar cruce</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="buscar-cruce-admin">Buscar por código</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <Input
                  id="buscar-cruce-admin"
                  className="pl-9"
                  value={busqueda}
                  placeholder="Ej. 02-001"
                  onChange={(event) => { setBusqueda(event.target.value); setPagina(0); setSeleccionId(null); }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filtro-eliminados">Estado del cruce</Label>
              <Select
                id="filtro-eliminados"
                value={filtro}
                onChange={(event) => { setFiltro(event.target.value as FiltroEliminados); setPagina(0); setSeleccionId(null); }}
              >
                <option value="todos">Todos</option>
                <option value="activos">Solo activos</option>
                <option value="eliminados">Solo archivados ({cantidadEliminados})</option>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <EstadoCargando etiqueta="Cargando cruces…" />
          ) : isError ? (
            <EstadoError mensaje="No se pudieron cargar los cruces." onReintentar={() => void refetch()} />
          ) : crucesPagina?.length === 0 ? (
            <EstadoVacio titulo={filtro === 'eliminados' ? 'No hay cruces archivados.' : 'No hay cruces que coincidan con estos filtros.'} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
              <div className="space-y-3">
                <ul className="divide-y rounded-md border border-line">
                  {crucesPagina?.map((cruce) => (
                    <li key={cruce.id}>
                      <button
                        type="button"
                        aria-pressed={seleccionId === cruce.id}
                        onClick={() => setSeleccionId(cruce.id)}
                        className="flex min-h-tap w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2 aria-pressed:bg-brand-l"
                      >
                        <span className="font-mono text-sm font-semibold">{cruce.codigo_sistema}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant="outline">{ESTADO_LABEL[cruce.estado]}</Badge>
                          {cruce.es_prueba && <Badge variant="warning">Prueba</Badge>}
                          {cruce.eliminado_at && <Badge variant="danger">Archivado</Badge>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between text-xs text-ink-3">
                  <span>{crucesFiltrados?.length ?? 0} cruces · Página {paginaActual + 1} de {totalPaginas}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" aria-label="Página anterior" disabled={paginaActual === 0} onClick={() => { setPagina((valor) => valor - 1); setSeleccionId(null); }}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" aria-label="Página siguiente" disabled={paginaActual + 1 >= totalPaginas} onClick={() => { setPagina((valor) => valor + 1); setSeleccionId(null); }}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-line bg-surface-2 p-3">
                {cruceSeleccionado ? (
                  <ul><FilaCruce cruce={cruceSeleccionado} /></ul>
                ) : (
                  <div className="flex min-h-32 items-center justify-center text-center text-sm text-ink-3">
                    Selecciona un cruce para ver sus acciones administrativas.
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
