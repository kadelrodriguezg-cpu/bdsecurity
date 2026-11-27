/**
 * «Ver valores» de la planilla de ronda (Fase 2, Sprint 3, S3-2; referencia
 * docs/diseno/v2/01, vista `#valores`): matriz individuos × descriptores de la
 * ronda elegida, con el valor de cada celda y su estado según la base (medido,
 * faltó, no evaluado, marcado). Solo la ve un admin; el que la monta decide.
 * Las columnas van agrupadas por sección del esquema de fase; el encabezado y
 * la columna del código quedan fijos y el desplazamiento horizontal ocurre
 * dentro de la matriz, no de la página. Nunca lleva linaje: solo las columnas
 * del esquema de Evaluación anual.
 */
import { formatearFecha } from '@/lib/v3/formatos';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DescriptoresProtocolo, EstadoDescriptor, FilaPlanilla } from '@/api/protocolo';
import { listarValoresDeRonda, type ValoresEvaluacion } from '@/api/valoresRonda';
import type { TipoRonda } from '@/api/rondas';
import { camposLegibles, contarObligatoriosDeEstados, ESTADO_DESCRIPTOR_LABEL } from '@/lib/esquemaFase/protocolo';
import { estaActivo, etiquetaDeNivel, tieneValor, type CampoFase, type EsquemaFase } from '@/lib/esquemaFase/tipos';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChipEstado, aRevisar, corto } from './filaPlanilla';

/** Encabezados cortos: la etiqueta completa va en el título y para lectores de pantalla. */
const ABREVIATURA: Record<string, string> = {
  brotacion: 'Brot.', presencia_yemas_florales: 'Yemas', floracion: 'Flor.', fecha_inicio_floracion: 'Ini. flor.', precocidad: 'Prec.', cuaja: 'Cuaja', concentracion_cosecha: 'Conc.', distribucion_flores_frutos: 'Distrib.',
  n_varas_basales: 'Varas', n_varas_con_flor: 'c/flor', n_flores_varas_basales: 'Flores', n_frutos_varas_basales: 'Frutos', altura_brote_mm: 'Alt. mm', diametro_brote_mm: 'Diám. mm', vigor_vegetativo: 'Vigor', color_follaje: 'Follaje',
  calibre_mm: 'Calib. mm', firmeza: 'Firmeza', color: 'Color', bloom: 'Bloom', brix: '°Bx', cicatriz: 'Cicatr.',
  cantidad_frutos: 'N.º frutos', peso_total_g: 'Peso g',
  rend_kg_planta: 'kg/planta', rend_t_ha: 't/ha', pct_fruta_exportable: '% export.',
  dano_calor: 'Calor', golpe_sol: 'Sol', caida_fruto: 'Caída',
};

const formatoNumero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });

/** Texto de una celda: fecha `dd-mm-aaaa` (contrato, decisión N23), cifras en es-CL sin unidad (la unidad va en el encabezado). */
export function textoCelda(campo: CampoFase, valor: unknown): string {
  if (!tieneValor(valor)) return '—';
  if (campo.tipo === 'fecha') {
    return formatearFecha(String(valor));
  }
  // Escala con texto por nivel («Hasta la mitad»): se escribe el nivel, no un 2 que no dice nada.
  const nivel = etiquetaDeNivel(campo, valor);
  if (nivel) return nivel;
  const numero = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(numero) ? formatoNumero.format(numero) : String(valor);
}

// Los tres estados con huella propia se dibujan igual en la leyenda y en la celda.
const CLASE_FALTO = 'bg-warn-l text-warn';
const CLASE_MARCADO = 'bg-danger-l text-danger';
const CAJA_VACIA = 'mx-auto block h-5 w-8 rounded-[3px] border border-line bg-surface';

function Celda({ estado, campo, valor, inicioGrupo }: { estado: EstadoDescriptor | undefined; campo: CampoFase; valor: unknown; inicioGrupo: boolean }) {
  const base = cn('h-11 whitespace-nowrap border-b border-line-soft px-2 text-right text-small tabular-nums', inicioGrupo && 'border-l border-l-line');
  if (!estado) return <td className={base} />; // sin evaluación: nada que mostrar
  const etiqueta = `${campo.etiqueta}: ${ESTADO_DESCRIPTOR_LABEL[estado]}`;
  if (estado === 'falto') {
    return <td className={cn(base, 'text-center', CLASE_FALTO)} title={etiqueta}>falta<span className="sr-only">: {campo.etiqueta}, faltó</span></td>;
  }
  if (estado === 'marcado') {
    return (
      <td className={cn(base, CLASE_MARCADO)} title={etiqueta}>
        <span aria-hidden="true" className="mr-1">!</span>{textoCelda(campo, valor)}
        <span className="sr-only">: {campo.etiqueta}, marcado para revisión</span>
      </td>
    );
  }
  if (estado === 'no_evaluado') {
    return <td className={base} title={etiqueta}><span className={CAJA_VACIA} /><span className="sr-only">No evaluado: {campo.etiqueta}</span></td>;
  }
  return <td className={cn(base, 'text-ink')}>{textoCelda(campo, valor)}</td>;
}

function Leyenda() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-small text-ink-3" aria-label="Leyenda de estados">
      <li className="flex items-center gap-2"><span aria-hidden="true" className="tabular-nums text-ink">4</span>Medido</li>
      <li className="flex items-center gap-2"><span aria-hidden="true" className={cn('rounded-[3px] px-2 py-0.5', CLASE_FALTO)}>falta</span>Faltó (obligatorio sin dato)</li>
      <li className="flex items-center gap-2"><span aria-hidden="true" className={cn(CAJA_VACIA, 'mx-0')} />No evaluado</li>
      <li className="flex items-center gap-2"><span aria-hidden="true" className={cn('rounded-[3px] px-2 py-0.5 tabular-nums', CLASE_MARCADO)}>! 14</span>Marcado para revisión</li>
    </ul>
  );
}

export function MatrizValores({
  plantaId,
  numero,
  tipo,
  filas,
  descriptores,
  esquema,
  onAbrir,
  onVer,
}: {
  plantaId: string;
  numero: number;
  tipo: TipoRonda;
  /** Las filas que se dibujan (ya filtradas y paginadas por quien monta la matriz). */
  filas: readonly FilaPlanilla[];
  descriptores: DescriptoresProtocolo | null;
  esquema: EsquemaFase;
  /** Selecciona el individuo en el expediente. */
  onAbrir: (individuoId: string) => void;
  /** Abre su evaluación a pantalla completa. */
  onVer: (fila: FilaPlanilla) => void;
}) {
  const valores = useQuery({ queryKey: qk.protocolo.valores(plantaId, numero, tipo), queryFn: () => listarValoresDeRonda(plantaId, numero, tipo) });

  // Con protocolo: sus descriptores. Sin él: los campos que alguna evaluación de la ronda llenó.
  // Un campo desactivado (rend_t_ha) solo es columna si alguna evaluación de la ronda ya trae un valor: el dato histórico se conserva.
  const columnas = useMemo(() => {
    const leidos = valores.data ? [...valores.data.values()] : [];
    const conValor = (c: CampoFase) => leidos.some((v) => tieneValor((v as Record<string, unknown>)[c.clave]));
    const campos = camposLegibles(esquema).filter((c) => estaActivo(c) || conValor(c));
    if (descriptores && Object.keys(descriptores).length > 0) return campos.filter((c) => (descriptores as Record<string, unknown>)[c.clave] || (!estaActivo(c) && conValor(c)));
    return campos.filter(conValor);
  }, [esquema, descriptores, valores.data]);
  const grupos = useMemo(
    () => esquema.secciones
      .map((s) => ({ id: s.id, etiqueta: s.etiqueta, campos: columnas.filter((c) => c.seccion === s.id) }))
      .filter((g) => g.campos.length > 0),
    [esquema, columnas],
  );

  if (valores.isPending) return <p role="status" className="text-small text-ink-3">Cargando valores de la ronda {numero}…</p>;
  if (valores.isError) {
    return (
      <Alert>
        No se pudieron leer los valores de la ronda {numero}.{' '}
        <Button variant="outline" size="sm" disabled={valores.isFetching} onClick={() => void valores.refetch()}>Reintentar</Button>
      </Alert>
    );
  }
  if (columnas.length === 0) {
    return <p className="rounded-md border border-dashed px-3 py-4 text-center text-small text-ink-3">Ninguna evaluación de esta ronda tiene valores todavía.</p>;
  }
  const mapa: Map<string, ValoresEvaluacion> = valores.data;

  // El encabezado va en dos filas fijas (sección y descriptor); la primera mide 32 px y la segunda se pega debajo.
  const celdaFija = 'sticky left-0 border-r border-r-line bg-surface';
  const encabezado = 'sticky z-20 border-b border-line bg-surface-2 text-small font-normal text-ink-3';
  return (
    <div className="max-md:hidden space-y-2">
      <div
        role="region"
        aria-label={`Valores de la ronda ${numero} por individuo y descriptor`}
        tabIndex={0}
        className="max-h-[70vh] overflow-auto rounded-md border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-left text-small">
          <caption className="sr-only">Valores registrados en la ronda {numero}, por individuo y descriptor</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className={cn(encabezado, 'left-0 top-0 z-30 h-[68px] border-r border-r-line px-3 align-bottom')}>
                <span className="block pb-2">Individuo</span>
              </th>
              {grupos.map((g) => (
                <th key={g.id} scope="colgroup" colSpan={g.campos.length} className={cn(encabezado, 'top-0 h-8 border-l border-l-line px-2 text-left')}>{g.etiqueta}</th>
              ))}
              <th scope="col" rowSpan={2} className={cn(encabezado, 'top-0 border-l border-l-line px-2 align-bottom')}><span className="block pb-2">Oblig.</span></th>
              <th scope="col" rowSpan={2} className={cn(encabezado, 'top-0 px-2 align-bottom')}><span className="block pb-2">Estado</span></th>
              <th scope="col" rowSpan={2} className={cn(encabezado, 'top-0 px-2')}><span className="sr-only">Acción</span></th>
            </tr>
            <tr>
              {grupos.flatMap((g) => g.campos.map((c, i) => (
                <th key={c.clave} scope="col" title={c.unidad ? `${c.etiqueta} (${c.unidad})` : c.etiqueta} className={cn(encabezado, 'top-8 h-9 whitespace-nowrap px-2 text-right', i === 0 && 'border-l border-l-line')}>
                  <span aria-hidden="true">{ABREVIATURA[c.clave] ?? c.etiqueta}</span>
                  <span className="sr-only">{c.unidad ? `${c.etiqueta} (${c.unidad})` : c.etiqueta}</span>
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const v = f.evaluacion_id ? mapa.get(f.evaluacion_id) : undefined;
              const oblig = contarObligatoriosDeEstados(descriptores, f.estados, esquema);
              return (
                <tr key={f.individuo_id}>
                  <th scope="row" className={cn(celdaFija, 'z-10 h-11 whitespace-nowrap border-b border-line-soft px-3 text-left font-normal')}>
                    <button type="button" className="min-h-tap font-mono text-ink underline-offset-4 hover:text-brand hover:underline" title="Abrir en Individuos" onClick={() => onAbrir(f.individuo_id)}>{corto(f)}</button>
                  </th>
                  {grupos.flatMap((g) => g.campos.map((c, i) => (
                    <Celda key={c.clave} campo={c} inicioGrupo={i === 0} estado={f.estados ? f.estados[c.clave as keyof typeof f.estados] ?? 'no_evaluado' : undefined} valor={v?.[c.clave as keyof ValoresEvaluacion]} />
                  )))}
                  <td className={cn('h-11 whitespace-nowrap border-b border-l border-line-soft border-l-line px-2 text-right tabular-nums', oblig.llenos < oblig.total ? 'text-warn' : 'text-ink-2')}>
                    {f.estados && oblig.total > 0 ? `${oblig.llenos}/${oblig.total}` : '—'}
                  </td>
                  <td className="h-11 whitespace-nowrap border-b border-line-soft px-2"><ChipEstado fila={f} descriptores={descriptores} /></td>
                  <td className="h-11 whitespace-nowrap border-b border-line-soft px-1 text-right">
                    {f.evaluacion_id && (
                      <Button size="sm" variant="link" className={aRevisar(f) ? 'text-danger' : undefined} onClick={() => onVer(f)}>{aRevisar(f) ? 'Revisar' : 'Ver'}</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Leyenda />
    </div>
  );
}
