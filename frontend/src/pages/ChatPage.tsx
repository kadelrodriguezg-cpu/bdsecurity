import { useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ChatWorkspace } from '@/features/chat/ChatWorkspace';
import { Card } from '@/components/ui/card';
import type { CanalChat, DestinoChat } from '@/types/chat';

export function ChatPage() {
  const { plantaId } = useParams<{ plantaId: string }>();
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const canalParam = parametros.get('canal');
  const mensajeParam = parametros.get('mensaje');
  const destino = useMemo<DestinoChat | undefined>(
    () => plantaId ? { tipo: 'cruce', entidadId: plantaId } : undefined,
    [plantaId],
  );
  const alSeleccionar = useCallback((canal: CanalChat) => {
    navegar(canal.tipo === 'general' ? '/chat' : `/chat?canal=${canal.id}`, { replace: true });
  }, [navegar]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-display font-semibold">Chat del equipo</h1>
        <p className="mt-1 text-body text-ink-2">Actualizaciones operativas en tiempo real, organizadas por cruce, predio y en una conversación general.</p>
      </header>
      <Card className="h-[calc(100dvh-240px)] min-h-[440px] overflow-hidden md:h-[calc(100dvh-190px)] md:min-h-[520px]">
        <ChatWorkspace
          destinoInicial={destino}
          canalInicialId={canalParam}
          mensajeInicialId={mensajeParam}
          onCanalSeleccionado={alSeleccionar}
        />
      </Card>
    </div>
  );
}
