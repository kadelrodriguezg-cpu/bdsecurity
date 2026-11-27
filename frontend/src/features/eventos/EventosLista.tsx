/**
 * Historial cronológico de eventos de una planta, con miniaturas de fotos.
 * Las fotos viven en un bucket PRIVADO: cada miniatura pide una URL firmada
 * temporal al backend (componente ArchivoAdjunto).
 *
 * Ronda 2 UI (Bloque 4 Paso 2): sobre Workspace/Panel, mismo patrón que
 * GerminacionSeccion — reemplaza el Card + tokens gray-* de la versión
 * anterior. Chips filtran por tipo de evento (fase actual preseleccionada,
 * vía tipoEventoDeEstado); "Ver más" acota la lista sin paginar de verdad
 * (con 5-10 eventos por cruce hoy alcanza). Editar abre un Sheet lateral,
 * mismo patrón que "Editar ensayo EVECL" (EnsayoDetallePage.tsx) — antes
 * era un formulario inline dentro del acordeón.
 *
 * Cada fila sigue siendo un acordeón (colapsado por default, salvo el más
 * reciente) — pensado para historiales largos en pantallas chicas.
 * Editar/eliminar solo se muestran a quien tiene permiso real (autor propio
 * o admin para editar; solo admin para eliminar) — la policy de RLS es la
 * que manda, esto es nada más UX para no ofrecer un botón que el backend va
 * a rechazar.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Camera, ChevronDown, ChevronRight, FileVideo, ImageOff, Paperclip, Pencil, Trash2, X } from 'lucide-react';
import {
  listarEventosDePlanta,
  urlFirmada,
  actualizarEvento,
  eliminarEvento,
  subirBinarioEvento,
  registrarArchivoDeEvento,
  eliminarArchivoDeEvento,
  type ArchivoEvento,
  type RegistroEvento,
} from '@/api/eventos';
import { listarContenedores, listarInsumos, listarPredios, listarSustratos } from '@/api/catalogos';
import { etiquetaContenedor } from '@/lib/contenedores';
import { TIPO_EVENTO_LABEL, tipoEventoDeEstado, type EstadoPlanta, type TipoEvento } from '@/types/domain';
import { useAuth } from '@/features/auth/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { qk } from '@/lib/queryKeys';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Sheet } from '@/components/ui/sheet';
import { Workspace, Panel } from '@/components/ui/workspace';
import { cn } from '@/lib/utils';
import { formatearFechaCivil, formatearFechaHora } from '@/lib/fechas';

/** Cuántos eventos se muestran antes de necesitar "Ver más". */
const TOPE_INICIAL = 5;

const ETIQUETA_DATO_EVENTO: Record<string, string> = {
  fecha: 'Fecha',
  fecha_polinizacion: 'Fecha de polinización',
  n_flores_cruzadas: 'Flores cruzadas',
  fecha_cosecha: 'Fecha de cosecha',
  n_semillas: 'Semillas cosechadas',
  escarificacion_subtipo: 'Tipo de escarificación',
  escarificacion_duracion_dias: 'Duración de escarificación (días)',
  contenedor_id: 'Contenedor',
  insumo_ids: 'Insumos',
  predio_id: 'Predio',
  semillas_sembradas: 'Semillas sembradas',
  sustratos: 'Sustratos',
  cantidad_nueva: 'Cantidad germinada',
};

function etiquetaDatoEvento(clave: string): string {
  return ETIQUETA_DATO_EVENTO[clave]
    ?? clave.replaceAll('_', ' ').replace(/^./, (letra) => letra.toUpperCase());
}

/**
 * Los `datos` de un registro_evento pueden traer FKs crudas de catálogo
 * (contenedor_id, insumo_ids, predio_id, sustratos) — Historial debe mostrar
 * el nombre, nunca el UUID (nunca deben aparecer UUIDs crudos en pantalla).
 * Claves desconocidas caen al render genérico de siempre.
 */
function useMapasCatalogo() {
  const { data: contenedores } = useQuery({ queryKey: qk.catalogos.contenedores.historial, queryFn: () => listarContenedores(false) });
  const { data: insumos } = useQuery({ queryKey: qk.catalogos.insumos.historial, queryFn: () => listarInsumos(false) });
  const { data: predios } = useQuery({ queryKey: qk.catalogos.predios.historial, queryFn: () => listarPredios(false) });
  const { data: sustratos } = useQuery({ queryKey: qk.catalogos.sustratos.historial, queryFn: () => listarSustratos(false) });

  return {
    contenedor: new Map((contenedores ?? []).map((c) => [c.id, etiquetaContenedor(c)])),
    insumo: new Map((insumos ?? []).map((i) => [i.id, i.nombre])),
    predio: new Map((predios ?? []).map((p) => [p.id, p.nombre])),
    sustrato: new Map((sustratos ?? []).map((s) => [s.id, s.nombre])),
  };
}

type MapasCatalogo = ReturnType<typeof useMapasCatalogo>;

/** Renderiza el valor de una clave conocida de `datos` resolviendo nombres; null si la clave no se reconoce (cae al fallback genérico). */
function valorResueltoDeCatalogo(clave: string, valor: unknown, mapas: MapasCatalogo): string | null {
  if (clave === 'contenedor_id' && typeof valor === 'string') return mapas.contenedor.get(valor) ?? 'No disponible';
  if (clave === 'predio_id' && typeof valor === 'string') return mapas.predio.get(valor) ?? 'No disponible';
  if (clave === 'insumo_ids' && Array.isArray(valor)) {
    if (valor.length === 0) return 'No aplica';
    return valor.map((id) => mapas.insumo.get(String(id)) ?? 'No disponible').join(', ');
  }
  if (clave === 'sustratos' && Array.isArray(valor)) {
    if (valor.length === 0) return 'No aplica';
    return valor
      .map((s) => {
        const fila = s as { sustrato_id?: string; porcentaje?: number };
        const nombre = fila.sustrato_id ? mapas.sustrato.get(fila.sustrato_id) ?? 'No disponible' : 'No disponible';
        return `${nombre} (${fila.porcentaje ?? 0}%)`;
      })
      .join(', ');
  }
  return null;
}

function valorDatoEvento(clave: string, valor: unknown, mapas: MapasCatalogo): string {
  const catalogo = valorResueltoDeCatalogo(clave, valor, mapas);
  if (catalogo !== null) return catalogo;
  if (valor === null || valor === undefined || valor === '') {
    return clave.includes('fecha') ? 'Sin fecha registrada' : 'No medido';
  }
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  if (Array.isArray(valor)) return valor.length === 0 ? 'No aplica' : valor.map(String).join(', ');
  // Una fecha guardada como texto ISO se muestra siempre `dd-mm-aaaa` (decisión N23).
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return formatearFechaCivil(valor);
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) return formatearFechaHora(valor);
  return String(valor);
}

function ArchivoAdjunto({ archivo }: { archivo: ArchivoEvento }) {
  const { data: url, isError } = useQuery({
    queryKey: qk.media.urlFirmada(archivo.id),
    queryFn: () => urlFirmada(archivo.storage_path),
    staleTime: 45 * 60 * 1000, // la URL firmada dura 60 min; renovamos antes
  });

  if (isError) return <ImageOff className="h-8 w-8 text-ink-3" />;
  if (!url) return <div className="h-20 w-20 animate-pulse rounded-md bg-surface-2" />;

  if (archivo.tipo === 'video') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="flex h-20 w-20 items-center justify-center rounded-md border bg-surface-2">
        <FileVideo className="h-8 w-8 text-ink-3" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Foto del evento" className="h-20 w-20 rounded-md border object-cover" />
    </a>
  );
}

/**
 * Fotos/videos de un evento ya creado: listar, agregar y quitar. Reusa las
 * mismas dos llamadas del alta (subirBinarioEvento + registrarArchivoDeEvento,
 * api/eventos.ts) — la única diferencia es que acá `registroId` ya existe
 * desde el principio. Cada cambio invalida la lista de eventos del cruce
 * completa (los archivos vienen embebidos en `RegistroEvento.archivos`, no
 * tienen query propia).
 */
function AdjuntosEvento({
  registroId,
  codigoSistema,
  archivos,
  onActualizado,
}: {
  registroId: string;
  codigoSistema: string;
  archivos: ArchivoEvento[];
  onActualizado: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const subirMutacion = useMutation({
    mutationFn: async (file: File) => {
      const { path, tipo } = await subirBinarioEvento({ file, codigoSistema });
      await registrarArchivoDeEvento({ registroId, path, tipo });
    },
    onSuccess: onActualizado,
  });

  const quitarMutacion = useMutation({
    mutationFn: (archivo: ArchivoEvento) => eliminarArchivoDeEvento(archivo),
    onSuccess: onActualizado,
  });

  return (
    <div className="space-y-1.5">
      <Label>Fotos / videos</Label>
      {archivos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {archivos.map((a) => (
            <div key={a.id} className="relative">
              <ArchivoAdjunto archivo={a} />
              <button
                type="button"
                onClick={() => quitarMutacion.mutate(a)}
                disabled={quitarMutacion.isPending}
                aria-label={`Quitar adjunto ${a.tipo}`}
                className="absolute -right-1.5 -top-1.5 rounded-full border bg-surface p-0.5 text-danger shadow"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          if (file) subirMutacion.mutate(file);
          e.target.value = '';
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={subirMutacion.isPending}>
        <Camera className="h-3.5 w-3.5" /> {subirMutacion.isPending ? 'Subiendo…' : 'Agregar foto/video'}
      </Button>
      {(subirMutacion.isError || quitarMutacion.isError) && (
        <Alert>{((subirMutacion.error ?? quitarMutacion.error) as Error).message}</Alert>
      )}
    </div>
  );
}

function EventoEditForm({
  registro,
  codigoSistema,
  onCancelar,
  onGuardado,
  onActualizado,
  onTocadoChange,
}: {
  registro: RegistroEvento;
  codigoSistema: string;
  onCancelar: () => void;
  onGuardado: () => void;
  onActualizado: () => void;
  /** El Sheet pide confirmación antes de cerrar (Escape/overlay/X) si hay cambios sin guardar. */
  onTocadoChange?: (tocado: boolean) => void;
}) {
  const [fecha, setFecha] = useState(registro.fecha);
  const [notas, setNotas] = useState(registro.notas ?? '');

  const tocado = fecha !== registro.fecha || notas !== (registro.notas ?? '');
  useEffect(() => onTocadoChange?.(tocado), [tocado, onTocadoChange]);

  // El tipo de evento no se edita acá — reetiquetar (ej. Polinización a
  // Cosecha) rompe la auditoría y deja datos mal clasificados. Se manda el
  // valor original sin cambios; no hay control en pantalla para tocarlo.
  const mutacion = useMutation({
    mutationFn: () => actualizarEvento({
      id: registro.id,
      tipo_evento: registro.tipo_evento,
      fecha,
      notas: notas.trim() === '' ? undefined : notas,
    }),
    onSuccess: onGuardado,
  });

  return (
    <div className="space-y-2">
      <CampoFecha id={`fecha-${registro.id}`} label="Fecha" value={fecha} onChange={setFecha} required />
      <div className="space-y-1">
        <Label htmlFor={`notas-${registro.id}`}>Notas (opcional)</Label>
        <Textarea
          id={`notas-${registro.id}`}
          value={notas}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotas(e.target.value)}
        />
      </div>
      <AdjuntosEvento
        registroId={registro.id}
        codigoSistema={codigoSistema}
        archivos={registro.archivos}
        onActualizado={onActualizado}
      />
      {mutacion.isError && <Alert>{(mutacion.error as Error).message}</Alert>}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={() => mutacion.mutate()} disabled={mutacion.isPending}>
          {mutacion.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancelar} disabled={mutacion.isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function EventosLista({
  plantaId,
  codigoSistema,
  estadoCruce,
}: {
  plantaId: string;
  codigoSistema: string;
  /** Preselecciona el chip de filtro con el tipo de evento de la fase actual (tipoEventoDeEstado). */
  estadoCruce: EstadoPlanta;
}) {
  const { user, esAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { data: eventos, isLoading, isError, error } = useQuery({
    queryKey: qk.eventos.planta(plantaId),
    queryFn: () => listarEventosDePlanta(plantaId),
  });
  const mapasCatalogo = useMapasCatalogo();

  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  // Solo el id: el registro se busca en `eventos` en cada render (no un
  // snapshot aparte) para que agregar/quitar un adjunto desde el Sheet —
  // que invalida y refetchea la lista — se refleje ahí mismo sin cerrar y
  // reabrir.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [tocado, setTocado] = useState(false);
  const [confirmandoBorradoId, setConfirmandoBorradoId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<TipoEvento | 'todos'>('todos');
  const [verTodos, setVerTodos] = useState(false);
  const yaInicializado = useRef(false);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: qk.eventos.planta(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.actividad.planta(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.polinizacion.nota(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.siembra.nota(plantaId) });
  };

  // El más reciente arranca expandido (es el que más se consulta) y el chip
  // de filtro arranca en el tipo de evento de la fase actual, si hay algún
  // evento de ese tipo (si no, "Todos" — mejor mostrar algo que una lista
  // vacía por un filtro que no aplica). Solo se hace una vez: un refetch no
  // debe pisar lo que el usuario ya tocó a mano.
  useEffect(() => {
    if (!yaInicializado.current && eventos && eventos.length > 0) {
      setExpandidos(new Set([eventos[0].id]));
      const tipoDeFase = tipoEventoDeEstado(estadoCruce);
      setFiltro(eventos.some((ev) => ev.tipo_evento === tipoDeFase) ? tipoDeFase : 'todos');
      yaInicializado.current = true;
    }
  }, [eventos, estadoCruce]);

  const alternarExpandido = (id: string) => {
    setExpandidos((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) siguiente.delete(id); else siguiente.add(id);
      return siguiente;
    });
  };

  const mutacionBorrado = useMutation({
    mutationFn: (id: string) => eliminarEvento(id),
    onSuccess: () => {
      setConfirmandoBorradoId(null);
      invalidar();
    },
  });

  const cerrarEdicion = () => {
    if (tocado && !window.confirm('Tienes cambios sin guardar. ¿Descartar el borrador?')) return;
    setEditandoId(null);
    setTocado(false);
  };

  const tiposPresentes = useMemo(
    () => (Object.keys(TIPO_EVENTO_LABEL) as TipoEvento[]).filter((t) => (eventos ?? []).some((ev) => ev.tipo_evento === t)),
    [eventos],
  );
  const eventosFiltrados = useMemo(
    () => (eventos ?? []).filter((ev) => filtro === 'todos' || ev.tipo_evento === filtro),
    [eventos, filtro],
  );
  const eventosVisibles = verTodos ? eventosFiltrados : eventosFiltrados.slice(0, TOPE_INICIAL);
  const eventoEditando = editandoId ? (eventos ?? []).find((ev) => ev.id === editandoId) : undefined;

  if (isLoading) return <p className="text-small text-ink-3">Cargando historial…</p>;
  if (isError) return <p className="text-small text-danger">{(error as Error).message}</p>;
  if (!eventos?.length) return <p className="text-small text-ink-3">Este cruce todavía no tiene registros.</p>;

  return (
    <Workspace>
      <Panel titulo="Historial" meta={`${eventos.length} registro(s)`}>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => { setFiltro('todos'); setVerTodos(false); }}
            className={cn(
              'whitespace-nowrap rounded-md border px-2.5 py-1 text-small font-medium',
              filtro === 'todos' ? 'border-primary bg-brand-l text-brand-ink' : 'border-line bg-surface-2 text-ink-2',
            )}
          >
            Todos
          </button>
          {tiposPresentes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setFiltro(t); setVerTodos(false); }}
              className={cn(
                'whitespace-nowrap rounded-md border px-2.5 py-1 text-small font-medium',
                filtro === t ? 'border-primary bg-brand-l text-brand-ink' : 'border-line bg-surface-2 text-ink-2',
              )}
            >
              {TIPO_EVENTO_LABEL[t]}
            </button>
          ))}
        </div>
      </Panel>

      <Panel>
        {eventosFiltrados.length === 0 ? (
          <p className="py-2 text-small text-ink-3">Ningún registro coincide con este filtro.</p>
        ) : (
          <ul className="-mx-4">
            {eventosVisibles.map((ev) => {
              const expandido = expandidos.has(ev.id);
              const puedeEditar = esAdmin || ev.created_by === user?.id;
              const puedeBorrar = esAdmin;

              return (
                <li key={ev.id} className="border-b border-line-soft last:border-0">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
                    onClick={() => alternarExpandido(ev.id)}
                    aria-expanded={expandido}
                  >
                    {expandido
                      ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" />
                      : <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />}
                    <Badge className="text-small font-semibold">{TIPO_EVENTO_LABEL[ev.tipo_evento]}</Badge>
                    <span className="flex items-center gap-1 text-small text-ink-3">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {ev.datos?.fecha_placeholder === true
                        ? 'Sin fecha registrada'
                        : formatearFechaCivil(ev.fecha)}
                    </span>
                    {ev.archivos.length > 0 && (
                      <span className="flex items-center gap-1 text-small text-ink-3" aria-label={`${ev.archivos.length} adjunto(s)`}>
                        <Paperclip className="h-3.5 w-3.5" />
                        {ev.archivos.length}
                      </span>
                    )}
                  </button>

                  {expandido && (
                    <div className="space-y-2 px-4 pb-3">
                      {ev.notas && <p className="whitespace-pre-wrap text-body">{ev.notas}</p>}
                      {Object.keys(ev.datos ?? {}).length > 0 && (
                        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-2">
                          {Object.entries(ev.datos)
                            .filter(([k]) => k !== 'migration_source' && k !== 'fecha_placeholder')
                            .map(([k, v]) => (
                              <div key={k}>
                                <dt className="inline font-medium">{etiquetaDatoEvento(k)}: </dt>
                                <dd className="inline">{valorDatoEvento(k, v, mapasCatalogo)}</dd>
                              </div>
                            ))}
                        </dl>
                      )}
                      {ev.archivos.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {ev.archivos.map((a) => <ArchivoAdjunto key={a.id} archivo={a} />)}
                        </div>
                      )}

                      {(puedeEditar || puedeBorrar) && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {puedeEditar && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => { setEditandoId(ev.id); setConfirmandoBorradoId(null); }}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </Button>
                          )}
                          {puedeBorrar && confirmandoBorradoId !== ev.id && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-danger hover:text-danger"
                              onClick={() => { setConfirmandoBorradoId(ev.id); setEditandoId(null); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Eliminar
                            </Button>
                          )}
                        </div>
                      )}

                      {puedeBorrar && confirmandoBorradoId === ev.id && (
                        <div className="flex flex-wrap items-center gap-2 text-small">
                          <span>¿Eliminar este registro? Queda fuera del historial, pero no se destruye.</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => mutacionBorrado.mutate(ev.id)}
                            disabled={mutacionBorrado.isPending}
                          >
                            {mutacionBorrado.isPending ? 'Eliminando…' : 'Sí, eliminar'}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmandoBorradoId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      )}
                      {mutacionBorrado.isError && mutacionBorrado.variables === ev.id && (
                        <Alert>{(mutacionBorrado.error as Error).message}</Alert>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!verTodos && eventosFiltrados.length > TOPE_INICIAL && (
          <div className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setVerTodos(true)}>
              Ver más ({eventosFiltrados.length - TOPE_INICIAL})
            </Button>
          </div>
        )}
      </Panel>

      {editandoId && eventoEditando && (
        <Sheet
          titulo="Editar evento"
          subtitulo={`${TIPO_EVENTO_LABEL[eventoEditando.tipo_evento]} · ${codigoSistema}`}
          hayContenido={tocado}
          onCerrar={cerrarEdicion}
        >
          <EventoEditForm
            registro={eventoEditando}
            codigoSistema={codigoSistema}
            onCancelar={cerrarEdicion}
            onActualizado={invalidar}
            onTocadoChange={setTocado}
            onGuardado={() => {
              setEditandoId(null);
              setTocado(false);
              invalidar();
            }}
          />
        </Sheet>
      )}
    </Workspace>
  );
}
