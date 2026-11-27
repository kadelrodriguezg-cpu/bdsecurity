import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { obtenerUrlFirmadaFotoEvecl } from '@/api/evecl';
import { Button } from '@/components/ui/button';
import { qk } from '@/lib/queryKeys';
import { comprimirFotoEvecl } from './fotos';

export function FotoDescriptor({
  descriptorId,
  fotoPath,
  archivo,
  alCambiar,
  alBorrar,
  soloLectura = false,
}: {
  descriptorId: number;
  fotoPath: string | null;
  archivo?: File;
  alCambiar: (archivo: File) => void;
  alBorrar: () => void;
  soloLectura?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firmada = useQuery({
    queryKey: qk.evecl.foto(fotoPath ?? ''),
    queryFn: () => obtenerUrlFirmadaFotoEvecl(fotoPath!),
    enabled: Boolean(fotoPath) && !archivo,
  });

  useEffect(() => {
    if (!archivo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  const seleccionar = async (seleccionado?: File) => {
    if (!seleccionado) return;
    setComprimiendo(true);
    setError(null);
    try {
      alCambiar(await comprimirFotoEvecl(seleccionado));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo preparar la foto.');
    } finally {
      setComprimiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const src = preview ?? firmada.data ?? null;
  return (
    <div className="space-y-2">
      {src ? <img src={src} alt="Foto del descriptor" className="aspect-video w-full rounded-md border border-line object-cover" /> : null}
      {firmada.isError ? <p className="text-xs text-danger">No se pudo abrir la foto privada.</p> : null}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      {!soloLectura && <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          id={`foto-descriptor-${descriptorId}`}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(evento) => void seleccionar(evento.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" disabled={comprimiendo} onClick={() => inputRef.current?.click()}>
          {comprimiendo ? <LoaderCircle className="h-4 w-4 animate-spin" /> : src ? <Camera className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
          {comprimiendo ? 'Comprimiendo…' : src ? 'Reemplazar foto' : 'Agregar foto'}
        </Button>
        {(src || fotoPath) ? (
          <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={alBorrar}>
            <Trash2 className="h-4 w-4" /> Quitar foto
          </Button>
        ) : null}
      </div>}
      {!soloLectura && <p className="text-[10px] text-ink-3">La foto se comprime antes de guardarse en el almacenamiento privado.</p>}
    </div>
  );
}
