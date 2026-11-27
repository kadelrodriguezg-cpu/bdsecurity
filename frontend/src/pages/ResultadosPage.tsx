/**
 * Resultados v3 (docs/rediseno_v3/resultados/resultados.md; N19, N21, N33, N34): una sola tabla con controles, sin
 * pestañas internas. Reemplaza a Ranking (General, Parámetro, Comparación histórica, Snapshots), al Panel científico y a
 * Visualizar. Lo que muestra otra cosa (lugares, tiempo, variedades) son «otras vistas» enlazadas arriba.
 *
 * Las categorías y sus pesos salen de la versión de puntaje activa (o de la del ranking congelado), nunca del código.
 * El puntaje se maneja en 0–1 con precisión completa; solo el texto visible pasa por `lib/v3/puntaje.ts`.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Download, Plus, Snowflake } from 'lucide-react';
import { listarPlantas } from '@/api/plantas';
import { congelarRankingGrupos, empatesPorIndividuo, listarTemporadasEspecie, obtenerRankingPorGrupos, obtenerValoresParametros } from '@/api/rankingGrupos';
import { compararSnapshotVivo, listarSnapshotsRanking, obtenerCoberturaSnapshot, obtenerDetalleSnapshot } from '@/api/snapshots';
import { obtenerComparacionRondas } from '@/api/comparacion';
import { etiquetaCategoria, obtenerMetricasVersion, obtenerPesosCategorias, type PesoCategoria } from '@/api/resultados';
import { useAuth } from '@/features/auth/AuthContext';
import { useEspacioEspecie } from '@/features/especies/EspacioEspecie';
import { Panorama } from '@/features/especies/Panorama';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { DataTableFrame } from '@/components/ui/data-table-frame';
import { EncabezadoPagina, EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { useIncluirPruebas } from '@/lib/preferencias';
import { useEsEscritorio } from '@/lib/useEsEscritorio';
import { formatearFecha } from '@/lib/v3/formatos';
import { formatearPuntos } from '@/lib/v3/puntaje';
import { hoyChileISO } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { TablaResultados } from '@/features/resultados/TablaResultados';
import { SelectorCruce } from '@/components/shared/SelectorCruce';
import { Paginacion } from '@/components/shared/Paginacion';
import { usePaginacionUrl } from '@/lib/usePaginacionUrl';
import { ListaResultadosMovil } from '@/features/resultados/ListaResultadosMovil';
import { PanelIndividuo } from '@/features/resultados/PanelIndividuo';
import { ChipsColumnas, HojaColumnas } from '@/features/resultados/Columnas';
import { CincoMejores } from '@/features/resultados/CincoMejores';
import { PlegadoFinal } from '@/features/resultados/PlegadoFinal';
import { ComoSeCalcula } from '@/features/resultados/ComoSeCalcula';
import { CerrarTemporada } from '@/features/resultados/CerrarTemporada';
import { PuntoCobertura } from '@/features/resultados/piezas';
import { construirCsv, descargarCsv, nombreArchivo } from '@/features/resultados/exportar';
import {
  aplicarFiltros, cambiosDesdeComparacion, filtrosEfectivos, cambiosDesdeCongelado, escribirEstado, filasDelGrupo, filasDesdeCongelado,
  filasDesdeVivo, grupoPorDefecto, gruposDisponibles, leerEstado, medianaDelGrupo, motivoSinCambio, ordenar, ordenarPorPeso, pesosDelGrupo, plegado, temporadas,
  type EstadoUrl, type GrupoDisponible, type Orden,
} from '@/features/resultados/modelo';

const ORDENES_MOVIL: Array<{ etiqueta: string; orden: Orden }> = [
  { etiqueta: 'Puesto', orden: { columna: 'puesto', dir: 'asc' } },
  { etiqueta: 'Puntaje (mayor primero)', orden: { columna: 'puntaje', dir: 'desc' } },
  { etiqueta: 'Puntaje (menor primero)', orden: { columna: 'puntaje', dir: 'asc' } },
  { etiqueta: 'Cambio (mayor primero)', orden: { columna: 'cambio', dir: 'desc' } },
];

/** «las 5 categorías» si el grupo tiene todas las de la versión; si no, sus nombres, en el orden de los pesos de la versión. */
function nombreGrupo(g: Pick<GrupoDisponible, 'categorias'>, totalVersion: number, pesos: readonly PesoCategoria[] = []): string {
  return g.categorias.length === totalVersion && totalVersion > 0 ? `las ${totalVersion} categorías` : ordenarPorPeso(g.categorias, pesos).map(etiquetaCategoria).join(' · ');
}

function OtrasVistas({ esAdmin, parametro }: { esAdmin: boolean; parametro: string }) {
  const q = `?especie=${parametro}`;
  const clase = 'inline-flex min-h-tap items-center gap-2 rounded-md border border-line-strong bg-white px-3 text-small font-medium text-ink hover:bg-surface-2';
  return (
    <nav aria-label="Otras vistas" className="flex flex-wrap items-center gap-2">
      <span className="hidden text-small text-ink-3 lg:inline">Otras vistas:</span>
      <Link to={`/resultados/mapa${q}`} className={clase}>Mapa territorial</Link>
      <Link to={`/resultados/tendencias${q}`} className={clase}>Tendencias</Link>
      {esAdmin && <Link to={`/resultados/polinizacion${q}`} className={clase}>Polinización por variedad <span className="rounded-full bg-neutral-l px-1.5 text-micro text-ink-2">Admin</span></Link>}
    </nav>
  );
}

export function ResultadosPage() {
  const { esAdmin } = useAuth();
  const esEscritorio = useEsEscritorio();
  const queryClient = useQueryClient();
  const [parametros, setParametros] = useSearchParams();
  const estado = leerEstado(parametros);
  const cambiar = (cambios: Partial<EstadoUrl>) => setParametros((p) => escribirEstado(p, cambios), { replace: true });
  const [incluirPruebas] = useIncluirPruebas();
  const [hoja, setHoja] = useState<null | 'alcance' | 'grupo' | 'orden' | 'columnas'>(null);

  // --- Alcance ---------------------------------------------------------------
  // Fase 4: la especie es la del encabezado (el selector propio de Resultados desaparece). Cambiarla deja la URL solo con
  // la especie nueva, así que el cruce, el congelado, el grupo y el individuo de la otra especie se descartan solos.
  const { activa, parametro } = useEspacioEspecie();
  const especieId = activa?.id ?? '';
  const especieNombre = activa?.nombre ?? '';
  const cruces = useQuery({
    queryKey: qk.plantas.lista({ especieId, selector: 'resultados', incluirPruebas }),
    queryFn: () => listarPlantas({ especieId, incluirPruebas }),
    enabled: !!especieId,
  });
  const cruce = cruces.data?.find((c) => c.id === estado.cruce);
  const alcance = estado.cruce ? { plantaId: estado.cruce } : { especieId };
  const congeladoId = estado.congelado && estado.congelado !== 'elegir' ? estado.congelado : '';
  const modoCongelado = !!estado.congelado;

  // N38 [Provisional]: la temporada por defecto es la última cerrada de la especie (R5: una ronda abre una temporada).
  // La lectura sin ronda (la última de cada individuo) trae además las rondas del alcance para elegirla.
  const base = useQuery({
    queryKey: qk.ranking.grupos({ ...alcance, incluirPruebas }),
    queryFn: () => obtenerRankingPorGrupos({ ...alcance, incluirPruebas }),
    enabled: !!especieId && !congeladoId,
  });
  const infoTemporadas = temporadas(base.data?.rondas);
  // Fase 5 (G2): cada ronda se rotula con su temporada de julio a junio (la del cruce elegido, o la de toda la especie).
  const etiquetasTemporada = useQuery({ queryKey: qk.temporadas(especieId), queryFn: () => listarTemporadasEspecie(especieId), enabled: !!especieId });
  const etiquetaDeRonda = (numero: number) => etiquetasTemporada.data?.find((t) => t.tipo_ronda === 'anual' && t.numero_ronda === numero && t.planta_id === (estado.cruce || null))?.etiqueta;
  const rondaElegida: number | null = estado.ronda === 'ultima' ? null : estado.ronda ? Number(estado.ronda) : infoTemporadas.porDefecto;
  const porRonda = useQuery({
    queryKey: qk.ranking.grupos({ ...alcance, incluirPruebas, numeroRonda: rondaElegida }),
    queryFn: () => obtenerRankingPorGrupos({ ...alcance, incluirPruebas, numeroRonda: rondaElegida as number }),
    enabled: !!especieId && !congeladoId && rondaElegida !== null && base.isSuccess,
  });
  const vivo = rondaElegida === null ? base : porRonda;
  const mezclaTemporadas = !congeladoId && rondaElegida === null;
  const snapshots = useQuery({
    queryKey: qk.snapshots.lista(alcance),
    queryFn: () => listarSnapshotsRanking({ ...alcance, limite: 50 }),
    enabled: !!especieId && modoCongelado,
  });
  const detalle = useQuery({ queryKey: qk.snapshots.detalle(congeladoId), queryFn: () => obtenerDetalleSnapshot(congeladoId), enabled: !!congeladoId });
  const coberturaCongelado = useQuery({ queryKey: qk.snapshots.cobertura(congeladoId), queryFn: () => obtenerCoberturaSnapshot(congeladoId), enabled: !!congeladoId });

  const versionId = congeladoId ? detalle.data?.snapshot.scoring_version_id : vivo.data?.scoring_version_id;
  const versionNombre = congeladoId ? detalle.data?.snapshot.scoring_version_nombre : vivo.data?.scoring_version_nombre;
  const pesos = useQuery({ queryKey: ['resultados', 'pesos', versionId], queryFn: () => obtenerPesosCategorias(versionId as string), enabled: !!versionId, staleTime: 300_000 });
  const metricas = useQuery({ queryKey: ['resultados', 'metricas', versionId], queryFn: () => obtenerMetricasVersion(versionId as string), enabled: !!versionId && hoja === 'columnas', staleTime: 300_000 });

  // --- Filas, grupo y orden --------------------------------------------------
  const filas = useMemo(() => {
    if (congeladoId) return detalle.data ? filasDesdeCongelado(detalle.data, coberturaCongelado.data ?? {}) : [];
    return vivo.data ? filasDesdeVivo(vivo.data) : [];
  }, [congeladoId, detalle.data, coberturaCongelado.data, vivo.data]);
  const grupos = useMemo(() => gruposDisponibles(filas), [filas]);
  const grupo = grupos.find((g) => g.clave === estado.grupo) ?? grupoPorDefecto(grupos);
  const delGrupo = useMemo(() => (grupo ? filasDelGrupo(filas, grupo.clave) : []), [filas, grupo]);
  const mediana = medianaDelGrupo(delGrupo);
  // G19: empates dentro del grupo; G20: alcance del puesto (la especie activa o el cruce elegido).
  const empates = useMemo(() => empatesPorIndividuo(delGrupo.map((f) => ({ individuo_id: f.individuo_id, grupo: f.grupo as never, posicion_grupo: f.posicion }))), [delGrupo]);
  const alcancePuesto = estado.cruce && cruce ? `dentro del cruce ${cruce.codigo_sistema}` : especieNombre ? `en ${especieNombre}` : undefined;
  const pesosGrupo = grupo ? pesosDelGrupo(grupo.categorias, pesos.data ?? []) : [];
  const totalCategoriasVersion = pesos.data?.length ?? 0;

  // Valores de descriptores para «+ Columnas»: en vivo, una lectura por cruce (obtener_scoring_planta); congelado: del detalle.
  const filtrosActivos = filtrosEfectivos(estado);
  const necesitaValores = estado.columnas.length > 0 || filtrosActivos.length > 0;
  const valoresVivo = useQuery({
    queryKey: qk.ranking.valoresParametros({ ...alcance, incluirPruebas, ids: delGrupo.length }),
    queryFn: () => obtenerValoresParametros(delGrupo.map((f) => ({ individuo_id: f.individuo_id, planta_id: f.planta_id as string, evaluacion_id: f.evaluacion_id }))),
    enabled: necesitaValores && !congeladoId && delGrupo.length > 0,
    staleTime: 60_000,
  });
  const valores = congeladoId
    ? Object.fromEntries((detalle.data?.resultados ?? []).map((r) => [r.individuo_id, r.detalle.metricas ?? {}]))
    : valoresVivo.data;

  // Cambio: vs. ronda anterior (solo con un cruce: la función de comparación exige un cruce) o, en un congelado, vs. en vivo.
  const comparacion = useQuery({
    queryKey: qk.comparacion.planta(estado.cruce),
    queryFn: () => obtenerComparacionRondas({ plantaId: estado.cruce }),
    enabled: estado.cambio && !!estado.cruce && !congeladoId,
  });
  const vsVivo = useQuery({ queryKey: qk.snapshots.comparacion(congeladoId), queryFn: () => compararSnapshotVivo(congeladoId), enabled: estado.cambio && !!congeladoId });
  const cambios = useMemo(() => {
    if (!estado.cambio) return undefined;
    if (congeladoId) return vsVivo.data ? cambiosDesdeCongelado(vsVivo.data) : undefined;
    if (!estado.cruce) return undefined;
    return comparacion.data && pesos.data ? cambiosDesdeComparacion(comparacion.data, pesos.data, rondaElegida) : undefined;
  }, [estado.cambio, estado.cruce, congeladoId, vsVivo.data, comparacion.data, pesos.data, rondaElegida]);
  const rondaAnterior = rondaElegida !== null ? (rondaElegida > 1 ? String(rondaElegida - 1) : undefined) : cambios ? [...cambios.values()][0]?.referencia : undefined;
  const tituloCambio = congeladoId ? 'Cambio vs. en vivo' : rondaAnterior ? `Cambio vs. Ronda ${rondaAnterior}` : 'Cambio vs. ronda anterior';
  const puedeCambio = !!congeladoId || (!!estado.cruce && rondaElegida !== 1);
  const sinCambio = (individuoId: string) => (congeladoId ? 'Sin dato en vivo' : motivoSinCambio(individuoId, comparacion.data, rondaElegida));

  const filtradas = aplicarFiltros(delGrupo, valores, filtrosActivos);
  const ordenadas = ordenar(filtradas, estado.orden, { valores, cambios });
  // G18: paginación numerada (50 o 100 filas, la página en la URL); cambiar el alcance, el grupo, los filtros o el orden vuelve a la 1.
  const paginacion = usePaginacionUrl(ordenadas, { reinicio: [especieId, estado.cruce, congeladoId, grupo?.clave, rondaElegida, JSON.stringify(filtrosActivos), estado.orden.columna, estado.orden.dir] });
  const { pagina } = paginacion;
  const elegida = filas.find((f) => f.individuo_id === estado.individuo) ?? (esEscritorio ? ordenadas[0] : undefined);
  const resumenPlegado = plegado(filas, grupo?.clave ?? null);
  const umbralCobertura = vivo.data?.cobertura_advertencia ?? 0.5;
  const hayCoberturaBaja = pagina.some((f) => pesosGrupo.some((p) => { const c = f.cobertura[p.categoria]; return c && c.total > 0 && c.con_valor / c.total < umbralCobertura; }));

  const congelar = useMutation({
    mutationFn: () => congelarRankingGrupos({ ...alcance, nombre: `Resultados ${cruce?.codigo_sistema ?? especieNombre} ${hoyChileISO()}` }),
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: qk.snapshots.all });
      cambiar({ congelado: id });
    },
  });

  const cargando = !!especieId && (congeladoId ? detalle.isPending : base.isPending || (rondaElegida !== null && porRonda.isPending));
  const error = congeladoId ? detalle.isError : vivo.isError;

  // --- Piezas ----------------------------------------------------------------
  const controlesAlcance = (
    <>
      <div className="space-y-1">
        <Label htmlFor="res-cruce">Cruce</Label>
        {/* G17: selector con buscador (se escribe «07» y se filtra), en orden natural y con «Toda la especie» primero. */}
        <SelectorCruce
          id="res-cruce"
          etiqueta="Cruce"
          cruces={cruces.data ?? []}
          valor={estado.cruce}
          disabled={!especieId}
          opcionTodos="Toda la especie"
          onCambiar={(id) => cambiar({ cruce: id, congelado: modoCongelado ? 'elegir' : '', grupo: '', individuo: '' })}
        />
      </div>
      {/* [Provisional] El ranking en vivo usa la última ronda de cada individuo (no hay hoy una función por ronda); las temporadas pasadas se ven con «Congelado…». */}
      <div className="space-y-1">
        <Label htmlFor="res-ronda">Ronda (temporada)</Label>
        {congeladoId && detalle.data ? (
          <p className="flex min-h-tap items-center rounded-md border border-line bg-surface-2 px-3 text-small text-ink-2">Congelada el {formatearFecha(detalle.data.snapshot.created_at)}</p>
        ) : (
          <Select id="res-ronda" value={rondaElegida === null ? 'ultima' : String(rondaElegida)} disabled={modoCongelado} onChange={(e) => cambiar({ ronda: e.target.value === String(infoTemporadas.porDefecto) ? '' : e.target.value, individuo: '' })}>
            {infoTemporadas.lista.map((t) => { const et = etiquetaDeRonda(t.numero); return <option key={t.numero} value={String(t.numero)}>{`Ronda ${t.numero}${et ? ` · ${et}` : ''} · ${t.cerrada ? 'cerrada' : 'en curso'}`}</option>; })}
            <option value="ultima">La última evaluación de cada individuo</option>
          </Select>
        )}
      </div>
      <div className="space-y-1">
        <span className="block text-small font-medium text-ink-2" id="res-mostrar">Mostrar</span>
        <div role="group" aria-labelledby="res-mostrar" className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-line-strong p-0.5">
            <Button size="sm" variant={!modoCongelado ? 'default' : 'ghost'} aria-pressed={!modoCongelado} onClick={() => cambiar({ congelado: '', cambio: false })}>En vivo</Button>
            <Button size="sm" variant={modoCongelado ? 'default' : 'ghost'} aria-pressed={modoCongelado} onClick={() => cambiar({ congelado: congeladoId || 'elegir', cambio: false })}>Congelado…</Button>
          </div>
          {modoCongelado && (
            <Select aria-label="Ranking congelado" className="min-w-52" value={congeladoId} onChange={(e) => cambiar({ congelado: e.target.value || 'elegir', individuo: '' })}>
              <option value="">{snapshots.isPending ? 'Cargando…' : (snapshots.data?.items.length ?? 0) === 0 ? 'No hay rankings congelados' : 'Elegir un ranking congelado…'}</option>
              {(snapshots.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre} · {formatearFecha(s.created_at)}</option>)}
            </Select>
          )}
          {/* Fase 4 (decisión 7): el cierre de temporada congela el ranking de la temporada elegida de toda la especie. */}
          {!modoCongelado && esAdmin && !estado.cruce && (
            <CerrarTemporada especieId={especieId} especieNombre={especieNombre} numeroRonda={rondaElegida} onCongelado={(id) => cambiar({ congelado: id, cambio: false })} />
          )}
          {/* Hallazgo 10 de la guía: visible también en vivo (antes solo aparecía tras cambiar a «Congelado…»); oculto mientras se mira un congelado. */}
          {esAdmin && !congeladoId && (
            <Button size="sm" variant="outline" disabled={congelar.isPending || !vivo.data} onClick={() => congelar.mutate()}>
              <Snowflake className="h-4 w-4" aria-hidden="true" /> {congelar.isPending ? 'Congelando…' : 'Congelar el ranking actual'}
            </Button>
          )}
        </div>
      </div>
    </>
  );

  // Los pesos y la explicación del cálculo: solo el admin y solo plegados (nunca el nombre de la versión de puntaje).
  const comoSeCalcula = esAdmin ? <ComoSeCalcula pesos={pesos.data ?? []} pesosGrupo={pesosGrupo} /> : null;

  const frase = grupo ? (
    <p className="text-body text-ink">
      Comparando <strong>{grupo.n} {grupo.n === 1 ? 'individuo' : 'individuos'}</strong> que tienen {grupo.categorias.length === totalCategoriasVersion && totalCategoriasVersion > 0 ? <>las <strong>{totalCategoriasVersion} categorías</strong></> : <>las categorías <strong>{ordenarPorPeso(grupo.categorias, pesos.data ?? []).map(etiquetaCategoria).join(', ')}</strong></>} evaluadas.
      {!grupo.conPosicion && <span className="text-ink-2"> Todavía no hay puestos: el grupo no llega al mínimo de {vivo.data?.minimo_evaluaciones_grupo ?? 5} plantas.</span>}
    </p>
  ) : null;

  const chipsPoblacion = !modoCongelado && (
    <div className="flex flex-wrap gap-2 text-small">
      {resumenPlegado.excluidas.length > 0 && <span className="rounded-full bg-danger-l px-2.5 py-0.5 text-danger">{resumenPlegado.excluidas.length} por revisión</span>}
      <span className="rounded-full border border-line px-2.5 py-0.5 text-ink-2">{resumenPlegado.sinPuntaje.length} sin puntaje</span>
      <span className="rounded-full border border-line px-2.5 py-0.5 text-ink-2">{resumenPlegado.otrosGrupos.length} en otros grupos</span>
    </div>
  );

  const toggleCambio = (
    <label className={cn('flex min-h-tap items-center gap-2 text-small', puedeCambio ? 'text-ink' : 'text-ink-3')}>
      <input type="checkbox" role="switch" className="h-4 w-4 accent-primary" disabled={!puedeCambio} checked={estado.cambio && puedeCambio} onChange={(e) => cambiar({ cambio: e.target.checked })} />
      {congeladoId ? 'Mostrar cambio vs. en vivo' : `Mostrar cambio vs. ${rondaAnterior ? `Ronda ${rondaAnterior}` : 'ronda anterior'}`}
    </label>
  );
  // Fase 5 (G8, EF24): lo temprano es mejor, pero una variedad que produzca entre enero y marzo es valiosa: se buscan con un filtro.
  const botonTardias = (
    <Button variant={estado.tardias ? 'default' : 'outline'} aria-pressed={estado.tardias} onClick={() => cambiar({ tardias: !estado.tardias })}>
      Tardías (enero o después) {estado.tardias && <Check className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
  const notaCambio = !puedeCambio && <p className="text-small text-ink-3">{rondaElegida === 1 ? 'La ronda 1 no tiene una ronda anterior con qué comparar.' : 'El cambio vs. la ronda anterior se calcula por cruce: elige un cruce para verlo.'}</p>;
  const notaRonda = mezclaTemporadas && base.isSuccess && (
    <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-small text-ink-2">
      {infoTemporadas.porDefecto === null && !estado.ronda ? 'Aún no hay una temporada cerrada en esta especie. ' : ''}
      Mostrando la última evaluación de cada individuo (pueden ser de temporadas distintas).
    </p>
  );
  const etiquetaRonda = congeladoId && detalle.data ? detalle.data.snapshot.nombre : rondaElegida === null ? 'La última evaluación de cada individuo' : `Ronda ${rondaElegida}`;
  const exportar = () => {
    if (!grupo) return;
    const contexto = {
      especie: especieNombre, cruce: cruce?.codigo_sistema ?? null, version: versionNombre ?? 'sin versión',
      ronda: congeladoId ? `Congelado: ${etiquetaRonda}` : etiquetaRonda,
      rondaCorta: congeladoId ? 'congelado' : rondaElegida === null ? 'ultima' : `ronda-${rondaElegida}`,
      grupo: nombreGrupo(grupo, totalCategoriasVersion, pesos.data), ahora: new Date(),
    };
    descargarCsv(nombreArchivo(contexto), construirCsv(ordenadas, contexto, { pesosGrupo, columnas: estado.columnas, valores, cambios }));
  };

  const panel = elegida && (
    <PanelIndividuo
      fila={elegida}
      pesos={pesos.data ?? []}
      mediana={grupo && filasDelGrupo([elegida], grupo.clave).length ? mediana : medianaDelGrupo(filasDelGrupo(filas, elegida.grupo.join(',')))}
      cambio={cambios?.get(elegida.individuo_id)}
      sinCambio={cambios && !cambios.get(elegida.individuo_id) ? sinCambio(elegida.individuo_id) : undefined}
      especieNombre={especieNombre}
      mostrarComparar={!!cambios && !congeladoId}
      enHoja={!esEscritorio}
      alcance={alcancePuesto}
      empatadoCon={empates.get(elegida.individuo_id)}
    />
  );

  const cuerpo = cargando ? <EstadoCargando etiqueta="Cargando resultados…" forma="esqueleto" lineas={6} />
    : error ? <EstadoError mensaje="No se pudieron cargar los resultados." onReintentar={() => void (congeladoId ? detalle.refetch() : vivo.refetch())} />
      : estado.congelado === 'elegir' ? <EstadoVacio titulo="Elige un ranking congelado" descripcion={esAdmin ? 'O congela el ranking actual con «Congelar el ranking actual».' : undefined} />
        : !grupo ? <EstadoVacio titulo="Todavía no hay individuos con puntaje" descripcion="Cuando haya evaluaciones cerradas, el ranking aparece aquí." />
          : null;

  // «Todas las especies»: los resultados se leen dentro de una especie.
  if (!activa) return <Panorama titulo="Resultados" subtitulo="Los resultados se leen por especie. Entra a una para ver su ranking." />;

  // --- Celular -----------------------------------------------------------------
  if (!esEscritorio) {
    return (
      <div className="space-y-4">
        <EncabezadoPagina titulo="Resultados" />
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
          <div className="min-w-0">
            <p className="truncate text-body text-ink"><strong>{especieNombre || 'Especie'}</strong> · {cruce ? `cruce ${cruce.codigo_sistema}` : 'toda la especie'}</p>
            <p className="text-small text-ink-2">{congeladoId && detalle.data ? `${detalle.data.snapshot.nombre} · congelado` : `${etiquetaRonda} · en vivo`}</p>
          </div>
          <Button variant="outline" onClick={() => setHoja('alcance')}>Cambiar</Button>
        </div>
        <OtrasVistas esAdmin={esAdmin} parametro={parametro} />
        {cuerpo ?? (
          <>
            {comoSeCalcula}
            {notaRonda}
            {frase}
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => setHoja('grupo')}>Grupo <ChevronDown className="h-4 w-4" aria-hidden="true" /></Button>
              <Button variant="outline" onClick={() => setHoja('orden')}>Ordenar <ChevronDown className="h-4 w-4" aria-hidden="true" /></Button>
              <Button variant={estado.cambio && puedeCambio ? 'default' : 'outline'} aria-pressed={estado.cambio && puedeCambio} disabled={!puedeCambio} onClick={() => cambiar({ cambio: !estado.cambio })}>
                Cambio {estado.cambio && puedeCambio && <Check className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
            {botonTardias}
            {notaCambio}
            <ListaResultadosMovil filas={pagina} mediana={mediana} cambios={cambios} sinCambio={sinCambio} onSeleccion={(id) => cambiar({ individuo: id })} empates={empates} />
            {paginacion.total > 1 && <Paginacion estado={paginacion} />}
            {mediana !== null && <p className="text-small text-ink-3"><span aria-hidden="true" className="font-semibold text-ink">|</span> mediana del grupo ({formatearPuntos(mediana)})</p>}
            <PlegadoFinal plegado={resumenPlegado} congelado={!!congeladoId} />
          </>
        )}
        {hoja === 'alcance' && <Sheet titulo="Qué mostrar" onCerrar={() => setHoja(null)} footer={<div className="flex justify-end"><Button onClick={() => setHoja(null)}>Listo</Button></div>}><div className="space-y-4">{controlesAlcance}</div></Sheet>}
        {hoja === 'grupo' && (
          <Sheet titulo="Grupo" subtitulo="Cada individuo compite con los que tienen las mismas categorías evaluadas." onCerrar={() => setHoja(null)}>
            <ul className="space-y-1">
              {grupos.map((g) => (
                <li key={g.clave}>
                  <button type="button" aria-pressed={g.clave === grupo?.clave} onClick={() => { cambiar({ grupo: g.clave, individuo: '' }); setHoja(null); }} className="flex min-h-tap w-full items-center justify-between rounded-md px-3 text-left text-body hover:bg-surface-2 aria-pressed:bg-brand-l">
                    <span>{nombreGrupo(g, totalCategoriasVersion, pesos.data)}</span><span className="text-small text-ink-3">{g.n}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Sheet>
        )}
        {hoja === 'orden' && (
          <Sheet titulo="Ordenar" onCerrar={() => setHoja(null)}>
            <ul className="space-y-1">
              {ORDENES_MOVIL.filter((o) => o.orden.columna !== 'cambio' || !!cambios).map((o) => (
                <li key={o.etiqueta}>
                  <button type="button" aria-pressed={estado.orden.columna === o.orden.columna && estado.orden.dir === o.orden.dir} onClick={() => { cambiar({ orden: o.orden }); setHoja(null); }} className="flex min-h-tap w-full items-center rounded-md px-3 text-left text-body hover:bg-surface-2 aria-pressed:bg-brand-l">{o.etiqueta}</button>
                </li>
              ))}
            </ul>
          </Sheet>
        )}
        {elegida && estado.individuo && (
          <Sheet titulo={elegida.codigo_display} onCerrar={() => cambiar({ individuo: '' })}>{panel}</Sheet>
        )}
      </div>
    );
  }

  // --- Escritorio --------------------------------------------------------------
  return (
    <div className="space-y-4">
      <EncabezadoPagina titulo="Resultados" acciones={<OtrasVistas esAdmin={esAdmin} parametro={parametro} />} />
      <section aria-label="Alcance" className="grid items-start gap-4 rounded-lg border border-line bg-surface p-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,17rem)_minmax(0,1fr)]">
        {controlesAlcance}
      </section>

      {cuerpo ?? (
        <>
          {comoSeCalcula}
          {notaRonda}
          <div className="flex flex-wrap items-center justify-between gap-3">{frase}{chipsPoblacion}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Grupo" className="w-auto min-w-56" value={grupo?.clave ?? ''} onChange={(e) => cambiar({ grupo: e.target.value, individuo: '' })}>
              {grupos.map((g) => <option key={g.clave} value={g.clave}>Grupo: {nombreGrupo(g, totalCategoriasVersion, pesos.data)} ({g.n})</option>)}
            </Select>
            <Button variant="outline" onClick={() => setHoja('columnas')}><Plus className="h-4 w-4" aria-hidden="true" /> Columnas</Button>
            <ChipsColumnas columnas={estado.columnas} filtros={estado.filtros} onQuitar={(m) => cambiar({ columnas: estado.columnas.filter((c) => c !== m), filtros: estado.filtros.filter((f) => f.metrica !== m), orden: estado.orden.columna === `met:${m}` ? undefined : estado.orden })} />
            {toggleCambio}
            {botonTardias}
            <Button variant="ghost" aria-pressed={estado.cinco} onClick={() => cambiar({ cinco: !estado.cinco })}>{estado.cinco ? 'Ocultar los 5 mejores' : 'Ver los 5 mejores'}</Button>
            {/* N36: solo admin; CSV sin linaje con el puntaje 0–1 exacto y el visible. */}
            {esAdmin && <Button variant="outline" className="ml-auto" disabled={ordenadas.length === 0 || (necesitaValores && !valores)} onClick={exportar}><Download className="h-4 w-4" aria-hidden="true" /> Exportar</Button>}
          </div>
          {notaCambio}
          {necesitaValores && !congeladoId && valoresVivo.isPending && <EstadoCargando etiqueta="Cargando los valores de las columnas…" />}
          {estado.cinco && <CincoMejores filas={ordenadas} orden={estado.orden} valores={valores} />}

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 rounded-lg border border-line bg-surface">
              {ordenadas.length === 0 ? (
                <EstadoVacio className="m-4" titulo={estado.tardias && estado.filtros.length === 0 ? 'Ningún individuo del grupo es tardío (cosecha en enero o después).' : 'Ningún individuo cumple los filtros.'} accion={<Button variant="outline" size="sm" onClick={() => cambiar({ filtros: [], tardias: false })}>Quitar filtros</Button>} />
              ) : (
                <DataTableFrame label="Resultados">
                  <TablaResultados
                    filas={pagina}
                    pesosGrupo={pesosGrupo}
                    columnas={estado.columnas}
                    valores={valores}
                    cambios={cambios}
                    sinCambio={sinCambio}
                    tituloCambio={tituloCambio}
                    mediana={mediana}
                    umbralCobertura={umbralCobertura}
                    seleccion={elegida?.individuo_id ?? ''}
                    onSeleccion={(id) => cambiar({ individuo: id })}
                    orden={estado.orden}
                    onOrden={(orden) => cambiar({ orden })}
                    empates={empates}
                  />
                </DataTableFrame>
              )}
              {paginacion.total > 1 && <Paginacion estado={paginacion} className="border-t border-line px-4 py-3" />}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-small text-ink-3">
                <span>
                  {hayCoberturaBaja && <><PuntoCobertura /> Cobertura baja: menos de la mitad de los descriptores de esa categoría tiene dato · </>}
                  {mediana !== null && <><span aria-hidden="true" className="font-semibold text-ink">|</span> mediana del grupo ({formatearPuntos(mediana)})</>}
                </span>
              </div>
            </div>
            {elegida && <aside aria-label="Individuo elegido" className="rounded-lg border border-line bg-surface p-4 xl:sticky xl:top-4">{panel}</aside>}
          </div>
          <PlegadoFinal plegado={resumenPlegado} congelado={!!congeladoId} />
        </>
      )}

      {hoja === 'columnas' && (
        <HojaColumnas
          metricas={metricas.data ?? []}
          columnas={estado.columnas}
          filtros={estado.filtros}
          onCerrar={() => setHoja(null)}
          onAplicar={(columnas, filtros) => { cambiar({ columnas, filtros }); setHoja(null); }}
        />
      )}
    </div>
  );
}
