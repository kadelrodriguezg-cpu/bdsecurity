import { formatearFechaCivil, formatearHoraChile } from '@/lib/fechas';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Archive, AtSign, LoaderCircle, MessageCircle, RefreshCw, Send, X } from 'lucide-react';
import { chat, combinarMensajesChat, prepararMensajeChat, type BorradorEnvioChat, type EstadoChat } from '@/api/chat';
import type { CanalChat, MensajeChat, ParticipanteChat } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useMarcarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';

/** Día del separador: `dd-mm-aaaa`, el día de Chile (decisión N23). */
function diaMensaje(fecha: string) {
  return formatearFechaCivil(fecha);
}

function EstadoConexion({ estado }: { estado: EstadoChat }) {
  if (estado === 'conectado') {
    return <span className="flex items-center gap-1.5 text-small text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" />Actualización en vivo</span>;
  }
  if (estado === 'cerrado') return null;
  return (
    <span className={cn('flex items-center gap-1.5 text-small', estado === 'reconectando' ? 'text-warn' : 'text-ink-3')}>
      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      {estado === 'reconectando' ? 'Reconectando…' : 'Actualizando…'}
    </span>
  );
}

export function ConversacionChat({
  canal,
  usuarioId,
  esAdmin = false,
  mensajeInicialId,
  onLecturaActualizada,
  onCanalActualizado,
}: {
  canal: CanalChat;
  usuarioId: string;
  esAdmin?: boolean;
  mensajeInicialId?: string | null;
  onLecturaActualizada?: (canalId: string, posicion: number) => void;
  onCanalActualizado?: (canalId?: string) => void;
}) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [contenido, setContenido] = useState('');
  // Un mensaje a medio escribir cuenta como cambio sin guardar.
  useMarcarCambiosSinGuardar(contenido.trim() !== '');
  const [estado, setEstado] = useState<EstadoChat>('conectando');
  const [cargando, setCargando] = useState(true);
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
  const [hayAnteriores, setHayAnteriores] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [archivado, setArchivado] = useState(canal.archivado);
  const [error, setError] = useState<string | null>(null);
  const [reintento, setReintento] = useState(0);
  const [participantes, setParticipantes] = useState<ParticipanteChat[]>([]);
  const [mencionados, setMencionados] = useState<ParticipanteChat[]>([]);
  const [ayudaVisible, setAyudaVisible] = useState(false);
  const [confirmarLimpieza, setConfirmarLimpieza] = useState(false);
  const [limpiando, setLimpiando] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const cercaDelFinal = useRef(true);
  const envioPendiente = useRef<{ texto: string; envio: BorradorEnvioChat } | null>(null);
  const ultimaLeida = useRef(0);
  const ultimaPosicionVisible = useRef(0);

  const marcarLeido = useCallback((posicion: number) => {
    if (document.visibilityState === 'hidden' || posicion <= ultimaLeida.current) return;
    ultimaLeida.current = posicion;
    void chat.marcarLeido(canal.id, posicion)
      .then(() => onLecturaActualizada?.(canal.id, posicion))
      .catch(() => { ultimaLeida.current = 0; });
  }, [canal.id, onLecturaActualizada]);

  const titulo = canal.tipo === 'general'
    ? 'General'
    : canal.entidad_nombre ?? (canal.tipo === 'cruce' ? 'Cruce archivado' : canal.tipo === 'predio' ? 'Predio archivado' : 'Canal libre');
  const mensajesAgrupados = useMemo(() => mensajes.map((mensaje, indice) => ({
    mensaje,
    mostrarDia: indice === 0 || diaMensaje(mensajes[indice - 1].creado_at) !== diaMensaje(mensaje.creado_at),
  })), [mensajes]);
  const coincidenciaMencion = contenido.match(/(?:^|\s)@([^@\n]*)$/);
  const sugerencias = useMemo(() => {
    if (!coincidenciaMencion) return [];
    const busqueda = coincidenciaMencion[1].trim().toLocaleLowerCase('es-CL');
    const perfiles = participantes
      .filter((perfil) => perfil.id !== usuarioId && perfil.nombre.toLocaleLowerCase('es-CL').includes(busqueda))
      .slice(0, 5)
      .map((perfil) => ({ id: perfil.id, nombre: perfil.nombre, todos: false as const }));
    const permiteTodos = canal.tipo !== 'general' || esAdmin;
    return permiteTodos && 'all'.includes(busqueda)
      ? [{ id: '@all', nombre: 'all', todos: true as const }, ...perfiles]
      : perfiles;
  }, [canal.tipo, coincidenciaMencion, esAdmin, participantes, usuarioId]);

  useEffect(() => {
    let vigente = true;
    let cerrarObservador: (() => void) | undefined;
    setMensajes([]);
    setCargando(true);
    setHayAnteriores(false);
    setError(null);
    setEstado('conectando');
    setArchivado(canal.archivado);
    ultimaLeida.current = 0;
    ultimaPosicionVisible.current = 0;
    cercaDelFinal.current = true;
    setMencionados([]);
    setAyudaVisible(false);

    if (!canal.archivado) {
      void chat.listarParticipantes(canal.id)
        .then((datos) => { if (vigente) setParticipantes(datos); })
        .catch(() => { if (vigente) setParticipantes([]); });
    }

    async function iniciar() {
      try {
        const iniciales = mensajeInicialId
          ? await chat.listarContextoMensaje(canal.id, mensajeInicialId)
          : await chat.listarMensajes(canal.id);
        if (!vigente) return;
        setMensajes(iniciales);
        setHayAnteriores(mensajeInicialId ? (iniciales.at(0)?.posicion ?? 1) > 1 : iniciales.length === 50);
        setCargando(false);
        ultimaPosicionVisible.current = iniciales.at(-1)?.posicion ?? 0;
        const posicionObjetivo = mensajeInicialId
          ? iniciales.find((mensaje) => mensaje.id === mensajeInicialId)?.posicion ?? 0
          : ultimaPosicionVisible.current;
        marcarLeido(posicionObjetivo);
        requestAnimationFrame(() => {
          const contenedor = contenedorRef.current;
          const objetivo = mensajeInicialId ? document.getElementById(`mensaje-chat-${mensajeInicialId}`) : null;
          if (objetivo) objetivo.scrollIntoView({ block: 'center' });
          else if (contenedor) contenedor.scrollTop = contenedor.scrollHeight;
        });

        if (canal.archivado) {
          setEstado('cerrado');
          return;
        }

        const control = await chat.observarCanal(canal.id, {
          desde: iniciales.at(-1)?.posicion ?? 0,
          onMensajes: (nuevos) => {
            if (!vigente) return;
            const debeBajar = cercaDelFinal.current || nuevos.some((mensaje) => mensaje.autor_id === usuarioId);
            setMensajes((actuales) => combinarMensajesChat(actuales, nuevos));
            setError(null);
            ultimaPosicionVisible.current = Math.max(ultimaPosicionVisible.current, nuevos.at(-1)?.posicion ?? 0);
            marcarLeido(ultimaPosicionVisible.current);
            if (debeBajar) requestAnimationFrame(() => {
              const contenedor = contenedorRef.current;
              if (contenedor) contenedor.scrollTop = contenedor.scrollHeight;
            });
          },
          onEstado: (nuevoEstado) => {
            setEstado(nuevoEstado);
            if (nuevoEstado === 'conectado') setError(null);
          },
          onError: (fallo) => setError(fallo.message),
        });
        if (!vigente) control.cerrar();
        else cerrarObservador = control.cerrar;
      } catch (fallo) {
        if (!vigente) return;
        setCargando(false);
        setEstado('reconectando');
        setError(fallo instanceof Error ? fallo.message : 'No se pudo abrir la conversación.');
      }
    }

    const alVolver = () => marcarLeido(ultimaPosicionVisible.current);
    document.addEventListener('visibilitychange', alVolver);
    void iniciar();
    return () => {
      vigente = false;
      cerrarObservador?.();
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [canal.archivado, canal.id, canal.oculto_desde, marcarLeido, mensajeInicialId, reintento, usuarioId]);

  async function cargarAnteriores() {
    const primera = mensajes[0];
    if (!primera || cargandoAnteriores) return;
    const contenedor = contenedorRef.current;
    const alturaAnterior = contenedor?.scrollHeight ?? 0;
    setCargandoAnteriores(true);
    setError(null);
    try {
      const anteriores = await chat.listarMensajes(canal.id, { antes: primera.posicion });
      setMensajes((actuales) => combinarMensajesChat(anteriores, actuales));
      setHayAnteriores(anteriores.length === 50);
      requestAnimationFrame(() => {
        if (contenedor) contenedor.scrollTop += contenedor.scrollHeight - alturaAnterior;
      });
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudieron cargar los mensajes anteriores.');
    } finally {
      setCargandoAnteriores(false);
    }
  }

  async function enviar(evento?: FormEvent) {
    evento?.preventDefault();
    const texto = contenido.trim();
    if (!texto || enviando || archivado) return;
    if (texto === '/ayuda') {
      setAyudaVisible(true);
      setContenido('');
      envioPendiente.current = null;
      return;
    }
    if (texto === '/clear') {
      setContenido('');
      envioPendiente.current = null;
      if (esAdmin) setConfirmarLimpieza(true);
      else setError('El comando /clear está disponible solo para administradores.');
      return;
    }
    let pendiente = envioPendiente.current;
    if (!pendiente || pendiente.texto !== texto) {
      try {
        const mencionesVigentes = mencionados.filter((perfil) => texto.includes(`@${perfil.nombre}`));
        pendiente = {
          texto,
          envio: prepararMensajeChat(canal.id, texto, {
            mencionados: mencionesVigentes.map((perfil) => perfil.id),
            mencionarTodos: /(^|\s)@all(?=\s|$)/i.test(texto),
          }),
        };
      } catch (fallo) {
        setError((fallo as Error).message);
        return;
      }
      envioPendiente.current = pendiente;
    }
    setEnviando(true);
    setError(null);
    try {
      const confirmado = await chat.enviarMensaje(pendiente.envio);
      setMensajes((actuales) => combinarMensajesChat(actuales, [confirmado]));
      ultimaPosicionVisible.current = Math.max(ultimaPosicionVisible.current, confirmado.posicion);
      marcarLeido(confirmado.posicion);
      setContenido('');
      setMencionados([]);
      envioPendiente.current = null;
      cercaDelFinal.current = true;
      requestAnimationFrame(() => {
        const contenedor = contenedorRef.current;
        if (contenedor) contenedor.scrollTop = contenedor.scrollHeight;
      });
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : 'No se pudo enviar el mensaje.';
      setError(mensaje);
      if (mensaje.toLocaleLowerCase('es-CL').includes('archivada')) setArchivado(true);
    } finally {
      setEnviando(false);
    }
  }

  function elegirMencion(sugerencia: { id: string; nombre: string; todos: boolean }) {
    if (!coincidenciaMencion) return;
    const inicio = (coincidenciaMencion.index ?? 0) + coincidenciaMencion[0].lastIndexOf('@');
    setContenido(`${contenido.slice(0, inicio)}@${sugerencia.nombre} `);
    if (!sugerencia.todos) {
      const perfil = participantes.find((item) => item.id === sugerencia.id);
      if (perfil) setMencionados((actuales) => [...new Map([...actuales, perfil].map((item) => [item.id, item])).values()]);
    }
    envioPendiente.current = null;
  }

  async function limpiarHistorialVisible() {
    setLimpiando(true);
    setError(null);
    try {
      await chat.limpiarCanal(canal.id);
      setMensajes([]);
      setHayAnteriores(false);
      ultimaLeida.current = canal.ultima_posicion;
      ultimaPosicionVisible.current = canal.ultima_posicion;
      setConfirmarLimpieza(false);
      onCanalActualizado?.(canal.id);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo limpiar la vista del canal.');
      setConfirmarLimpieza(false);
    } finally {
      setLimpiando(false);
    }
  }

  function manejarTeclado(evento: KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key !== 'Enter' || evento.shiftKey || evento.nativeEvent.isComposing) return;
    evento.preventDefault();
    void enviar();
  }

  return (
    <section aria-label={`Chat ${titulo}`} className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex min-h-[64px] items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-body-l font-semibold">{titulo}</h2>
          <p className="text-small text-ink-3">
            {canal.tipo === 'general'
              ? 'Coordinación general del equipo'
              : canal.tipo === 'cruce'
                ? 'Seguimiento compartido de este cruce'
                : canal.tipo === 'predio' ? 'Coordinación operativa de este predio' : 'Conversación de participantes invitados'}
          </p>
        </div>
        {archivado ? (
          <span className="flex shrink-0 items-center gap-1.5 text-small text-ink-3"><Archive className="h-3.5 w-3.5" />Archivado</span>
        ) : <EstadoConexion estado={estado} />}
      </header>

      <div
        ref={contenedorRef}
        onScroll={(evento) => {
          const elemento = evento.currentTarget;
          cercaDelFinal.current = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight < 96;
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-3 py-4 sm:px-5"
      >
        {cargando ? (
          <div className="grid h-full min-h-48 place-items-center text-sm text-ink-3"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />Cargando conversación…</div>
        ) : error && mensajes.length === 0 && estado === 'reconectando' ? (
          <div className="grid h-full min-h-48 place-items-center text-center">
            <div><p className="text-sm text-danger">{error}</p><Button className="mt-3" variant="outline" size="sm" onClick={() => setReintento((valor) => valor + 1)}><RefreshCw className="h-4 w-4" />Reintentar</Button></div>
          </div>
        ) : mensajes.length === 0 ? (
          <div className="grid h-full min-h-48 place-items-center text-center text-ink-3">
            <div><MessageCircle className="mx-auto mb-2 h-8 w-8" /><p className="text-sm font-medium text-ink-2">Aún no hay mensajes</p><p className="mt-1 text-small">Inicia la conversación con una actualización breve.</p></div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {hayAnteriores && (
              <Button className="mx-auto mb-2" variant="ghost" size="sm" disabled={cargandoAnteriores} onClick={() => void cargarAnteriores()}>
                {cargandoAnteriores && <LoaderCircle className="h-4 w-4 animate-spin" />}Cargar mensajes anteriores
              </Button>
            )}
            {mensajesAgrupados.map(({ mensaje, mostrarDia }) => {
              const propio = mensaje.autor_id === usuarioId;
              return (
                <div key={mensaje.id}>
                  {mostrarDia && <div className="my-3 flex items-center gap-3 text-micro text-ink-3"><span className="h-px flex-1 bg-line" /><span>{diaMensaje(mensaje.creado_at)}</span><span className="h-px flex-1 bg-line" /></div>}
                  <article id={`mensaje-chat-${mensaje.id}`} className={cn('flex scroll-m-6', propio ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[88%] rounded-lg px-3 py-2 shadow-sm transition-shadow sm:max-w-[72%]',
                      propio ? 'bg-brand-l text-brand-ink' : 'border border-line-soft bg-surface text-ink',
                      mensaje.id === mensajeInicialId && 'ring-2 ring-brand ring-offset-2',
                    )}>
                      {!propio && <p className="mb-0.5 text-small font-semibold text-brand">{mensaje.autor_nombre}</p>}
                      <p className="whitespace-pre-wrap break-words text-sm">{mensaje.contenido}</p>
                      <time className="mt-1 block text-right text-micro text-ink-3" dateTime={mensaje.creado_at}>{formatearHoraChile(new Date(mensaje.creado_at))}</time>
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && !(mensajes.length === 0 && estado === 'reconectando') && (
        <p role="alert" className="border-t border-danger-l bg-danger-l px-4 py-2 text-small text-danger">{error}</p>
      )}
      {archivado ? (
        <div className="border-t border-line bg-surface-2 px-4 py-3 text-center text-small text-ink-3">Esta conversación se conserva como historial y ya no acepta mensajes.</div>
      ) : (
        <form onSubmit={(evento) => void enviar(evento)} className="border-t border-line bg-surface p-3">
          {ayudaVisible && (
            <div className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-md border border-brand-c bg-brand-l px-3 py-2 text-small text-brand-ink">
              <AtSign className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p><strong>/ayuda</strong> muestra esta guía.</p>
                {esAdmin && <p><strong>/clear</strong> oculta el historial visible después de confirmar; conserva los mensajes y registra la acción.</p>}
                <p>Escribe <strong>@</strong> para mencionar participantes{canal.tipo === 'general' && !esAdmin ? '.' : ' o usar @all.'}</p>
              </div>
              <button type="button" aria-label="Cerrar ayuda" onClick={() => setAyudaVisible(false)}><X className="h-4 w-4" /></button>
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <label htmlFor="mensaje-chat" className="sr-only">Mensaje</label>
            <div className="min-w-0 flex-1">
              <Textarea
                id="mensaje-chat"
                value={contenido}
                maxLength={4000}
                rows={2}
                placeholder="Escribe una actualización…"
                disabled={enviando}
                onKeyDown={manejarTeclado}
                onChange={(evento) => {
                  setContenido(evento.target.value);
                  setMencionados((actuales) => actuales.filter((perfil) => evento.target.value.includes(`@${perfil.nombre}`)));
                  if (envioPendiente.current?.texto !== evento.target.value.trim()) envioPendiente.current = null;
                }}
                className="min-h-tap resize-none"
              />
              {sugerencias.length > 0 && (
                <div className="mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-md">
                  {sugerencias.map((sugerencia) => (
                    <button
                      key={sugerencia.id}
                      type="button"
                      onClick={() => elegirMencion(sugerencia)}
                      className="flex min-h-tap w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2"
                    >
                      <AtSign className="h-4 w-4 text-brand" />
                      <span>{sugerencia.nombre}</span>
                      {sugerencia.todos && <span className="ml-auto text-small text-ink-3">Todos los participantes</span>}
                    </button>
                  ))}
                </div>
              )}
              {contenido.length >= 3600 && <p className="mt-1 text-right text-micro text-ink-3">{contenido.length}/4000</p>}
            </div>
            <Button type="submit" aria-label="Enviar mensaje" disabled={!contenido.trim() || enviando} className="shrink-0 px-3">
              {enviando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mx-auto mt-1 max-w-3xl text-micro text-ink-3">Enter para enviar · Shift + Enter para una nueva línea</p>
        </form>
      )}
      <Modal open={confirmarLimpieza} onClose={() => setConfirmarLimpieza(false)} title="Confirmar /clear">
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            Se ocultará el historial visible de <strong>{titulo}</strong> para sus participantes. Los mensajes seguirán guardados y la acción quedará auditada.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmarLimpieza(false)} disabled={limpiando}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={() => void limpiarHistorialVisible()} disabled={limpiando}>
              {limpiando && <LoaderCircle className="h-4 w-4 animate-spin" />}Confirmar /clear
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
