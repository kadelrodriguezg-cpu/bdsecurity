/**
 * Expediente resumido del individuo elegido en Resultados: panel lateral en escritorio y hoja desde abajo en el celular
 * (mismo contenido). «De dónde salen los N puntos»: valor × peso = puntos por categoría; la suma da el puntaje.
 */
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { obtenerEvaluacion } from '@/api/rondas';
import { ESTADO_RANKING_LABEL } from '@/api/rankingGrupos';
import { etiquetaCategoria, type PesoCategoria } from '@/api/resultados';
import { formatearFecha } from '@/lib/v3/formatos';
import { formatearCategoria, formatearPeso, formatearPuntos } from '@/lib/v3/puntaje';
import { etiquetaAnio, textoEmpate } from '@/lib/etiquetas';
import { qk } from '@/lib/queryKeys';
import { useAuth } from '@/features/auth/AuthContext';
import { BarraCategoria, ChipCambio } from './piezas';
import { desglose, type Cambio, type FilaResultado } from './modelo';

export function PanelIndividuo({ fila, pesos, mediana, cambio, sinCambio, especieNombre, mostrarComparar, enHoja = false, alcance, empatadoCon }: {
  fila: FilaResultado;
  pesos: readonly PesoCategoria[];
  mediana: number | null;
  cambio: Cambio | undefined;
  /** Con el cambio activado y sin cambio calculable: el motivo. */
  sinCambio?: string;
  especieNombre: string;
  /** Con el cambio activado, enlace a «Comparar rondas descriptor por descriptor». */
  mostrarComparar: boolean;
  enHoja?: boolean;
  /** G20: alcance del puesto, p. ej. «en Arándano» o «dentro del cruce 02-001». */
  alcance?: string;
  /** G19: cuántos otros comparten el puesto. */
  empatadoCon?: number;
}) {
  const { esAdmin } = useAuth();
  const lineas = desglose(fila, pesos);
  // Las barras comparan los aportes entre sí: la más larga es la categoría que más puntos aporta.
  const maxPuntos = Math.max(0, ...lineas.map((l) => l.puntos));
  const evaluacion = useQuery({
    queryKey: qk.evaluaciones.porId(fila.evaluacion_id ?? ''),
    queryFn: () => obtenerEvaluacion(fila.evaluacion_id as string),
    enabled: !!fila.evaluacion_id,
    staleTime: 60_000,
  });
  const plantaId = fila.planta_id;
  return (
    <div className="space-y-4">
      {!enHoja && <h2 className="font-mono text-title font-semibold text-ink">{fila.codigo_display}</h2>}
      <p className="text-small text-ink-3">
        {especieNombre}{fila.codigo_sistema ? ` · cruce ${fila.codigo_sistema}` : ''}
        {fila.estado !== 'comparable' && ` · ${ESTADO_RANKING_LABEL[fila.estado]}`}
      </p>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="text-[2.5rem] font-semibold leading-none tabular-nums text-ink">{formatearPuntos(fila.puntaje)}</span>
        <span className="text-small leading-tight text-ink-2">
          {etiquetaAnio(fila.numero_ronda) && <>{etiquetaAnio(fila.numero_ronda)}<br /></>}
          {fila.posicion !== null && <>puesto {fila.posicion} de {fila.tamano}{alcance ? ` ${alcance}` : ''}{textoEmpate(empatadoCon) ? ` · ${textoEmpate(empatadoCon)}` : ''}<br /></>}
          {mediana !== null && <>mediana del grupo {formatearPuntos(mediana)}</>}
        </span>
      </div>
      {(cambio || sinCambio) && <ChipCambio cambio={cambio} sinCambio={sinCambio} />}

      {/* Los pesos y el desglose del cálculo: solo el admin y plegados. El operario ve el puntaje, el puesto y la mediana. */}
      {esAdmin && lineas.length > 0 && (
        <details className="group rounded-md border border-line px-3">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-small font-medium text-ink-2">
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
            Cómo se calcula este puntaje
          </summary>
          <section aria-label="De dónde salen los puntos" className="space-y-2.5 pb-3">
            <h3 className="text-small font-semibold text-ink-2">De dónde salen los {formatearPuntos(fila.puntaje)} puntos</h3>
            <ul className="space-y-2.5">
              {lineas.map((l) => (
                <li key={l.categoria}>
                  <div className="flex items-baseline justify-between gap-2 text-small">
                    <span className="text-ink">{etiquetaCategoria(l.categoria)} <span className="tabular-nums text-ink-2">{formatearCategoria(l.valor)} × {formatearPeso(l.pesoEfectivo)}%</span></span>
                    <span className="tabular-nums font-semibold text-ink">{formatearPuntos(l.puntos)} pts</span>
                  </div>
                  <BarraCategoria valor={maxPuntos > 0 ? l.puntos / maxPuntos : 0} />
                </li>
              ))}
            </ul>
          </section>
        </details>
      )}

      <p className="text-small text-ink-3">
        Última evaluación cerrada
        {fila.numero_ronda !== null && ` · Ronda ${fila.numero_ronda}`}
        {fila.fecha_evaluacion && ` · ${formatearFecha(fila.fecha_evaluacion)}`}
        {evaluacion.data?.evaluador && ` · ${evaluacion.data.evaluador}`}
      </p>

      {plantaId && (
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/planta/${plantaId}?pestana=individuos&individuo=${fila.individuo_id}`}
            className="inline-flex min-h-tap flex-1 items-center justify-center rounded-md bg-primary px-4 text-small font-semibold text-white hover:bg-brand-d"
          >
            Abrir expediente
          </Link>
          <Link to={`/planta/${plantaId}`} className="inline-flex min-h-tap items-center justify-center rounded-md border border-line-strong bg-white px-4 text-small text-ink hover:bg-surface-2">
            Ver ficha
          </Link>
        </div>
      )}
      {mostrarComparar && plantaId && (
        <Link to={`/planta/${plantaId}/comparar/${fila.individuo_id}`} className="inline-flex min-h-tap items-center text-small text-brand underline-offset-4 hover:underline">
          Comparar rondas descriptor por descriptor
        </Link>
      )}
    </div>
  );
}
