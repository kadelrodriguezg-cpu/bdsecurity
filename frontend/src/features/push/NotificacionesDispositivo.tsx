import { useState } from 'react';
import { BellOff, BellRing, LoaderCircle, Smartphone } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { EstadoPush } from '@/lib/push/dispositivo';
import { guardarSonidoActivado, sonidoActivado } from '@/lib/push/sonido';
import { cn } from '@/lib/utils';
import { usePushDispositivo } from './usePushDispositivo';

const AVISO_PRIVACIDAD = 'La notificación dice quién te mencionó y en qué canal, nunca el texto del mensaje.';

/** Botón «Activar notificaciones» según el estado de este dispositivo. Presentacional: lo prueban las pruebas. */
export function BotonNotificacionesPush({
  estado,
  procesando,
  error,
  onActivar,
  onDesactivar,
  compacto = false,
}: {
  estado: EstadoPush | null;
  procesando: boolean;
  error: string | null;
  onActivar: () => void;
  onDesactivar: () => void;
  compacto?: boolean;
}) {
  const texto = cn('text-ink-3', compacto ? 'text-micro' : 'text-sm');
  let cuerpo: React.ReactNode;
  if (!estado) {
    cuerpo = <p className={cn(texto, 'flex items-center gap-2')}><LoaderCircle className="h-4 w-4 animate-spin" />Revisando este dispositivo…</p>;
  } else if (estado.tipo === 'no_soportado') {
    cuerpo = (
      <p className={texto}>
        Este navegador no permite notificaciones. Usa Chrome, Edge o Firefox en el computador, Chrome en Android
        o la app instalada en iPhone.
      </p>
    );
  } else if (estado.tipo === 'iphone_sin_instalar') {
    cuerpo = (
      <div className={cn(texto, 'space-y-1')}>
        <p className="flex items-center gap-1.5 font-medium text-ink-2"><Smartphone className="h-4 w-4" />Primero instala la app</p>
        <p>
          En iPhone (iOS 16.4 o superior) las notificaciones funcionan solo con la app en la pantalla de inicio:
          en Safari toca <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>. Abre
          BDSecurity desde ese ícono y vuelve a esta opción.
        </p>
      </div>
    );
  } else if (estado.tipo === 'bloqueado') {
    cuerpo = (
      <div className={cn(texto, 'space-y-1')}>
        <p className="flex items-center gap-1.5 font-medium text-ink-2"><BellOff className="h-4 w-4" />Bloqueadas en este navegador</p>
        <p>
          Para desbloquearlas, toca el candado o el ícono junto a la dirección del sitio, entra a
          <strong> Permisos</strong> (o Configuración del sitio) y cambia <strong>Notificaciones</strong> a
          <strong> Permitir</strong>. Después recarga la página.
        </p>
      </div>
    );
  } else if (estado.tipo === 'activado') {
    cuerpo = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn(texto, 'flex items-center gap-1.5 font-medium text-ok')}><BellRing className="h-4 w-4" />Activadas en este dispositivo</p>
        <Button type="button" variant="outline" size="sm" onClick={onDesactivar} disabled={procesando}>
          {procesando ? 'Desactivando…' : 'Desactivar'}
        </Button>
      </div>
    );
  } else {
    cuerpo = (
      <div className="space-y-2">
        {!compacto && <p className={texto}>Te avisamos cuando te mencionen, aunque la app esté cerrada. {AVISO_PRIVACIDAD}</p>}
        <Button type="button" size="sm" onClick={onActivar} disabled={procesando}>
          <BellRing className="h-4 w-4" />
          {procesando ? 'Activando…' : 'Activar notificaciones'}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {cuerpo}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

export function NotificacionesDispositivo({ compacto = false }: { compacto?: boolean }) {
  const push = usePushDispositivo();
  return (
    <BotonNotificacionesPush
      estado={push.estado}
      procesando={push.procesando}
      error={push.error}
      onActivar={() => void push.activar()}
      onDesactivar={() => void push.desactivar()}
      compacto={compacto}
    />
  );
}

/** Interruptor «Sonido en la app» (localStorage, activado por defecto). */
export function InterruptorSonidoApp() {
  const [activo, setActivo] = useState(sonidoActivado);
  return (
    <label className="flex min-h-tap cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-sm font-medium text-ink">Sonido en la app</span>
        <span className="block text-xs text-ink-3">Suena un aviso cuando te mencionan con la app abierta y a la vista.</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="h-5 w-5 shrink-0 accent-brand"
        checked={activo}
        onChange={(evento) => {
          setActivo(evento.target.checked);
          guardarSonidoActivado(evento.target.checked);
        }}
      />
    </label>
  );
}
