/**
 * Huella etiquetada (DESIGN.md): una fila por sección con una celda por
 * descriptor en cuatro estados. Medido = índigo lleno; faltó = ámbar con borde;
 * no evaluado = blanco con borde; marcado = rojo con «!». Siempre con leyenda y
 * el estado escrito para lectores de pantalla.
 */
import type { EstadoDescriptor } from '@/api/protocolo';
import { camposLegibles, ESTADO_DESCRIPTOR_LABEL } from '@/lib/esquemaFase/protocolo';
import { estaActivo, type EsquemaFase } from '@/lib/esquemaFase/tipos';
import { cn } from '@/lib/utils';

const CELDA: Record<EstadoDescriptor, string> = {
  medido: 'border-brand bg-brand',
  falto: 'border-warn bg-warn-t',
  no_evaluado: 'border-line bg-surface',
  marcado: 'border-danger bg-danger text-white',
};

function Celda({ estado, etiqueta }: { estado: EstadoDescriptor; etiqueta: string }) {
  return (
    <span
      title={`${etiqueta}: ${ESTADO_DESCRIPTOR_LABEL[estado]}`}
      className={cn('grid h-3 w-3 shrink-0 place-items-center rounded-[3px] border text-[9px] font-semibold leading-none', CELDA[estado])}
    >
      {estado === 'marcado' ? '!' : null}
      <span className="sr-only">{`${etiqueta}: ${ESTADO_DESCRIPTOR_LABEL[estado]}`}</span>
    </span>
  );
}

export function LeyendaHuella() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-3" aria-label="Leyenda de estados">
      {(['medido', 'falto', 'no_evaluado', 'marcado'] as const).map((estado) => (
        <li key={estado} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('grid h-3 w-3 place-items-center rounded-[3px] border text-[9px] font-semibold leading-none', CELDA[estado])}>
            {estado === 'marcado' ? '!' : null}
          </span>
          {estado === 'falto' ? 'Faltó (obligatorio)' : ESTADO_DESCRIPTOR_LABEL[estado]}
        </li>
      ))}
    </ul>
  );
}

export function HuellaEvaluacion<C extends string>({
  esquema,
  estados,
  className,
  enFila = false,
  sinLeyenda = false,
}: {
  esquema: EsquemaFase<C>;
  estados: Partial<Record<string, EstadoDescriptor>>;
  className?: string;
  /** A ancho completo: etiqueta, celdas y conteo en una sola línea (docs/diseno/v2/02). */
  enFila?: boolean;
  /** Cuando varias huellas comparten una sola leyenda (Comparar rondas). */
  sinLeyenda?: boolean;
}) {
  // Un campo desactivado (rend_t_ha) solo tiene celda si esa evaluación ya trae un valor.
  const campos = camposLegibles(esquema).filter((c) => estaActivo(c) || estados[c.clave] === 'medido' || estados[c.clave] === 'marcado');
  return (
    <div className={cn('space-y-2', className)}>
      <dl className="space-y-1.5">
        {esquema.secciones.map((seccion) => {
          const deSeccion = campos.filter((c) => c.seccion === seccion.id);
          if (deSeccion.length === 0) return null;
          const medidos = deSeccion.filter((c) => estados[c.clave] === 'medido' || estados[c.clave] === 'marcado').length;
          if (enFila) {
            return (
              <div key={seccion.id} className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_auto] items-center gap-3">
                <dt className="truncate text-small text-ink-2">{seccion.etiqueta}</dt>
                <dd className="flex flex-wrap gap-1">
                  {deSeccion.map((c) => <Celda key={c.clave} estado={estados[c.clave] ?? 'no_evaluado'} etiqueta={c.etiqueta} />)}
                </dd>
                <dd className="text-small tabular-nums text-ink-3">{medidos} de {deSeccion.length}</dd>
              </div>
            );
          }
          return (
            // Etiqueta y conteo en una línea, celdas debajo: funciona igual en el
            // panel angosto del expediente que a ancho completo.
            <div key={seccion.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 truncate text-small text-ink-3">{seccion.etiqueta}</dt>
                <dd className="text-small tabular-nums text-ink-3">{medidos}/{deSeccion.length}</dd>
              </div>
              <dd className="flex flex-wrap gap-1">
                {deSeccion.map((c) => <Celda key={c.clave} estado={estados[c.clave] ?? 'no_evaluado'} etiqueta={c.etiqueta} />)}
              </dd>
            </div>
          );
        })}
      </dl>
      {!sinLeyenda && <LeyendaHuella />}
    </div>
  );
}
