/**
 * Catálogo de especies (solo admin): alta y edición, con el patrón común de catálogos. Desde la fase 4 la especie es el espacio
 * de trabajo de la app: cada fila muestra cuántos cruces tiene y lleva a «Configurar descriptores» de esa especie. No hay baja:
 * una especie con cruces no se puede borrar y no tiene estado activo/inactivo.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { listarEspecies, crearEspecie, actualizarEspecie, type Especie } from '@/api/especies';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet } from '@/components/ui/sheet';
import { PuntoEspecie } from '@/components/shell/SelectorEspecie';
import { useEspacioEspecieOpcional } from '@/features/especies/EspacioEspecie';
import { qk } from '@/lib/queryKeys';
import { CatalogoTabla } from './CatalogoTabla';

function HojaEspecie({ especie, onCerrar }: { especie: Especie | null; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(especie?.nombre ?? '');
  const [nombreCientifico, setNombreCientifico] = useState(especie?.nombre_cientifico ?? '');
  const guardar = useMutation({
    mutationFn: () => (especie
      ? actualizarEspecie(especie.id, { nombre: nombre.trim(), nombreCientifico: nombreCientifico.trim() || null })
      : crearEspecie(nombre.trim(), nombreCientifico.trim() || undefined)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.especies.all });
      void queryClient.invalidateQueries({ queryKey: qk.plantas.all });
      onCerrar();
    },
  });
  const valido = nombre.trim() !== '';
  return (
    <Sheet
      titulo={especie ? 'Editar especie' : 'Nueva especie'}
      onCerrar={onCerrar}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button disabled={!valido || guardar.isPending} onClick={() => guardar.mutate()}>{guardar.isPending ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      )}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) guardar.mutate(); }}>
        <div className="space-y-1">
          <Label htmlFor="especie-nombre">Nombre</Label>
          <Input id="especie-nombre" value={nombre} placeholder="Ej. Mora, Frambuesa" onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="especie-cientifico">Nombre científico (opcional)</Label>
          <Input id="especie-cientifico" value={nombreCientifico} placeholder="Ej. Rubus idaeus" onChange={(e) => setNombreCientifico(e.target.value)} />
        </div>
        {!especie && <p className="text-small text-ink-3">La especie nueva usa todos los descriptores; después puedes elegir cuáles usa en «Descriptores».</p>}
        {guardar.error && <Alert>{(guardar.error as Error).message}</Alert>}
      </form>
    </Sheet>
  );
}

export function EspeciesCatalogo() {
  const consulta = useQuery({ queryKey: qk.especies.all, queryFn: listarEspecies });
  const panorama = useEspacioEspecieOpcional()?.panorama;
  const [hoja, setHoja] = useState<{ especie: Especie | null } | null>(null);
  const crucesDe = (id: string) => panorama?.find((p) => p.id === id)?.cruces;
  return (
    <>
      <CatalogoTabla<Especie>
        titulo="Especies"
        descripcion="Cada especie es un espacio de trabajo: se elige en el encabezado y toda la app trabaja en ella."
        singular="especie"
        plural="especies"
        filas={consulta.data}
        cargando={consulta.isPending}
        error={consulta.isError ? 'No se pudieron cargar las especies.' : null}
        onReintentar={() => void consulta.refetch()}
        nombreDe={(e) => <span className="inline-flex items-center gap-2"><PuntoEspecie especie={e} />{e.nombre}</span>}
        columnas={[
          { titulo: 'Nombre científico', celda: (e) => (e.nombre_cientifico ? <em className="not-italic text-ink-2">{e.nombre_cientifico}</em> : <span className="text-ink-3">—</span>) },
          { titulo: 'Cruces', derecha: true, celda: (e) => crucesDe(e.id) ?? '—' },
        ]}
        onAgregar={() => setHoja({ especie: null })}
        onEditar={(e) => setHoja({ especie: e })}
        extraAcciones={(e) => (
          <Link to={`/catalogos?tipo=descriptores&especie=${e.id}`} className="inline-flex min-h-tap items-center gap-1.5 rounded-md px-3 text-small font-medium text-brand hover:bg-surface-2">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Descriptores
          </Link>
        )}
      />
      {hoja && <HojaEspecie key={hoja.especie?.id ?? 'nueva'} especie={hoja.especie} onCerrar={() => setHoja(null)} />}
    </>
  );
}
