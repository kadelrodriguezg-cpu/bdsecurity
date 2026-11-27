import type { ReactNode } from 'react';

/**
 * Fila de identidad de las pantallas de evaluación (anual, multisitio y crecimiento): volver, código del
 * individuo, contador de avance, estado del borrador y navegación. En escritorio es una fila con salto de
 * línea; en celular, una cuadrícula de tres filas fijas: volver · código · contador / subtítulo / estado.
 * El contador va a la derecha de la primera fila y no se parte; el subtítulo se recorta con puntos suspensivos.
 */
export function EncabezadoEvaluacion({ izquierda, codigo, subtitulo, contador, estado, derecha }: {
  izquierda: ReactNode;
  codigo: string;
  subtitulo: string;
  contador?: ReactNode;
  /** Estado del guardado local: pásale `CLASE_ESTADO_ENCABEZADO` para que en celular ocupe su propia fila. */
  estado?: ReactNode;
  /** Navegación de escritorio (anterior, siguiente, escanear). */
  derecha?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 md:flex md:flex-wrap md:gap-x-6 md:gap-y-3">
      <div className="max-md:col-start-1 max-md:row-start-1">{izquierda}</div>
      <div className="min-w-0 max-md:contents">
        <p className="font-mono text-body-l font-semibold text-ink max-md:col-start-2 max-md:row-start-1 max-md:truncate">{codigo}</p>
        <p title={subtitulo} className="text-xs text-ink-3 md:text-small max-md:col-span-3 max-md:row-start-2 max-md:truncate">{subtitulo}</p>
      </div>
      {contador && <div className="min-w-0 max-md:col-start-3 max-md:row-start-1 max-md:justify-self-end max-md:whitespace-nowrap max-md:text-right md:flex-1">{contador}</div>}
      {estado}
      {derecha}
    </div>
  );
}

/** Lugar del estado del borrador en la cuadrícula de celular (fila propia, sin hueco mientras está vacío). */
export const CLASE_ESTADO_ENCABEZADO = 'max-md:col-span-3 max-md:row-start-3 max-md:text-xs max-md:empty:hidden';
