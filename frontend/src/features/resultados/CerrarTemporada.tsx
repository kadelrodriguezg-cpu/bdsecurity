/**
 * «Cerrar temporada y congelar ranking» (fase 4, decisión 7; solo admin). Congela el ranking por grupos de la temporada elegida
 * con el mecanismo de rankings congelados que ya existe. Fase 5 (G2): el nombre sugerido es «Temporada AAAA-AAAA+1» y el admin
 * puede cambiarlo antes de confirmar. Si ese nombre ya existe en la especie, lo dice (no lo duplica) y ofrece abrirlo.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { CierreYaExiste, cerrarTemporada, obtenerTemporadaSugerida } from '@/api/rankingGrupos';
import { listarSnapshotsRanking } from '@/api/snapshots';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet } from '@/components/ui/sheet';
import { qk } from '@/lib/queryKeys';

export function CerrarTemporada({ especieId, especieNombre, numeroRonda, onCongelado }: {
  especieId: string;
  especieNombre: string;
  /** Temporada elegida en Resultados; sin temporada («la última de cada individuo») no se puede cerrar. */
  numeroRonda: number | null;
  onCongelado: (snapshotId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [existente, setExistente] = useState<string | null>(null);
  const [nombreEscrito, setNombreEscrito] = useState('');
  const temporada = useQuery({
    queryKey: ['resultados', 'temporada-sugerida', especieId, numeroRonda],
    queryFn: () => obtenerTemporadaSugerida(especieId, numeroRonda as number),
    enabled: abierto && numeroRonda !== null,
  });
  // El nombre sugerido llena el campo una vez; después manda lo que escriba el admin.
  useEffect(() => { if (temporada.data) setNombreEscrito(`Temporada ${temporada.data}`); }, [temporada.data]);
  const nombre = temporada.data && nombreEscrito.trim() ? nombreEscrito.trim() : null;
  const cerrar = useMutation({
    mutationFn: () => cerrarTemporada(especieId, numeroRonda as number, nombre as string),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: qk.snapshots.all });
      setAbierto(false);
      onCongelado(r.snapshot_id);
    },
    onError: (e) => { if (e instanceof CierreYaExiste) setExistente(nombre); },
  });
  const verExistente = useMutation({
    mutationFn: async () => {
      const lista = await listarSnapshotsRanking({ especieId, limite: 50 });
      return lista.items.find((s) => s.nombre.toLowerCase() === (nombre ?? '').toLowerCase())?.id ?? null;
    },
    onSuccess: (id) => { if (id) { setAbierto(false); onCongelado(id); } },
  });
  const cerrarHoja = () => { setAbierto(false); setExistente(null); cerrar.reset(); };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={numeroRonda === null}
        title={numeroRonda === null ? 'Elige una temporada para cerrarla' : undefined}
        onClick={() => setAbierto(true)}
      >
        <Lock className="h-4 w-4" aria-hidden="true" /> Cerrar temporada y congelar ranking
      </Button>
      {abierto && numeroRonda !== null && (
        <Sheet
          titulo={temporada.data ? `¿Cerrar la temporada ${temporada.data} de ${especieNombre}?` : 'Cerrar temporada'}
          onCerrar={cerrarHoja}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={cerrarHoja}>Cancelar</Button>
              {existente ? (
                <Button disabled={verExistente.isPending} onClick={() => verExistente.mutate()}>Ver ese ranking</Button>
              ) : (
                <Button disabled={!nombre || cerrar.isPending} onClick={() => cerrar.mutate()}>{cerrar.isPending ? 'Cerrando…' : 'Cerrar temporada'}</Button>
              )}
            </div>
          )}
        >
          <div className="space-y-3 text-small text-ink-2">
            {temporada.isPending && <p role="status" className="text-ink-3">Revisando la temporada…</p>}
            {temporada.isSuccess && !temporada.data && <Alert>Esta temporada no tiene individuos en {especieNombre}.</Alert>}
            {temporada.data && !existente && (
              <>
                <p>Se congelará el ranking de la Ronda {numeroRonda} de {especieNombre} (temporada {temporada.data}).</p>
                <div className="space-y-1">
                  <Label htmlFor="nombre-cierre-temporada">Nombre del ranking congelado</Label>
                  <Input id="nombre-cierre-temporada" value={nombreEscrito} maxLength={120} onChange={(e) => setNombreEscrito(e.target.value)} />
                  <p className="text-ink-3">El nombre lo decide la empresa; el sugerido sigue la regla de temporadas de julio a junio.</p>
                </div>
                <p>El ranking en vivo sigue cambiando con cada evaluación; el congelado queda tal cual y se puede abrir desde «Congelado…».</p>
              </>
            )}
            {existente && <Alert>Ya existe «{existente}» en {especieNombre}. No se creó otro.</Alert>}
            {cerrar.isError && !existente && <Alert>{cerrar.error instanceof Error ? cerrar.error.message : 'No se pudo cerrar la temporada.'}</Alert>}
          </div>
        </Sheet>
      )}
    </>
  );
}
