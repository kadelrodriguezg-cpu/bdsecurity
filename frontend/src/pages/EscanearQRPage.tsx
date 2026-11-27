import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { QRScanner } from '@/components/shared/QRScanner';
import { lecturaDeTexto, resolverLectura, type Lectura } from '@/lib/busquedaCodigo';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Escáner de página (respaldo del escáner del encabezado, decisión N10). La resolución del código es la misma (`lib/busquedaCodigo`, N13). */
export function EscanearQRPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const ocupado = useRef(false);

  const handleResultado = async (resultado: Lectura) => {
    if (ocupado.current) return;
    ocupado.current = true;
    setBuscando(true);
    setError(null);
    const encontrado = await resolverLectura(resultado);
    if ('ruta' in encontrado) {
      navigate(encontrado.ruta, { state: { volverA: '/escanear' } });
      return;
    }
    setError(encontrado.error);
    ocupado.current = false;
    setBuscando(false);
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Escanear etiqueta</h1>
        <p className="text-sm text-ink-3">
          Apunta la cámara al código QR pegado en la etiqueta del cruce o del individuo.
        </p>
      </div>

      <QRScanner
        onResultado={handleResultado}
        onNoReconocido={() =>
           !ocupado.current && setError('Ese código QR no corresponde a un cruce ni a un individuo de este sistema.')
        }
      />

      {error && <Alert>{error}</Alert>}

      <form className="space-y-2 rounded-lg border border-line p-3" onSubmit={(event) => {
        event.preventDefault();
        if (ocupado.current) return;
        const valor = codigo.trim();
        if (!valor) { setError('Ingresa el código que aparece en la etiqueta.'); return; }
        void handleResultado(lecturaDeTexto(valor));
      }}>
        <Label htmlFor="codigo-manual">Escribir el código de la etiqueta</Label>
        <p id="codigo-manual-ayuda" className="text-sm text-ink-2">Si no puedes usar la cámara: el código de un cruce (02-502) o de un individuo (02-502-P1).</p>
        <Input id="codigo-manual" aria-describedby="codigo-manual-ayuda" placeholder="Ej. 02-502-P1" value={codigo} onChange={(event) => setCodigo(event.target.value)} disabled={buscando} />
        <Button type="submit" disabled={buscando}>{buscando ? 'Buscando…' : 'Buscar'}</Button>
      </form>
    </div>
  );
}
