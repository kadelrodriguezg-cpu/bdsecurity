import { formatearMesAnio } from '@/lib/v3/formatos';
import { useManualTabs } from '@/components/ui/useManualTabs';
/**
 * Bloque de clima histórico por predio (Sprint 7.5.1, 2.8 del documento
 * maestro; mid-fix de legibilidad/escalabilidad): bloque PROPIO debajo del
 * mapa de MapaCruceFicha, no fusionado con él — el mapa responde "dónde"
 * (espacial), este bloque responde "qué pasó ahí en el tiempo" (temporal),
 * pensado para mirarse junto a los gráficos de deltas de Ranking Parámetro
 * (Sprint 6).
 *
 * Fuente: resumen mensual cacheado (obtener_clima_predio), nunca una
 * llamada en vivo a Open-Meteo desde el navegador. Un predio recién
 * geolocalizado no tiene datos todavía (la sincronización es asíncrona,
 * corre en el backend) — sincronizando=true distingue ese caso de
 * "nunca se geolocalizó" (tiene_coordenada=false), y cada uno muestra un
 * estado explicado en vez de un bloque vacío sin contexto.
 *
 * Con 2+ predios se navega por pestañas (mismo patrón visual que
 * RankingPage) en vez de apilar un bloque completo por predio: apilado
 * ocupaba una pantalla entera de scroll con solo 2-3 predios y obligaba a
 * sostener el gráfico anterior en la memoria para comparar. Con exactamente
 * 1 predio se salta el selector — una pestaña única no aporta nada y es
 * ruido visual.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudSun, Loader2 } from 'lucide-react';
import { obtenerClimaPredio, type ClimaPredio, type MesClimaPredio } from '@/api/emplazamientos';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COLORES_CLIMA } from '@/lib/colores';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

// Paleta de series documentada en lib/colores.ts: el clima no tiene color semántico.
const COLOR_TEMP_MAX = COLORES_CLIMA.tempMax;
const COLOR_TEMP_MIN = COLORES_CLIMA.tempMin;
const COLOR_SOL = COLORES_CLIMA.sol;
const COLOR_HELADA = COLORES_CLIMA.helada;

// Eje X compartido por los tres gráficos (temperatura, sol, heladas) — misma
// escala horizontal para que se puedan leer en conjunto por mes (ej.
// correlacionar un pico de temperatura con las horas de sol del mismo mes).
const ANCHO = 560;
const MARGEN_IZQ = 42;
const MARGEN_DER = 12;

const etiquetaMes = formatearMesAnio;

function posicionesX(cantidad: number) {
  const pasos = Math.max(cantidad - 1, 1);
  return (indice: number) => MARGEN_IZQ + (indice / pasos) * (ANCHO - MARGEN_IZQ - MARGEN_DER);
}

/** Cada 2-3 meses en vez de las 25 etiquetas: satura para un rango típico de backfill. */
function indicesEtiquetaX(cantidad: number): Set<number> {
  const paso = Math.max(1, Math.round(cantidad / 8));
  const indices = new Set<number>();
  for (let i = 0; i < cantidad; i += paso) indices.add(i);
  indices.add(cantidad - 1);
  return indices;
}

function EjeXMeses({ meses }: { meses: MesClimaPredio[] }) {
  const x = posicionesX(meses.length);
  const conEtiqueta = indicesEtiquetaX(meses.length);
  return (
    <svg viewBox={`0 0 ${ANCHO} 20`} role="presentation" aria-hidden="true" className="h-4 w-full" preserveAspectRatio="none">
      {meses.map((m, i) =>
        conEtiqueta.has(i) ? (
          <text key={`${m.anio}-${m.mes}`} x={x(i)} y="10" fontSize="9" textAnchor="middle" className="fill-ink-3">
            {etiquetaMes(m.anio, m.mes)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function GraficoTemperatura({ meses }: { meses: MesClimaPredio[] }) {
  const trazado = useMemo(() => {
    const valores = meses.flatMap((m) => [m.temp_max_promedio, m.temp_min_promedio]).filter((v): v is number => v !== null);
    if (valores.length === 0) return null;
    const minimo = Math.min(...valores);
    const maximo = Math.max(...valores);
    const rango = maximo - minimo || 1;
    const alto = 140;
    const margenV = 12;
    const x = posicionesX(meses.length);
    const y = (valor: number) => alto - margenV - ((valor - minimo) / rango) * (alto - margenV * 2);
    const lineaMax = meses.map((m, i) => (m.temp_max_promedio === null ? null : `${x(i)},${y(m.temp_max_promedio)}`)).filter((v): v is string => v !== null).join(' ');
    const lineaMin = meses.map((m, i) => (m.temp_min_promedio === null ? null : `${x(i)},${y(m.temp_min_promedio)}`)).filter((v): v is string => v !== null).join(' ');
    const ticksY = [0, 1 / 3, 2 / 3, 1].map((f) => ({ valor: minimo + rango * f, y: y(minimo + rango * f) }));
    return { alto, lineaMax, lineaMin, ticksY };
  }, [meses]);

  if (!trazado) return <p className="py-4 text-center text-xs text-ink-3">Sin datos de temperatura en el rango disponible.</p>;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 text-xs text-ink-3">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_TEMP_MAX }} /> Temp. máx. promedio
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_TEMP_MIN }} /> Temp. mín. promedio
        </span>
      </div>
      <svg viewBox={`0 0 ${ANCHO} ${trazado.alto}`} role="img" aria-label="Temperatura máxima y mínima promedio mensual" className="h-36 w-full overflow-visible" preserveAspectRatio="none">
        {trazado.ticksY.map((tick) => (
          <g key={tick.y}>
            <line x1={MARGEN_IZQ} x2={ANCHO - MARGEN_DER} y1={tick.y} y2={tick.y} className="stroke-line" strokeWidth="1" strokeDasharray="2,3" />
            <text x={MARGEN_IZQ - 4} y={tick.y} dy="3" fontSize="9" textAnchor="end" className="fill-ink-3">
              {tick.valor.toFixed(1)}°
            </text>
          </g>
        ))}
        <polyline points={trazado.lineaMax} fill="none" stroke={COLOR_TEMP_MAX} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={trazado.lineaMin} fill="none" stroke={COLOR_TEMP_MIN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <EjeXMeses meses={meses} />
    </div>
  );
}

function GraficoBarras({ titulo, meses, valor, color, sufijo }: { titulo: string; meses: MesClimaPredio[]; valor: (m: MesClimaPredio) => number | null; color: string; sufijo: string }) {
  const barras = useMemo(() => {
    const valores = meses.map(valor).filter((v): v is number => v !== null);
    const maximo = Math.max(...valores, 1);
    const alto = 56;
    const x = posicionesX(meses.length);
    const anchoBarra = Math.max((ANCHO - MARGEN_IZQ - MARGEN_DER) / meses.length - 2, 1);
    return meses.map((m, i) => {
      const v = valor(m);
      const h = v === null ? 0 : (v / maximo) * (alto - 4);
      return { key: `${m.anio}-${m.mes}`, x: x(i) - anchoBarra / 2, ancho: anchoBarra, alto: h, valor: v, etiqueta: etiquetaMes(m.anio, m.mes) };
    });
  }, [meses, valor]);

  return (
    <div className="space-y-1">
      <p className="text-xs text-ink-3">{titulo}</p>
      <svg viewBox={`0 0 ${ANCHO} 56`} role="img" aria-label={titulo} className="h-14 w-full" preserveAspectRatio="none">
        {barras.map((b) => (
          <rect key={b.key} x={b.x} y={56 - 2 - b.alto} width={b.ancho} height={b.alto} rx="1" fill={color} fillOpacity={b.valor === null ? 0.15 : 0.85}>
            <title>{`${b.etiqueta}: ${b.valor === null ? 'sin dato' : `${b.valor}${sufijo}`}`}</title>
          </rect>
        ))}
      </svg>
      <EjeXMeses meses={meses} />
    </div>
  );
}

function BloquePredio({ clima }: { clima: ClimaPredio }) {
  if (!clima.tiene_coordenada) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-ink-3">
        <p>Sin datos climáticos todavía — geolocaliza este predio en Catálogos para empezar a sincronizarlos.</p>
      </div>
    );
  }

  if (clima.sincronizando || clima.meses.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-ink-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <p>Sincronizando datos climáticos… la primera sincronización puede tardar algunos minutos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">{clima.meses.length} meses disponibles</p>
      <GraficoTemperatura meses={clima.meses} />
      <GraficoBarras titulo="Horas de sol acumuladas" meses={clima.meses} valor={(m) => m.horas_sol_acumuladas} color={COLOR_SOL} sufijo=" h" />
      <GraficoBarras titulo="Días de helada" meses={clima.meses} valor={(m) => m.dias_helada} color={COLOR_HELADA} sufijo=" días" />
    </div>
  );
}

function SelectorPredios({ predios }: { predios: ClimaPredio[] }) {
  const [seleccionado, setSeleccionado] = useState(0);
  const indiceActivo = Math.min(seleccionado, Math.max(0, predios.length - 1));
  const tabs = useManualTabs(predios.map((_, i) => i), indiceActivo, setSeleccionado);
  // Con un solo predio el selector es ruido visual — se salta directo al bloque.
  if (predios.length === 1) return <BloquePredio clima={predios[0]} />;

  const activo = predios[indiceActivo];
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Predios de este cruce" className="flex flex-wrap gap-1 border-b border-line">
        {predios.map((p, i) => (
          <button
            key={p.predio_id}
            {...tabs.tabProps(i)}
            className={cn(
              'min-h-tap rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium',
              i === indiceActivo
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-2',
            )}
          >
            {p.predio_nombre}
          </button>
        ))}
      </div>
      <div {...tabs.panelProps(indiceActivo)}><BloquePredio clima={activo} /></div>
      {predios.map((_, i) => i !== indiceActivo ? <div key={i} {...tabs.panelProps(i)} hidden /> : null)}
    </div>
  );
}

export function ClimaPredioBloque({ plantaId }: { plantaId: string }) {
  const clima = useQuery({
    queryKey: qk.territorio.climaCruce(plantaId),
    queryFn: () => obtenerClimaPredio({ plantaId }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CloudSun className="h-4 w-4 text-primary" /> Clima histórico por predio
        </CardTitle>
        <p className="text-xs text-ink-3">
          Resumen mensual (temperatura, sol, heladas) de los predios donde este cruce tuvo individuos — contexto para
          interpretar los resultados y sus cambios, no una medición de campo.
        </p>
      </CardHeader>
      <CardContent>
        {clima.isError && <Alert>No se pudo {clima.data ? 'actualizar' : 'cargar'} el clima. {clima.data ? 'Se conserva la información disponible.' : ''} <Button variant="outline" disabled={clima.isFetching} onClick={() => void clima.refetch()}>Reintentar clima</Button></Alert>}
        {!clima.data && !clima.isError ? (
          <p role="status" className="text-sm text-ink-3">Cargando clima…</p>
        ) : !clima.data ? null : clima.data.predios.length === 0 && clima.isSuccess ? (
          <p className="rounded-md border border-dashed py-6 text-center text-sm text-ink-3">
            Ningún individuo de este cruce tiene emplazamiento registrado todavía.
          </p>
        ) : clima.data.predios.length === 0 ? null : (
          <SelectorPredios predios={clima.data.predios} />
        )}
      </CardContent>
    </Card>
  );
}
