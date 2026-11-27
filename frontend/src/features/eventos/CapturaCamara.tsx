/**
 * Captura de foto/video DENTRO de la página (getUserMedia + MediaRecorder),
 * en vez de delegarle todo a la app de cámara nativa del sistema operativo.
 *
 * Motivo: en el celular real, tanto con `capture="environment"` como sin él,
 * el archivo tomado con la cámara nunca llegaba a adjuntarse al formulario
 * (comportamiento estructural del navegador/PWA en modo standalone, no un
 * bug de nuestro código — diagnosticado con evidencia en esta misma sesión).
 * Al capturar sin salir nunca de la página, no hay ningún salto de Activity
 * que el sistema operativo pueda interrumpir.
 *
 * Si algo falla (sin permiso, sin cámara, cámara ocupada, navegador viejo
 * sin soporte), siempre se ofrece una salida: el selector de archivo de
 * siempre, para no dejar al operario bloqueado.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Circle, Square, RotateCcw, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

type TipoErrorCamara = 'permiso_denegado' | 'sin_camara' | 'camara_ocupada' | 'no_soportado';

type EstadoCaptura =
  | { fase: 'pidiendo_permiso' }
  | { fase: 'en_vivo' }
  | { fase: 'grabando'; segundos: number }
  | { fase: 'revisando'; blob: Blob; url: string }
  | { fase: 'error'; tipo: TipoErrorCamara; mensaje: string };

function mapearError(err: unknown): EstadoCaptura {
  const nombre = err instanceof DOMException ? err.name : '';
  switch (nombre) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { fase: 'error', tipo: 'permiso_denegado', mensaje: 'No diste permiso de cámara en este navegador.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { fase: 'error', tipo: 'sin_camara', mensaje: 'No se encontró una cámara en este dispositivo.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { fase: 'error', tipo: 'camara_ocupada', mensaje: 'La cámara está siendo usada por otra app.' };
    default:
      return { fase: 'error', tipo: 'no_soportado', mensaje: 'No se pudo abrir la cámara en la página.' };
  }
}

function formatearSegundos(total: number): string {
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function CapturaCamara({
  modo,
  onCapturado,
  onUsarSelectorArchivo,
  onCancelar,
}: {
  modo: 'foto' | 'video';
  onCapturado: (file: File) => void;
  onUsarSelectorArchivo: () => void;
  onCancelar: () => void;
}) {
  const [estado, setEstado] = useState<EstadoCaptura>({ fase: 'pidiendo_permiso' });
  const [intento, setIntento] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const grabadorRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cortarStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    let cancelado = false;

    if (!navigator.mediaDevices?.getUserMedia || (modo === 'video' && typeof MediaRecorder === 'undefined')) {
      setEstado({ fase: 'error', tipo: 'no_soportado', mensaje: 'Este navegador no soporta cámara en la página.' });
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: modo === 'video',
      })
      .catch((err: unknown) => {
        // Un solo reintento con constraints más simples si el dispositivo no
        // soporta la resolución pedida — recién ahí se da por error real.
        if (err instanceof DOMException && err.name === 'OverconstrainedError') {
          return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: modo === 'video' });
        }
        throw err;
      })
      .then((stream) => {
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setEstado({ fase: 'en_vivo' });
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        setEstado(mapearError(err));
      });

    return () => {
      cancelado = true;
      cortarStream();
    };
  }, [modo, intento]);

  // Conecta el stream al <video> recién cuando ya está montado: en el
  // momento en que getUserMedia resuelve, la fase todavía es
  // 'pidiendo_permiso' y el <video> ni existe en el árbol (solo se renderiza
  // en 'en_vivo'/'grabando'), así que asignar srcObject ahí arriba no servía
  // de nada — quedaba un visor en negro aunque el stream fuera válido.
  useEffect(() => {
    if ((estado.fase !== 'en_vivo' && estado.fase !== 'grabando') || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    // .play() devuelve una Promise en navegadores modernos, pero no todos la
    // garantizan (y algunos entornos de test no la implementan) — se llama
    // igual por si autoPlay no alcanza, sin depender de que exista .catch.
    const resultado = videoRef.current.play();
    if (resultado && typeof resultado.catch === 'function') {
      resultado.catch(() => {
        // Autoplay bloqueado o interrumpido: no es crítico ni motivo de pasar
        // a fase de error — el resto del flujo (capturar/grabar) sigue andando.
      });
    }
  }, [estado.fase]);

  const reintentar = () => {
    setEstado({ fase: 'pidiendo_permiso' });
    setIntento((i) => i + 1);
  };

  const capturarFoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setEstado({ fase: 'revisando', blob, url: URL.createObjectURL(blob) });
    }, 'image/jpeg', 0.9);
  };

  const iniciarGrabacion = () => {
    if (!streamRef.current) return;
    const candidatos = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    mimeTypeRef.current = candidatos.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';

    const grabador = new MediaRecorder(streamRef.current, mimeTypeRef.current ? { mimeType: mimeTypeRef.current } : undefined);
    chunksRef.current = [];
    grabador.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    grabador.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
      setEstado({ fase: 'revisando', blob, url: URL.createObjectURL(blob) });
    };
    grabador.start();
    grabadorRef.current = grabador;

    setEstado({ fase: 'grabando', segundos: 0 });
    timerRef.current = setInterval(() => {
      setEstado((prev) => (prev.fase === 'grabando' ? { fase: 'grabando', segundos: prev.segundos + 1 } : prev));
    }, 1000);
  };

  const detenerGrabacion = () => {
    grabadorRef.current?.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const repetir = () => {
    if (estado.fase === 'revisando') URL.revokeObjectURL(estado.url);
    setEstado({ fase: 'en_vivo' });
  };

  const confirmar = () => {
    if (estado.fase !== 'revisando') return;
    const extension = modo === 'foto' ? 'jpg' : 'webm';
    const mime = estado.blob.type || (modo === 'foto' ? 'image/jpeg' : 'video/webm');
    const file = new File([estado.blob], `${modo}-${Date.now()}.${extension}`, { type: mime });
    URL.revokeObjectURL(estado.url);
    cortarStream();
    onCapturado(file);
  };

  const cancelar = () => {
    if (estado.fase === 'revisando') URL.revokeObjectURL(estado.url);
    cortarStream();
    onCancelar();
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      {estado.fase === 'pidiendo_permiso' && (
        <div className="space-y-2 text-sm text-ink-3">
          <p>Pidiendo acceso a la cámara…</p>
          <Button type="button" variant="outline" size="sm" onClick={cancelar}>
            <X className="h-4 w-4" /> Cancelar
          </Button>
        </div>
      )}

      {(estado.fase === 'en_vivo' || estado.fase === 'grabando') && (
        <div className="space-y-2">
          <video
            ref={videoRef}
            data-testid="visor-camara"
            autoPlay
            playsInline
            muted
            className="aspect-video w-full rounded-md border bg-black object-cover"
          />
          {estado.fase === 'grabando' && (
            <p className="flex items-center gap-1.5 text-sm text-danger">
              <Circle className="h-3 w-3 fill-current" /> Grabando… {formatearSegundos(estado.segundos)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {estado.fase === 'en_vivo' && modo === 'foto' && (
              <Button type="button" size="sm" onClick={capturarFoto}>
                <Camera className="h-4 w-4" /> Capturar foto
              </Button>
            )}
            {estado.fase === 'en_vivo' && modo === 'video' && (
              <Button type="button" size="sm" onClick={iniciarGrabacion}>
                <Circle className="h-4 w-4" /> Grabar
              </Button>
            )}
            {estado.fase === 'grabando' && (
              <Button type="button" variant="outline" size="sm" onClick={detenerGrabacion}>
                <Square className="h-4 w-4" /> Detener
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={cancelar}>
              <X className="h-4 w-4" /> Cancelar
            </Button>
          </div>
        </div>
      )}

      {estado.fase === 'revisando' && (
        <div className="space-y-2">
          {modo === 'foto'
            ? <img src={estado.url} alt="Foto capturada" className="aspect-video w-full rounded-md border object-cover" />
            : <video src={estado.url} controls className="aspect-video w-full rounded-md border" />}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={confirmar}>
              <Check className="h-4 w-4" /> Usar {modo === 'foto' ? 'esta foto' : 'este video'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={repetir}>
              <RotateCcw className="h-4 w-4" /> Repetir
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancelar}>
              <X className="h-4 w-4" /> Cancelar
            </Button>
          </div>
        </div>
      )}

      {estado.fase === 'error' && (
        <div className="space-y-2">
          <Alert>{estado.mensaje}</Alert>
          <div className="flex flex-wrap gap-2">
            {estado.tipo === 'camara_ocupada' && (
              <Button type="button" size="sm" onClick={reintentar}>
                Reintentar
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={onUsarSelectorArchivo}>
              Elegir archivo existente
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancelar}>
              <X className="h-4 w-4" /> Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
