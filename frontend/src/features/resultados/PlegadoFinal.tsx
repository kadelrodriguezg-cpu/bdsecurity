/** Plegado al final de Resultados: «Excluidas por revisión · Sin puntaje · En otros grupos», con sus motivos. */
import { ESTADO_RANKING_LABEL } from '@/api/rankingGrupos';
import { etiquetaCategoria } from '@/api/resultados';
import { ordenarGrupo } from '@/api/scoring';
import type { Plegado } from './modelo';

export function PlegadoFinal({ plegado, congelado }: { plegado: Plegado; congelado: boolean }) {
  const { excluidas, sinPuntaje, otrosGrupos } = plegado;
  if (congelado) {
    return <p className="rounded-lg border border-line bg-surface px-4 py-3 text-small text-ink-3">Un ranking congelado guarda solo los individuos con puesto: no tiene excluidos ni individuos sin puntaje.</p>;
  }
  const lista = (titulo: string, filas: typeof excluidas, motivo: (f: (typeof excluidas)[number]) => string) => (
    <section aria-label={titulo} className="space-y-1">
      <h3 className="text-small font-semibold text-ink">{titulo} ({filas.length})</h3>
      {filas.length === 0 ? <p className="text-small text-ink-3">Ninguno.</p> : (
        <ul className="grid gap-x-6 gap-y-0.5 text-small sm:grid-cols-2 lg:grid-cols-3">
          {filas.slice(0, 60).map((f) => <li key={f.individuo_id} className="flex justify-between gap-2"><span className="font-mono text-ink">{f.codigo_display}</span><span className="truncate text-ink-3">{motivo(f)}</span></li>)}
          {filas.length > 60 && <li className="text-ink-3">y {filas.length - 60} más</li>}
        </ul>
      )}
    </section>
  );
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-body font-semibold text-ink">
        <span>Excluidas por revisión ({excluidas.length}) · Sin puntaje ({sinPuntaje.length}) · En otros grupos ({otrosGrupos.length})</span>
        <span className="text-small font-normal text-brand group-open:hidden">Ver</span>
        <span className="hidden text-small font-normal text-brand group-open:inline">Ocultar</span>
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-3">
        {lista('Excluidas por revisión', excluidas, (f) => ESTADO_RANKING_LABEL[f.estado])}
        {lista('Sin puntaje', sinPuntaje, (f) => ESTADO_RANKING_LABEL[f.estado])}
        {lista('En otros grupos', otrosGrupos, (f) => ordenarGrupo(f.grupo).map(etiquetaCategoria).join(' · '))}
      </div>
    </details>
  );
}
