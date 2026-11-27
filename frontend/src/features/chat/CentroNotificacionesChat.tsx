import { formatearActividad } from '@/lib/v3/formatos';
import { useEffect, useRef } from 'react';
import { AtSign, Bell, Check, CheckCheck, LoaderCircle, Users } from 'lucide-react';
import type { NotificacionChat } from '@/types/chat';
import { cn } from '@/lib/utils';

export function CentroNotificacionesChat({
  abierto,
  notificaciones,
  cargando,
  error,
  procesando,
  onAlternar,
  onAbrir,
  onMarcarLeida,
  onMarcarTodas,
  pie,
}: {
  /** Acceso a las notificaciones push de este dispositivo (lo pone ChatPanelContext). */
  pie?: React.ReactNode;
  abierto: boolean;
  notificaciones: NotificacionChat[];
  cargando: boolean;
  error?: string | null;
  procesando?: string | null;
  onAlternar: () => void;
  onAbrir: (notificacion: NotificacionChat) => void;
  onMarcarLeida: (notificacion: NotificacionChat) => void;
  onMarcarTodas: () => void;
}) {
  const pendientes = notificaciones.filter((item) => !item.leida_at).length;
  const raiz = useRef<HTMLDivElement>(null);
  const alternarRef = useRef(onAlternar);
  alternarRef.current = onAlternar;

  // El panel se cierra con Escape y al pulsar fuera de él (ahora cuelga del encabezado, ya no es un botón flotante).
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (evento: KeyboardEvent) => { if (evento.key === 'Escape') alternarRef.current(); };
    const alPulsarFuera = (evento: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(evento.target as Node)) alternarRef.current();
    };
    document.addEventListener('keydown', alTeclear);
    document.addEventListener('mousedown', alPulsarFuera);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.removeEventListener('mousedown', alPulsarFuera);
    };
  }, [abierto]);

  return (
    <div ref={raiz} className="relative">
      <button
        type="button"
        aria-label={pendientes ? `Abrir notificaciones, ${pendientes} pendientes` : 'Abrir notificaciones'}
        aria-expanded={abierto}
        title="Notificaciones"
        onClick={onAlternar}
        className="grid min-h-tap min-w-tap place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Bell className="h-5 w-5" />
        {pendientes > 0 && (
          <span className="absolute right-0.5 top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-micro font-semibold leading-none text-white shadow-sm">
            {pendientes > 99 ? '99+' : pendientes}
          </span>
        )}
      </button>

      {abierto && (
        <section
          aria-label="Centro de notificaciones"
          className="fixed inset-x-2 top-[4.5rem] z-40 flex max-h-[min(620px,calc(100dvh-10rem-env(safe-area-inset-bottom)))] w-auto flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl md:absolute md:inset-x-auto md:right-0 md:top-[calc(100%+0.5rem)] md:max-h-[min(620px,70dvh)] md:w-[min(380px,calc(100vw-2rem))]"
        >
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1 basis-44">
              <h2 className="text-body-l font-semibold">Notificaciones</h2>
              <p className="text-small text-ink-3">Menciones directas y avisos a todo el canal</p>
            </div>
            {pendientes > 0 && (
              <button
                type="button"
                onClick={onMarcarTodas}
                disabled={procesando === 'todas'}
                className="flex min-h-tap shrink-0 items-center gap-1.5 rounded-md px-2 text-small font-medium text-brand transition-colors hover:bg-brand-l disabled:opacity-60"
              >
                {procesando === 'todas' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                Marcar todo
              </button>
            )}
          </header>

          <div className="min-h-0 overflow-y-auto">
            {cargando ? (
              <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-ink-3"><LoaderCircle className="h-4 w-4 animate-spin" />Cargando…</p>
            ) : error ? (
              <p role="alert" className="px-4 py-6 text-center text-sm text-danger">{error}</p>
            ) : notificaciones.length === 0 ? (
              <div className="px-4 py-8 text-center text-ink-3">
                <Bell className="mx-auto mb-2 h-7 w-7" />
                <p className="text-sm">No tienes menciones.</p>
              </div>
            ) : (
              notificaciones.map((notificacion) => {
                const Icono = notificacion.tipo === 'todos' ? Users : AtSign;
                const pendiente = !notificacion.leida_at;
                return (
                  <article
                    key={notificacion.mensaje_id}
                    className={cn('flex gap-2 border-b border-line-soft p-2 last:border-b-0', pendiente && 'bg-brand-l')}
                  >
                    <button
                      type="button"
                      onClick={() => onAbrir(notificacion)}
                      className="flex min-w-0 flex-1 gap-3 rounded-md p-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full', pendiente ? 'bg-brand text-white' : 'bg-surface-2 text-ink-3')}>
                        <Icono className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <strong className="truncate text-sm">{notificacion.autor_nombre}</strong>
                          <time className="shrink-0 text-micro text-ink-3" dateTime={notificacion.creado_at}>{formatearActividad(notificacion.creado_at)}</time>
                        </span>
                        <span className="block truncate text-small text-brand">{notificacion.canal_nombre}</span>
                        <span className="mt-0.5 line-clamp-2 block text-small text-ink-2">{notificacion.contenido}</span>
                      </span>
                    </button>
                    {pendiente && (
                      <button
                        type="button"
                        aria-label={`Marcar como leída la mención de ${notificacion.autor_nombre}`}
                        title="Marcar como leída"
                        disabled={procesando === notificacion.mensaje_id}
                        onClick={() => onMarcarLeida(notificacion)}
                        className="grid min-h-tap min-w-tap shrink-0 place-items-center self-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand disabled:opacity-60"
                      >
                        {procesando === notificacion.mensaje_id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </div>
          {pie && <footer className="border-t border-line px-4 py-3">{pie}</footer>}
        </section>
      )}
    </div>
  );
}
