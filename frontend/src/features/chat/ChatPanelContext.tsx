import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { chat } from '@/api/chat';
import { push } from '@/api/push';
import { Sheet } from '@/components/ui/sheet';
import { useAuth } from '@/features/auth/AuthContext';
import { NotificacionesDispositivo } from '@/features/push/NotificacionesDispositivo';
import { pushActivoEnEsteDispositivo, sincronizarSuscripcion } from '@/lib/push/dispositivo';
import { debeSonar, instalarDesbloqueoAudio, sonidoActivado, tocarTonoMencion } from '@/lib/push/sonido';
import { qk } from '@/lib/queryKeys';
import type { DestinoChat, NotificacionChat } from '@/types/chat';
import { CentroNotificacionesChat } from './CentroNotificacionesChat';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canal y mensaje que pide abrir una notificación push (`/?chat=<canal>&mensaje=<mensaje>`). */
export function destinoDesdeNotificacion(canalId: unknown, mensajeId: unknown): { canalId: string; mensajeId: string | null } | null {
  if (typeof canalId !== 'string' || !UUID.test(canalId)) return null;
  return { canalId, mensajeId: typeof mensajeId === 'string' && UUID.test(mensajeId) ? mensajeId : null };
}

/** Menciones sin leer que no estaban en la lista anterior (para el aviso sonoro). */
export function mencionesNuevas(anteriores: ReadonlySet<string>, actuales: NotificacionChat[]): NotificacionChat[] {
  return actuales.filter((item) => !item.leida_at && !anteriores.has(item.mensaje_id));
}

const ChatWorkspace = lazy(() => import('./ChatWorkspace').then((modulo) => ({ default: modulo.ChatWorkspace })));

type ControlChat = { abrirChat: (destino?: DestinoChat) => void };

const ChatPanelContext = createContext<ControlChat>({ abrirChat: () => undefined });

/** Lo que necesitan los botones de campana y chat del encabezado (el shell los coloca; antes eran botones flotantes). */
type ControlesChatEstado = {
  noLeidos: number;
  notificaciones: NotificacionChat[];
  cargandoNotificaciones: boolean;
  errorNotificaciones: string | null;
  procesando: string | null;
  notificacionesAbiertas: boolean;
  alternarNotificaciones: () => void;
  abrirChat: () => void;
  abrirNotificacion: (notificacion: NotificacionChat) => void;
  marcarLeida: (notificacion: NotificacionChat) => void;
  marcarTodas: () => void;
};
const ControlesChatContext = createContext<ControlesChatEstado | null>(null);

/** Campana y botón del chat con sus contadores. Va en el encabezado; sin sesión no muestra nada. */
export function ControlesChat() {
  const c = useContext(ControlesChatContext);
  if (!c) return null;
  return (
    <div className="flex items-center gap-1">
      <CentroNotificacionesChat
        abierto={c.notificacionesAbiertas}
        notificaciones={c.notificaciones}
        cargando={c.cargandoNotificaciones}
        error={c.errorNotificaciones}
        procesando={c.procesando}
        onAlternar={c.alternarNotificaciones}
        onAbrir={c.abrirNotificacion}
        onMarcarLeida={c.marcarLeida}
        onMarcarTodas={c.marcarTodas}
        pie={<NotificacionesDispositivo compacto />}
      />
      <button
        type="button"
        aria-label={c.noLeidos ? `Abrir chat del equipo, ${c.noLeidos} sin leer` : 'Abrir chat del equipo'}
        title="Abrir chat del equipo"
        onClick={c.abrirChat}
        className="relative grid min-h-tap min-w-tap place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <MessageCircle className="h-5 w-5" />
        {c.noLeidos > 0 && (
          <span className="absolute right-0.5 top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-micro font-semibold leading-none text-white shadow-sm">
            {c.noLeidos > 99 ? '99+' : c.noLeidos}
          </span>
        )}
      </button>
    </div>
  );
}

export function useChatPanel() {
  return useContext(ChatPanelContext);
}

function destinoDesdeRuta(pathname: string): DestinoChat | undefined {
  const cruce = pathname.match(/^\/planta\/([0-9a-f-]{36})$/i);
  return cruce ? { tipo: 'cruce', entidadId: cruce[1] } : undefined;
}

export function ChatPanelProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [destino, setDestino] = useState<DestinoChat>();
  const [canalInicialId, setCanalInicialId] = useState<string | null>(null);
  const [mensajeInicialId, setMensajeInicialId] = useState<string | null>(null);
  const [notificacionesAbiertas, setNotificacionesAbiertas] = useState(false);
  const [procesandoNotificacion, setProcesandoNotificacion] = useState<string | null>(null);
  const [errorNotificacion, setErrorNotificacion] = useState<string | null>(null);
  const contextoRuta = useMemo(() => destinoDesdeRuta(pathname), [pathname]);
  const canalesQuery = useQuery({
    queryKey: qk.chat.canales,
    queryFn: chat.listarCanales,
    enabled: !!user,
    staleTime: 30_000,
  });
  const noLeidos = (canalesQuery.data ?? []).reduce((total, canal) => total + canal.no_leidos, 0);
  const notificacionesQuery = useQuery({
    queryKey: qk.chat.notificaciones,
    queryFn: chat.listarNotificaciones,
    enabled: !!user,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!user) return;
    let vigente = true;
    let cerrar: (() => void) | undefined;
    void chat.observarResumen(() => {
      void queryClient.invalidateQueries({ queryKey: qk.chat.canales });
      void queryClient.invalidateQueries({ queryKey: qk.chat.notificaciones });
    }).then((control) => {
      if (vigente) cerrar = control.cerrar;
      else control.cerrar();
    }).catch(() => {
      // La consulta periódica de React Query conserva un fallback recuperable.
    });
    return () => {
      vigente = false;
      cerrar?.();
    };
  }, [queryClient, user]);

  // Aviso sonoro: suena una vez por mención nueva que llega con la página a la vista.
  const vistas = useRef<Set<string> | null>(null);
  useEffect(() => instalarDesbloqueoAudio(), []);
  useEffect(() => {
    if (!user) { vistas.current = null; return; }
    const lista = notificacionesQuery.data;
    if (!lista) return;
    if (vistas.current) {
      const nuevas = mencionesNuevas(vistas.current, lista);
      const condiciones = {
        visible: document.visibilityState === 'visible',
        activado: sonidoActivado(),
        pushActivo: pushActivoEnEsteDispositivo(),
        userAgent: navigator.userAgent,
      };
      if (nuevas.length && debeSonar(condiciones)) {
        tocarTonoMencion(nuevas.some((item) => item.tipo === 'directa') ? 'directa' : 'todos');
      }
    }
    vistas.current = new Set(lista.map((item) => item.mensaje_id));
  }, [notificacionesQuery.data, user]);

  // Con una suscripción ya activa, queda a nombre de quien inició sesión en este navegador.
  useEffect(() => {
    if (user) void sincronizarSuscripcion(push).catch(() => undefined);
  }, [user]);

  function abrirDesdeNotificacion(canalId: string, mensajeId: string | null) {
    if (mensajeId) {
      void chat.marcarNotificacionLeida(mensajeId)
        .then(() => queryClient.invalidateQueries({ queryKey: qk.chat.notificaciones }))
        .catch(() => undefined);
    }
    setDestino(undefined);
    setCanalInicialId(canalId);
    setMensajeInicialId(mensajeId);
    setNotificacionesAbiertas(false);
    setAbierto(true);
  }
  const abrirDesdeNotificacionRef = useRef(abrirDesdeNotificacion);
  abrirDesdeNotificacionRef.current = abrirDesdeNotificacion;

  // La notificación abrió la app en /?chat=…&mensaje=…: se abre el canal y se limpia la URL.
  useEffect(() => {
    if (!user) return;
    const parametros = new URLSearchParams(search);
    if (!parametros.has('chat')) return;
    const destinoPush = destinoDesdeNotificacion(parametros.get('chat'), parametros.get('mensaje'));
    parametros.delete('chat');
    parametros.delete('mensaje');
    const resto = parametros.toString();
    navigate({ pathname, search: resto ? `?${resto}` : '' }, { replace: true });
    if (destinoPush) abrirDesdeNotificacionRef.current(destinoPush.canalId, destinoPush.mensajeId);
  }, [navigate, pathname, search, user]);

  // Con la app ya abierta, el service worker la enfoca y pide abrir el canal por mensaje.
  useEffect(() => {
    const contenedor = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    if (!contenedor || !user) return;
    const alRecibir = (evento: MessageEvent) => {
      const datos = evento.data as { tipo?: unknown; canalId?: unknown; mensajeId?: unknown } | null;
      if (datos?.tipo !== 'abrir-chat') return;
      const destinoPush = destinoDesdeNotificacion(datos.canalId, datos.mensajeId);
      if (destinoPush) abrirDesdeNotificacionRef.current(destinoPush.canalId, destinoPush.mensajeId);
    };
    contenedor.addEventListener('message', alRecibir);
    return () => contenedor.removeEventListener('message', alRecibir);
  }, [user]);

  const valor = useMemo<ControlChat>(() => ({
    abrirChat: (nuevoDestino = contextoRuta ?? { tipo: 'general' }) => {
      setDestino(nuevoDestino);
      setCanalInicialId(null);
      setMensajeInicialId(null);
      setNotificacionesAbiertas(false);
      setAbierto(true);
    },
  }), [contextoRuta]);

  async function marcarLeida(notificacion: NotificacionChat) {
    setProcesandoNotificacion(notificacion.mensaje_id);
    setErrorNotificacion(null);
    try {
      await chat.marcarNotificacionLeida(notificacion.mensaje_id);
      queryClient.setQueryData<NotificacionChat[]>(qk.chat.notificaciones, (actuales) => actuales?.map((item) => (
        item.mensaje_id === notificacion.mensaje_id ? { ...item, leida_at: new Date().toISOString() } : item
      )));
    } catch (fallo) {
      setErrorNotificacion(fallo instanceof Error ? fallo.message : 'No se pudo actualizar la notificación.');
    } finally {
      setProcesandoNotificacion(null);
    }
  }

  async function marcarTodas() {
    setProcesandoNotificacion('todas');
    setErrorNotificacion(null);
    try {
      await chat.marcarTodasNotificacionesLeidas();
      const ahora = new Date().toISOString();
      queryClient.setQueryData<NotificacionChat[]>(qk.chat.notificaciones, (actuales) => actuales?.map((item) => (
        item.leida_at ? item : { ...item, leida_at: ahora }
      )));
    } catch (fallo) {
      setErrorNotificacion(fallo instanceof Error ? fallo.message : 'No se pudieron actualizar las notificaciones.');
    } finally {
      setProcesandoNotificacion(null);
    }
  }

  async function abrirNotificacion(notificacion: NotificacionChat) {
    if (!notificacion.leida_at) await marcarLeida(notificacion);
    await queryClient.invalidateQueries({ queryKey: qk.chat.canales });
    setDestino(undefined);
    setCanalInicialId(notificacion.canal_id);
    setMensajeInicialId(notificacion.mensaje_id);
    setNotificacionesAbiertas(false);
    setAbierto(true);
  }

  const controles: ControlesChatEstado | null = user ? {
    noLeidos,
    notificaciones: notificacionesQuery.data ?? [],
    cargandoNotificaciones: notificacionesQuery.isLoading,
    errorNotificaciones: errorNotificacion ?? (notificacionesQuery.error instanceof Error ? notificacionesQuery.error.message : null),
    procesando: procesandoNotificacion,
    notificacionesAbiertas,
    alternarNotificaciones: () => {
      if (!notificacionesAbiertas) {
        setErrorNotificacion(null);
        void notificacionesQuery.refetch();
      }
      setNotificacionesAbiertas((actual) => !actual);
    },
    abrirChat: () => valor.abrirChat(),
    abrirNotificacion: (notificacion) => void abrirNotificacion(notificacion),
    marcarLeida: (notificacion) => void marcarLeida(notificacion),
    marcarTodas: () => void marcarTodas(),
  } : null;

  return (
    <ChatPanelContext.Provider value={valor}>
      <ControlesChatContext.Provider value={controles}>
        {children}
      </ControlesChatContext.Provider>
      {abierto && (
        <Sheet titulo="Chat del equipo" onCerrar={() => setAbierto(false)} size="chat">
          <Suspense fallback={<div className="h-full min-h-[360px] animate-pulse bg-surface-2" />}>
            <ChatWorkspace destinoInicial={destino} canalInicialId={canalInicialId} mensajeInicialId={mensajeInicialId} />
          </Suspense>
        </Sheet>
      )}
    </ChatPanelContext.Provider>
  );
}
