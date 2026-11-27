/** Búsqueda por código del encabezado (cruce `02-502` o individuo `02-502-P1`) con el escáner como botón dentro del campo. */
import { lazy, Suspense, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { QrCode, Search, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { lecturaDeTexto, resolverLectura, type Lectura } from '@/lib/busquedaCodigo';

// El lector (cámara + decodificador wasm) pesa: solo se baja cuando se abre el escáner.
const QRScanner = lazy(() => import('@/components/shared/QRScanner').then((modulo) => ({ default: modulo.QRScanner })));

export function BusquedaCodigo({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  const [errorEscaner, setErrorEscaner] = useState<string | null>(null);
  // Fase 4: en el celular el encabezado también lleva el selector de especie; la búsqueda queda como lupa + escáner y el
  // campo se despliega sobre el encabezado al tocar la lupa.
  const [abiertaMovil, setAbiertaMovil] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const ocupado = useRef(false);

  /** Resuelve la lectura y abre la ficha (que vuelve a la pantalla de origen). Lanza el mensaje si no se encontró. */
  async function abrir(lectura: Lectura): Promise<boolean> {
    if (ocupado.current) return false;
    ocupado.current = true;
    setBuscando(true);
    const resultado = await resolverLectura(lectura);
    ocupado.current = false;
    setBuscando(false);
    if ('error' in resultado) throw new Error(resultado.error);
    navigate(resultado.ruta, { state: { volverA: `${pathname}${search}` } });
    return true;
  }

  async function enviar() {
    const valor = texto.trim();
    if (!valor) { setError('Escribe un código (por ejemplo 02-502 o 02-502-P1).'); return; }
    setError(null);
    try {
      if (await abrir(lecturaDeTexto(valor))) { setTexto(''); setAbiertaMovil(false); }
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo buscar.');
    }
  }

  async function alLeer(lectura: Lectura) {
    setErrorEscaner(null);
    try {
      if (await abrir(lectura)) setEscanerAbierto(false);
    } catch (fallo) {
      setErrorEscaner(fallo instanceof Error ? fallo.message : 'No se pudo buscar.');
    }
  }

  return (
    <>
      <div className="ml-auto flex shrink-0 md:hidden">
        <button
          type="button"
          aria-label="Buscar por código"
          aria-expanded={abiertaMovil}
          onClick={() => { setAbiertaMovil(true); window.setTimeout(() => campo.current?.focus(), 0); }}
          className="grid min-h-tap min-w-tap place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Escanear QR"
          onClick={() => { setErrorEscaner(null); setEscanerAbierto(true); }}
          className="grid min-h-tap min-w-tap place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <QrCode className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <form
        role="search"
        aria-label="Buscar por código"
        className={cn('relative', className, abiertaMovil ? 'max-md:absolute max-md:inset-x-2 max-md:top-3 max-md:z-40 max-md:flex max-md:items-center max-md:gap-1 max-md:bg-surface' : 'max-md:hidden')}
        onSubmit={(evento) => { evento.preventDefault(); void enviar(); }}
      >
        <label htmlFor="busqueda-codigo" className="sr-only">Buscar por código de cruce o de individuo</label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-ink-3 md:block" />
        <Input
          id="busqueda-codigo"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="Buscar código"
          value={texto}
          disabled={buscando}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'busqueda-codigo-error' : undefined}
          ref={campo}
          onChange={(evento) => { setTexto(evento.target.value); if (error) setError(null); }}
          onKeyDown={(evento) => { if (evento.key === 'Escape') setAbiertaMovil(false); }}
          className="pr-12 md:pl-9"
        />
        <button
          type="button"
          aria-label="Escanear código QR"
          title="Escanear código QR"
          onClick={() => { setErrorEscaner(null); setEscanerAbierto(true); }}
          className="absolute right-0 top-0 grid h-full min-w-tap place-items-center rounded-r-md text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:hidden"
        >
          <QrCode className="h-5 w-5" />
        </button>
        <button type="submit" className="sr-only" disabled={buscando}>Buscar</button>
        {abiertaMovil && (
          <button
            type="button"
            aria-label="Cerrar la búsqueda"
            onClick={() => { setAbiertaMovil(false); setError(null); }}
            className="grid min-h-tap min-w-tap shrink-0 place-items-center rounded-md text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {error && (
          <p
            id="busqueda-codigo-error"
            role="alert"
            className="absolute left-0 top-full z-10 mt-1 w-[min(20rem,calc(100vw-1.5rem))] rounded-md border border-danger bg-danger-l px-3 py-2 text-small text-danger shadow-lg"
          >
            {error}
          </p>
        )}
      </form>

      {escanerAbierto && (
        <Sheet titulo="Escanear código QR" onCerrar={() => setEscanerAbierto(false)}>
          <div className="space-y-3">
            <p className="text-sm text-ink-2">Apunta la cámara al código QR pegado en la etiqueta del cruce o del individuo.</p>
            <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface-2" />}>
              <QRScanner
                onResultado={(lectura) => { void alLeer(lectura); }}
                onNoReconocido={() => { if (!ocupado.current) setErrorEscaner('Ese código QR no corresponde a un cruce ni a un individuo de este sistema.'); }}
              />
            </Suspense>
            {errorEscaner && <Alert>{errorEscaner}</Alert>}
            {buscando && <p role="status" className="text-sm text-ink-3">Buscando…</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}
