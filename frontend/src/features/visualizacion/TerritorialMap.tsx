import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import type { LatLngBounds } from 'leaflet';
import { MapPinned } from 'lucide-react';
import { obtenerMapaAgregado, consultarMapaViewport, type PuntoViewportAdmin } from '@/api/visualizacion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/AuthContext';
import { useIncluirPruebas } from '@/lib/preferencias';
import { COLORES } from '@/lib/colores';
import { qk } from '@/lib/queryKeys';
import 'leaflet/dist/leaflet.css';
import { compararCodigos } from '@/lib/ordenNatural';

type Viewport = { latitudMinima: number; latitudMaxima: number; longitudMinima: number; longitudMaxima: number };
const VIEWPORT_INICIAL: Viewport = { latitudMinima: -90, latitudMaxima: 90, longitudMinima: -180, longitudMaxima: 180 };

function serializarViewport(bounds: LatLngBounds): Viewport {
  const surOeste = bounds.getSouthWest();
  const norEste = bounds.getNorthEast();
  return { latitudMinima: Math.max(-90, surOeste.lat), latitudMaxima: Math.min(90, norEste.lat), longitudMinima: Math.max(-180, surOeste.lng), longitudMaxima: Math.min(180, norEste.lng) };
}

function ObservadorViewport({ alCambiar }: { alCambiar: (viewport: Viewport) => void }) {
  const map = useMapEvents({ moveend: () => alCambiar(serializarViewport(map.getBounds())) });
  return null;
}

/** Desglose por código de cruce dentro de un cluster de puntos — este mapa es de cruzamientos, no de individuos sueltos. */
function desglosePorCruce(puntos: PuntoViewportAdmin[]): { codigo_sistema: string; cantidad: number }[] {
  const porCodigo = new Map<string, number>();
  for (const punto of puntos) porCodigo.set(punto.codigo_sistema, (porCodigo.get(punto.codigo_sistema) ?? 0) + 1);
  return [...porCodigo.entries()].map(([codigo_sistema, cantidad]) => ({ codigo_sistema, cantidad })).sort((a, b) => compararCodigos(a.codigo_sistema, b.codigo_sistema));
}

function PopupCruces({ cruces }: { cruces: { codigo_sistema: string; cantidad: number }[] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {cruces.map((c) => (
        <li key={c.codigo_sistema} className="font-mono">
          {c.codigo_sistema}
          {c.cantidad > 1 && <span className="text-ink-3"> ×{c.cantidad}</span>}
        </li>
      ))}
    </ul>
  );
}

function MapaConCoordenadas({ puntos, alCambiarViewport }: { puntos: PuntoViewportAdmin[]; alCambiarViewport: (viewport: Viewport) => void }) {
  const [sectoresExpandidos, setSectoresExpandidos] = useState<Set<string>>(() => new Set());
  const clusters = useMemo(() => {
    const porSector = new Map<string, { sectorId: string; sector: string; predio: string; latitud: number; longitud: number; puntos: PuntoViewportAdmin[] }>();
    puntos.forEach((punto) => {
      const actual = porSector.get(punto.sector_id);
      if (actual) actual.puntos.push(punto);
      else porSector.set(punto.sector_id, { sectorId: punto.sector_id, sector: punto.sector_nombre, predio: punto.predio_nombre, latitud: punto.latitud, longitud: punto.longitud, puntos: [punto] });
    });
    return [...porSector.values()].map((cluster) => ({
      ...cluster,
      latitud: cluster.puntos.reduce((suma, punto) => suma + Number(punto.latitud), 0) / cluster.puntos.length,
      longitud: cluster.puntos.reduce((suma, punto) => suma + Number(punto.longitud), 0) / cluster.puntos.length,
      cruces: desglosePorCruce(cluster.puntos),
    }));
  }, [puntos]);
  const alternarSector = (sectorId: string) => setSectoresExpandidos((actual) => { const siguiente = new Set(actual); if (siguiente.has(sectorId)) siguiente.delete(sectorId); else siguiente.add(sectorId); return siguiente; });

  return (
    <div className="relative isolate h-[520px] overflow-hidden rounded-[var(--r-l)] border border-line">
      <MapContainer center={[-35.42, -71.66]} zoom={7} scrollWheelZoom className="h-full w-full" aria-label="Mapa territorial con coordenadas exactas">
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ObservadorViewport alCambiar={alCambiarViewport} />
        {clusters.map((cluster) => (
          <CircleMarker key={cluster.sectorId} center={[cluster.latitud, cluster.longitud]} radius={Math.min(10 + cluster.puntos.length * 2, 28)} pathOptions={{ color: COLORES.acento, fillColor: COLORES.acento, fillOpacity: 0.72 }} eventHandlers={{ click: () => alternarSector(cluster.sectorId) }}>
            <Popup>
              <strong>{cluster.predio} · {cluster.sector}</strong>
              <br />
              {cluster.puntos.length} emplazamiento(s) de {cluster.cruces.length} cruce(s):
              <PopupCruces cruces={cluster.cruces} />
              <button type="button" className="mt-2 text-sm font-medium text-primary" onClick={() => alternarSector(cluster.sectorId)}>
                {sectoresExpandidos.has(cluster.sectorId) ? 'Agrupar posiciones' : 'Mostrar posiciones exactas'}
              </button>
            </Popup>
          </CircleMarker>
        ))}
        {clusters.flatMap((cluster) => sectoresExpandidos.has(cluster.sectorId) ? cluster.puntos.map((punto) => (
          <CircleMarker key={punto.emplazamiento_id} center={[punto.latitud, punto.longitud]} radius={5} pathOptions={{ color: COLORES.tinta2, fillColor: COLORES.tinta2, fillOpacity: 0.9 }}>
            <Popup>
              <strong className="font-mono">{punto.codigo_sistema}</strong>
              <br />
              {punto.predio_nombre} · {punto.sector_nombre}
              <br />
              Precisión: {punto.precision_metros ?? 'no registrada'} m
            </Popup>
          </CircleMarker>
        )) : [])}
      </MapContainer>
    </div>
  );
}

export function TerritorialMap({ especieId }: { especieId?: string }) {
  const { esAdmin } = useAuth();
  const [viewport, setViewport] = useState<Viewport>(VIEWPORT_INICIAL);
  // N35: los cruces de prueba no salen en el mapa salvo que el admin active «Incluir cruces de prueba».
  const [incluirPruebas] = useIncluirPruebas();
  const agregado = useQuery({ queryKey: qk.territorio.mapaAgregado({ especieId, incluirPruebas }), queryFn: () => obtenerMapaAgregado({ especieId, incluirPruebas }), enabled: !esAdmin });
  const coordenadas = useQuery({ queryKey: qk.territorio.viewport({ especieId, incluirPruebas, ...viewport }), queryFn: () => consultarMapaViewport({ especieId, incluirPruebas, ...viewport }), enabled: esAdmin });
  const alCambiarViewport = useCallback((siguiente: Viewport) => setViewport((actual) => JSON.stringify(actual) === JSON.stringify(siguiente) ? actual : siguiente), []);

  if (esAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><MapPinned className="h-4 w-4 text-primary" /> Mapa territorial</CardTitle>
          <p className="text-xs text-ink-3">Ubicaciones exactas. Se muestran las del área visible del mapa.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {coordenadas.isError && <p className="text-sm text-danger">{coordenadas.error.message}</p>}
          <MapaConCoordenadas puntos={coordenadas.data?.puntos ?? []} alCambiarViewport={alCambiarViewport} />
          <p className="text-xs text-ink-3">{coordenadas.isLoading ? 'Cargando ubicaciones del área visible…' : `${coordenadas.data?.total ?? 0} emplazamientos con coordenadas en el área visible.`}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><MapPinned className="h-4 w-4 text-primary" /> Mapa territorial agregado</CardTitle>
        <p className="text-xs text-ink-3">La ubicación se presenta por sitio, predio y sector, con el código de cada cruzamiento presente.</p>
      </CardHeader>
      <CardContent>
        {agregado.isError && <p className="text-sm text-danger">{agregado.error.message}</p>}
        {agregado.isLoading ? (
          <p className="text-sm text-ink-3">Cargando agrupaciones…</p>
        ) : (agregado.data?.clusters.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-3">No hay emplazamientos vigentes para este alcance.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {agregado.data?.clusters.map((cluster) => (
              <li key={cluster.sector_id} className="rounded-md border border-line p-3 text-sm">
                <p className="font-medium">{cluster.predio_nombre} · {cluster.sector_nombre}</p>
                <p className="text-xs text-ink-3">{cluster.sitio_nombre}</p>
                <p className="mt-2 text-xs text-ink-2">{cluster.individuos_vivos} vivos / {cluster.individuos} emplazados</p>
                <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-xs">
                  {[...cluster.cruces].sort((a, b) => compararCodigos(a.codigo_sistema, b.codigo_sistema)).map((c) => (
                    <li key={c.planta_id} className="flex justify-between gap-2">
                      <span className="font-mono text-ink-2">{c.codigo_sistema}</span>
                      <span className="text-ink-3">{c.individuos_vivos}/{c.individuos}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
