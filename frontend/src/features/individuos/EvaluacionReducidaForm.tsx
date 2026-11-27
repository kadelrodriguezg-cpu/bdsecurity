/**
 * Formulario puro de evaluación reducida (Trasplante: talla + entrenudos +
 * vigor; Crecimiento: + multibrotes + presencia de raíces). Dos disposiciones:
 * en un modal (Trasplante, North Star v5, rediseño de UX Parte D.5) y, desde el
 * Sprint 2 (S2-6), a pantalla completa para Crecimiento (docs/diseno/v2/04 y 08):
 * campos de 52 px en celular y acción principal fija abajo. El resumen de lo ya
 * cargado vive aparte, en EvaluacionReducidaResumen, siempre visible.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ruler } from 'lucide-react';
import { crearEvaluacionReducida, type FaseEvaluacionReducida } from '@/api/evaluacionReducida';
import { Stepper1a5 } from './Stepper1a5';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

export function EvaluacionReducidaForm({
  individuoId,
  plantaId,
  fase,
  onGuardado,
  onTocadoChange,
  variante = 'modal',
  siguiente,
  onCerrar,
}: {
  individuoId: string;
  plantaId: string;
  fase: FaseEvaluacionReducida;
  onGuardado?: () => void;
  onTocadoChange?: (tocado: boolean) => void;
  /** 'pantalla': pantalla completa, con la barra de acciones fija abajo. */
  variante?: 'modal' | 'pantalla';
  /** Código corto del siguiente pendiente: el botón dice «Guardar y seguir con …». */
  siguiente?: string;
  /** Pantalla completa: «Cancelar» (la página decide a dónde vuelve). */
  onCerrar?: () => void;
}) {
  const queryClient = useQueryClient();
  const pantalla = variante === 'pantalla';
  const [talla, setTalla] = useState('');
  const [entrenudos, setEntrenudos] = useState('');
  const [vigor, setVigor] = useState<number | undefined>(undefined);
  const [multibrotes, setMultibrotes] = useState('');
  const [raices, setRaices] = useState<number | undefined>(undefined);
  const [observaciones, setObservaciones] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tocado = !!(talla || entrenudos || vigor || multibrotes || raices || observaciones.trim());

  useEffect(() => onTocadoChange?.(tocado), [onTocadoChange, tocado]);

  const mutacion = useMutation({
    mutationFn: () =>
      crearEvaluacionReducida({
        individuo_id: individuoId,
        fase,
        talla: talla === '' ? undefined : Number(talla),
        numero_entrenudos: entrenudos === '' ? undefined : Number(entrenudos),
        vigor,
        multibrotes: fase === 'crecimiento' && multibrotes !== '' ? Number(multibrotes) : undefined,
        presencia_raices: fase === 'crecimiento' ? raices : undefined,
        observaciones: observaciones.trim() || undefined,
      }),
    onSuccess: () => {
      setError(null);
      onTocadoChange?.(false);
      void queryClient.invalidateQueries({ queryKey: qk.evaluacionReducida.all(individuoId) });
      void queryClient.invalidateQueries({ queryKey: qk.evaluacionReducida.cruce(plantaId, fase) });
      void queryClient.invalidateQueries({ queryKey: qk.individuos.resumen(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
      onGuardado?.();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la evaluación.');
    },
  });

  // En celular los campos de terreno miden 52 px (referencia 08); en escritorio, los 44 de siempre.
  const campo = pantalla ? 'max-md:min-h-[52px] max-md:text-base' : '';
  const multibrotesCampo = (
    <div className="space-y-1.5">
      <Label htmlFor="multibrotes">Multibrotes (opcional)</Label>
      <Input id="multibrotes" type="number" inputMode="numeric" min={0} value={multibrotes} onChange={(e) => setMultibrotes(e.target.value)} className={cn(!pantalla && 'w-32', campo)} />
    </div>
  );
  const textoGuardar = mutacion.isPending ? 'Guardando…' : siguiente ? `Guardar y seguir con ${siguiente}` : 'Guardar evaluación';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Una evaluación sin ningún valor no aporta nada al avance: a pantalla completa se pide al menos uno.
        if (pantalla && !tocado) {
          setError('Registra al menos un valor antes de guardar.');
          return;
        }
        mutacion.mutate();
      }}
      className={cn('space-y-3', pantalla && 'space-y-5 pb-28 md:pb-24')}
    >
      <div className={cn('grid grid-cols-2 gap-3', pantalla && 'max-sm:grid-cols-1 sm:gap-4', pantalla && fase === 'crecimiento' && 'sm:grid-cols-3')}>
        <div className="space-y-1.5">
          <Label htmlFor="talla">Talla (opcional)</Label>
          <Input id="talla" type="number" inputMode="decimal" step="0.1" min={0} value={talla} onChange={(e) => setTalla(e.target.value)} className={campo} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entrenudos">N° entrenudos (opcional)</Label>
          <Input id="entrenudos" type="number" inputMode="numeric" min={0} value={entrenudos} onChange={(e) => setEntrenudos(e.target.value)} className={campo} />
        </div>
        {/* A pantalla completa los tres números van en una fila; en el modal, multibrotes sigue después del vigor. */}
        {pantalla && fase === 'crecimiento' && multibrotesCampo}
      </div>

      {pantalla ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Stepper1a5 label="Vigor" value={vigor} onChange={setVigor} labelMin="muy bajo" labelMax="muy alto" grande />
          {fase === 'crecimiento' && <Stepper1a5 label="Presencia de raíces" value={raices} onChange={setRaices} labelMin="ninguna" labelMax="abundante" grande />}
        </div>
      ) : (
        <>
          <Stepper1a5 label="Vigor" value={vigor} onChange={setVigor} labelMin="muy bajo" labelMax="muy alto" />
          {fase === 'crecimiento' && (
            <>
              {multibrotesCampo}
              <Stepper1a5 label="Presencia de raíces" value={raices} onChange={setRaices} labelMin="ninguna" labelMax="abundante" />
            </>
          )}
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="obs_reducida">Observaciones (opcional)</Label>
        <Textarea id="obs_reducida" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className={pantalla ? 'max-md:text-base' : undefined} />
      </div>

      {error && <Alert role="alert">{error}</Alert>}

      {pantalla ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-end gap-2">
            <span className="mr-auto hidden text-small text-ink-3 md:block">{tocado ? 'Hay valores sin guardar' : 'Sin valores todavía'}</span>
            {onCerrar && (
              <Button type="button" variant="outline" className="max-md:min-h-[52px] max-md:flex-none max-md:px-4" onClick={onCerrar}>Cancelar</Button>
            )}
            <Button type="submit" disabled={mutacion.isPending} className="max-md:min-h-[52px] max-md:flex-1 max-md:text-body-l">
              <Ruler className="h-4 w-4" aria-hidden="true" />
              {textoGuardar}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" disabled={mutacion.isPending}>
          <Ruler className="h-4 w-4" />
          {mutacion.isPending ? 'Guardando…' : 'Guardar evaluación'}
        </Button>
      )}
    </form>
  );
}
