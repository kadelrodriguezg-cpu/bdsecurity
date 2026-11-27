/**
 * Contenedores (se eligen en Siembra). La capacidad es su propio dato y se muestra sola junto al nombre («Macetero · 10 L»):
 * no hay que escribirla en el nombre. Los nombres antiguos que la repiten se marcan en ámbar (dato dudoso, N8) con un botón
 * para quitarla del nombre; si el nombre trae una capacidad que no está cargada, un botón la pasa a la capacidad.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actualizarContenedor, crearContenedor, listarContenedores, type Contenedor } from '@/api/catalogos';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet } from '@/components/ui/sheet';
import { capacidadEnNombre, etiquetaContenedor, formatearLitros, nombreSinCapacidad, repiteCapacidad } from '@/lib/contenedores';
import { qk } from '@/lib/queryKeys';
import { CatalogoTabla } from './CatalogoTabla';
import { mensajeCarga } from './mensajes';

function FormContenedor({ contenedor, onCerrar }: { contenedor: Contenedor | null; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(contenedor?.nombre ?? '');
  const [capacidad, setCapacidad] = useState(contenedor?.capacidad_litros != null ? String(contenedor.capacidad_litros) : '');
  const [error, setError] = useState<string | null>(null);
  const litros = capacidad.trim() === '' ? null : Number(capacidad.replace(',', '.'));
  const capacidadValida = litros === null || (Number.isFinite(litros) && litros > 0);
  const enNombre = capacidadEnNombre(nombre);
  const guardar = useMutation({
    mutationFn: () => {
      const datos = { nombre: nombre.trim(), capacidad_litros: litros };
      return contenedor ? actualizarContenedor(contenedor.id, datos) : crearContenedor(datos).then(() => undefined);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.catalogos.contenedores.admin });
      void queryClient.invalidateQueries({ queryKey: qk.catalogos.contenedores.activos });
      void queryClient.invalidateQueries({ queryKey: qk.catalogos.contenedores.historial });
      onCerrar();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar el contenedor.'),
  });
  const usarCapacidadDelNombre = () => {
    if (enNombre === null) return;
    setCapacidad(String(enNombre));
    setNombre(nombreSinCapacidad(nombre, enNombre));
  };
  return (
    <Sheet
      titulo={contenedor ? 'Editar contenedor' : 'Agregar contenedor'}
      onCerrar={onCerrar}
      hayContenido={!contenedor && (nombre.trim() !== '' || capacidad.trim() !== '')}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button disabled={!nombre.trim() || !capacidadValida || guardar.isPending} onClick={() => guardar.mutate()}>{guardar.isPending ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      )}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (nombre.trim() && capacidadValida) guardar.mutate(); }}>
        <div className="space-y-1">
          <Label htmlFor="cont-nombre">Nombre</Label>
          <Input id="cont-nombre" value={nombre} placeholder="Ej. Macetero, Bolsa GrowinBag" onChange={(e) => setNombre(e.target.value)} />
          <p className="text-micro text-ink-3">Sin la capacidad: se muestra sola junto al nombre.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cont-cap">Capacidad (litros)</Label>
          <Input id="cont-cap" inputMode="decimal" className="w-40" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} aria-invalid={capacidadValida ? undefined : true} />
          {!capacidadValida && <p className="text-small text-danger">La capacidad debe ser un número mayor que cero.</p>}
        </div>
        {enNombre !== null && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-warn-l p-3 text-small text-warn">
            <span>El nombre dice {formatearLitros(enNombre)}.</span>
            <Button type="button" size="sm" variant="outline" onClick={usarCapacidadDelNombre}>
              {litros === enNombre ? 'Quitarla del nombre' : 'Usarla como capacidad'}
            </Button>
          </div>
        )}
        {nombre.trim() && capacidadValida && (
          <p className="text-small text-ink-2">Se mostrará así: <strong className="text-ink">{etiquetaContenedor({ nombre: nombre.trim(), capacidad_litros: litros })}</strong></p>
        )}
        {error && <Alert>{error}</Alert>}
      </form>
    </Sheet>
  );
}

export function ContenedoresCatalogo() {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: qk.catalogos.contenedores.admin, queryFn: () => listarContenedores(false) });
  const [hoja, setHoja] = useState<{ contenedor: Contenedor | null } | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.contenedores.admin });
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.contenedores.activos });
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.contenedores.historial });
  };
  const actualizar = useMutation({
    mutationFn: ({ c, cambios }: { c: Contenedor; cambios: Partial<Pick<Contenedor, 'nombre' | 'capacidad_litros' | 'activo'>> }) => actualizarContenedor(c.id, cambios),
    onSuccess: () => { setErrorAccion(null); invalidar(); },
    onError: (e) => setErrorAccion(e instanceof Error ? e.message : 'No se pudo actualizar el contenedor.'),
  });

  // Los nombres que repiten la capacidad se limpian todos juntos desde un solo aviso (fila por fila sería ruido).
  const repetidos = (consulta.data ?? []).filter((c) => c.activo && repiteCapacidad(c));
  const limpiarTodos = useMutation({
    mutationFn: () => Promise.all(repetidos.map((c) => actualizarContenedor(c.id, { nombre: nombreSinCapacidad(c.nombre, Number(c.capacidad_litros)) }))),
    onSuccess: () => { setErrorAccion(null); invalidar(); },
    onError: (e) => setErrorAccion(e instanceof Error ? e.message : 'No se pudieron corregir los nombres.'),
  });

  const avisoFila = (c: Contenedor) => {
    if (repiteCapacidad(c)) {
      return <span className="mt-0.5 block text-small font-normal text-warn">Nombre guardado: «{c.nombre.replace(/\s+/g, ' ').trim()}»</span>;
    }
    const enNombre = c.capacidad_litros === null ? capacidadEnNombre(c.nombre) : null;
    if (enNombre !== null) {
      return (
        <span className="mt-1 flex flex-wrap items-center gap-2 text-small font-normal text-warn">
          El nombre dice {formatearLitros(enNombre)}, pero la capacidad no está cargada.
          <Button size="sm" variant="outline" disabled={actualizar.isPending} onClick={() => actualizar.mutate({ c, cambios: { capacidad_litros: enNombre, nombre: nombreSinCapacidad(c.nombre, enNombre) } })}>Usarla como capacidad</Button>
        </span>
      );
    }
    return null;
  };

  return (
    <div className="space-y-3">
      {errorAccion && <Alert>{errorAccion}</Alert>}
      <CatalogoTabla<Contenedor>
        aviso={repetidos.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-warn-l p-3 text-small text-warn">
            <span>{repetidos.length === 1 ? '1 nombre repite la capacidad' : `${repetidos.length} nombres repiten la capacidad`}, que ya se muestra sola junto al nombre.</span>
            <Button size="sm" variant="outline" disabled={limpiarTodos.isPending} onClick={() => limpiarTodos.mutate()}>
              {limpiarTodos.isPending ? 'Corrigiendo…' : repetidos.length === 1 ? 'Quitarla del nombre' : 'Quitarla de todos'}
            </Button>
          </div>
        ) : undefined}
        titulo="Contenedores"
        descripcion="Bandejas, maceteros y bolsas que se eligen al registrar la siembra."
        singular="contenedor"
        plural="contenedores"
        filas={consulta.data}
        cargando={consulta.isPending}
        error={consulta.isError ? mensajeCarga('los contenedores', consulta.error) : null}
        onReintentar={() => void consulta.refetch()}
        nombreDe={(c) => (
          <>
            <span className="block">{c.capacidad_litros === null ? c.nombre.replace(/\s+/g, ' ').trim() : nombreSinCapacidad(c.nombre, Number(c.capacidad_litros))}</span>
            {avisoFila(c)}
          </>
        )}
        columnas={[{
          titulo: 'Capacidad',
          derecha: true,
          celda: (c) => (c.capacidad_litros === null ? <span className="text-warn">Sin capacidad</span> : formatearLitros(Number(c.capacidad_litros))),
        }]}
        onAgregar={() => setHoja({ contenedor: null })}
        onEditar={(c) => setHoja({ contenedor: c })}
        onAlternarActivo={(c) => actualizar.mutate({ c, cambios: { activo: !c.activo } })}
        alternando={actualizar.isPending ? actualizar.variables?.c.id ?? null : null}
      />
      {hoja && <FormContenedor key={hoja.contenedor?.id ?? 'nuevo'} contenedor={hoja.contenedor} onCerrar={() => setHoja(null)} />}
    </div>
  );
}
