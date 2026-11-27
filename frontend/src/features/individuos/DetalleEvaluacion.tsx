/**
 * Evaluación pasada (solo lectura). Muestra todo lo guardado, sección por
 * sección, con el estado de cada descriptor según el protocolo congelado de la
 * evaluación (Fase 2): medido · faltó (obligatorio) · no evaluado · marcado.
 * Los estados vienen de la base (obtener_estados_evaluacion); mientras cargan,
 * o sin conexión, se calculan en el cliente sin protocolo (medido / no
 * evaluado). Lo usan el expediente del individuo y la lista de la ronda.
 */
import { formatearFecha } from '@/lib/v3/formatos';
import { useQuery } from '@tanstack/react-query';
import { obtenerEstadosEvaluacion, type EstadoDescriptor } from '@/api/protocolo';
import type { EvaluacionRow, EstadoEvaluacion } from '@/api/rondas';
import { HuellaEvaluacion } from '@/features/evaluaciones/HuellaEvaluacion';
import { ESQUEMA_EVALUACION_ANUAL, exportableCalculado } from '@/lib/esquemaFase/evaluacionAnual';
import { estadoDescriptor, NIVEL_SECCION_LABEL, resumenSecciones } from '@/lib/esquemaFase/protocolo';
import { useEspecieDeCruce, useEsquemaEvaluacionAnualDeEspecie } from '@/lib/esquemaFase/useEsquemaFase';
import {
  camposDeSeccion,
  contarDescriptoresConValor,
  descriptoresDe,
  esquemaVisibleDe,
  formatearValorCampo,
  noExistianDe,
  tieneValor,
} from '@/lib/esquemaFase/tipos';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

export const ESTADO_EVALUACION_LABEL: Record<EstadoEvaluacion, string> = {
  borrador: 'Borrador',
  completa: 'Completa',
  corregida: 'Corregida',
  anulada: 'Anulada',
};

/** «N de M descriptores»: M no cuenta los descriptores creados después de la fecha de la evaluación (no se pudieron medir). */
export function resumenDescriptores(evaluacion: EvaluacionRow): string {
  const esquema = esquemaVisibleDe(ESQUEMA_EVALUACION_ANUAL, evaluacion as unknown as Record<string, unknown>, evaluacion.fecha);
  return `${contarDescriptoresConValor(esquema, evaluacion)} de ${descriptoresDe(esquema).length} descriptores`;
}

/**
 * Estado de cada descriptor según el protocolo congelado de la evaluación (lo comparten el detalle y la página). Con el cruce,
 * el esquema es el de su especie (fase 4: etiquetas propias; lo que la especie no usa solo aparece si la evaluación trae valor).
 */
export function useEstadosEvaluacion(evaluacion: EvaluacionRow, plantaId?: string) {
  // Un campo desactivado (rend_t_ha) solo aparece si esta evaluación ya trae un valor: el dato histórico se conserva.
  // Un descriptor creado después de la fecha de la evaluación no se pudo medir: sale del esquema (no cuenta) y se nombra aparte.
  const completo = useEsquemaEvaluacionAnualDeEspecie(useEspecieDeCruce(plantaId));
  const valores = evaluacion as unknown as Record<string, unknown>;
  const visible = esquemaVisibleDe(completo, valores, evaluacion.fecha);
  const noExistian = noExistianDe(completo, valores, evaluacion.fecha);
  const estadosQuery = useQuery({
    queryKey: qk.protocolo.estados(evaluacion.id),
    queryFn: () => obtenerEstadosEvaluacion(evaluacion.id),
    staleTime: 30_000,
  });
  // La base ya sabe qué descriptores cuentan para esta evaluación (especie, fecha y desactivados): con su respuesta, lo que no
  // nombra no se muestra como «no evaluado». Los derivados no tienen estado y se quedan.
  const deLaBase = estadosQuery.data?.estados as Record<string, unknown> | undefined;
  const esquema = deLaBase ? { ...visible, campos: visible.campos.filter((c) => c.rol === 'derivado' || c.clave in deLaBase) } : visible;
  const protocolo = estadosQuery.data?.protocolo ?? null;
  const estadoDe = (clave: string): EstadoDescriptor =>
    estadosQuery.data?.estados[clave as keyof typeof estadosQuery.data.estados]
    ?? estadoDescriptor(clave, evaluacion[clave as keyof EvaluacionRow], null);
  const estados: Record<string, EstadoDescriptor> = Object.fromEntries(esquema.campos.map((c) => [c.clave, estadoDe(c.clave)]));
  const secciones = new Map(resumenSecciones(esquema, protocolo?.descriptores ?? null).map((s) => [s.id, s]));
  return { esquema, estadosQuery, protocolo, estados, secciones, noExistian };
}

export function DetalleEvaluacion({ evaluacion, className, plantaId }: { evaluacion: EvaluacionRow; className?: string; plantaId?: string }) {
  const { esquema, estadosQuery, protocolo, estados, secciones } = useEstadosEvaluacion(evaluacion, plantaId);
  // El % exportable se calcula con la poscosecha de esta visita (o es el valor histórico escrito a mano).
  const lectura: Record<string, unknown> = { ...evaluacion, pct_fruta_exportable: exportableCalculado(evaluacion as unknown as Record<string, unknown>) };

  return (
    <div className={cn('space-y-3 text-small', className)}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div>
          <dt className="text-ink-3">Fecha efectiva</dt>
          <dd className="tabular-nums text-ink">{formatearFecha(evaluacion.fecha)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Año</dt>
          <dd className="tabular-nums text-ink">{evaluacion.anio}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Estado</dt>
          <dd className="text-ink">{ESTADO_EVALUACION_LABEL[evaluacion.estado]}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Evaluador</dt>
          <dd className="text-ink">{evaluacion.evaluador || 'Sin registrar'}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-ink-3">Protocolo</dt>
          <dd className="text-ink">
            {protocolo
              ? `${protocolo.nombre} · versión ${protocolo.version}`
              : estadosQuery.isSuccess ? 'Sin protocolo (anterior a los protocolos de ronda)' : 'Sin confirmar'}
          </dd>
        </div>
      </dl>

      {(evaluacion.requiere_revision || evaluacion.no_comparable || evaluacion.sin_muestra) && (
        <ul className="flex flex-wrap gap-1.5">
          {evaluacion.requiere_revision && (
            <li className="rounded-full bg-danger-l px-2.5 py-0.5 text-danger">Revisar: no entra al ranking hasta resolverse</li>
          )}
          {evaluacion.no_comparable && (
            <li className="rounded-full bg-neutral-l px-2.5 py-0.5 text-ink-2">Marcada como no comparable</li>
          )}
          {evaluacion.sin_muestra && (
            <li className="rounded-full bg-neutral-l px-2.5 py-0.5 text-ink-2">Sin muestra de frutos</li>
          )}
        </ul>
      )}

      <HuellaEvaluacion esquema={esquema} estados={estados} className="border-t border-line-soft pt-2.5" />

      {esquema.secciones.map((seccion) => {
        const campos = camposDeSeccion(esquema, seccion.id);
        const visibles = campos.filter((campo) => campo.rol === 'derivado'
          ? tieneValor(lectura[campo.clave])
          : estados[campo.clave] !== 'no_evaluado');
        const noEvaluados = campos.filter((campo) => campo.rol !== 'derivado' && estados[campo.clave] === 'no_evaluado');
        const nivel = secciones.get(seccion.id)?.nivel;
        return (
          <section key={seccion.id} aria-label={seccion.etiqueta} className="space-y-1.5 border-t border-line-soft pt-2.5">
            <h4 className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-ink-2">{seccion.etiqueta}</span>
              {protocolo && nivel && <span className="text-ink-3">{NIVEL_SECCION_LABEL[nivel]}</span>}
            </h4>
            {/* Una columna: el detalle vive también en el panel angosto del expediente. */}
            {visibles.length > 0 && (
              <dl className="space-y-1">
                {visibles.map((campo) => {
                  const estado = campo.rol === 'derivado' ? 'medido' : estados[campo.clave];
                  return (
                    <div key={campo.clave} className="flex items-baseline justify-between gap-3">
                      <dt className="min-w-0 text-ink-3">
                        {campo.etiqueta}
                        {campo.rol === 'derivado' && <span className="sr-only"> (calculado)</span>}
                      </dt>
                      {estado === 'falto' ? (
                        <dd className="shrink-0 whitespace-nowrap text-right text-warn">Falta · era obligatorio</dd>
                      ) : (
                        <dd className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-right tabular-nums text-ink">
                          {formatearValorCampo(campo, lectura[campo.clave])}
                          {estado === 'marcado' && (
                            <span className="rounded-full bg-danger-l px-1.5 text-danger">Revisar</span>
                          )}
                        </dd>
                      )}
                    </div>
                  );
                })}
              </dl>
            )}
            {noEvaluados.length > 0 && (
              <p className="text-ink-3">
                No evaluado: {noEvaluados.map((campo) => campo.etiqueta.toLowerCase()).join(', ')}.
              </p>
            )}
          </section>
        );
      })}

      <section aria-label="Observaciones" className="space-y-1 border-t border-line-soft pt-2.5">
        <h4 className="font-semibold text-ink-2">Observaciones</h4>
        <p className={cn('whitespace-pre-line', evaluacion.observaciones ? 'text-ink' : 'text-ink-3')}>
          {evaluacion.observaciones || 'Sin observaciones.'}
        </p>
      </section>
    </div>
  );
}
