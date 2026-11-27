/**
 * «No evaluada en esta ronda» (fase 5, decisión G3; solo admin). Pide el motivo (No alcanzó · Sin fruto · Otro con texto) y marca
 * la ronda de una planta. Cuenta como cerrada para abrir la ronda siguiente, deja de ser pendiente y no entra al ranking de esa
 * ronda. La base valida (no se marca una ronda con evaluación cerrada o con un borrador) y sus mensajes se muestran tal cual.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { marcarRondaNoEvaluada } from '@/api/rondas';
import type { MotivoNoEvaluada } from '@/api/protocolo';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Sheet } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { MOTIVO_NO_EVALUADA } from '@/lib/etiquetas';
import { invalidarTrasIniciar } from './IniciarRondaLote';

const MOTIVOS = Object.keys(MOTIVO_NO_EVALUADA) as MotivoNoEvaluada[];

export function MarcarNoEvaluada({ plantaId, rondaId, numeroRonda, codigo, onCerrar }: {
  plantaId: string;
  rondaId: string;
  numeroRonda: number;
  /** Código corto de la planta (p. ej. «P12»). */
  codigo: string;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState<MotivoNoEvaluada | null>(null);
  const [detalle, setDetalle] = useState('');
  const marcar = useMutation({
    mutationFn: () => marcarRondaNoEvaluada(rondaId, motivo as MotivoNoEvaluada, motivo === 'otro' ? detalle.trim() : null),
    onSuccess: async () => {
      await invalidarTrasIniciar(queryClient, plantaId);
      onCerrar();
    },
  });
  const listo = motivo !== null && (motivo !== 'otro' || detalle.trim().length > 0);
  const titulo = `No evaluada en la ronda ${numeroRonda} · ${codigo}`;

  return (
    <Sheet
      titulo={titulo}
      onCerrar={onCerrar}
      hayContenido={motivo !== null}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button disabled={!listo || marcar.isPending} onClick={() => marcar.mutate()}>{marcar.isPending ? 'Guardando…' : 'Marcar como no evaluada'}</Button>
        </div>
      )}
    >
      <div className="space-y-3 text-small text-ink-2">
        <p>La planta queda sin evaluar en esta ronda, con el motivo y tu nombre en el historial. No entra al ranking de la ronda y puede pasar a la siguiente.</p>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 font-medium text-ink">Motivo</legend>
          {MOTIVOS.map((m) => (
            <label key={m} className="flex min-h-tap items-center gap-2">
              <input type="radio" name="motivo-no-evaluada" value={m} checked={motivo === m} onChange={() => setMotivo(m)} />
              {MOTIVO_NO_EVALUADA[m]}
            </label>
          ))}
        </fieldset>
        {motivo === 'otro' && (
          <div className="space-y-1">
            <Label htmlFor="detalle-no-evaluada">¿Qué pasó?</Label>
            <Textarea id="detalle-no-evaluada" rows={2} maxLength={300} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
          </div>
        )}
        {marcar.isError && <Alert>{marcar.error instanceof Error ? marcar.error.message : 'No se pudo marcar la ronda.'}</Alert>}
      </div>
    </Sheet>
  );
}
