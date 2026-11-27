/**
 * Acciones y datos propios de la fase del cruce, dentro del expediente del individuo (v3 paso 4,
 * docs/rediseno_v3/ficha.md §5). Antes vivían en la lista vieja (`IndividuosSeccion`), una tarjeta desplegable
 * por individuo. Misma regla que allá: una sección aparece si tiene datos o si su acción está disponible ahora.
 *
 * - Trasplante: «+ Evaluación Trasplante» (en un modal, como antes) y sus evaluaciones reducidas (paso 5, N22).
 * - Crecimiento: «+ Evaluación Crecimiento» (pantalla completa) y sus evaluaciones reducidas.
 * - Multisitio: «+ Registrar traslado» (SOLO admin, como antes), emplazamiento y rondas multisitio (1–3).
 * - Proceso finalizado: lo registrado en Trasplante, Crecimiento y Multisitio, solo lectura.
 * Las rondas anuales, el PCR, la baja, el clon y la etiqueta ya estaban en el expediente.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { obtenerResumenIndividuos, type Individuo } from '@/api/individuos';
import type { EstadoPlanta } from '@/types/domain';
import { ESTADO_LABEL } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { SeccionColapsable } from '@/components/shared/SeccionColapsable';
import { useAuth } from '@/features/auth/AuthContext';
import { qk } from '@/lib/queryKeys';
import { rutaEvaluarCrecimiento, rutaEvaluarMultisitio } from '@/lib/rutasIndividuo';
import { EvaluacionReducidaForm } from './EvaluacionReducidaForm';
import { EvaluacionReducidaResumen } from './EvaluacionReducidaResumen';
import { MultisitioForm } from './MultisitioForm';
import { MultisitioResumen } from './MultisitioResumen';
import { RondasSeccion } from './RondasSeccion';

export function AccionesFaseIndividuo({ individuo, plantaId, codigoSistema: _codigoSistema, estadoCruce }: {
  individuo: Individuo;
  plantaId: string;
  codigoSistema: string;
  estadoCruce: EstadoPlanta;
}) {
  const navigate = useNavigate();
  const { esAdmin } = useAuth();
  const [trasladoAbierto, setTrasladoAbierto] = useState(false);
  const [trasladoTocado, setTrasladoTocado] = useState(false);
  const [trasplanteAbierto, setTrasplanteAbierto] = useState(false);
  const [trasplanteTocado, setTrasplanteTocado] = useState(false);
  // Misma consulta (y caché) que usaba la lista vieja: un solo resumen para todo el cruce.
  const { data: resumenes } = useQuery({ queryKey: qk.individuos.resumen(plantaId), queryFn: () => obtenerResumenIndividuos(plantaId) });
  const resumen = resumenes?.[individuo.id];

  const esVivo = individuo.estado_vital === 'vivo';
  // Al cerrar una evaluación a pantalla completa se vuelve a este individuo.
  const volverAqui = `/planta/${plantaId}?pestana=individuos&individuo=${individuo.id}`;
  const countTrasplante = resumen?.count_eval_trasplante ?? 0;
  const countCrecimiento = resumen?.count_eval_crecimiento ?? 0;
  const rondasMultisitio = resumen?.rondas_multisitio_count ?? 0;
  const emplazamientos = resumen?.emplazamiento_count ?? 0;

  const puedeTrasplante = esVivo && estadoCruce === 'trasplante';
  const puedeCrecimiento = esVivo && estadoCruce === 'crecimiento';
  const puedeTraslado = esAdmin && esVivo && estadoCruce === 'traslado_destino';
  const puedeRondaMultisitio = esVivo && estadoCruce === 'traslado_destino';
  const mostrarTrasplante = countTrasplante > 0 || puedeTrasplante;
  const mostrarCrecimiento = countCrecimiento > 0 || puedeCrecimiento;
  const mostrarMultisitio = emplazamientos > 0 || rondasMultisitio > 0 || puedeTraslado || puedeRondaMultisitio;
  if (!mostrarTrasplante && !mostrarCrecimiento && !mostrarMultisitio) return null;

  const cerrarTraslado = () => { setTrasladoAbierto(false); setTrasladoTocado(false); };
  const cerrarTrasplante = () => { setTrasplanteAbierto(false); setTrasplanteTocado(false); };

  return (
    <section aria-label={`Fase ${ESTADO_LABEL[estadoCruce]}`} className="mb-3.5 space-y-2.5 rounded-md border border-line-soft p-3">
      <h3 className="text-small font-semibold text-ink-2">Fase {ESTADO_LABEL[estadoCruce]}</h3>
      {(puedeTrasplante || puedeCrecimiento || puedeTraslado) && (
        <div className="flex flex-wrap gap-2">
          {puedeTrasplante && (
            <Button size="sm" onClick={() => setTrasplanteAbierto(true)}>+ Evaluación Trasplante</Button>
          )}
          {puedeCrecimiento && (
            <Button size="sm" onClick={() => navigate(rutaEvaluarCrecimiento(plantaId, individuo.id, volverAqui))}>+ Evaluación Crecimiento</Button>
          )}
          {puedeTraslado && (
            <Button size="sm" variant="outline" onClick={() => setTrasladoAbierto(true)}>+ Registrar traslado</Button>
          )}
        </div>
      )}

      {mostrarTrasplante && (
        <SeccionColapsable titulo="Evaluación reducida — Trasplante" defaultAbierto={puedeTrasplante} resumen={countTrasplante > 0 ? `${countTrasplante} registrada(s)` : undefined}>
          <EvaluacionReducidaResumen individuoId={individuo.id} fase="trasplante" />
        </SeccionColapsable>
      )}
      {mostrarCrecimiento && (
        <SeccionColapsable titulo="Evaluación reducida — Crecimiento" defaultAbierto={puedeCrecimiento} resumen={countCrecimiento > 0 ? `${countCrecimiento} registrada(s)` : undefined}>
          <EvaluacionReducidaResumen individuoId={individuo.id} fase="crecimiento" />
        </SeccionColapsable>
      )}
      {mostrarMultisitio && (
        <SeccionColapsable
          titulo="Ensayos multisitio"
          defaultAbierto={puedeTraslado || puedeRondaMultisitio}
          resumen={resumen?.emplazamiento_predio_nombre ? `${resumen.emplazamiento_predio_nombre} · ${resumen.emplazamiento_sector_nombre}` : undefined}
        >
          <div className="space-y-3">
            <MultisitioResumen individuoId={individuo.id} />
            <div className="space-y-1.5 border-t pt-3">
              <h4 className="text-xs font-semibold text-ink-2">Rondas multisitio (de 1 a 3)</h4>
              <RondasSeccion
                individuoId={individuo.id}
                plantaId={plantaId}
                codigoDisplay={individuo.codigo_display}
                puedeIniciar={puedeRondaMultisitio}
                tipo="multisitio"
                onEvaluarPantalla={(numeroRonda) => navigate(rutaEvaluarMultisitio(plantaId, individuo.id, { ronda: numeroRonda, volver: volverAqui }))}
              />
            </div>
          </div>
        </SeccionColapsable>
      )}

      <Modal open={trasplanteAbierto} onClose={cerrarTrasplante} title="Evaluación reducida — Trasplante" hayContenido={trasplanteTocado}>
        <EvaluacionReducidaForm individuoId={individuo.id} plantaId={plantaId} fase="trasplante" onGuardado={cerrarTrasplante} onTocadoChange={setTrasplanteTocado} />
      </Modal>
      <Modal open={trasladoAbierto} onClose={cerrarTraslado} title="Registrar traslado" hayContenido={trasladoTocado}>
        <MultisitioForm individuoId={individuo.id} plantaId={plantaId} onGuardado={cerrarTraslado} onTocadoChange={setTrasladoTocado} />
      </Modal>
    </section>
  );
}
