/**
 * Predios (Ensayos multisitio y mapa territorial), con el patrón común de catálogos: primero la lista (filtrable por región) y el
 * formulario con el mapa en una hoja, que se cierra y se vacía al guardar (A1-G7-11: antes conservaba el nombre y un segundo clic
 * creaba un duplicado).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { actualizarPredio, crearPredio, listarPredios, type Predio } from '@/api/catalogos';
import { useChatPanel } from '@/features/chat/ChatPanelContext';
import { qk } from '@/lib/queryKeys';
import { CatalogoTabla } from '../CatalogoTabla';
import { mensajeCarga } from '../mensajes';
import { PredioForm, type DatosPredioForm } from './PredioForm';
import { REGIONES_CHILE, type RegionChile } from './regionesChile';

function coordenadasParaPersistir(coordenadas: DatosPredioForm['coordenadas']) { return coordenadas ?? {}; }

export function filtrarPrediosPorRegion(predios: Predio[], region: RegionChile | ''): Predio[] {
  return region ? predios.filter((predio) => predio.region === region) : predios;
}

export function PrediosCatalogo() {
  const queryClient = useQueryClient();
  const { abrirChat } = useChatPanel();
  const [hoja, setHoja] = useState<{ predio: Predio | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtroRegion, setFiltroRegion] = useState<RegionChile | ''>('');
  const consulta = useQuery({ queryKey: qk.catalogos.predios.admin, queryFn: () => listarPredios(false) });
  const prediosFiltrados = useMemo(() => (consulta.data ? filtrarPrediosPorRegion(consulta.data, filtroRegion) : undefined), [consulta.data, filtroRegion]);
  const invalidarPredios = () => {
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.predios.admin });
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.predios.activos });
    void queryClient.invalidateQueries({ queryKey: qk.catalogos.predios.historial });
    void queryClient.invalidateQueries({ queryKey: qk.territorio.sectores });
    void queryClient.invalidateQueries({ queryKey: qk.territorio.mapaCruceAll });
    void queryClient.invalidateQueries({ queryKey: qk.territorio.mapaAgregadoAll });
    void queryClient.invalidateQueries({ queryKey: qk.territorio.viewportAll });
  };
  const guardar = useMutation({
    mutationFn: (datos: DatosPredioForm) => {
      const fila = { nombre: datos.nombre, region: datos.region, ...coordenadasParaPersistir(datos.coordenadas) };
      return hoja?.predio ? actualizarPredio(hoja.predio.id, fila) : crearPredio(fila).then(() => undefined);
    },
    onSuccess: () => { setError(null); setHoja(null); invalidarPredios(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar el predio.'),
  });
  const alternar = useMutation({
    mutationFn: (predio: Predio) => actualizarPredio(predio.id, { activo: !predio.activo }),
    onSuccess: invalidarPredios,
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo actualizar el estado.'),
  });
  const abrir = (predio: Predio | null) => { setError(null); setHoja({ predio }); };

  return (
    <div className="space-y-3">
      {error && !hoja && <Alert>{error}</Alert>}
      <CatalogoTabla<Predio>
        titulo="Predios"
        descripcion="Lugares donde se plantan los ensayos multisitio; con su ubicación aparecen en el mapa territorial."
        aviso={<p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-small text-ink-2">Evita nombres que describan qué se cultiva ahí (ej. «Predio 3» en vez de «Vivero Arándano Norte»), para no revelar qué se trabaja en cada lugar.</p>}
        singular="predio"
        plural="predios"
        filas={prediosFiltrados}
        cargando={consulta.isPending}
        error={consulta.isError ? mensajeCarga('los predios', consulta.error) : null}
        onReintentar={() => void consulta.refetch()}
        filtros={(
          <div className="w-56 space-y-1">
            <Label htmlFor="predios-filtro-region">Región</Label>
            <Select id="predios-filtro-region" value={filtroRegion} onChange={(evento) => setFiltroRegion(evento.target.value as RegionChile | '')}>
              <option value="">Todas las regiones</option>
              {REGIONES_CHILE.map((region) => <option key={region} value={region}>{region}</option>)}
            </Select>
          </div>
        )}
        columnas={[
          { titulo: 'Región', celda: (p) => p.region ?? <span className="text-ink-3">Sin región</span> },
          { titulo: 'Ubicación', celda: (p) => (p.latitud !== null && p.longitud !== null ? 'En el mapa' : <span className="text-warn">Sin ubicación</span>) },
        ]}
        onAgregar={() => abrir(null)}
        onEditar={abrir}
        onAlternarActivo={(p) => alternar.mutate(p)}
        alternando={alternar.isPending ? alternar.variables?.id ?? null : null}
        extraAcciones={(p) => (
          <Button size="sm" variant="ghost" onClick={() => abrirChat({ tipo: 'predio', entidadId: p.id })} aria-label={`Chat de ${p.nombre}`}>
            <MessageCircle className="h-4 w-4" aria-hidden="true" /> Chat
          </Button>
        )}
      />
      {hoja && (
        <Sheet titulo={hoja.predio ? 'Editar predio' : 'Agregar predio'} size="ancho" onCerrar={() => setHoja(null)}>
          <div className="space-y-3">
            <PredioForm
              key={hoja.predio?.id ?? 'nuevo'}
              predio={hoja.predio ?? undefined}
              guardando={guardar.isPending}
              alGuardar={(datos) => { if (datos.nombre) guardar.mutate(datos); }}
              alCancelar={() => setHoja(null)}
            />
            {error && <Alert>{error}</Alert>}
          </div>
        </Sheet>
      )}
    </div>
  );
}
