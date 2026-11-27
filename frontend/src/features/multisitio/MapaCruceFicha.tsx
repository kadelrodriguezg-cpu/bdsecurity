/**
 * Mapa de la ficha del cruce (Sprint 7, 2.4.4 del documento maestro):
 * acotado a ESTE cruce, alimentado por obtener_mapa_cruce — un pin por
 * predio (cluster) con el conteo de individuos, nunca un pin por individuo.
 * La coordenada del pin es la del predio (Sprint 4); los predios sin
 * geolocalizar se listan aparte en vez de desaparecer en silencio.
 * Reusa el stack Leaflet de TerritorialMap (tiles OSM + CircleMarker), pero
 * este mapa es de la ficha — el mapa territorial general se conserva aparte.
 */
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import { MapPinned } from 'lucide-react';
import { obtenerMapaCruce, type ClusterMapaCruce } from '@/api/emplazamientos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COLORES } from '@/lib/colores';
import { qk } from '@/lib/queryKeys';
import 'leaflet/dist/leaflet.css';

const CENTRO_DEFAULT: [number, number] = [-35.42, -71.66];

function MapaClusters({ clusters }: { clusters: Array<ClusterMapaCruce & { latitud: number; longitud: number }> }) {
  const centro: [number, number] = clusters.length > 0 ? [clusters[0].latitud, clusters[0].longitud] : CENTRO_DEFAULT;
  return (
    <div className="relative isolate h-[360px] overflow-hidden rounded-[var(--r-l)] border border-line">
      <MapContainer center={centro} zoom={clusters.length > 0 ? 10 : 7} scrollWheelZoom className="h-full w-full" aria-label="Mapa de emplazamientos del cruce">
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {clusters.map((cluster) => (
          <CircleMarker
            key={cluster.predio_id}
            center={[cluster.latitud, cluster.longitud]}
            radius={Math.min(12 + cluster.individuos * 3, 30)}
            pathOptions={{ color: COLORES.acento, fillColor: COLORES.acento, fillOpacity: 0.75 }}
          >
            <Popup>
              <strong>{cluster.predio_nombre}</strong>
              <br />
              {cluster.individuos_vivos} vivo(s) / {cluster.individuos} emplazado(s) de este cruce.
              {cluster.codigos_individuos.length > 0 && (
                <>
                  <br />
                  {cluster.codigos_individuos.map((c, i) => (
                    <span key={c.codigo_corto} style={{ opacity: c.vivo ? 1 : 0.6 }}>
                      {i > 0 && ', '}
                      {c.codigo_corto}
                    </span>
                  ))}
                </>
              )}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

export function MapaCruceFicha({ plantaId }: { plantaId: string }) {
  const mapa = useQuery({
    queryKey: qk.territorio.mapaCruce(plantaId),
    queryFn: () => obtenerMapaCruce(plantaId),
  });

  const clusters = mapa.data?.clusters ?? [];
  const conCoordenada = clusters.filter(
    (c): c is ClusterMapaCruce & { latitud: number; longitud: number } => c.tiene_coordenada && c.latitud !== null && c.longitud !== null,
  );
  const sinCoordenada = clusters.filter((c) => !c.tiene_coordenada);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MapPinned className="h-4 w-4 text-primary" /> Mapa del cruce
        </CardTitle>
        <p className="text-xs text-ink-3">
          Un pin por predio con el conteo de individuos de este cruce emplazados ahí. La coordenada es la del predio
          (se captura en Catálogos).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {mapa.isLoading ? (
          <p className="text-sm text-ink-3">Cargando emplazamientos…</p>
        ) : mapa.isError ? (
          <p className="text-sm text-danger">{mapa.error.message}</p>
        ) : (mapa.data?.total_individuos_emplazados ?? 0) === 0 ? (
          <p className="rounded-md border border-dashed py-6 text-center text-sm text-ink-3">
            Ningún individuo de este cruce tiene emplazamiento vigente todavía. Registra un traslado para verlo en el
            mapa.
          </p>
        ) : (
          <>
            {conCoordenada.length > 0 ? (
              <MapaClusters clusters={conCoordenada} />
            ) : (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-ink-3">
                Hay individuos emplazados pero ningún predio de destino tiene coordenadas cargadas — geolocaliza el
                predio en Catálogos para verlo como pin.
              </p>
            )}
            {sinCoordenada.length > 0 && (
              <div className="text-xs text-ink-3">
                <p className="font-medium text-ink-2">Sin coordenadas (no aparecen como pin):</p>
                <ul className="mt-1 space-y-0.5">
                  {sinCoordenada.map((cluster) => (
                    <li key={cluster.predio_id}>
                      {cluster.predio_nombre} — {cluster.individuos_vivos} vivo(s) / {cluster.individuos} emplazado(s)
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-ink-3">
              {mapa.data?.total_individuos_emplazados} individuo(s) con emplazamiento vigente en {clusters.length}{' '}
              predio(s).
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
