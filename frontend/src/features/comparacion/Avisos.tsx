/**
 * Avisos y formatos que comparten «Comparar rondas» de un individuo y la
 * pestaña «Comparación histórica» del ranking: ambas deben decir lo mismo
 * cuando dos rondas se calcularon con categorías o versiones distintas.
 */
import { TriangleAlert } from 'lucide-react';
import { formatearCambio } from '@/lib/v3/puntaje';
import { CATEGORIA_LABEL, ordenarGrupo, type CategoriaScoring } from '@/api/scoring';
import { cn } from '@/lib/utils';

export const TEXTO_GRUPOS_DISTINTOS = 'Los puntajes de grupos distintos no se restan: cada uno se calcula con las categorías que se midieron.';

export const nombreGrupo = (grupo: readonly CategoriaScoring[] | null) =>
  grupo === null ? 'sin determinar' : grupo.length === 0 ? 'ninguna categoría' : ordenarGrupo(grupo).map((c) => CATEGORIA_LABEL[c]).join(' · ');

export function AvisoComparacion({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="note" className={cn('flex gap-2 rounded-md bg-warn-l p-3 text-small text-warn', className)}>
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Aviso de grupos distintos con la combinación de cada ronda. */
export function AvisoGruposDistintos({ numeroA, grupoA, numeroB, grupoB }: {
  numeroA: number;
  grupoA: readonly CategoriaScoring[];
  numeroB: number;
  grupoB: readonly CategoriaScoring[];
}) {
  return (
    <AvisoComparacion>
      {TEXTO_GRUPOS_DISTINTOS}{' '}
      Ronda {numeroA}: {nombreGrupo(grupoA)}. Ronda {numeroB}: {nombreGrupo(grupoB)}.
    </AvisoComparacion>
  );
}

/** Diferencia de puntaje con signo, en puntos (N34: formato compartido de `lib/v3/puntaje.ts`). */
export function formatearDiferenciaPuntaje(diferencia: number): string {
  return formatearCambio(diferencia);
}
