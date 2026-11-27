import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { divIcon, type LatLngLiteral } from 'leaflet';
import { LocateFixed, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COLORES } from '@/lib/colores';
import { buscarLugarChile, type ResultadoGeocodificacion } from './geocoding';
import 'leaflet/dist/leaflet.css';

export type Coordenadas = { latitud: number; longitud: number } | null;

const CENTRO_MAULE: LatLngLiteral = { lat: -35.4264, lng: -71.6662 };

function mensajeErrorGeolocalizacion(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Denegaste el permiso de ubicación.';
    case error.POSITION_UNAVAILABLE:
      return 'No fue posible determinar tu ubicación actual.';
    case error.TIMEOUT:
      return 'La búsqueda de tu ubicación tardó demasiado.';
    default:
      return 'No fue posible obtener tu ubicación.';
  }
}

const ICONO_MARCADOR = divIcon({
  className: 'predio-location-marker',
  html: `<span aria-hidden="true" style="display:block;width:20px;height:20px;border-radius:50% 50% 50% 0;background:${COLORES.acento};border:3px solid ${COLORES.superficie};box-shadow:0 1px 5px ${COLORES.tinta2};transform:rotate(-45deg)"></span>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
});

function CentrarMapa({ coordenadas }: { coordenadas: Coordenadas }) {
  const mapa = useMap();
  useEffect(() => { if (coordenadas) mapa.flyTo([coordenadas.latitud, coordenadas.longitud], Math.max(mapa.getZoom(), 14)); }, [coordenadas, mapa]);
  return null;
}

/**
 * Catálogos mantiene los paneles de pestañas montados para no perder el
 * formulario. Leaflet se crea entonces mientras Predios está `display:none`
 * y mide 0×0. Observar el contenedor permite recalcular al hacerlo visible,
 * sin depender de que el usuario abra la edición o mueva el mapa.
 */
function RecalcularTamanoMapa() {
  const mapa = useMap();

  useEffect(() => {
    const contenedor = mapa.getContainer();
    let frame = 0;
    const invalidar = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => mapa.invalidateSize({ pan: false }));
    };
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidar);
    observador?.observe(contenedor);
    invalidar();
    return () => { window.cancelAnimationFrame(frame); observador?.disconnect(); };
  }, [mapa]);

  return null;
}

function SelectorEnMapa({ alCambiar }: { alCambiar: (coordenadas: Coordenadas) => void }) {
  useMapEvents({ click: (evento) => alCambiar({ latitud: evento.latlng.lat, longitud: evento.latlng.lng }) });
  return null;
}

export function PredioLocationPicker({ valor, alCambiar, alSugerirRegion }: { valor: Coordenadas; alCambiar: (coordenadas: Coordenadas) => void; alSugerirRegion?: (region: ResultadoGeocodificacion['region']) => void }) {
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<ResultadoGeocodificacion[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const solicitud = useRef<AbortController | null>(null);
  const centro = useMemo(() => valor ? { lat: valor.latitud, lng: valor.longitud } : CENTRO_MAULE, [valor]);

  useEffect(() => () => solicitud.current?.abort(), []);

  async function buscar() {
    solicitud.current?.abort();
    const controller = new AbortController();
    solicitud.current = controller;
    setBuscando(true); setMensaje(null); setResultados([]);
    try {
      const encontrados = await buscarLugarChile(consulta, controller.signal);
      if (controller.signal.aborted) return;
      setResultados(encontrados);
      if (encontrados.length === 0) setMensaje('No encontramos resultados. Puedes fijar la ubicación haciendo clic en el mapa.');
    } catch (error) {
      if (!controller.signal.aborted) setMensaje(error instanceof Error ? error.message : 'No fue posible buscar la ubicación.');
    } finally { if (!controller.signal.aborted) setBuscando(false); }
  }

  function capturarUbicacion() {
    if (!('geolocation' in navigator)) {
      setMensaje('Este navegador no admite geolocalización. Puedes fijar la ubicación haciendo clic en el mapa.');
      return;
    }
    setCapturando(true); setMensaje(null);
    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        setCapturando(false);
        alCambiar({ latitud: posicion.coords.latitude, longitud: posicion.coords.longitude });
      },
      (error) => {
        setCapturando(false);
        setMensaje(`${mensajeErrorGeolocalizacion(error)} Puedes fijar la ubicación haciendo clic en el mapa.`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return <section className="space-y-3" aria-label="Ubicación del predio">
    <div className="space-y-1"><label className="text-sm font-medium" htmlFor="predio-buscar-ubicacion">Ubicación</label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={capturarUbicacion} disabled={capturando}>
          <LocateFixed className="h-4 w-4" />{capturando ? 'Obteniendo ubicación…' : '📍 Capturar ubicación'}
        </Button>
        <Input id="predio-buscar-ubicacion" value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Buscar dirección, localidad o lugar…" />
        <Button type="button" variant="outline" onClick={() => void buscar()} disabled={buscando || !consulta.trim()}><Search className="h-4 w-4" />{buscando ? 'Buscando…' : 'Buscar'}</Button>
      </div>
    </div>
    {mensaje && <p role="status" className="text-xs text-ink-3">{mensaje}</p>}
    {resultados.length > 0 && <ul className="max-h-32 space-y-1 overflow-auto rounded-md border p-1" aria-label="Resultados de búsqueda">{resultados.map((resultado) => <li key={resultado.id}><button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => { alCambiar({ latitud: resultado.latitud, longitud: resultado.longitud }); alSugerirRegion?.(resultado.region); setResultados([]); }}>{resultado.etiqueta}</button></li>)}</ul>}
    <div className="relative isolate h-[340px] overflow-hidden rounded-[var(--r-l)] border border-line"><MapContainer center={centro} zoom={valor ? 14 : 8} scrollWheelZoom className="h-full w-full" aria-label="Mapa para seleccionar la ubicación del predio"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><RecalcularTamanoMapa /><CentrarMapa coordenadas={valor} /><SelectorEnMapa alCambiar={alCambiar} />{valor && <Marker position={[valor.latitud, valor.longitud]} icon={ICONO_MARCADOR} draggable eventHandlers={{ dragend: (evento) => { const punto = evento.target.getLatLng(); alCambiar({ latitud: punto.lat, longitud: punto.lng }); } }} />}</MapContainer></div>
    <p className="text-xs text-ink-3">Haz clic en el mapa para seleccionar la ubicación. Puedes arrastrar el marcador para ajustarla.</p>
    <p className="text-xs text-ink-2">{valor ? `Ubicación seleccionada: ${valor.latitud.toFixed(6)}, ${valor.longitud.toFixed(6)}` : 'Sin ubicación seleccionada.'}</p>
  </section>;
}
