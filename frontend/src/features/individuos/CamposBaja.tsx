/**
 * Campos de una baja: nuevo estado, fecha, criterios (uno o varios) y nota.
 * Los usan la baja individual (BajaForm) y la baja en lote, para que las dos
 * pidan exactamente lo mismo que valida la base (validar_parametros_baja).
 */
import { CRITERIO_BAJA_LABEL, type CriterioBaja, type EstadoVital } from '@/api/individuos';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { cn } from '@/lib/utils';

export type EstadoBaja = Extract<EstadoVital, 'descartado' | 'muerto'>;

export interface ValoresBaja {
  estado: EstadoBaja;
  fecha: string;
  criterios: CriterioBaja[];
  nota: string;
}

export function CamposBaja({
  valores,
  onChange,
  idPrefijo = 'baja',
}: {
  valores: ValoresBaja;
  onChange: (cambio: Partial<ValoresBaja>) => void;
  /** Prefijo de los id de los campos: dos formularios en la misma pantalla no pueden repetirlos. */
  idPrefijo?: string;
}) {
  const criteriosDisponibles = Object.keys(CRITERIO_BAJA_LABEL) as CriterioBaja[];
  const toggleCriterio = (c: CriterioBaja) =>
    onChange({ criterios: valores.criterios.includes(c) ? valores.criterios.filter((x) => x !== c) : [...valores.criterios, c] });

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`estado_${idPrefijo}`}>Nuevo estado</Label>
          <Select id={`estado_${idPrefijo}`} value={valores.estado} onChange={(e) => onChange({ estado: e.target.value as EstadoBaja })}>
            <option value="descartado">Descartado</option>
            <option value="muerto">Muerto</option>
          </Select>
        </div>
        <CampoFecha id={`fecha_${idPrefijo}`} label="Fecha" value={valores.fecha} onChange={(value) => onChange({ fecha: value })} required />
      </div>

      <div className="space-y-1.5">
        <Label>Criterio(s) (elige uno o varios)</Label>
        <div className="flex flex-wrap gap-2">
          {criteriosDisponibles.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={valores.criterios.includes(c)}
              onClick={() => toggleCriterio(c)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium',
                valores.criterios.includes(c) ? 'border-danger bg-danger-l text-danger' : 'border-line-strong bg-white hover:bg-surface-2',
              )}
            >
              {CRITERIO_BAJA_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`nota_${idPrefijo}`}>Nota (opcional)</Label>
        <Textarea id={`nota_${idPrefijo}`} placeholder="Detalle de la baja…" value={valores.nota} onChange={(e) => onChange({ nota: e.target.value })} />
      </div>
    </>
  );
}
