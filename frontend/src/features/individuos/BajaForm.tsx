/**
 * Marcar baja de un individuo: multiselect de criterios (junction baja_motivo,
 * no enum-array) + nota compartida opcional. Actualiza estado_vital. Desde la
 * migración 20261021160000 pasa por la RPC marcar_baja_individuo (atómica);
 * los campos y la invalidación son los mismos que usa la baja en lote.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { marcarBaja } from '@/api/individuos';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { hoyChileISO } from '@/lib/fechas';
import { CamposBaja, type ValoresBaja } from './CamposBaja';
import { invalidarTrasBaja } from './invalidarTrasBaja';

const valoresIniciales = (): ValoresBaja => ({ estado: 'descartado', fecha: hoyChileISO(), criterios: [], nota: '' });

export function BajaForm({ individuoId, plantaId, onGuardado, onTocadoChange }: { individuoId: string; plantaId: string; onGuardado?: () => void; onTocadoChange?: (tocado: boolean) => void }) {
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<ValoresBaja>(valoresIniciales);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [tocado, setTocado] = useState(false);
  // Generada una sola vez al montar -- identifica el intento de guardado, no
  // el contenido. Se conserva hasta que el envío tiene éxito: si el usuario
  // reenvía tras una red cortada, la RPC lo reconoce y no duplica.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => onTocadoChange?.(tocado), [onTocadoChange, tocado]);

  const mutacion = useMutation({
    mutationFn: () =>
      marcarBaja({
        individuo_id: individuoId,
        estado_vital: valores.estado,
        fecha_baja: valores.fecha,
        criterios: valores.criterios,
        nota: valores.nota.trim() || undefined,
      }, idempotencyKey),
    onSuccess: () => {
      setError(null);
      setOk(true);
      setValores((prev) => ({ ...prev, criterios: [], nota: '' }));
      setTocado(false);
      setIdempotencyKey(crypto.randomUUID());
      invalidarTrasBaja(queryClient, { plantaIds: [plantaId], individuoIds: [individuoId] });
      onGuardado?.();
    },
    onError: (e) => {
      setOk(false);
      setError(e instanceof Error ? e.message : 'No se pudo registrar la baja.');
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutacion.mutate();
      }}
      className="space-y-3"
    >
      <CamposBaja
        valores={valores}
        onChange={(cambio) => {
          setTocado(true);
          setValores((prev) => ({ ...prev, ...cambio }));
        }}
      />

      {error && <Alert>{error}</Alert>}
      {ok && <Alert variant="success">Baja registrada.</Alert>}

      <Button type="submit" variant="warning" disabled={mutacion.isPending}>
        <Ban className="h-4 w-4" />
        {mutacion.isPending ? 'Guardando…' : 'Marcar baja'}
      </Button>
    </form>
  );
}
