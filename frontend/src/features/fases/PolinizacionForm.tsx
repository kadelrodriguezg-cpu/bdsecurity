/**
 * Formulario estructurado de Polinización: N sesiones (`polinizacion_evento`),
 * cada una con su propia fecha y cantidad de flores cruzadas — mismo patrón
 * que Cosecha (`cosecha_fruto`) y Germinación (`germinacion_evento`). El
 * total se CALCULA sumando las sesiones, nunca se guarda como número fijo
 * (reemplaza la columna única `plantas.n_flores_cruzadas`, que un UPDATE
 * pisaba en cada guardado y perdía el conteo de sesiones anteriores).
 */
import { formatearFecha } from '@/lib/v3/formatos';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flower2, Plus, Minus, StickyNote } from 'lucide-react';
import { listarPolinizacionEventos, agregarPolinizacionEvento, quitarUltimoPolinizacionEvento, obtenerUltimaNotaPolinizacion } from '@/api/fases';
import { Contador } from '@/components/shared/Contador';
import { AdjuntarArchivoFase } from '@/components/shared/AdjuntarArchivoFase';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { hoyChileISO } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';

export function PolinizacionForm({
  plantaId,
  codigoSistema,
  onTocadoChange,
}: {
  plantaId: string;
  codigoSistema: string;
  onTocadoChange?: (tocado: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: eventos, isLoading } = useQuery({
    queryKey: qk.polinizacion.eventos(plantaId),
    queryFn: () => listarPolinizacionEventos(plantaId),
  });
  const { data: notaExistente } = useQuery({
    queryKey: qk.polinizacion.nota(plantaId),
    queryFn: () => obtenerUltimaNotaPolinizacion(plantaId),
  });

  const [fecha, setFecha] = useState(hoyChileISO);
  const [nFlores, setNFlores] = useState<number | null>(null);
  const [notas, setNotas] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [notasExpandido, setNotasExpandido] = useState(false);

  const hayCambiosSinGuardar = nFlores !== null || archivo !== null;
  useEffect(() => {
    onTocadoChange?.(hayCambiosSinGuardar);
  }, [hayCambiosSinGuardar, onTocadoChange]);

  useEffect(() => {
    if (hayCambiosSinGuardar || !notaExistente) return;
    setNotas(notaExistente);
    setNotasExpandido(true);
  }, [notaExistente, hayCambiosSinGuardar]);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: qk.polinizacion.eventos(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.ranking.polinizacionVarietal() });
    void queryClient.invalidateQueries({ queryKey: qk.eventos.planta(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.polinizacion.nota(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
  };

  const agregar = useMutation({
    mutationFn: () => {
      if (!fecha) throw new Error('La fecha de la sesión es obligatoria.');
      if (nFlores == null) throw new Error('Ingresa el número de flores cruzadas en esta sesión.');
      return agregarPolinizacionEvento(plantaId, {
        fecha,
        n_flores_cruzadas: nFlores,
        notas: notas.trim() || null,
        codigoSistema,
        archivo,
      });
    },
    onSuccess: () => {
      setError(null);
      setOk(true);
      setArchivo(null);
      setNFlores(null);
      invalidar();
    },
    onError: (e) => {
      setOk(false);
      setError(e instanceof Error ? e.message : 'No se pudo guardar la sesión de polinización.');
    },
  });

  const quitarUltima = useMutation({
    mutationFn: () => quitarUltimoPolinizacionEvento(plantaId),
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo quitar la última sesión.'),
  });

  const total = (eventos ?? []).reduce((s, e) => s + e.n_flores_cruzadas, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Flower2 className="h-4 w-4 text-primary" /> Polinización
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Sesiones de polinización</Label>
          {isLoading ? (
            <p className="text-sm text-ink-3">Cargando…</p>
          ) : !eventos || eventos.length === 0 ? (
            <p className="text-sm text-ink-3">Todavía no hay sesiones de polinización cargadas.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {eventos.map((e) => (
                <li key={e.id} className="flex items-center justify-between px-3 py-1.5">
                  <span className="tabular-nums text-ink-3">{formatearFecha(e.fecha)}</span>
                  <span className="font-medium">{e.n_flores_cruzadas} flores</span>
                </li>
              ))}
            </ul>
          )}
          {eventos && eventos.length > 0 && (
            <p className="text-xs text-ink-3">
              Total de flores cruzadas: <strong>{total}</strong> ({eventos.length} sesión{eventos.length === 1 ? '' : 'es'})
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            agregar.mutate();
          }}
          className="space-y-3 border-t pt-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoFecha id="fecha_polinizacion" label="Fecha de la sesión" required value={fecha} onChange={setFecha} />
            <Contador label="N° flores cruzadas" value={nFlores} onChange={setNFlores} />
          </div>

          {notasExpandido ? (
            <div className="space-y-1.5">
              <Label htmlFor="notas_polinizacion">Notas (opcional)</Label>
              <Textarea id="notas_polinizacion" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setNotasExpandido(true)}>
              <StickyNote className="h-3.5 w-3.5" /> Agregar notas
            </Button>
          )}

          <AdjuntarArchivoFase archivo={archivo} onArchivoChange={setArchivo} />

          {error && <Alert>{error}</Alert>}
          {ok && <Alert variant="success">Sesión de polinización guardada.</Alert>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={agregar.isPending}>
              <Plus className="h-3.5 w-3.5" /> {agregar.isPending ? 'Guardando…' : 'Agregar sesión'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => quitarUltima.mutate()}
              disabled={quitarUltima.isPending || !eventos || eventos.length === 0}
            >
              <Minus className="h-3.5 w-3.5" /> Quitar última sesión
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
