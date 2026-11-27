/**
 * Adjuntar foto/video opcional a un registro de fase — mismo patrón que ya
 * usaba el formulario genérico de eventos (EventoForm), reutilizando
 * CapturaCamara. Sin persistencia de borrador en IndexedDB (esa complejidad
 * era específica del textarea de notas libres que esta pasada reemplaza).
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Video, ImagePlus, X } from 'lucide-react';
import { CapturaCamara } from '@/features/eventos/CapturaCamara';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export function AdjuntarArchivoFase({
  archivo,
  onArchivoChange,
}: {
  archivo: File | null;
  onArchivoChange: (f: File | null) => void;
}) {
  const [camaraAbierta, setCamaraAbierta] = useState<'foto' | 'video' | null>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);

  const onArchivoElegido = (e: ChangeEvent<HTMLInputElement>) => onArchivoChange(e.target.files?.[0] ?? null);

  const quitarArchivo = () => {
    onArchivoChange(null);
    for (const ref of [fotoRef, videoRef, galeriaRef]) {
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <Camera className="h-4 w-4" /> Foto o video (opcional)
      </Label>
      {!camaraAbierta && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setCamaraAbierta('foto')}>
            <Camera className="h-4 w-4" /> Tomar foto ahora
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setCamaraAbierta('video')}>
            <Video className="h-4 w-4" /> Grabar video
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => galeriaRef.current?.click()}>
            <ImagePlus className="h-4 w-4" /> Elegir de galería
          </Button>
        </div>
      )}

      {camaraAbierta && (
        <CapturaCamara
          modo={camaraAbierta}
          onCapturado={(file) => {
            setCamaraAbierta(null);
            onArchivoChange(file);
          }}
          onUsarSelectorArchivo={() => {
            const ref = camaraAbierta === 'foto' ? fotoRef : videoRef;
            setCamaraAbierta(null);
            ref.current?.click();
          }}
          onCancelar={() => setCamaraAbierta(null)}
        />
      )}

      <Input type="file" accept="image/*" ref={fotoRef} onChange={onArchivoElegido} className="hidden" />
      <Input type="file" accept="video/*" ref={videoRef} onChange={onArchivoElegido} className="hidden" />
      <Input type="file" accept="image/*,video/*" ref={galeriaRef} onChange={onArchivoElegido} className="hidden" />

      {archivo && !camaraAbierta && (
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <span>Seleccionado: {archivo.name}</span>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-ink-3" onClick={quitarArchivo} aria-label="Quitar archivo seleccionado">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
