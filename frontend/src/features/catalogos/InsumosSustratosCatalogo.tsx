/**
 * Insumos (se aplican en los procedimientos y en Siembra) y sustratos (Siembra), con el patrón común de catálogos: lista,
 * alta y edición en una hoja, y desactivar en vez de borrar.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  actualizarInsumo, actualizarSustrato, crearInsumo, crearSustrato, listarInsumos, listarSustratos, TIPO_INSUMO_LABEL,
  type Insumo, type Sustrato, type TipoInsumo,
} from '@/api/catalogos';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { qk } from '@/lib/queryKeys';
import { CatalogoTabla } from './CatalogoTabla';
import { mensajeCarga } from './mensajes';

function HojaNombre({ titulo, nombreInicial, guardando, error, onGuardar, onCerrar, children, idNombre, listo = true }: {
  titulo: string;
  nombreInicial: string;
  guardando: boolean;
  error: string | null;
  onGuardar: (nombre: string) => void;
  onCerrar: () => void;
  children?: React.ReactNode;
  idNombre: string;
  listo?: boolean;
}) {
  const [nombre, setNombre] = useState(nombreInicial);
  const valido = nombre.trim() !== '' && listo;
  return (
    <Sheet
      titulo={titulo}
      onCerrar={onCerrar}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button disabled={!valido || guardando} onClick={() => onGuardar(nombre.trim())}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      )}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) onGuardar(nombre.trim()); }}>
        <div className="space-y-1">
          <Label htmlFor={idNombre}>Nombre</Label>
          <Input id={idNombre} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        {children}
        {error && <Alert>{error}</Alert>}
      </form>
    </Sheet>
  );
}

export function InsumosCatalogo() {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: qk.catalogos.insumos.admin, queryFn: () => listarInsumos(false) });
  const [hoja, setHoja] = useState<{ insumo: Insumo | null } | null>(null);
  const [tipo, setTipo] = useState<TipoInsumo>('otro');
  const [error, setError] = useState<string | null>(null);
  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.insumos.admin });
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.insumos.activos });
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.insumos.historial });
  };
  const guardar = useMutation({
    mutationFn: (nombre: string) => (hoja?.insumo ? actualizarInsumo(hoja.insumo.id, { nombre, tipo }) : crearInsumo({ nombre, tipo }).then(() => undefined)),
    onSuccess: () => { setHoja(null); setError(null); invalidar(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar el insumo.'),
  });
  const alternar = useMutation({
    mutationFn: (i: Insumo) => actualizarInsumo(i.id, { activo: !i.activo }),
    onSuccess: invalidar,
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo actualizar el insumo.'),
  });
  const abrir = (insumo: Insumo | null) => { setTipo(insumo?.tipo ?? 'otro'); setError(null); setHoja({ insumo }); };
  return (
    <div className="space-y-3">
      {error && !hoja && <Alert>{error}</Alert>}
      <CatalogoTabla<Insumo>
        titulo="Insumos"
        descripcion="Fungicidas, insecticidas, escarificantes y otros productos que se aplican en los procedimientos y en la siembra."
        singular="insumo"
        plural="insumos"
        filas={consulta.data}
        cargando={consulta.isPending}
        error={consulta.isError ? mensajeCarga('los insumos', consulta.error) : null}
        onReintentar={() => void consulta.refetch()}
        columnas={[{ titulo: 'Tipo', celda: (i) => TIPO_INSUMO_LABEL[i.tipo] }]}
        onAgregar={() => abrir(null)}
        onEditar={abrir}
        onAlternarActivo={(i) => alternar.mutate(i)}
        alternando={alternar.isPending ? alternar.variables?.id ?? null : null}
      />
      {hoja && (
        <HojaNombre
          key={hoja.insumo?.id ?? 'nuevo'}
          idNombre="ins-nombre"
          titulo={hoja.insumo ? 'Editar insumo' : 'Agregar insumo'}
          nombreInicial={hoja.insumo?.nombre ?? ''}
          guardando={guardar.isPending}
          error={error}
          onGuardar={(nombre) => guardar.mutate(nombre)}
          onCerrar={() => setHoja(null)}
        >
          <div className="space-y-1">
            <Label htmlFor="ins-tipo">Tipo</Label>
            <Select id="ins-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoInsumo)}>
              {Object.entries(TIPO_INSUMO_LABEL).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
            </Select>
          </div>
          <p className="text-small text-ink-3">La cantidad y la unidad se anotan en cada procedimiento, no aquí.</p>
        </HojaNombre>
      )}
    </div>
  );
}

export function SustratosCatalogo() {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: qk.catalogos.sustratos.admin, queryFn: () => listarSustratos(false) });
  const [hoja, setHoja] = useState<{ sustrato: Sustrato | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.sustratos.admin });
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.sustratos.activos });
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.sustratos.historial });
  };
  const guardar = useMutation({
    mutationFn: (nombre: string) => (hoja?.sustrato ? actualizarSustrato(hoja.sustrato.id, { nombre }) : crearSustrato({ nombre }).then(() => undefined)),
    onSuccess: () => { setHoja(null); setError(null); invalidar(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar el sustrato.'),
  });
  const alternar = useMutation({
    mutationFn: (s: Sustrato) => actualizarSustrato(s.id, { activo: !s.activo }),
    onSuccess: invalidar,
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo actualizar el sustrato.'),
  });
  return (
    <div className="space-y-3">
      {error && !hoja && <Alert>{error}</Alert>}
      <CatalogoTabla<Sustrato>
        titulo="Sustratos"
        descripcion="Mezclas y materiales de siembra (se pueden elegir varios en cada siembra)."
        singular="sustrato"
        plural="sustratos"
        filas={consulta.data}
        cargando={consulta.isPending}
        error={consulta.isError ? mensajeCarga('los sustratos', consulta.error) : null}
        onReintentar={() => void consulta.refetch()}
        columnas={[]}
        onAgregar={() => { setError(null); setHoja({ sustrato: null }); }}
        onEditar={(s) => { setError(null); setHoja({ sustrato: s }); }}
        onAlternarActivo={(s) => alternar.mutate(s)}
        alternando={alternar.isPending ? alternar.variables?.id ?? null : null}
      />
      {hoja && (
        <HojaNombre
          key={hoja.sustrato?.id ?? 'nuevo'}
          idNombre="sus-nombre"
          titulo={hoja.sustrato ? 'Editar sustrato' : 'Agregar sustrato'}
          nombreInicial={hoja.sustrato?.nombre ?? ''}
          guardando={guardar.isPending}
          error={error}
          onGuardar={(nombre) => guardar.mutate(nombre)}
          onCerrar={() => setHoja(null)}
        />
      )}
    </div>
  );
}
