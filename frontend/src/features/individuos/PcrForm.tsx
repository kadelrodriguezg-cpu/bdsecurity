/**
 * Formulario de PCR (análisis genético/molecular), ahora por ronda de
 * evaluación anual (Prompt 7 — antes colgaba directo del individuo, v3).
 * Toggle Sí/No + upload de PDF condicional (bucket privado media-plantas).
 */
import { useEffect, useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, FileUp } from 'lucide-react';
import { crearPcr, subirPdfPcr } from '@/api/rondas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { hoyChileISO } from '@/lib/fechas';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

export function PcrForm({
  rondaId,
  plantaId,
  codigoDisplay,
  onGuardado,
  onTocadoChange,
}: {
  rondaId: string;
  plantaId: string;
  codigoDisplay: string;
  onGuardado?: () => void;
  onTocadoChange?: (tocado: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [realizado, setRealizado] = useState<boolean | null>(null);
  const [fecha, setFecha] = useState(hoyChileISO);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // Generada una sola vez al montar -- identifica el intento de guardado, no
  // el contenido. Ver EvaluacionForm.tsx para el mismo patrón.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    onTocadoChange?.(realizado !== null || archivo !== null);
  }, [archivo, onTocadoChange, realizado]);

  const onArchivo = (e: ChangeEvent<HTMLInputElement>) => setArchivo(e.target.files?.[0] ?? null);

  const mutacion = useMutation({
    mutationFn: async () => {
      if (realizado === null) throw new Error('Indica si el PCR fue realizado.');
      const path = realizado && archivo ? await subirPdfPcr(archivo, codigoDisplay) : null;
      return crearPcr({
        ronda_id: rondaId,
        realizado,
        fecha: realizado ? fecha : null,
        informe_pdf_url: path,
      }, idempotencyKey);
    },
    onSuccess: () => {
      setError(null);
      setOk(true);
      onTocadoChange?.(false);
      setRealizado(null);
      setArchivo(null);
      setIdempotencyKey(crypto.randomUUID());
      void queryClient.invalidateQueries({ queryKey: qk.pcr.ronda(rondaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.actividad.planta(plantaId) });
      onGuardado?.();
    },
    onError: (e) => {
      setOk(false);
      setError(e instanceof Error ? e.message : 'No se pudo guardar el PCR.');
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
      <div className="space-y-1.5">
        <Label>¿PCR realizado?</Label>
        <div className="flex gap-2">
          {[
            { valor: true, label: 'Sí' },
            { valor: false, label: 'No' },
          ].map(({ valor, label }) => (
            <button
              key={label}
              type="button"
              onClick={() => setRealizado(valor)}
              className={cn(
                'rounded-md border px-4 py-2 text-sm font-medium',
                realizado === valor ? 'border-primary bg-primary text-white' : 'border-line-strong bg-white hover:bg-surface-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {realizado && (
        <>
          <CampoFecha id="fecha_pcr" label="Fecha" value={fecha} onChange={setFecha} required />
          <div className="space-y-1.5">
            <Label htmlFor="pdf_pcr" className="flex items-center gap-1.5">
              <FileUp className="h-4 w-4" /> Informe PDF (opcional)
            </Label>
            <Input id="pdf_pcr" type="file" accept="application/pdf" onChange={onArchivo} />
            {archivo && <p className="text-xs text-ink-3">Seleccionado: {archivo.name}</p>}
          </div>
        </>
      )}

      {error && <Alert>{error}</Alert>}
      {ok && <Alert variant="success">PCR guardado.</Alert>}

      <Button type="submit" disabled={mutacion.isPending || realizado === null}>
        <FlaskConical className="h-4 w-4" />
        {mutacion.isPending ? 'Guardando…' : 'Guardar PCR'}
      </Button>
    </form>
  );
}
