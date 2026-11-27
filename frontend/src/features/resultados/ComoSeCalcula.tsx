/**
 * «Cómo se calcula»: la explicación del puntaje y los pesos de cada categoría. Solo la ve el admin (el rol en el
 * frontend es UX, no seguridad) y va plegada: nunca en la pantalla principal. Sin el nombre de la versión de puntaje.
 */
import { ChevronRight } from 'lucide-react';
import { etiquetaCategoria, type PesoCategoria } from '@/api/resultados';
import { formatearPeso } from '@/lib/v3/puntaje';

const lista = (pesos: readonly PesoCategoria[]) => pesos.map((p) => `${etiquetaCategoria(p.categoria)} ${formatearPeso(p.peso)} %`).join(' · ');

export function ComoSeCalcula({ pesos, pesosGrupo }: {
  /** Pesos de todas las categorías del puntaje. */
  pesos: readonly PesoCategoria[];
  /** Pesos ya repartidos dentro del grupo que se está viendo (suman 100 %). */
  pesosGrupo: readonly PesoCategoria[];
}) {
  if (pesos.length === 0) return null;
  const repartidos = pesosGrupo.length > 0 && pesosGrupo.length < pesos.length;
  return (
    <details className="group rounded-lg border border-line bg-surface px-4">
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-small font-medium text-ink-2">
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        Cómo se calcula
      </summary>
      <div className="space-y-2 pb-3 text-small text-ink-2">
        <p>El puntaje va de 0 a 100. Cada categoría aporta según su peso: {lista(pesos)}.</p>
        {repartidos && (
          <p>En este grupo solo cuentan las categorías evaluadas, así que sus pesos se reparten así: {lista(pesosGrupo)}.</p>
        )}
      </div>
    </details>
  );
}
