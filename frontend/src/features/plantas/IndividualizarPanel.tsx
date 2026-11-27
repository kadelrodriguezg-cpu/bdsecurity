/**
 * Panel de individualización: solo visible cuando la planta está en la fase
 * Trasplante (único punto de individualización, North Star principio 3).
 * Acumulativo: si ya hay individuos creados para este cruce, se muestra el
 * conteo y se permite seguir agregando (nunca reemplaza).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import { listarIndividuosDePlanta, individualizarPlantas } from '@/api/individuos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { qk } from '@/lib/queryKeys';

// Supuestos del plan Corrida 1: mantener MAX coordinado con la RPC
// individualizar_plantas (20261022052253). El umbral exige confirmación UX.
export const MAX_INDIVIDUOS_POR_LLAMADA = 1000;
export const UMBRAL_CONFIRMACION_INDIVIDUOS = 400;

export function IndividualizarPanel({ plantaId }: { plantaId: string }) {
  const queryClient = useQueryClient();
  const [cantidad, setCantidad] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const { data: individuos } = useQuery({
    queryKey: qk.individuos.lista(plantaId),
    queryFn: () => listarIndividuosDePlanta(plantaId),
  });

  const mutacion = useMutation({
    mutationFn: () => individualizarPlantas(plantaId, cantidad),
    onSuccess: ({ codigos }) => {
      setError(null);
      setOk(`Se crearon ${codigos.length} individuo(s): ${codigos.join(', ')}`);
      setCantidad(1);
      void queryClient.invalidateQueries({ queryKey: qk.individuos.lista(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    },
    onError: (e) => {
      setOk(null);
      setError(e instanceof Error ? e.message : 'No se pudo individualizar.');
      void queryClient.invalidateQueries({ queryKey: qk.individuos.lista(plantaId) });
    },
  });

  const conteo = individuos?.length ?? 0;

  return (
    <Card className="border-brand-c bg-brand-l">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sprout className="h-4 w-4 text-primary" />
          Individualizar plantas de este cruce
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {conteo > 0 && (
          <p className="text-sm text-ink-3">
            Ya hay <strong>{conteo}</strong> individuo(s) creado(s) para este cruce. Puedes agregar más.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_INDIVIDUOS_POR_LLAMADA) {
              setError(`Ingresa una cantidad entera entre 1 y ${MAX_INDIVIDUOS_POR_LLAMADA}.`);
              return;
            }
            if (cantidad > UMBRAL_CONFIRMACION_INDIVIDUOS && !window.confirm(
              `Vas a individualizar ${cantidad} plantas. Se agregarán ${cantidad} individuos a este cruce. ¿Confirmas esta cantidad?`,
            )) return;
            mutacion.mutate();
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor="cantidad_individualizar">Cantidad a individualizar</Label>
            <Input
              id="cantidad_individualizar"
              type="number"
              min={1}
              max={MAX_INDIVIDUOS_POR_LLAMADA}
              step={1}
              value={cantidad}
              onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
              className="w-28"
            />
          </div>
          <Button type="submit" disabled={mutacion.isPending}>
            {mutacion.isPending ? 'Creando…' : `Individualizar ${cantidad} planta${cantidad === 1 ? '' : 's'}`}
          </Button>
        </form>
        {error && <Alert>{error}</Alert>}
        {ok && <Alert variant="success">{ok}</Alert>}
      </CardContent>
    </Card>
  );
}
