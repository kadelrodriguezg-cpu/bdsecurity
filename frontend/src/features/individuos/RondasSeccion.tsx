/**
 * Rondas de evaluación de un individuo (1-3 por serie). Desde Sprint 7 el
 * componente sirve las DOS series de la tabla generalizada (2.3 del
 * documento maestro): `tipo='anual'` (la de siempre) y `tipo='multisitio'`
 * (contador propio e independiente — un individuo puede tener anual 1-3 Y
 * multisitio 1-3 en paralelo). Misma mecánica y mismo formulario completo de
 * 15 descriptores + PCR por ronda; lo que cambia es la serie, su gate de
 * fase (anual ⇒ cruce en evaluacion_anual; multisitio ⇒ cruce en
 * traslado_destino) y la identidad visual — el usuario siempre ve en qué
 * serie está parado (badge + acento de color en las rondas multisitio).
 *
 * Los formularios de carga (evaluación completa, PCR) se abren en un modal
 * (North Star v5, rediseño de UX Parte D.5).
 */
import { formatearFecha } from '@/lib/v3/formatos';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, CalendarPlus, MapPinned } from 'lucide-react';
import { listarRondas, iniciarRonda, iniciarRondaMultisitio, type TipoRonda } from '@/api/rondas';
import { mensajeInicioRonda } from '@/lib/confirmacionRonda';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Sheet } from '@/components/ui/sheet';
import { EvaluacionForm } from './EvaluacionForm';
import { EvaluacionesLista } from './EvaluacionesLista';
import { PcrForm } from './PcrForm';
import { PcrLista } from './PcrLista';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/queryKeys';
import { temporadaDeRonda } from '@/lib/temporada';

type ModalRonda = 'evaluacion' | 'pcr' | null;

function FilaRonda({
  rondaId,
  numeroRonda,
  tipo,
  temporada,
  fechaInicio,
  codigoDisplay,
  plantaId,
  puedeAgregar,
  onEvaluarPantalla,
}: {
  rondaId: string;
  numeroRonda: number;
  tipo: TipoRonda;
  /** Fase 5 (G2): etiqueta de temporada (julio a junio) de la ronda anual. */
  temporada: string | null;
  fechaInicio: string | null;
  codigoDisplay: string;
  plantaId: string;
  puedeAgregar: boolean;
  /** Si se da, «Nueva evaluación» abre la evaluación a pantalla completa de esta ronda en vez de la hoja lateral. */
  onEvaluarPantalla?: (numeroRonda: number) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [modal, setModal] = useState<ModalRonda>(null);
  const [modalTocado, setModalTocado] = useState(false);

  const esMultisitio = tipo === 'multisitio';
  const tituloRonda = esMultisitio ? `Ronda multisitio ${numeroRonda}` : `Ronda ${numeroRonda}`;

  return (
    <li className={cn('rounded-md border', esMultisitio && 'border-line-strong bg-surface-2')}>
      <button type="button" onClick={() => setAbierto((a) => !a)} className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm">
        <span className="flex items-center gap-1.5">
          {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="font-medium">{tituloRonda}</span>
          {esMultisitio && (
            <Badge className="bg-neutral-l text-ink-2">
              <MapPinned className="mr-1 h-3 w-3" /> multisitio
            </Badge>
          )}
        </span>
        <span className="text-xs text-ink-3">{esMultisitio ? (fechaInicio ? formatearFecha(fechaInicio) : '') : temporada ? `Temporada ${temporada}` : ''}</span>
      </button>

      {abierto && (
        <div className="space-y-3 border-t p-3">
          {puedeAgregar && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => (onEvaluarPantalla ? onEvaluarPantalla(numeroRonda) : setModal('evaluacion'))}>
                Nueva evaluación
              </Button>
              <Button size="sm" variant="outline" onClick={() => setModal('pcr')}>
                Nuevo PCR
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <h5 className="text-xs font-semibold text-ink-2">Evaluaciones de esta ronda</h5>
            <EvaluacionesLista rondaId={rondaId} plantaId={plantaId} />
          </div>

          <div className="space-y-1.5 border-t pt-3">
            <h5 className="text-xs font-semibold text-ink-2">PCR de esta ronda</h5>
            <PcrLista rondaId={rondaId} />
          </div>
        </div>
      )}

      {modal === 'evaluacion' && (
        <Sheet
          titulo="Nueva evaluación"
          subtitulo={`${codigoDisplay} · ${tituloRonda}`}
          onCerrar={() => { setModal(null); setModalTocado(false); }}
          hayContenido={modalTocado}
          size="evaluacion"
        >
          <EvaluacionForm
            rondaId={rondaId}
            plantaId={plantaId}
            codigoIndividuo={codigoDisplay}
            numeroRonda={numeroRonda}
            tipoRonda={tipo}
            onGuardado={() => { setModal(null); setModalTocado(false); }}
            onCerrar={() => { setModal(null); setModalTocado(false); }}
            onTocadoChange={setModalTocado}
          />
        </Sheet>
      )}
      <Modal open={modal === 'pcr'} onClose={() => { setModal(null); setModalTocado(false); }} title={`Nuevo PCR — ${tituloRonda}`} hayContenido={modalTocado}>
        <PcrForm rondaId={rondaId} plantaId={plantaId} codigoDisplay={codigoDisplay} onGuardado={() => { setModal(null); setModalTocado(false); }} onTocadoChange={setModalTocado} />
      </Modal>
    </li>
  );
}

export function RondasSeccion({
  individuoId,
  plantaId,
  codigoDisplay,
  puedeIniciar,
  tipo = 'anual',
  onEvaluarPantalla,
}: {
  individuoId: string;
  plantaId: string;
  codigoDisplay: string;
  /** true si el cruce está en la fase que habilita ESTA serie y el individuo sigue vivo. */
  puedeIniciar: boolean;
  tipo?: TipoRonda;
  /** Evaluar a pantalla completa (multisitio, S2-6): recibe el número de la ronda elegida. */
  onEvaluarPantalla?: (numeroRonda: number) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const esMultisitio = tipo === 'multisitio';

  const { data: rondas, isLoading, isSuccess, isFetching } = useQuery({
    queryKey: qk.rondas.individuo(individuoId, tipo),
    queryFn: () => listarRondas(individuoId, tipo),
  });

  const iniciar = useMutation({
    mutationFn: (numeroEsperado: number) => (esMultisitio ? iniciarRondaMultisitio(individuoId, numeroEsperado) : iniciarRonda(individuoId, numeroEsperado)),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.rondas.individuo(individuoId, tipo) });
      void queryClient.invalidateQueries({ queryKey: qk.individuos.resumen(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar la ronda.');
      void queryClient.invalidateQueries({ queryKey: qk.rondas.individuo(individuoId, tipo) });
    },
  });

  const quedanRondas = (rondas?.length ?? 0) < 3;
  const nombreSerie = esMultisitio ? 'multisitio' : 'de evaluación anual';

  return (
    <div className="space-y-2">
      {isLoading ? (
        <p className="text-xs text-ink-3">Cargando rondas…</p>
      ) : !rondas || rondas.length === 0 ? (
        <p className="rounded-md border border-brand-c bg-brand-l px-3 py-2 text-xs text-brand-ink">
          Todavía no hay rondas {nombreSerie} iniciadas.
          {puedeIniciar ? ' Puedes iniciar la primera ronda con el botón inferior.' : ''}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rondas.map((r) => (
            <FilaRonda
              key={r.id}
              rondaId={r.id}
              numeroRonda={r.numero_ronda}
              tipo={r.tipo_ronda}
              temporada={temporadaDeRonda(r)}
              fechaInicio={r.fecha_inicio}
              codigoDisplay={codigoDisplay}
              plantaId={plantaId}
              puedeAgregar={puedeIniciar}
              onEvaluarPantalla={onEvaluarPantalla}
            />
          ))}
        </ul>
      )}

      {error && <Alert>{error}</Alert>}

      {puedeIniciar && (
        quedanRondas ? (
          <Button size="sm" variant="outline" onClick={() => {
            const numero = Math.max(0, ...(rondas ?? []).map(r => r.numero_ronda)) + 1;
            if (window.confirm(mensajeInicioRonda(numero, tipo))) iniciar.mutate(numero);
          }} disabled={iniciar.isPending || !isSuccess || isFetching}>
            <CalendarPlus className="h-3.5 w-3.5" />
            {iniciar.isPending
              ? 'Iniciando…'
              : `Iniciar ronda ${esMultisitio ? 'multisitio ' : ''}${(rondas?.length ?? 0) + 1}`}
          </Button>
        ) : (
          <p className="text-xs text-ink-3">
            Ya se alcanzó el máximo de 3 rondas {nombreSerie} para este individuo
            {esMultisitio ? ' (independiente de sus rondas anuales)' : ''}.
          </p>
        )
      )}
    </div>
  );
}
