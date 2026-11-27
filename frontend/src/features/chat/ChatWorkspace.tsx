import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Plus, RefreshCw, Settings } from 'lucide-react';
import { chat } from '@/api/chat';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/queryKeys';
import type { CanalChat, DestinoChat } from '@/types/chat';
import { ConversacionChat } from './ConversacionChat';
import { ListaCanalesChat } from './ListaCanalesChat';
import { CanalLibreModal } from './CanalLibreModal';

export function ChatWorkspace({
  destinoInicial,
  canalInicialId,
  mensajeInicialId,
  onCanalSeleccionado,
  className,
}: {
  destinoInicial?: DestinoChat;
  canalInicialId?: string | null;
  mensajeInicialId?: string | null;
  onCanalSeleccionado?: (canal: CanalChat) => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const { user, esAdmin } = useAuth();
  const [canalActivoId, setCanalActivoId] = useState(canalInicialId ?? null);
  const [mensajeObjetivoId, setMensajeObjetivoId] = useState(mensajeInicialId ?? null);
  const [modalCanal, setModalCanal] = useState<{ abierto: boolean; canal?: CanalChat }>({ abierto: false });
  const destinoTipo = destinoInicial?.tipo;
  const destinoEntidadId = destinoInicial && destinoInicial.tipo !== 'general' ? destinoInicial.entidadId : undefined;

  const canalesQuery = useQuery({
    queryKey: qk.chat.canales,
    queryFn: chat.listarCanales,
    staleTime: 30_000,
  });
  const destinoQuery = useQuery({
    queryKey: qk.chat.destino(destinoTipo ?? 'general', destinoEntidadId),
    queryFn: () => chat.obtenerCanal(destinoInicial),
    enabled: !!destinoInicial,
    retry: false,
  });

  useEffect(() => {
    setCanalActivoId(canalInicialId ?? null);
    setMensajeObjetivoId(mensajeInicialId ?? null);
  }, [canalInicialId, mensajeInicialId]);

  useEffect(() => {
    if (!destinoQuery.data) return;
    let vigente = true;
    void queryClient.invalidateQueries({ queryKey: qk.chat.canales }).then(() => {
      if (!vigente) return;
      setCanalActivoId(destinoQuery.data);
      setMensajeObjetivoId(null);
      const actualizados = queryClient.getQueryData<CanalChat[]>(qk.chat.canales);
      const canalDestino = actualizados?.find((canal) => canal.id === destinoQuery.data);
      if (canalDestino) onCanalSeleccionado?.(canalDestino);
    });
    return () => { vigente = false; };
  }, [destinoQuery.data, onCanalSeleccionado, queryClient]);

  const canales = canalesQuery.data ?? [];
  const general = canales.find((canal) => canal.tipo === 'general');
  const canalActivo = canales.find((canal) => canal.id === canalActivoId)
    ?? canales.find((canal) => canal.id === destinoQuery.data)
    ?? general;
  const destinoAunNoListado = !canalesQuery.isError && !!destinoQuery.data
    && !canales.some((canal) => canal.id === destinoQuery.data);

  function seleccionar(canal: CanalChat) {
    setCanalActivoId(canal.id);
    setMensajeObjetivoId(null);
    onCanalSeleccionado?.(canal);
  }

  const actualizarLectura = useCallback((canalId: string, posicion: number) => {
    queryClient.setQueryData<CanalChat[]>(qk.chat.canales, (actuales) => actuales?.map((canal) => (
      canal.id === canalId
        ? {
            ...canal,
            ultima_lectura: Math.max(canal.ultima_lectura, posicion),
            no_leidos: Math.max(canal.ultima_posicion - Math.max(canal.ultima_lectura, posicion), 0),
          }
        : canal
    )));
    void queryClient.invalidateQueries({ queryKey: qk.chat.canales });
  }, [queryClient]);

  const actualizarCanales = useCallback((canalId?: string) => {
    void queryClient.invalidateQueries({ queryKey: qk.chat.canales }).then(() => {
      if (canalId) setCanalActivoId(canalId);
    });
  }, [queryClient]);

  if (canalesQuery.isLoading || (!!destinoInicial && destinoQuery.isLoading) || destinoAunNoListado) {
    return <div className={cn('grid h-full min-h-[360px] grid-cols-[220px_1fr] gap-px bg-line', className)}><div className="animate-pulse bg-surface-2" /><div className="animate-pulse bg-surface" /></div>;
  }

  const errorDestino = destinoQuery.error instanceof Error ? destinoQuery.error.message : null;
  const errorCanales = canalesQuery.error instanceof Error ? canalesQuery.error.message : null;
  if (errorDestino || errorCanales || !user || !canalActivo) {
    return (
      <div className={cn('flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center', className)}>
        <MessageCircle className="h-10 w-10 text-ink-3" />
        <h2 className="text-title font-semibold">No se pudo abrir el chat</h2>
        <p className="max-w-md text-sm text-ink-2">{errorDestino ?? errorCanales ?? 'La conversación no está disponible para esta sesión.'}</p>
        <Button size="sm" onClick={() => { void canalesQuery.refetch(); if (destinoInicial) void destinoQuery.refetch(); }}>
          <RefreshCw className="h-4 w-4" />Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-surface lg:grid lg:grid-cols-[230px_minmax(0,1fr)]', className)}>
      <aside className="shrink-0 border-b border-line bg-surface lg:flex lg:min-h-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="hidden items-center justify-between gap-2 border-b border-line px-4 py-3 lg:flex">
          <div>
            <p className="text-sm font-semibold">Conversaciones</p>
            <p className="text-small text-ink-3">{canales.length} disponible{canales.length === 1 ? '' : 's'}</p>
          </div>
          {esAdmin && (
            <button
              type="button"
              aria-label="Crear canal libre"
              title="Crear canal libre"
              onClick={() => setModalCanal({ abierto: true })}
              className="grid min-h-tap min-w-tap place-items-center rounded-md text-brand transition-colors hover:bg-brand-l"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex justify-end gap-2 border-b border-line px-2 py-1.5 lg:hidden">
          {esAdmin && <Button size="sm" variant="ghost" onClick={() => setModalCanal({ abierto: true })}><Plus className="h-4 w-4" />Nuevo canal</Button>}
          {canalActivo.puede_gestionar && <Button size="sm" variant="ghost" onClick={() => setModalCanal({ abierto: true, canal: canalActivo })}><Settings className="h-4 w-4" />Gestionar</Button>}
        </div>
        <ListaCanalesChat canales={canales} canalActivoId={canalActivo.id} onSeleccionar={seleccionar} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        {canalActivo.puede_gestionar && (
          <div className="hidden justify-end border-b border-line px-3 py-1.5 lg:flex">
            <Button size="sm" variant="ghost" onClick={() => setModalCanal({ abierto: true, canal: canalActivo })}>
              <Settings className="h-4 w-4" />Gestionar canal
            </Button>
          </div>
        )}
        <ConversacionChat
          key={`${canalActivo.id}:${mensajeObjetivoId ?? ''}`}
          canal={canalActivo}
          usuarioId={user.id}
          esAdmin={esAdmin}
          mensajeInicialId={canalActivo.id === canalActivoId ? mensajeObjetivoId : undefined}
          onLecturaActualizada={actualizarLectura}
          onCanalActualizado={actualizarCanales}
        />
      </div>
      <CanalLibreModal
        open={modalCanal.abierto}
        canal={modalCanal.canal}
        usuarioId={user.id}
        onCerrar={() => setModalCanal({ abierto: false })}
        onGuardado={(canalId) => {
          actualizarCanales(canalId);
          setModalCanal({ abierto: false });
        }}
      />
    </div>
  );
}
