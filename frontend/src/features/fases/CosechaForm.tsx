import type { ComponentProps } from 'react';
import { useVigenciaFormulario } from '@/lib/useVigenciaFormulario';
import { useAuth } from '@/features/auth/AuthContext';
import { EstadoBorradorLocal } from '@/components/shared/EstadoBorradorLocal';
/**
 * Formulario estructurado de Cosecha. "Fruto 1"/"Fruto 2"... (antes
 * conteo_f1/conteo_f2, Prompt 6) son frutos cosechados con su cantidad de
 * semillas cada uno — confirmado por Efraín (North Star v4, sección 6), no
 * generaciones genéticas. Lista de N frutos (`cosecha_fruto`), + Agregar /
 * - Quitar último, con total/promedio calculados (no almacenados).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wheat, Plus, Minus } from 'lucide-react';
import { obtenerDatosFase, actualizarCosecha, listarCosechaFrutos, agregarCosechaFruto, quitarCosechaFruto } from '@/api/fases';
import { AdjuntarArchivoFase } from '@/components/shared/AdjuntarArchivoFase';
import { useBorradorLocal } from '@/lib/useBorradorLocal';

import { CampoFecha } from '@/components/ui/campo-fecha';
import { qk } from '@/lib/queryKeys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { formatearActividad, formatearFecha } from '@/lib/v3/formatos';

/**
 * Borrador local (hallazgo #3 de la auditoría pre-lanzamiento, 0.terdecies):
 * aplica solo a los 2 campos de este formulario (fecha, nSemillas) -- NUNCA
 * a `archivo` (File no es serializable a JSON, se perdería silenciosamente)
 * ni a FrutosCosecha (subcomponente aparte, guarda al toque, sin tipeo en
 * curso que proteger).
 */
interface CosechaBorrador {
  fecha: string;
  nSemillas: number | null;
  [key: string]: unknown;
}

const VALOR_INICIAL_COSECHA: CosechaBorrador = { fecha: '', nSemillas: null };

function FrutosCosecha({ plantaId }: { plantaId: string }) {
  const queryClient = useQueryClient();
  const ciclo = useVigenciaFormulario();
  const [cantidadNueva, setCantidadNueva] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: frutos, isLoading } = useQuery({
    queryKey: qk.cosecha.frutos(plantaId),
    queryFn: () => listarCosechaFrutos(plantaId),
  });

  const invalidar = () => {
    if (!ciclo.sesionVigente()) return;
    void queryClient.invalidateQueries({ queryKey: qk.cosecha.frutos(plantaId) });
  };

  const agregar = useMutation({
    mutationFn: () => {
      const n = Number(cantidadNueva);
      if (!cantidadNueva || Number.isNaN(n) || n < 0) throw new Error('Ingresa la cantidad de semillas del fruto.');
      return agregarCosechaFruto(plantaId, n);
    },
    onSuccess: () => {
      if (!ciclo.sesionVigente()) return;
      invalidar();
      if (!ciclo.uiVigente()) return;
      setError(null);
      setCantidadNueva('');
    },
    onError: (e) => {
      if (!ciclo.uiVigente()) return;
      setError(e instanceof Error ? e.message : 'No se pudo agregar el fruto.');
    },
  });

  const quitarUltimo = useMutation({
    mutationFn: () => {
      const ultimo = frutos?.[frutos.length - 1];
      if (!ultimo) throw new Error('No hay frutos para quitar.');
      return quitarCosechaFruto(ultimo.id);
    },
    onSuccess: () => {
      if (!ciclo.sesionVigente()) return;
      invalidar();
      if (!ciclo.uiVigente()) return;
      setError(null);
    },
    onError: (e) => {
      if (!ciclo.uiVigente()) return;
      setError(e instanceof Error ? e.message : 'No se pudo quitar el fruto.');
    },
  });

  const total = frutos?.length ?? 0;
  const sumaSemillas = (frutos ?? []).reduce((s, f) => s + f.cantidad_semillas, 0);
  const promedio = total > 0 ? sumaSemillas / total : null;

  return (
    <div className="space-y-2">
      <Label>Frutos cosechados</Label>
      {isLoading ? (
        <p className="text-sm text-ink-3">Cargando…</p>
      ) : total === 0 ? (
        <p className="text-sm text-ink-3">Todavía no hay frutos cargados.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {frutos!.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-3 py-1.5">
              <span className="font-medium">Fruto {f.numero_fruto}</span>
              <span className="text-ink-3">{f.cantidad_semillas} semillas</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="cantidad_semillas_fruto">Semillas del nuevo fruto</Label>
          <Input
            id="cantidad_semillas_fruto"
            type="number"
            min={0}
            value={cantidadNueva}
            onChange={(e) => setCantidadNueva(e.target.value)}
            className="w-32"
          />
        </div>
        <Button type="button" size="sm" onClick={() => agregar.mutate()} disabled={agregar.isPending}>
          <Plus className="h-3.5 w-3.5" /> Agregar fruto
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => quitarUltimo.mutate()} disabled={quitarUltimo.isPending || total === 0}>
          <Minus className="h-3.5 w-3.5" /> Quitar último
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {total > 0 && (
        <p className="text-xs text-ink-3">
          Total de frutos: <strong>{total}</strong> · Total de semillas: <strong>{sumaSemillas}</strong> · Promedio por fruto: <strong>{promedio!.toFixed(1)}</strong>
        </p>
      )}
    </div>
  );
}

function CosechaFormContenido({
  plantaId,
  codigoSistema,
  onTocadoChange,
}: {
  plantaId: string;
  codigoSistema: string;
  onTocadoChange?: (tocado: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const ciclo = useVigenciaFormulario();
  const { user } = useAuth();
  const { data: datos } = useQuery({ queryKey: qk.fase.datos(plantaId), queryFn: () => obtenerDatosFase(plantaId) });

  const claveBorrador = `borrador:cosecha:${plantaId}`;
  const {
    valor: form,
    setValor: setForm,
    estado: estadoBorrador,
    errorPersistencia,
    recuperadoEn,
    limpiar,
    descartarRecuperado,
  } = useBorradorLocal<CosechaBorrador>(claveBorrador, VALOR_INICIAL_COSECHA, { usuarioId: user?.id ?? null });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [tocado, setTocado] = useState(false);

  // El valor recuperado del borrador local NUNCA gana sobre el valor ya
  // guardado en el servidor mientras `tocado` sea false -- a propósito, no es
  // un descuido. Un borrador viejo puede coexistir con un dato real más
  // reciente guardado desde otro dispositivo/sesión; pisarlo en silencio
  // sería corrupción de datos, no una molestia menor. El operario adopta el
  // borrador explícitamente ("Usar este borrador" abajo) o empieza a tipear
  // -- ambos casos marcan `tocado=true` a propósito.
  const fechaEfectiva = tocado ? form.fecha : datos?.fecha_cosecha || '';
  const nSemillasEfectivo = tocado ? form.nSemillas : datos?.n_semillas ?? null;

  useEffect(() => {
    onTocadoChange?.(tocado);
  }, [tocado, onTocadoChange]);

  const mutacion = useMutation({
    mutationFn: () => {
      if (nSemillasEfectivo == null) {
        throw new Error('Ingresa el total de semillas cosechadas.');
      }
      return actualizarCosecha(plantaId, {
        fecha_cosecha: fechaEfectiva || null,
        n_semillas: nSemillasEfectivo,
        codigoSistema,
        archivo,
      });
    },
    onSuccess: () => {
      if (!ciclo.sesionVigente()) return;
      void queryClient.invalidateQueries({ queryKey: qk.fase.datos(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.eventos.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
      if (!ciclo.uiVigente()) return;
      setError(null);
      setOk(true);
      setArchivo(null);
      setTocado(false);
      limpiar();
      setForm(VALOR_INICIAL_COSECHA);
    },
    onError: (e) => {
      if (!ciclo.uiVigente()) return;
      setOk(false);
      setError(e instanceof Error ? e.message : 'No se pudo guardar la cosecha.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wheat className="h-4 w-4 text-primary" /> Cosecha
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutacion.mutate();
          }}
          className="space-y-3"
        >
          {recuperadoEn && !tocado && (
            <Alert variant="success">
              Hay un borrador local sin guardar de {formatearActividad(new Date(recuperadoEn).toISOString())} (fecha:{' '}
              {form.fecha ? formatearFecha(form.fecha) : '—'}, semillas: {form.nSemillas ?? '—'}). Por seguridad, los campos muestran el valor
              guardado en el servidor hasta que decidas.
              <div className="mt-1.5 flex gap-3">
                <button type="button" className="underline" onClick={() => setTocado(true)}>
                  Usar este borrador
                </button>
                <button type="button" className="underline" onClick={descartarRecuperado}>
                  Descartar
                </button>
              </div>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoFecha
              id="fecha_cosecha"
              label="Fecha de cosecha (opcional)"
              value={fechaEfectiva}
              onChange={(value) => {
                setTocado(true);
                setForm((actual) => ({ ...actual, fecha: value }));
              }}
            />
            <div className="space-y-1.5">
              <Label htmlFor="n_semillas">N° semillas (total) *</Label>
              <Input
                id="n_semillas"
                type="number"
                min={0}
                required
                value={nSemillasEfectivo ?? ''}
                onChange={(e) => {
                  setTocado(true);
                  setForm((actual) => ({ ...actual, nSemillas: e.target.value === '' ? null : Number(e.target.value) }));
                }}
              />
            </div>
          </div>

          <AdjuntarArchivoFase archivo={archivo} onArchivoChange={setArchivo} />

          {error && <Alert>{error}</Alert>}
          {ok && <Alert variant="success">Cosecha guardada.</Alert>}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={mutacion.isPending}>
              {mutacion.isPending ? 'Guardando…' : 'Guardar cosecha'}
            </Button>
            <EstadoBorradorLocal estado={estadoBorrador} errorPersistencia={errorPersistencia} />
          </div>
        </form>

        <div className="border-t pt-4">
          <FrutosCosecha plantaId={plantaId} />
        </div>
      </CardContent>
    </Card>
  );
}

export function CosechaForm(props: ComponentProps<typeof CosechaFormContenido>) {
  const { user, generacionSesion } = useAuth();
  return <CosechaFormContenido key={JSON.stringify([user?.id ?? null, generacionSesion, props.plantaId])} {...props} />;
}
