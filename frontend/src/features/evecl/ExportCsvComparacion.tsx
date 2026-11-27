import { useState } from 'react';
import { Download } from 'lucide-react';
import type { EveclComparacion } from '@/api/evecl';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { hoyChileISO } from '@/lib/fechas';
import { crearCsvComparacion, descargarCsvComparacion, gruposExportables } from './exportCsv';

export function ExportCsvComparacion({ comparacion }: { comparacion: EveclComparacion }) {
  const grupos = gruposExportables(comparacion);
  const [grupoFicha, setGrupoFicha] = useState(grupos[0]?.key ?? '');
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set());

  const descargar = (alcance: 'ficha' | 'seleccion' | 'todo') => {
    const claves = alcance === 'todo'
      ? undefined
      : alcance === 'ficha'
        ? new Set([grupoFicha])
        : seleccion;
    const contenido = crearCsvComparacion(comparacion, claves);
    const fecha = hoyChileISO();
    descargarCsvComparacion(contenido, `evecl-comparacion-${alcance}-${fecha}.csv`);
  };

  const alternarGrupo = (key: string, marcado: boolean) => {
    setSeleccion((actual) => {
      const siguiente = new Set(actual);
      if (marcado) siguiente.add(key);
      else siguiente.delete(key);
      return siguiente;
    });
  };

  return (
    <section data-print-control className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div>
        <h2 className="font-semibold">Exportar CSV</h2>
        <p className="mt-1 text-xs text-ink-3">Exporta los resultados tal como se ven en pantalla; el archivo no recalcula puntajes.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-end">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Una ficha</span>
          <Select
            value={grupoFicha}
            onChange={(evento) => setGrupoFicha(evento.target.value)}
            disabled={comparacion.modo !== 'entre_fichas' || grupos.length === 0}
          >
            {grupos.map((grupo) => <option key={grupo.key} value={grupo.key}>{grupo.label}</option>)}
          </Select>
          {comparacion.modo !== 'entre_fichas' ? <span className="block text-xs text-ink-3">Disponible en el modo Entre fichas.</span> : null}
        </label>
        <Button variant="outline" disabled={comparacion.modo !== 'entre_fichas' || !grupoFicha} onClick={() => descargar('ficha')}>
          <Download className="h-4 w-4" /> Una ficha
        </Button>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Selección de grupos</legend>
        <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-2 xl:grid-cols-3">
          {grupos.map((grupo, indice) => (
            <label key={grupo.key} htmlFor={`evecl-export-${indice}`} className="flex min-h-tap items-center gap-2 text-sm">
              <input
                id={`evecl-export-${indice}`}
                type="checkbox"
                checked={seleccion.has(grupo.key)}
                onChange={(evento) => alternarGrupo(grupo.key, evento.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              <span>{grupo.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={seleccion.size === 0} onClick={() => descargar('seleccion')}>
          <Download className="h-4 w-4" /> Selección ({seleccion.size})
        </Button>
        <Button onClick={() => descargar('todo')} disabled={grupos.length === 0}>
          <Download className="h-4 w-4" /> Todo
        </Button>
      </div>
    </section>
  );
}
