/**
 * «+ Columnas» (reemplaza a Ranking Parámetro): agrega descriptores de la versión activa como columnas para ver y
 * ordenar, con un filtro opcional ≥ / ≤ por columna. Las agregadas se muestran como chips removibles.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { etiquetaCategoria, etiquetaMetrica, type MetricaVersion } from '@/api/resultados';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { FiltroColumna } from './modelo';

const OPERADOR = { ge: '≥', le: '≤' } as const;

export function ChipsColumnas({ columnas, filtros, onQuitar }: { columnas: readonly string[]; filtros: readonly FiltroColumna[]; onQuitar: (metrica: string) => void }) {
  return (
    <>
      {columnas.map((m) => {
        const filtro = filtros.find((f) => f.metrica === m);
        return (
          <span key={m} className="inline-flex items-center gap-1 rounded-full bg-brand-l py-0.5 pl-2.5 pr-1 text-small text-brand-ink">
            {etiquetaMetrica(m)}{filtro && <span className="tabular-nums"> {OPERADOR[filtro.op]} {String(filtro.valor).replace('.', ',')}</span>}
            <button type="button" aria-label={`Quitar la columna ${etiquetaMetrica(m)}`} onClick={() => onQuitar(m)} className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/60">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </>
  );
}

export function HojaColumnas({ metricas, columnas, filtros, onAplicar, onCerrar }: {
  metricas: readonly MetricaVersion[];
  columnas: readonly string[];
  filtros: readonly FiltroColumna[];
  onAplicar: (columnas: string[], filtros: FiltroColumna[]) => void;
  onCerrar: () => void;
}) {
  const [elegidas, setElegidas] = useState<string[]>([...columnas]);
  const [borrador, setBorrador] = useState<Record<string, { op: 'ge' | 'le'; valor: string }>>(
    Object.fromEntries(filtros.map((f) => [f.metrica, { op: f.op, valor: String(f.valor).replace('.', ',') }])),
  );
  const categorias = [...new Set(metricas.map((m) => m.categoria))];
  const alternar = (m: string) => setElegidas((actual) => (actual.includes(m) ? actual.filter((x) => x !== m) : [...actual, m]));
  const aplicar = () => {
    const nuevos: FiltroColumna[] = [];
    for (const m of elegidas) {
      const b = borrador[m];
      const valor = b ? Number(b.valor.replace(',', '.')) : NaN;
      if (b && b.valor.trim() !== '' && Number.isFinite(valor)) nuevos.push({ metrica: m, op: b.op, valor });
    }
    onAplicar(elegidas, nuevos);
  };
  return (
    <Sheet
      titulo="Columnas"
      subtitulo="Agrega descriptores para verlos y ordenar por ellos. Con un valor, filtra la tabla."
      onCerrar={onCerrar}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onCerrar}>Cancelar</Button><Button onClick={aplicar}>Aplicar</Button></div>}
    >
      <div className="space-y-4">
        {categorias.map((c) => (
          <fieldset key={c} className="space-y-1.5">
            <legend className="text-small font-semibold text-ink">{etiquetaCategoria(c)}</legend>
            {metricas.filter((m) => m.categoria === c).map((m) => {
              const elegida = elegidas.includes(m.metrica);
              const b = borrador[m.metrica] ?? { op: 'ge' as const, valor: '' };
              return (
                <div key={m.metrica} className="flex flex-wrap items-center gap-2">
                  <label className="flex min-h-tap flex-1 items-center gap-2 text-small text-ink">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={elegida} onChange={() => alternar(m.metrica)} />
                    {etiquetaMetrica(m.metrica)}
                  </label>
                  {elegida && (
                    <span className="flex items-center gap-1">
                      <Select aria-label={`Filtro de ${etiquetaMetrica(m.metrica)}`} className="w-16" value={b.op} onChange={(e) => setBorrador((x) => ({ ...x, [m.metrica]: { ...b, op: e.target.value as 'ge' | 'le' } }))}>
                        <option value="ge">≥</option>
                        <option value="le">≤</option>
                      </Select>
                      <Input aria-label={`Valor del filtro de ${etiquetaMetrica(m.metrica)}`} inputMode="decimal" className="w-20" placeholder="valor" value={b.valor} onChange={(e) => setBorrador((x) => ({ ...x, [m.metrica]: { ...b, valor: e.target.value } }))} />
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
    </Sheet>
  );
}
