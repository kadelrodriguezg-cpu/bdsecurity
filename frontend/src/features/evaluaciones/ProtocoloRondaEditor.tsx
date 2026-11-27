/**
 * Definir o cambiar el protocolo de una ronda (solo admin; la base lo valida
 * en definir_protocolo_ronda). Referencia: docs/diseno/v2/04, vista «Protocolo».
 * Cada sección es obligatoria, opcional o no se evalúa; dentro de la sección
 * se puede ajustar descriptor por descriptor. Guardar crea una versión nueva:
 * lo ya evaluado conserva la versión con que se hizo.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { definirProtocoloRonda, type DescriptoresProtocolo, type NivelProtocolo } from '@/api/protocolo';
import { camposProtocolizables } from '@/lib/esquemaFase/protocolo';
import { useEspecieDeCruce, useEsquemaEvaluacionAnualDeEspecie } from '@/lib/esquemaFase/useEsquemaFase';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { etiquetaTemporada } from '@/lib/temporada';
import { hoyChileISO } from '@/lib/fechas';

type Nivel = NivelProtocolo | 'no';

const OPCIONES: { valor: Nivel; texto: string }[] = [
  { valor: 'obligatorio', texto: 'Obligatoria' },
  { valor: 'opcional', texto: 'Opcional' },
  { valor: 'no', texto: 'No se evalúa' },
];

function Segmentado({ valor, onChange, etiqueta, mixto }: { valor: Nivel | null; onChange: (v: Nivel) => void; etiqueta: string; mixto?: boolean }) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
      {OPCIONES.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onChange(o.valor)}
          className={cn(
            'min-h-tap rounded-[6px] px-2.5 text-small',
            valor === o.valor ? 'bg-surface text-brand-ink shadow-[0_1px_0_var(--line)]' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.texto}
        </button>
      ))}
      {mixto && <span className="self-center px-2 text-small text-ink-3">Mixta</span>}
    </div>
  );
}

export function ProtocoloRondaEditor({
  plantaId,
  numeroRonda,
  actual,
  nombreActual,
  onGuardado,
  onCancelar,
  onTocadoChange,
}: {
  plantaId: string;
  numeroRonda: number;
  actual: DescriptoresProtocolo | null;
  nombreActual?: string;
  onGuardado: () => void;
  onCancelar: () => void;
  onTocadoChange?: (tocado: boolean) => void;
}) {
  // Fase 4: solo se ofrecen los descriptores que usa la especie del cruce (la base rechaza los demás).
  const esquema = useEsquemaEvaluacionAnualDeEspecie(useEspecieDeCruce(plantaId));
  const queryClient = useQueryClient();
  const campos = camposProtocolizables(esquema);
  const [nombre, setNombre] = useState(nombreActual ?? `Ronda ${numeroRonda} anual · Temporada ${etiquetaTemporada(hoyChileISO())}`);
  const [niveles, setNiveles] = useState<Record<string, Nivel>>(() =>
    Object.fromEntries(campos.map((c) => [c.clave, ((actual as Record<string, NivelProtocolo> | null)?.[c.clave]) ?? 'no'])));
  const [error, setError] = useState<string | null>(null);

  const cambiar = (claves: string[], nivel: Nivel) => {
    setNiveles((n) => ({ ...n, ...Object.fromEntries(claves.map((c) => [c, nivel])) }));
    onTocadoChange?.(true);
  };

  const resumen = useMemo(() => {
    const valores = Object.values(niveles);
    return {
      obligatorios: valores.filter((v) => v === 'obligatorio').length,
      opcionales: valores.filter((v) => v === 'opcional').length,
      no: valores.filter((v) => v === 'no').length,
    };
  }, [niveles]);

  const mutacion = useMutation({
    mutationFn: () => definirProtocoloRonda({
      plantaId,
      numeroRonda,
      nombre,
      // Solo lo que hoy se ofrece: un protocolo anterior puede traer un descriptor que la especie ya no usa.
      descriptores: Object.fromEntries(Object.entries(niveles).filter(([clave, n]) => n !== 'no' && campos.some((c) => c.clave === clave))) as DescriptoresProtocolo,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.protocolo.all });
      onGuardado();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar el protocolo.'),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (resumen.obligatorios + resumen.opcionales === 0) {
          setError('El protocolo debe incluir al menos un descriptor.');
          return;
        }
        mutacion.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="protocolo-nombre">Nombre del protocolo</Label>
        <Input id="protocolo-nombre" value={nombre} onChange={(e) => { setNombre(e.target.value); onTocadoChange?.(true); }} required />
      </div>

      <p className="text-small text-ink-3">
        Qué se evalúa en la ronda {numeroRonda}:{' '}
        <span className="tabular-nums text-ink-2">{resumen.obligatorios} obligatorios · {resumen.opcionales} opcionales · {resumen.no} no se evalúan</span>.
        Lo obligatorio que falte se avisa al finalizar, pero no lo impide.
      </p>

      <ul className="divide-y divide-line-soft rounded-lg border border-line">
        {esquema.secciones.map((seccion) => {
          const deSeccion = campos.filter((c) => c.seccion === seccion.id);
          if (deSeccion.length === 0) return null;
          const nivelesSeccion = new Set(deSeccion.map((c) => niveles[c.clave]));
          const nivelSeccion = nivelesSeccion.size === 1 ? [...nivelesSeccion][0] : null;
          return (
            <li key={seccion.id} className="space-y-2 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-body text-ink">
                  {seccion.etiqueta} <span className="text-small text-ink-3">· {deSeccion.length} {deSeccion.length === 1 ? 'descriptor' : 'descriptores'}</span>
                </span>
                <Segmentado
                  etiqueta={`Nivel de ${seccion.etiqueta}`}
                  valor={nivelSeccion}
                  mixto={nivelSeccion === null}
                  onChange={(v) => cambiar(deSeccion.map((c) => c.clave), v)}
                />
              </div>
              {seccion.id === 'fruto' && (
                <p className="text-small text-ink-3">Si se carga algún dato de fruta, la muestra (cantidad y peso) se exige al finalizar.</p>
              )}
              <details>
                <summary className="min-h-tap cursor-pointer py-2 text-small text-brand">Elegir descriptor por descriptor</summary>
                <ul className="space-y-1.5 pt-1">
                  {deSeccion.map((c) => (
                    <li key={c.clave} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-small text-ink-2">{c.etiqueta}</span>
                      <Segmentado etiqueta={`Nivel de ${c.etiqueta}`} valor={niveles[c.clave]} onChange={(v) => cambiar([c.clave], v)} />
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>

      <p className="text-small text-ink-3">
        Cada evaluación guarda el protocolo con que se hizo. Si lo cambias a mitad de ronda, lo ya guardado conserva el anterior.
      </p>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" cargando={mutacion.isPending}>Guardar protocolo</Button>
      </div>
    </form>
  );
}
