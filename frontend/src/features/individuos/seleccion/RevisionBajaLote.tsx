/**
 * Revisión y confirmación de la baja en lote (solo admin). Antes de escribir
 * nada pide a la base qué individuos de la selección se pueden dar de baja y
 * cuáles no (con su motivo): los excluidos se muestran y NO se envían. La base
 * igual rechaza el lote completo si llega alguno no elegible.
 *
 * La baja es irreversible (un individuo de baja no vuelve a vivo): la pantalla
 * lo dice y la confirmación exige escribir la cantidad de individuos.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import {
  darBajaEnLote,
  previsualizarBajaEnLote,
  MOTIVO_EXCLUSION_BAJA_LABEL,
} from '@/api/individuos';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hoyChileISO } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';
import { CamposBaja, type ValoresBaja } from '../CamposBaja';
import { invalidarTrasBaja } from '../invalidarTrasBaja';
import { compararCodigos } from '@/lib/ordenNatural';

export function RevisionBajaLote({
  abierto,
  onCerrar,
  ids,
  onConfirmado,
}: {
  abierto: boolean;
  onCerrar: () => void;
  ids: string[];
  onConfirmado: (procesados: number) => void;
}) {
  if (!abierto) return null;
  return <Contenido onCerrar={onCerrar} ids={ids} onConfirmado={onConfirmado} />;
}

function Contenido({ onCerrar, ids, onConfirmado }: { onCerrar: () => void; ids: string[]; onConfirmado: (procesados: number) => void }) {
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<ValoresBaja>({ estado: 'descartado', fecha: hoyChileISO(), criterios: [], nota: '' });
  const [confirmacion, setConfirmacion] = useState('');
  // Una clave por apertura de la revisión: un reenvío tras una red cortada no duplica.
  const [clave] = useState(() => crypto.randomUUID());

  const preview = useQuery({
    queryKey: qk.baja.previsualizacionLote(ids),
    queryFn: () => previsualizarBajaEnLote(ids),
    staleTime: 0,
    gcTime: 0,
  });

  // G16: en orden natural de código (la base los entrega en orden de texto).
  const procesables = [...(preview.data?.procesables ?? [])].sort((a, b) => compararCodigos(a.codigo_display, b.codigo_display));
  const excluidos = [...(preview.data?.excluidos ?? [])].sort((a, b) => compararCodigos(a.codigo_display, b.codigo_display));
  const excedeTope = !!preview.data && procesables.length > preview.data.limite;

  const mutacion = useMutation({
    mutationFn: () =>
      darBajaEnLote({
        ids: procesables.map((p) => p.id),
        estado_vital: valores.estado,
        fecha_baja: valores.fecha,
        criterios: valores.criterios,
        nota: valores.nota.trim() || undefined,
      }, clave),
    onSuccess: (resultado) => {
      invalidarTrasBaja(queryClient, {
        plantaIds: [...new Set(procesables.map((p) => p.planta_id))],
        individuoIds: procesables.map((p) => p.id),
      });
      onConfirmado(resultado.procesados);
    },
  });

  const puedeConfirmar =
    procesables.length > 0 &&
    !excedeTope &&
    valores.criterios.length > 0 &&
    valores.fecha !== '' &&
    confirmacion.trim() === String(procesables.length) &&
    !mutacion.isPending;

  return (
    <Modal open onClose={onCerrar} title="Dar de baja en lote" hayContenido={valores.criterios.length > 0 || confirmacion !== ''}>
      <div className="space-y-4 text-sm">
        {preview.isPending && <p className="text-ink-3">Revisando la selección…</p>}
        {preview.isError && <Alert>{preview.error.message}</Alert>}

        {preview.data && (
          <>
            <section className="space-y-1.5">
              <h3 className="font-semibold">Se darán de baja {procesables.length} individuo(s)</h3>
              {procesables.length > 0 && (
                <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto font-mono text-xs" aria-label="Individuos que se procesarán">
                  {procesables.map((p) => <li key={p.id} className="rounded border border-line px-1.5 py-0.5">{p.codigo_display}</li>)}
                </ul>
              )}
            </section>

            {excluidos.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="font-semibold">No se procesarán {excluidos.length}</h3>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs" aria-label="Individuos excluidos">
                  {excluidos.map((e) => (
                    <li key={e.id}>
                      <span className="font-mono">{e.codigo_display ?? e.id}</span>: {MOTIVO_EXCLUSION_BAJA_LABEL[e.motivo] ?? e.motivo}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {excedeTope && (
              <Alert>Son {procesables.length} individuos y el máximo por lote es {preview.data.limite}. Divide la selección.</Alert>
            )}

            {procesables.length > 0 && !excedeTope && (
              <>
                <div className="space-y-3 border-t pt-3">
                  <p className="text-small text-ink-3">El estado, los criterios, la nota y la fecha se aplican a todo el lote. Si las causas son distintas, haz lotes distintos.</p>
                  <CamposBaja idPrefijo="baja_lote" valores={valores} onChange={(cambio) => setValores((prev) => ({ ...prev, ...cambio }))} />
                </div>

                <Alert>
                  Esta acción no se puede deshacer: un individuo dado de baja no vuelve a quedar vivo.
                </Alert>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmar_baja_lote">Para confirmar, escribe la cantidad de individuos ({procesables.length})</Label>
                  <Input
                    id="confirmar_baja_lote"
                    inputMode="numeric"
                    autoComplete="off"
                    value={confirmacion}
                    onChange={(e) => setConfirmacion(e.target.value)}
                  />
                </div>
                {mutacion.isError && <Alert>{mutacion.error.message}</Alert>}
                <Button variant="warning" onClick={() => mutacion.mutate()} disabled={!puedeConfirmar}>
                  <Ban className="h-4 w-4" />
                  {mutacion.isPending ? 'Dando de baja…' : `Dar de baja ${procesables.length} individuo(s)`}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
