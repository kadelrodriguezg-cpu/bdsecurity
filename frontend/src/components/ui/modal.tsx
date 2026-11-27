/**
 * Adaptador para consumidores antiguos. Todos los overlays comparten la
 * misma primitiva accesible (`Sheet`) y, por tanto, el mismo contrato de
 * foco, Escape, restauración y cambios pendientes.
 */
import { Sheet } from './sheet';

export function Modal({
  open,
  onClose,
  title,
  children,
  hayContenido = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  hayContenido?: boolean;
}) {
  if (!open) return null;
  return (
    <Sheet titulo={title} onCerrar={onClose} hayContenido={hayContenido}>
      {children}
    </Sheet>
  );
}
