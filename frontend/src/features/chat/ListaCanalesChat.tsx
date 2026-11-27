import { useMemo, useState } from 'react';
import { Archive, Hash, Leaf, MapPin, MessageCircle, Search } from 'lucide-react';
import type { CanalChat } from '@/types/chat';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

function tituloCanal(canal: CanalChat) {
  if (canal.tipo === 'general') return 'General';
  if (canal.entidad_nombre) return canal.entidad_nombre;
  if (canal.tipo === 'cruce') return 'Cruce archivado';
  if (canal.tipo === 'predio') return 'Predio archivado';
  return 'Canal libre';
}

export function ListaCanalesChat({
  canales,
  canalActivoId,
  onSeleccionar,
}: {
  canales: CanalChat[];
  canalActivoId?: string;
  onSeleccionar: (canal: CanalChat) => void;
}) {
  const [filtro, setFiltro] = useState('');
  const canalesVisibles = useMemo(() => {
    const texto = filtro.trim().toLocaleLowerCase('es-CL');
    return texto
      ? canales.filter((canal) => tituloCanal(canal).toLocaleLowerCase('es-CL').includes(texto))
      : canales;
  }, [canales, filtro]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line p-2 lg:p-3">
        <label htmlFor="buscar-chat" className="sr-only">Buscar conversación</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input id="buscar-chat" value={filtro} onChange={(evento) => setFiltro(evento.target.value)} placeholder="Buscar conversación…" className="pl-9" />
        </div>
      </div>
      <nav aria-label="Conversaciones" className="flex gap-2 overflow-x-auto p-2 lg:flex-col lg:overflow-y-auto lg:p-3">
        {canalesVisibles.map((canal) => {
          const activo = canal.id === canalActivoId;
          const Icono = canal.archivado
            ? Archive
            : canal.tipo === 'general' ? MessageCircle : canal.tipo === 'cruce' ? Leaf : canal.tipo === 'predio' ? MapPin : Hash;
          return (
            <button
              key={canal.id}
              type="button"
              aria-current={activo ? 'page' : undefined}
              onClick={() => onSeleccionar(canal)}
              className={cn(
                'flex min-h-tap min-w-[170px] items-center gap-3 rounded-md px-3 py-2 text-left transition-colors lg:min-w-0 lg:w-full',
                activo ? 'bg-brand-l text-brand-ink' : 'text-ink-2 hover:bg-surface-2',
              )}
            >
              <span className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                activo ? 'bg-surface text-brand' : 'bg-surface-2 text-ink-3',
              )}>
                <Icono className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tituloCanal(canal)}</span>
                  {canal.no_leidos > 0 && (
                    <span
                      aria-label={`${canal.no_leidos} mensajes sin leer`}
                      className="grid min-h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1 text-micro font-semibold leading-none text-white"
                    >
                      {canal.no_leidos > 99 ? '99+' : canal.no_leidos}
                    </span>
                  )}
                </span>
                <span className="block truncate text-small text-ink-3">
                  {canal.tipo === 'general'
                    ? 'Panorama del equipo'
                      : canal.archivado
                        ? 'Solo lectura'
                        : canal.tipo === 'cruce'
                          ? 'Conversación del cruce'
                          : canal.tipo === 'predio' ? 'Conversación del predio' : 'Canal del equipo'}
                </span>
              </span>
            </button>
          );
        })}
        {canalesVisibles.length === 0 && <p className="px-3 py-4 text-center text-small text-ink-3">No hay conversaciones que coincidan.</p>}
      </nav>
    </div>
  );
}
