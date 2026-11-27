/**
 * Elige el formulario estructurado según la fase actual del cruce. Trasplante
 * ya tiene su propio panel (IndividualizarPanel, Prompt 2) — no se
 * reemplaza acá; Sprint 8 (3.d) le agrega además ProcedimientosSeccion (el
 * mismo componente ya usado en Crecimiento/Multisitio), montado junto a
 * IndividualizarPanel en PlantaFichaPage porque ambos aplican en esta fase.
 * sin_empezar y proceso_finalizado no tienen formulario en esta pasada.
 *
 * Crecimiento y Evaluación anual comparten el mismo panel de procedimientos
 * de cultivo a nivel de cruce (podas/fertilizaciones/aplicaciones — North
 * Star v5, sección 4: "aplicaciones y podas continúan" en Evaluación anual).
 * traslado_destino ya NO usa el formulario de predio único a nivel de cruce
 * (TrasladoForm, decidido antes de que existieran individuos) — su contenido
 * pasa a ser "Ensayos multisitio" con selector de individuo, montado en
 * IndividuosSeccion (North Star v5, sección 4, punto 5: "contenido de lo que
 * hoy es traslado_destino").
 */
import type { EstadoPlanta } from '@/types/domain';
import { PolinizacionForm } from './PolinizacionForm';
import { CosechaForm } from './CosechaForm';
import { SiembraForm } from './SiembraForm';
import { GerminacionSeccion } from './GerminacionSeccion';
import { ProcedimientosSeccion } from './ProcedimientosSeccion';
import { MultisitioSeccion } from '@/features/multisitio/MultisitioSeccion';

export function FaseFormulario({
  plantaId,
  codigoSistema,
  estado,
  onTocadoChange,
}: {
  plantaId: string;
  codigoSistema: string;
  estado: EstadoPlanta;
  onTocadoChange?: (tocado: boolean) => void;
}) {
  switch (estado) {
    case 'polinizacion':
      return <PolinizacionForm plantaId={plantaId} codigoSistema={codigoSistema} onTocadoChange={onTocadoChange} />;
    case 'cosecha':
      return <CosechaForm plantaId={plantaId} codigoSistema={codigoSistema} onTocadoChange={onTocadoChange} />;
    case 'siembra_semilla':
      return <SiembraForm plantaId={plantaId} codigoSistema={codigoSistema} onTocadoChange={onTocadoChange} />;
    case 'germinacion':
      return <GerminacionSeccion plantaId={plantaId} codigoSistema={codigoSistema} onTocadoChange={onTocadoChange} />;
    case 'crecimiento':
    case 'evaluacion_anual':
      return <ProcedimientosSeccion plantaId={plantaId} />;
    case 'traslado_destino':
      // Sección Multisitio (Sprint 7, 2.4.5): procedimientos + mapa del cruce
      // en la columna izquierda; traslados y rondas multisitio por individuo
      // siguen en IndividuosSeccion (columna de individuos).
      return <MultisitioSeccion plantaId={plantaId} />;
    default:
      // sin_empezar: todavía no hay nada que cargar.
      // trasplante: tiene su propio panel (IndividualizarPanel), no se duplica acá.
      // proceso_finalizado: ver ResumenFinal, montado aparte en PlantaFichaPage.
      return null;
  }
}
