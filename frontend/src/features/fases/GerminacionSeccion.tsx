/**
 * Fase Germinación: serie temporal de eventos (fecha + cantidad nueva ese
 * día), no un campo único. Ronda 2 UI: workspace fusionado (KPIs / registrar
 * / serie de eventos) en vez de una sola Card con sub-bloques apilados.
 *
 * KPI "último registro" reemplaza al "días hasta última" del mockup de
 * referencia: `plantas` no tiene una columna `fecha_siembra` persistida, así
 * que no hay de dónde calcular días reales sin inventar el dato.
 */
import { formatearFecha } from '@/lib/v3/formatos';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { listarGerminacionEventos, crearGerminacionEvento, obtenerDatosFase } from '@/api/fases';
import { Contador } from '@/components/shared/Contador';
import { AdjuntarArchivoFase } from '@/components/shared/AdjuntarArchivoFase';
import { hoyChileISO } from '@/lib/fechas';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { qk } from '@/lib/queryKeys';
import { Workspace, WorkspaceDivisor, Panel } from '@/components/ui/workspace';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export function GerminacionSeccion({
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
    queryKey: qk.germinacion.planta(plantaId),
    queryFn: () => listarGerminacionEventos(plantaId),
  });
  const { data: datosFase } = useQuery({ queryKey: qk.fase.datos(plantaId), queryFn: () => obtenerDatosFase(plantaId) });

  const totalGerminado = (eventos ?? []).reduce((acc, e) => acc + e.cantidad_nueva, 0);
  const semillasSembradas = datosFase?.semillas_sembradas ?? null;
  const pctGerminacion = semillasSembradas && semillasSembradas > 0 ? (totalGerminado / semillasSembradas) * 100 : null;
  const ultimoRegistro = eventos && eventos.length > 0 ? eventos[eventos.length - 1].fecha : null;

  const [fecha, setFecha] = useState(hoyChileISO);
  const [cantidad, setCantidad] = useState<number | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const hayCambiosSinGuardar = cantidad !== null || archivo !== null;
  useEffect(() => {
    onTocadoChange?.(hayCambiosSinGuardar);
  }, [hayCambiosSinGuardar, onTocadoChange]);

  const mutacion = useMutation({
    mutationFn: () => {
      if (cantidad == null) throw new Error('Ingresa la cantidad de plántulas nuevas.');
      return crearGerminacionEvento({ planta_id: plantaId, fecha, cantidad_nueva: cantidad, codigoSistema, archivo });
    },
    onSuccess: () => {
      setError(null);
      setOk(true);
      setCantidad(null);
      setArchivo(null);
      void queryClient.invalidateQueries({ queryKey: qk.germinacion.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.eventos.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    },
    onError: (e) => {
      setOk(false);
      setError(e instanceof Error ? e.message : 'No se pudo guardar el evento de germinación.');
    },
  });

  return (
    <Workspace>
      <Panel titulo="Germinación" meta="agregado a nivel cruce · sin individuos aún">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="flex flex-col gap-0.5 rounded-md border border-line-soft bg-surface-2 p-2.5">
            <span className="tabular-nums text-display font-semibold leading-none">{semillasSembradas ?? '—'}</span>
            <span className="text-micro text-ink-3">Sembradas</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-line-soft bg-surface-2 p-2.5">
            <span className="tabular-nums text-display font-semibold leading-none">{totalGerminado}</span>
            <span className="text-micro text-ink-3">Germinadas</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-line-soft bg-surface-2 p-2.5">
            <span className="tabular-nums text-display font-semibold leading-none text-ok">
              {pctGerminacion != null ? `${pctGerminacion.toFixed(1)}%` : '—'}
            </span>
            <span className="text-micro text-ink-3">Eficiencia</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-line-soft bg-surface-2 p-2.5">
            <span className="tabular-nums text-body-l font-semibold leading-none">{ultimoRegistro ? formatearFecha(ultimoRegistro) : '—'}</span>
            <span className="text-micro text-ink-3">Último registro</span>
          </div>
        </div>
        {pctGerminacion == null && (eventos?.length ?? 0) > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-small text-ink-3">
            <Info className="h-3.5 w-3.5" /> Carga "semillas sembradas" en Siembra para ver el % de germinación.
          </p>
        )}
      </Panel>

      <WorkspaceDivisor />

      <Panel titulo="Registrar germinación" meta="acción disponible en esta fase">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutacion.mutate();
          }}
          className="max-w-md space-y-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoFecha
              id="fecha_germinacion"
              label="Fecha"
              value={fecha}
              onChange={setFecha}
              fechaMinimaContextual={ultimoRegistro}
              etiquetaFechaMinima="la germinación anterior"
              required
            />
            <Contador label="Plántulas nuevas ese día" value={cantidad} onChange={setCantidad} />
          </div>

          <AdjuntarArchivoFase archivo={archivo} onArchivoChange={setArchivo} />

          {error && <Alert>{error}</Alert>}
          {ok && <Alert variant="success">Evento de germinación guardado.</Alert>}

          <Button type="submit" size="lg" className="w-full" disabled={mutacion.isPending || cantidad === null}>
            {mutacion.isPending ? 'Guardando…' : `Registrar ${cantidad ? `+${cantidad}` : ''}`}
          </Button>
          {cantidad === null && <p className="text-center text-small text-ink-3">Ingresa al menos una plántula para registrar el evento.</p>}
        </form>
      </Panel>

      <WorkspaceDivisor />

      <Panel titulo="Serie de eventos" meta={eventos ? `${eventos.length} registros` : undefined} maxAltura={220} scroll>
        {isLoading ? (
          <p className="px-4 pb-4 text-small text-ink-3">Cargando…</p>
        ) : !eventos || eventos.length === 0 ? (
          <p className="px-4 pb-4 text-small text-ink-3">Todavía no hay eventos de germinación cargados.</p>
        ) : (
          <ul className="px-4 pb-2">
            {[...eventos].reverse().map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-b border-line-soft py-2.5 text-body last:border-0">
                <span className="tabular-nums text-ink-2">{formatearFecha(e.fecha)}</span>
                <span className="tabular-nums font-semibold text-ok">+{e.cantidad_nueva}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Workspace>
  );
}
