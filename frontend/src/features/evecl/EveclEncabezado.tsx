import type { ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { EncabezadoPagina, type EstadoEncabezado } from '@/components/v3/estados';

/**
 * Encabezado de las pantallas EVECL con el contrato v3: el `EncabezadoPagina` compartido (h1 de 20 px, subtítulo gris y a lo
 * sumo una acción sólida) y, encima, la marca «Externo» que distingue el material foráneo del de mejoramiento propio.
 * El enlace «Ensayos EVECL» que había antes se fue: lo cubre la barra de secciones de `EveclModuloLayout`.
 */
export function EveclEncabezado({ titulo, descripcion, acciones, estado, mensajeError }: {
  titulo: string;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  estado?: EstadoEncabezado;
  mensajeError?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-brand-ink">
        <FlaskConical className="h-4 w-4" aria-hidden="true" />
        <span className="rounded-full bg-brand-l px-2 py-0.5 text-xs font-semibold">Externo</span>
      </div>
      <EncabezadoPagina titulo={titulo} subtitulo={descripcion} acciones={acciones} estado={estado} mensajeError={mensajeError} />
    </div>
  );
}
