/**
 * Avance de una ronda multisitio por predio (referencia docs/diseno/v2/06).
 * Solo avance: cuántos individuos de cada predio tienen su evaluación cerrada.
 * No hay ranking ni comparación de puntajes entre predios (decisión de Kadel):
 * cada genotipo vive en un solo predio y los predios no se ordenan entre sí.
 */
import type { FilaPlanilla } from '@/api/protocolo';
import { horaModificacion, pl } from './PlanillaPiezas';

/** Agrupa a los individuos que aún no tienen emplazamiento (el traslado se registra aparte, en Individuos). */
export const SIN_PREDIO = 'Sin predio';

export interface GrupoPredio {
  predio: string;
  vivos: number;
  completas: number;
  borradores: number;
  pendientes: number;
  sinRonda: number;
  /** La modificación más reciente de una evaluación de este predio. */
  ultima: { iso: string; evaluador: string | null } | null;
}

/** Predios por nombre, con «Sin predio» al final. */
export function agruparPorPredio(filas: readonly FilaPlanilla[], predioDe: (individuoId: string) => string | null): GrupoPredio[] {
  const grupos = new Map<string, GrupoPredio>();
  for (const f of filas) {
    const nombre = predioDe(f.individuo_id) ?? SIN_PREDIO;
    const g = grupos.get(nombre) ?? { predio: nombre, vivos: 0, completas: 0, borradores: 0, pendientes: 0, sinRonda: 0, ultima: null };
    g.vivos += 1;
    if (f.estado === 'completa') g.completas += 1;
    else if (f.estado === 'borrador') g.borradores += 1;
    else if (f.estado === 'sin_iniciar') g.pendientes += 1;
    else g.sinRonda += 1;
    if (f.evaluacion_updated_at && (!g.ultima || f.evaluacion_updated_at > g.ultima.iso)) g.ultima = { iso: f.evaluacion_updated_at, evaluador: f.evaluador };
    grupos.set(nombre, g);
  }
  return [...grupos.values()].sort((a, b) => (a.predio === SIN_PREDIO ? 1 : b.predio === SIN_PREDIO ? -1 : a.predio.localeCompare(b.predio, 'es')));
}

export function AvancePorPredio({ grupos }: { grupos: readonly GrupoPredio[] }) {
  return (
    <ul aria-label="Avance por predio" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {grupos.map((g) => {
        const pct = (n: number) => (g.vivos > 0 ? (n / g.vivos) * 100 : 0);
        return (
          <li key={g.predio} className="space-y-2 rounded-lg border border-line bg-surface p-4 max-md:space-y-1.5 max-md:p-3">
            <p className="font-semibold text-ink">{g.predio}</p>
            <p className="text-small tabular-nums text-ink-2">
              {g.completas} de {g.vivos} cerradas
              {g.borradores > 0 && ` · ${pl(g.borradores, 'borrador', 'borradores')}`}
              {g.sinRonda > 0 && ` · ${g.sinRonda} sin ronda`}
            </p>
            <div
              className="flex h-2 overflow-hidden rounded-full bg-track"
              role="img"
              aria-label={`${pl(g.completas, 'cerrada', 'cerradas')}${g.borradores > 0 ? ` y ${pl(g.borradores, 'borrador', 'borradores')}` : ''} de ${g.vivos}`}
            >
              <div className="h-full bg-brand" style={{ width: `${pct(g.completas)}%` }} />
              <div className="h-full bg-brand-c" style={{ width: `${pct(g.borradores)}%` }} />
            </div>
            {/* En celular se sale a terreno: la última actividad se omite para que la lista de pendientes quede a la vista. */}
            <p className="text-small text-ink-3 max-md:hidden">
              {g.ultima ? <>Última actividad {horaModificacion(g.ultima.iso)}{g.ultima.evaluador ? ` · ${g.ultima.evaluador}` : ''}</> : 'Sin actividad todavía'}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
