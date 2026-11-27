/**
 * Sección colapsable con resumen de una línea — North Star v5, rediseño de
 * UX Parte D.3: lo que ya pasó queda accesible pero no impuesto (colapsado
 * por defecto); lo que corresponde ahora mismo arranca expandido, porque es
 * lo que el usuario necesita ver/hacer en este momento.
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function SeccionColapsable({
  titulo,
  resumen,
  defaultAbierto,
  children,
}: {
  titulo: string;
  /** Resumen de una línea mostrado siempre, colapsado o no (ej. "2 evaluaciones · última 12-07-2026"). */
  resumen?: string;
  defaultAbierto: boolean;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(defaultAbierto);

  return (
    <div className="border-t pt-3">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex min-h-tap w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown className={`h-3.5 w-3.5 text-ink-3 transition-transform ${abierto ? '' : '-rotate-90'}`} />
          <h4 className="text-xs font-semibold text-ink-2">{titulo}</h4>
        </span>
        {resumen && !abierto && <span className="text-xs text-ink-3">{resumen}</span>}
      </button>
      {abierto && <div className="motion-reveal mt-2 space-y-2">{children}</div>}
    </div>
  );
}
