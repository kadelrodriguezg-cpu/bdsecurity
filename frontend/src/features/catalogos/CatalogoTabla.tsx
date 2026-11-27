/**
 * Patrón común de los catálogos de Administración (pasada de diseño, 26-10-2026; mismo lenguaje que Cruces y Resultados):
 * encabezado con qué es y dónde se usa, «+ Agregar», buscador por nombre, «Mostrar inactivos», tabla en escritorio y tarjetas
 * en el celular. Agregar y editar se hacen en una hoja; no hay borrado: desactivar es la única baja (los registros históricos
 * siguen apuntando al elemento).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Pencil, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTableFrame } from '@/components/ui/data-table-frame';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { cn } from '@/lib/utils';

export interface ColumnaCatalogo<T> {
  titulo: string;
  celda: (fila: T) => ReactNode;
  /** Alineada a la derecha (cifras). */
  derecha?: boolean;
}

export interface FilaCatalogo { id: string; nombre: string; activo?: boolean }

export function ChipEstado({ activo }: { activo: boolean }) {
  return activo
    ? <span className="inline-flex rounded-full bg-ok-l px-2.5 py-0.5 text-small font-medium text-ok">Activo</span>
    : <span className="inline-flex rounded-full bg-neutral-l px-2.5 py-0.5 text-small font-medium text-ink-3">Inactivo</span>;
}

export function CatalogoTabla<T extends FilaCatalogo>({
  titulo, descripcion, singular, plural, filas, columnas, nombreDe, cargando, error, onReintentar, onAgregar, onEditar, onAlternarActivo,
  alternando, aviso, filtros, extraAcciones,
}: {
  titulo: string;
  descripcion: ReactNode;
  /** «contenedor», para «Agregar contenedor» y «Editar …». */
  singular: string;
  plural: string;
  filas: T[] | undefined;
  columnas: ColumnaCatalogo<T>[];
  /** Cómo se muestra el nombre (p. ej. el contenedor sin la capacidad repetida). */
  nombreDe?: (fila: T) => ReactNode;
  cargando: boolean;
  error: string | null;
  onReintentar: () => void;
  onAgregar: () => void;
  onEditar: (fila: T) => void;
  /** Sin esto el catálogo no tiene baja (p. ej. Especies). */
  onAlternarActivo?: (fila: T) => void;
  alternando?: string | null;
  /** Nota fija bajo el encabezado (p. ej. privacidad de los nombres de predio). */
  aviso?: ReactNode;
  /** Controles extra en la barra (p. ej. filtro por región). Reciben las filas ya buscadas. */
  filtros?: ReactNode;
  extraAcciones?: (fila: T) => ReactNode;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const inactivos = (filas ?? []).filter((f) => f.activo === false).length;
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es');
    return (filas ?? [])
      .filter((f) => verInactivos || f.activo !== false)
      .filter((f) => !q || f.nombre.toLocaleLowerCase('es').includes(q));
  }, [filas, busqueda, verInactivos]);
  const activos = (filas ?? []).length - inactivos;
  const idBusqueda = `buscar-${plural.replace(/\s+/g, '-')}`;

  const acciones = (fila: T) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {extraAcciones?.(fila)}
      <Button size="sm" variant="ghost" onClick={() => onEditar(fila)} aria-label={`Editar ${fila.nombre}`}>
        <Pencil className="h-4 w-4" aria-hidden="true" /> Editar
      </Button>
      {onAlternarActivo && (
        <Button size="sm" variant="ghost" disabled={alternando === fila.id} onClick={() => onAlternarActivo(fila)} aria-label={`${fila.activo === false ? 'Activar' : 'Desactivar'} ${fila.nombre}`}>
          {fila.activo === false ? 'Activar' : 'Desactivar'}
        </Button>
      )}
    </div>
  );

  return (
    <section aria-label={titulo} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-body-l font-semibold text-ink">{titulo}</h2>
          <p className="text-small text-ink-2">{descripcion}</p>
          {filas && filas.length > 0 && (
            <p className="text-small tabular-nums text-ink-3">{activos} {activos === 1 ? 'activo' : 'activos'}{inactivos > 0 ? ` · ${inactivos} ${inactivos === 1 ? 'inactivo' : 'inactivos'}` : ''}</p>
          )}
        </div>
        <Button size="sm" disabled={!!error} onClick={onAgregar}><Plus className="h-4 w-4" aria-hidden="true" /> Agregar {singular}</Button>
      </div>
      {aviso}

      {filas && filas.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 md:gap-3">
          <div className="min-w-0 flex-1 space-y-1 md:max-w-xs">
            <Label htmlFor={idBusqueda}>Buscar por nombre</Label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <Input id={idBusqueda} className="pl-9" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
          </div>
          {filtros}
          {inactivos > 0 && (
            <button
              type="button"
              aria-pressed={verInactivos}
              onClick={() => setVerInactivos((v) => !v)}
              className={cn(
                'inline-flex min-h-tap items-center rounded-full border px-3 text-small font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                verInactivos ? 'border-primary bg-brand-l text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
              )}
            >
              Mostrar inactivos ({inactivos})
            </button>
          )}
        </div>
      )}

      {error ? <EstadoError mensaje={error} onReintentar={onReintentar} />
        : cargando || !filas ? <EstadoCargando etiqueta={`Cargando ${plural}…`} forma="esqueleto" />
          : filas.length === 0 ? <EstadoVacio titulo={`Todavía no hay ${plural}.`} accion={<Button size="sm" onClick={onAgregar}><Plus className="h-4 w-4" aria-hidden="true" /> Agregar {singular}</Button>} />
            : visibles.length === 0 ? <EstadoVacio titulo={`No hay ${plural} que coincidan.`} accion={<Button size="sm" variant="outline" onClick={() => { setBusqueda(''); setVerInactivos(true); }}>Ver todos</Button>} />
              : (
                <>
                  <div className="hidden md:block">
                    <DataTableFrame label={`Tabla de ${plural}`} className="max-h-none border border-line bg-surface">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-ink-3">
                            <th className="px-4 py-2.5 font-medium">Nombre</th>
                            {columnas.map((c) => <th key={c.titulo} className={cn('px-3 py-2.5 font-medium', c.derecha && 'text-right')}>{c.titulo}</th>)}
                            {onAlternarActivo && <th className="px-3 py-2.5 font-medium">Estado</th>}
                            <th className="px-3 py-2.5 font-medium"><span className="sr-only">Acciones</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibles.map((fila) => (
                            <tr key={fila.id} className={cn('border-b align-top last:border-0', fila.activo === false && 'text-ink-3')}>
                              <th scope="row" className="px-4 py-3 text-left font-medium">{nombreDe ? nombreDe(fila) : fila.nombre}</th>
                              {columnas.map((c) => <td key={c.titulo} className={cn('px-3 py-3', c.derecha && 'text-right tabular-nums')}>{c.celda(fila)}</td>)}
                              {onAlternarActivo && <td className="px-3 py-3"><ChipEstado activo={fila.activo !== false} /></td>}
                              <td className="px-3 py-2">{acciones(fila)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </DataTableFrame>
                  </div>
                  <ul aria-label={`Lista de ${plural}`} className="grid gap-2 md:hidden">
                    {visibles.map((fila) => (
                      <li key={fila.id} className={cn('space-y-2 rounded-lg border border-line bg-surface p-3', fila.activo === false && 'text-ink-3')}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 font-medium">{nombreDe ? nombreDe(fila) : fila.nombre}</span>
                          {onAlternarActivo && <ChipEstado activo={fila.activo !== false} />}
                        </div>
                        {columnas.length > 0 && (
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-small">
                            {columnas.map((c) => (
                              <div key={c.titulo} className="min-w-0"><dt className="text-ink-3">{c.titulo}</dt><dd className="text-ink-2">{c.celda(fila)}</dd></div>
                            ))}
                          </dl>
                        )}
                        {acciones(fila)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
    </section>
  );
}
