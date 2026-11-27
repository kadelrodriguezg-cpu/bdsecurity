/**
 * Botones para mover la planta entre etapas del ciclo, SOLO PARA ADMIN (U-03,
 * decisión N6): el operario ve la fase actual como lectura y ningún botón. La
 * base lo exige igual (trigger validar_orden_fases, migración 20261024070000);
 * acá es UX.
 *
 * Para el admin:
 *  - avanzar (siempre disponible salvo en la última etapa), con confirmación.
 *    Al pasar de Evaluación anual a Multisitio avisa cuántas plantas tienen la
 *    poscosecha sin terminar, porque en Multisitio ya no se pueden cargar.
 *  - «Retroceder fase» (fase 5, decisión G1): aunque el cruce tenga plantas,
 *    con motivo obligatorio. La base (retroceder_fase_cruce) se niega si
 *    quedarían datos huérfanos y explica por qué; ese mensaje se muestra tal
 *    cual. Retroceder avisa además si el formulario de la fase actual tiene
 *    cambios sin guardar, porque al cambiar de fase esos cambios se pierden.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { actualizarEstado, contarPoscosechaIncompleta, retrocederFase } from '@/api/plantas';
import { siguienteEstado, anteriorEstado, ESTADO_LABEL, type EstadoPlanta } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { qk } from '@/lib/queryKeys';
import { useAuth } from '@/features/auth/AuthContext';

type Accion = 'avanzar' | 'retroceder' | null;

export function AvanzarEstado({
  plantaId,
  estadoActual,
  formTocado = false,
}: {
  plantaId: string;
  estadoActual: EstadoPlanta;
  formTocado?: boolean;
}) {
  const queryClient = useQueryClient();
  const { esAdmin } = useAuth();
  const [accion, setAccion] = useState<Accion>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const siguiente = siguienteEstado(estadoActual);
  const anterior = anteriorEstado(estadoActual);
  const haciaMultisitio = estadoActual === 'evaluacion_anual' && siguiente === 'traslado_destino';

  const poscosecha = useQuery({
    queryKey: [...qk.planta.detalle(plantaId), 'poscosecha-incompleta'],
    queryFn: () => contarPoscosechaIncompleta(plantaId),
    enabled: esAdmin && accion === 'avanzar' && haciaMultisitio,
  });

  const alTerminar = () => {
    setError(null);
    setAccion(null);
    setMotivo('');
    // La ficha y los listados quedan viejos: los refrescamos.
    void queryClient.invalidateQueries({ queryKey: qk.planta.detalle(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.plantas.all });
    void queryClient.invalidateQueries({ queryKey: qk.eventos.planta(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
    void queryClient.invalidateQueries({ queryKey: qk.resumenFinal.all });
  };
  const alFallar = (e: unknown, cerrar: boolean) => {
    if (cerrar) setAccion(null);
    setError(e instanceof Error ? e.message : 'No se pudo cambiar la fase.');
    void queryClient.invalidateQueries({ queryKey: qk.planta.detalle(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.plantas.all });
  };

  const avanzar = useMutation({
    mutationFn: ({ destino, origen }: { destino: EstadoPlanta; origen: EstadoPlanta }) => actualizarEstado(plantaId, destino, origen),
    onSuccess: alTerminar,
    onError: (e) => alFallar(e, true),
  });
  // Si la base se niega (datos huérfanos), la confirmación queda abierta con su explicación.
  const retroceder = useMutation({
    mutationFn: ({ origen, texto }: { origen: EstadoPlanta; texto: string }) => retrocederFase(plantaId, origen, texto),
    onSuccess: alTerminar,
    onError: (e) => alFallar(e, false),
  });
  const ocupado = avanzar.isPending || retroceder.isPending;

  if (!esAdmin) {
    return (
      <p className="text-sm text-ink-3">
        Fase actual: <strong className="font-medium text-ink-2">{ESTADO_LABEL[estadoActual]}</strong>. Solo un admin puede cambiar la fase.
      </p>
    );
  }

  const motivoListo = motivo.trim().length > 0;
  const pendientesPoscosecha = poscosecha.data ?? 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {anterior !== null && accion !== 'retroceder' && (
          <Button size="sm" variant="outline" onClick={() => { setError(null); setAccion('retroceder'); }} disabled={accion === 'avanzar'}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Retroceder fase
          </Button>
        )}

        {siguiente ? (
          accion !== 'avanzar' && (
            <Button size="lg" onClick={() => { setError(null); setAccion('avanzar'); }} disabled={accion === 'retroceder' || formTocado}>
              <ArrowRight className="h-4 w-4" />
              Avanzar a «{ESTADO_LABEL[siguiente]}»
            </Button>
          )
        ) : (
          <p className="text-sm text-ink-3">El proceso de este cruce ya está finalizado.</p>
        )}
      </div>

      {formTocado && siguiente && (
        <p className="text-xs font-medium text-warn">
          Guarda o descarta los cambios del formulario antes de avanzar de fase.
        </p>
      )}

      {accion === 'avanzar' && siguiente && (
        <div className="space-y-1.5">
          {haciaMultisitio && pendientesPoscosecha > 0 && (
            <p role="status" className="rounded-md border border-warn bg-warn-l px-3 py-2 text-sm text-warn">
              {pendientesPoscosecha === 1 ? '1 planta tiene' : `${pendientesPoscosecha} plantas tienen`} la poscosecha sin terminar (faltan lecturas de 15, 30 o 45 días). En Multisitio ya no se podrán cargar.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              ¿Pasar de <strong>{ESTADO_LABEL[estadoActual]}</strong> a <strong>{ESTADO_LABEL[siguiente]}</strong>?
            </span>
            <Button size="sm" onClick={() => avanzar.mutate({ destino: siguiente, origen: estadoActual })} disabled={ocupado || (haciaMultisitio && poscosecha.isPending)}>
              {avanzar.isPending ? 'Guardando…' : 'Sí, avanzar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAccion(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {accion === 'retroceder' && anterior && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <p className="text-sm">
            ¿Volver de <strong>{ESTADO_LABEL[estadoActual]}</strong> a <strong>{ESTADO_LABEL[anterior]}</strong>?
          </p>
          <div className="space-y-1">
            <Label htmlFor={`motivo-retroceso-${plantaId}`}>Motivo (obligatorio)</Label>
            <Textarea
              id={`motivo-retroceso-${plantaId}`}
              value={motivo}
              maxLength={500}
              rows={2}
              placeholder="Ej. Se avanzó por error: faltan lecturas de poscosecha"
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <p className="text-xs text-ink-3">
            Queda registrado con tu nombre y el motivo. Los datos ya guardados no se pierden. Si volver dejaría datos sin su fase, el sistema no lo permite y explica por qué.
          </p>
          {formTocado && (
            <p className="text-xs font-medium text-danger">
              Tienes cambios sin guardar en el formulario actual — se van a perder. ¿Igual quieres volver?
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => retroceder.mutate({ origen: estadoActual, texto: motivo.trim() })} disabled={ocupado || !motivoListo}>
              {retroceder.isPending ? 'Guardando…' : 'Sí, retroceder'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setAccion(null); setError(null); }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {error && <Alert>{error}</Alert>}
    </div>
  );
}
