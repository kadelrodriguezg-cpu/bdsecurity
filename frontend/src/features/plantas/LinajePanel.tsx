/**
 * Panel de linaje genético (SOLO se monta en la variante admin de la ficha).
 * Lectura: los datos ya vinieron en obtener_planta() porque el backend
 * determinó que el usuario puede verlos. Escritura: vía RPC actualizar_linaje
 * (el único camino legítimo; el UPDATE directo está revocado en Postgres).
 *
 * Mamá/Papá dejaron de ser texto libre (Bloque 3, Parte 3C de la auditoría
 * de UX): se eligen del catálogo `variedades` con SelectorVariedad — mismo
 * combobox que usa NuevaPlantaPage, para que editar el linaje de un cruce ya
 * creado no reabra la puerta al texto libre que el combobox vino a cerrar.
 * La vista de solo-lectura prioriza el nombre resuelto (mama_nombre/
 * papa_nombre, que resuelve obtener_planta) y cae al texto legado
 * (ficha.mama/papa, congelado) solo para cruces que todavía no se migraron.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dna, Pencil, X } from 'lucide-react';
import { actualizarLinaje } from '@/api/linaje';
import type { FichaPlanta } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { SelectorVariedad } from './SelectorVariedad';
import { qk } from '@/lib/queryKeys';

export function LinajePanel({ ficha }: { ficha: FichaPlanta }) {
  // Una ficha distinta no debe reutilizar el borrador de linaje de la anterior.
  return <LinajePanelContenido key={ficha.id} ficha={ficha} />;
}

function LinajePanelContenido({ ficha }: { ficha: FichaPlanta }) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cruzamiento, setCruzamiento] = useState(ficha.cruzamiento ?? '');
  const [mamaId, setMamaId] = useState<string | null>(ficha.mama_id ?? null);
  const [papaId, setPapaId] = useState<string | null>(ficha.papa_id ?? null);

  const abrirEdicion = () => {
    setCruzamiento(ficha.cruzamiento ?? '');
    setMamaId(ficha.mama_id ?? null);
    setPapaId(ficha.papa_id ?? null);
    setError(null);
    setEditando(true);
  };

  const mutacion = useMutation({
    mutationFn: () =>
      actualizarLinaje({
        plantaId: ficha.id,
        cruzamiento: cruzamiento.trim() || null,
        mamaId,
        papaId,
      }),
    onSuccess: () => {
      setError(null);
      setEditando(false);
      void queryClient.invalidateQueries({ queryKey: qk.planta.detalle(ficha.id) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(ficha.id) });
      // Cambiar mamá/papá reasigna el cruce entre filas del ranking agregado.
      void queryClient.invalidateQueries({ queryKey: qk.ranking.polinizacionVarietal() });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar el linaje.'),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Dna className="h-4 w-4 text-ink-3" />
          Linaje genético
          <span className="rounded bg-neutral-l px-1.5 py-0.5 text-xs font-normal text-ink-2">
            Confidencial
          </span>
        </CardTitle>
        <Button variant="ghost" size="sm" aria-label={editando ? 'Cancelar edición de linaje' : 'Editar linaje'} onClick={() => (editando ? setEditando(false) : abrirEdicion())}>
          {editando ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {!editando ? (
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-ink-3">Cruzamiento</dt>
              <dd>{ficha.cruzamiento ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Mamá</dt>
              <dd>{ficha.mama_nombre ?? ficha.mama ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Papá</dt>
              <dd>{ficha.papa_nombre ?? ficha.papa ?? '—'}</dd>
            </div>
          </dl>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutacion.mutate();
            }}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="cruzamiento">Cruzamiento</Label>
                <Input id="cruzamiento" value={cruzamiento} onChange={(e) => setCruzamiento(e.target.value)} />
              </div>
              <SelectorVariedad id="mama" label="Mamá" especieId={ficha.especie_id} valorId={mamaId} onCambiar={setMamaId} />
              <SelectorVariedad id="papa" label="Papá" especieId={ficha.especie_id} valorId={papaId} onCambiar={setPapaId} />
            </div>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" size="sm" disabled={mutacion.isPending}>
              {mutacion.isPending ? 'Guardando…' : 'Guardar linaje'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
