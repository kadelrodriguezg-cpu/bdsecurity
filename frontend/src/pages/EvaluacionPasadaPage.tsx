/**
 * Evaluación pasada a pantalla completa (Fase 2, referencia docs/diseno/v2/02).
 * Solo lectura: lo guardado sección por sección con el estado de cada
 * descriptor según el protocolo congelado de la evaluación, el conjunto
 * evaluado y, al costado, cómo está el individuo en el ranking por grupos y
 * qué pedía el protocolo. El expediente sigue mostrando el detalle compacto.
 */
import { useState } from 'react';
import { formatearFecha } from '@/lib/v3/formatos';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ChevronLeft, TriangleAlert } from 'lucide-react';
import { obtenerEvaluacion, type EvaluacionConContexto } from '@/api/rondas';
import { CATEGORIA_LABEL, ordenarGrupo } from '@/api/scoring';
import { ESTADO_RANKING_LABEL, obtenerRankingPorGrupos } from '@/api/rankingGrupos';
import { HuellaEvaluacion } from '@/features/evaluaciones/HuellaEvaluacion';
import { CorregirEvaluacion } from '@/features/evaluaciones/CorregirEvaluacion';
import { HistorialCorrecciones } from '@/features/evaluaciones/HistorialCorrecciones';
import { BotonPedirCorreccion, HistorialPedidosCorreccion } from '@/features/evaluaciones/PedirCorreccion';
import { useAuth } from '@/features/auth/AuthContext';
import { useEsquemaEvaluacionAnual } from '@/lib/esquemaFase/useEsquemaFase';
import { exportableCalculado } from '@/lib/esquemaFase/evaluacionAnual';
import { ESTADO_EVALUACION_LABEL, useEstadosEvaluacion } from '@/features/individuos/DetalleEvaluacion';
import { formatearPuntaje } from '@/features/ranking/formato';
import { NIVEL_SECCION_LABEL } from '@/lib/esquemaFase/protocolo';
import { camposDeSeccion, etiquetaDeNivel, formatearValorCampo, tieneValor, type CampoFase } from '@/lib/esquemaFase/tipos';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { temporadaDeRonda } from '@/lib/temporada';

const formatoNumero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });

/** Valor grande del mosaico y su unidad aparte (la unidad va en gris, como en la referencia). */
function valorMosaico(campo: CampoFase, valor: unknown): { cifra: string; unidad?: string } {
  if (!tieneValor(valor)) return { cifra: '—' };
  // Escala con texto por nivel: se escribe el nivel («Hasta la mitad»), no el número.
  const nivel = etiquetaDeNivel(campo, valor);
  if (nivel) return { cifra: nivel };
  if (campo.tipo === 'fecha' || campo.tipo === 'escala') return { cifra: campo.tipo === 'fecha' ? formatearFecha(String(valor)) : formatoNumero.format(Number(valor)) };
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return { cifra: formatearValorCampo(campo, valor) };
  return { cifra: formatoNumero.format(numero), unidad: campo.unidad };
}

function pieMosaico(campo: CampoFase): string | null {
  if (campo.escala?.etiquetasNivel) return `Escala ${campo.escala.minimo} a ${campo.escala.maximo} · ${campo.escala.etiquetasNivel.map((texto, i) => `${(campo.escala?.minimo ?? 1) + i} ${texto}`).join(', ')}`;
  if (campo.escala) return `Escala ${campo.escala.minimo} a ${campo.escala.maximo} · ${campo.escala.minimo} ${campo.escala.etiquetaMinimo}, ${campo.escala.maximo} ${campo.escala.etiquetaMaximo}`;
  if (campo.tipo === 'fecha') return 'Fecha observada en la planta';
  if (campo.rol === 'derivado') return 'Calculado';
  return null;
}

function TarjetaRanking({ evaluacion }: { evaluacion: EvaluacionConContexto }) {
  const plantaId = evaluacion.ronda.individuo.planta_id;
  const ranking = useQuery({
    queryKey: qk.ranking.grupos({ plantaId, especieId: undefined, incluirPruebas: false }),
    queryFn: () => obtenerRankingPorGrupos({ plantaId }),
  });
  const item = ranking.data?.items.find((i) => i.individuo_id === evaluacion.ronda.individuo.id);
  // Mismo puntaje publicado en el mismo grupo: comparten la posición.
  const empatado = !!item && item.posicion_grupo !== null && (ranking.data?.items ?? []).some((i) => i !== item
    && i.posicion_grupo === item.posicion_grupo && i.grupo.join(',') === item.grupo.join(','));
  return (
    <section aria-label="Ranking actual" className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-body-l font-semibold text-ink">Ranking actual del cruce</h2>
      {ranking.isPending ? <p role="status" className="text-small text-ink-3">Cargando ranking…</p>
        : ranking.isError || !item ? <p className="text-small text-ink-3">No se pudo leer la posición de este individuo.</p>
          : item.evaluacion_id !== evaluacion.id ? (
            <p className="text-small text-ink-2">
              El ranking usa la evaluación de la ronda {item.numero_ronda ?? '—'}, no esta. Esta evaluación queda como historia.
            </p>
          ) : (
            <>
              {item.puntaje !== null && (
                <p className="text-ink-2">
                  <span className="tabular-nums text-title font-semibold text-ink">{formatearPuntaje(item.puntaje)}</span>
                  {item.posicion_grupo !== null && <> · puesto {item.posicion_grupo} de {item.tamano_grupo} en su grupo{empatado ? ', empatado' : ''}</>}
                </p>
              )}
              <p className="text-small text-ink-2">
                {item.estado_ranking === 'comparable'
                  ? `Grupo: ${ordenarGrupo(item.grupo).map((c) => CATEGORIA_LABEL[c]).join(' · ')}.`
                  : `${ESTADO_RANKING_LABEL[item.estado_ranking]}.`}
                {item.estado_ranking === 'pocas_plantas' && ` Su grupo (${ordenarGrupo(item.grupo).map((c) => CATEGORIA_LABEL[c]).join(' · ')}) tiene ${item.tamano_grupo} de ${ranking.data.minimo_evaluaciones_grupo} plantas necesarias.`}
              </p>
              <Link to={`/ranking?especie=${item.especie_id}&cruce=${plantaId}`} className="inline-flex min-h-tap items-center text-small text-brand underline underline-offset-4">
                Abrir ranking
              </Link>
            </>
          )}
    </section>
  );
}

function EvaluacionPasada({ evaluacion }: { evaluacion: EvaluacionConContexto }) {
  const { esquema, estadosQuery, protocolo, estados, secciones, noExistian } = useEstadosEvaluacion(evaluacion, evaluacion.ronda.individuo.planta_id);
  // El % exportable se calcula con la poscosecha de esta visita (o es el valor histórico escrito a mano).
  const valores: Record<string, unknown> = { ...evaluacion, pct_fruta_exportable: exportableCalculado(evaluacion as unknown as Record<string, unknown>) };
  // Un protocolo antiguo puede traer un campo desactivado (rend_t_ha) que esta evaluación no tiene: no cuenta como descriptor del protocolo.
  const enProtocolo = Object.keys(protocolo?.descriptores ?? {}).filter((clave) => esquema.campos.some((c) => c.clave === clave));
  const medidosProtocolo = enProtocolo.filter((clave) => estados[clave] === 'medido' || estados[clave] === 'marcado').length;
  const faltaron = esquema.campos.filter((c) => estados[c.clave] === 'falto');
  const nombres = (lista: string[]) => (lista.length <= 1 ? lista.join('') : `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`);
  const seccionesPorNivel = (nivel: 'obligatoria' | 'mixta' | 'opcional' | 'fuera') => [...secciones.values()].filter((s) => s.nivel === nivel).map((s) => s.etiqueta);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-4">
        <section aria-label="Datos de la evaluación" className="rounded-lg border border-line bg-surface p-4">
          <dl className="grid grid-cols-2 gap-4 text-small md:grid-cols-4">
            <div><dt className="text-ink-3">Estado</dt><dd className="mt-1"><span className="rounded-full bg-brand-s px-2 py-0.5 text-brand-ink">{ESTADO_EVALUACION_LABEL[evaluacion.estado]}</span></dd></div>
            <div><dt className="text-ink-3">Fecha efectiva</dt><dd className="mt-1 tabular-nums text-body text-ink">{formatearFecha(evaluacion.fecha)}</dd></div>
            <div><dt className="text-ink-3">Evaluador en terreno</dt><dd className="mt-1 text-body text-ink">{evaluacion.evaluador || 'Sin registrar'}</dd></div>
            <div><dt className="text-ink-3">Protocolo</dt><dd className="mt-1 text-body text-ink">{protocolo ? `${protocolo.nombre} · v${protocolo.version}` : estadosQuery.isSuccess ? 'Sin protocolo' : 'Sin confirmar'}</dd></div>
          </dl>
          {(evaluacion.requiere_revision || evaluacion.no_comparable || evaluacion.sin_muestra) && (
            <ul className="mt-3 flex flex-wrap gap-1.5 text-small">
              {evaluacion.requiere_revision && <li className="rounded-full bg-danger-l px-2.5 py-0.5 text-danger">Revisar: no entra al ranking hasta resolverse</li>}
              {evaluacion.no_comparable && <li className="rounded-full bg-neutral-l px-2.5 py-0.5 text-ink-2">Marcada como no comparable</li>}
              {evaluacion.sin_muestra && <li className="rounded-full bg-neutral-l px-2.5 py-0.5 text-ink-2">Sin muestra de frutos</li>}
            </ul>
          )}
        </section>

        <HistorialCorrecciones individuoId={evaluacion.ronda.individuo.id} evaluacionId={evaluacion.id} />
        <HistorialPedidosCorreccion evaluacionId={evaluacion.id} />

        <section aria-label="Conjunto evaluado" className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-body-l font-semibold text-ink">Conjunto evaluado</span>
            {protocolo && <span className="text-small text-ink-3">{medidosProtocolo} de {enProtocolo.length} descriptores del protocolo</span>}
          </h2>
          <HuellaEvaluacion esquema={esquema} estados={estados} enFila />
          {faltaron.length > 0 && (
            <p className="flex gap-2 rounded-md bg-warn-l p-3 text-small text-warn">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {faltaron.length === 1 ? 'Faltó' : 'Faltaron'} {nombres(faltaron.map((c) => c.etiqueta))}
                {faltaron.length === 1 ? ', que era obligatorio' : ', que eran obligatorios'} en esta ronda. Sin valor guardado: no es cero.
              </span>
            </p>
          )}
        </section>

        {esquema.secciones.map((seccion) => {
          const campos = camposDeSeccion(esquema, seccion.id);
          const visibles = campos.filter((campo) => (campo.rol === 'derivado' ? tieneValor(valores[campo.clave]) : estados[campo.clave] !== 'no_evaluado'));
          const noEvaluados = campos.filter((campo) => campo.rol !== 'derivado' && estados[campo.clave] === 'no_evaluado');
          // Creados después de la fecha de esta evaluación: no se pudieron medir y no cuentan en el «N de M».
          const inexistentes = noExistian.filter((campo) => campo.seccion === seccion.id);
          const resumen = secciones.get(seccion.id);
          const nivel = protocolo && resumen ? NIVEL_SECCION_LABEL[resumen.nivel] : null;
          if (visibles.length === 0) {
            return (
              <section key={seccion.id} aria-label={seccion.etiqueta} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-dashed border-line px-4 py-3 text-small">
                <span><span className="font-semibold text-ink">{seccion.etiqueta}</span><span className="text-ink-3"> · {nivel ? `${nivel.toLowerCase()}, ` : ''}no se evaluó</span></span>
                <span className="text-ink-3">{campos.filter((c) => c.rol !== 'derivado').map((c) => c.etiqueta).join(', ')}</span>
                {inexistentes.length > 0 && (
                  <span className="w-full text-ink-3">No existía en esa fecha: {inexistentes.map((c) => c.etiqueta).join(', ')}.</span>
                )}
              </section>
            );
          }
          // Los calculados (peso promedio, cobertura floral, exportable…) no son descriptores: no cuentan en el «N de M».
          const medidos = campos.filter((c) => c.rol !== 'derivado' && (estados[c.clave] === 'medido' || estados[c.clave] === 'marcado')).length;
          const descriptores = campos.filter((c) => c.rol !== 'derivado').length;
          return (
            <section key={seccion.id} aria-label={seccion.etiqueta} className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <h2 className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-l font-semibold text-ink">{seccion.etiqueta}</span>
                <span className="text-small tabular-nums text-ink-3">{medidos} de {descriptores}{nivel ? ` · ${nivel.toLowerCase()}` : ''}</span>
              </h2>
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibles.map((campo) => {
                  const estado = campo.rol === 'derivado' ? 'medido' : estados[campo.clave];
                  if (estado === 'falto') {
                    return (
                      <div key={campo.clave} className="rounded-md border border-warn bg-warn-l p-3">
                        <dt className="text-small text-ink-2">{campo.etiqueta}</dt>
                        <dd className="mt-1 text-body-l text-warn">Falta · era obligatorio</dd>
                        <dd className="text-micro text-ink-3">Sin valor guardado. No es cero.</dd>
                      </div>
                    );
                  }
                  const { cifra, unidad } = valorMosaico(campo, valores[campo.clave]);
                  const pie = pieMosaico(campo);
                  return (
                    <div key={campo.clave} className={cn('rounded-md bg-surface-2 p-3', estado === 'marcado' && 'border border-danger-l')}>
                      <dt className="text-small text-ink-2">{campo.etiqueta}</dt>
                      <dd className="mt-1 flex items-baseline gap-1.5">
                        <span className="tabular-nums text-title font-semibold text-ink">{cifra}</span>
                        {unidad && <span className="text-small text-ink-3">{unidad}</span>}
                        {estado === 'marcado' && <span className="ml-1 rounded-full bg-danger-l px-2 text-small text-danger">Revisar</span>}
                      </dd>
                      {pie && <dd className="text-micro text-ink-3">{pie}</dd>}
                    </div>
                  );
                })}
                {noEvaluados.map((campo) => (
                  <div key={campo.clave} className="rounded-md border border-dashed border-line p-3">
                    <dt className="text-small text-ink-2">{campo.etiqueta}</dt>
                    <dd className="mt-1 text-body text-ink-3">No evaluado</dd>
                  </div>
                ))}
                {inexistentes.map((campo) => (
                  <div key={campo.clave} className="rounded-md border border-dashed border-line-soft p-3">
                    <dt className="text-small text-ink-3">{campo.etiqueta}</dt>
                    <dd className="mt-1 text-small text-ink-3">No existía en esa fecha</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}

        <section aria-label="Observaciones" className="space-y-1 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-body-l font-semibold text-ink">Observaciones</h2>
          <p className={cn('whitespace-pre-line text-body', evaluacion.observaciones ? 'text-ink' : 'text-ink-3')}>{evaluacion.observaciones || 'Sin observaciones.'}</p>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4">
        <TarjetaRanking evaluacion={evaluacion} />
        <section aria-label="Protocolo de esta ronda" className="space-y-1.5 rounded-lg border border-line bg-surface p-4 text-small">
          <h2 className="text-body-l font-semibold text-ink">Protocolo de esta ronda</h2>
          {protocolo ? (
            <>
              <p className="text-ink-2">
                {[
                  seccionesPorNivel('obligatoria').length > 0 && `Obligatorio: ${nombres(seccionesPorNivel('obligatoria'))}.`,
                  seccionesPorNivel('mixta').length > 0 && `Con obligatorios: ${nombres(seccionesPorNivel('mixta'))}.`,
                  seccionesPorNivel('opcional').length > 0 && `Opcional: ${nombres(seccionesPorNivel('opcional'))}.`,
                  seccionesPorNivel('fuera').length > 0 && `Fuera: ${nombres(seccionesPorNivel('fuera'))}.`,
                ].filter(Boolean).join(' ')}
              </p>
              <p className="text-ink-3">«{protocolo.nombre}», versión {protocolo.version}, definido el {formatearFecha(protocolo.created_at)}. La evaluación quedó con el protocolo vigente al crearse.</p>
            </>
          ) : (
            <p className="text-ink-3">{estadosQuery.isSuccess ? 'Esta evaluación es anterior a los protocolos de ronda: no hubo descriptores obligatorios.' : 'Cargando…'}</p>
          )}
        </section>
      </aside>
    </div>
  );
}

/**
 * U-09: una ronda puede tener varias evaluaciones cerradas del mismo individuo (visitas espaciadas dentro de la
 * temporada). Desde la lectura de una cerrada se abre una nueva visita en la misma ronda; el formulario avisa arriba
 * que la ronda ya tiene una cerrada. Al cancelar o guardar se vuelve a esta lectura.
 */
function BotonNuevaEvaluacion({ evaluacion, plantaId }: { evaluacion: EvaluacionConContexto; plantaId: string }) {
  if (evaluacion.estado !== 'completa' && evaluacion.estado !== 'corregida') return null;
  const { individuo, numero_ronda: numero, tipo_ronda: tipo } = evaluacion.ronda;
  const ruta = `/planta/${plantaId}/${tipo === 'multisitio' ? 'multisitio' : 'evaluar'}/${individuo.id}`;
  const consulta = new URLSearchParams();
  if (Number.isInteger(numero) && numero >= 1 && numero <= 3) consulta.set('ronda', String(numero));
  consulta.set('volver', `/planta/${plantaId}/evaluacion/${evaluacion.id}`);
  return (
    <Link to={`${ruta}?${consulta.toString()}`} className="inline-flex min-h-tap items-center rounded-md bg-primary px-4 text-small font-semibold text-white hover:bg-brand-d">
      Nueva evaluación en esta ronda
    </Link>
  );
}

/**
 * A8 (v3 paso 6): solo el admin corrige una evaluación cerrada, con motivo. El operario no ve el botón (la base además
 * lo rechaza: triggers de integridad + RLS). docs/rediseno_v3/corregir.md.
 */
function BotonCorregir({ evaluacion }: { evaluacion: EvaluacionConContexto }) {
  const { esAdmin } = useAuth();
  const esquema = useEsquemaEvaluacionAnual();
  const [abierta, setAbierta] = useState(false);
  if (!esAdmin || (evaluacion.estado !== 'completa' && evaluacion.estado !== 'corregida')) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setAbierta(true)}>Corregir</Button>
      {abierta && <CorregirEvaluacion evaluacion={evaluacion} esquema={esquema} onCerrar={() => setAbierta(false)} />}
    </>
  );
}

/** Desde la evaluación se llega a «Comparar rondas»: con la ronda anterior ya elegida o, si es la primera, para elegir. */
function EnlacesComparar({ evaluacion, plantaId }: { evaluacion: EvaluacionConContexto; plantaId: string }) {
  const base = `/planta/${plantaId}/comparar/${evaluacion.ronda.individuo.id}`;
  const numero = evaluacion.ronda.numero_ronda;
  const claseLink = 'inline-flex min-h-tap items-center px-2 text-small text-brand underline-offset-4 hover:underline';
  return numero > 1 ? (
    <nav aria-label="Comparar rondas" className="flex flex-wrap items-center gap-2">
      <Link to={`${base}?rondas=${numero - 1},${numero}`} className="inline-flex min-h-tap items-center rounded-md border border-line-strong bg-white px-4 text-small text-ink hover:bg-surface-2">
        Comparar con la ronda anterior
      </Link>
      <Link to={base} className={claseLink}>Elegir otra ronda</Link>
    </nav>
  ) : (
    <nav aria-label="Comparar rondas">
      <Link to={base} className="inline-flex min-h-tap items-center rounded-md border border-line-strong bg-white px-4 text-small text-ink hover:bg-surface-2">
        Comparar rondas
      </Link>
    </nav>
  );
}

export function EvaluacionPasadaPage() {
  const { id: plantaId = '', evaluacionId = '' } = useParams();
  const query = useQuery({ queryKey: qk.evaluaciones.porId(evaluacionId), queryFn: () => obtenerEvaluacion(evaluacionId) });
  const evaluacion = query.data;

  return (
    <div className="mx-auto max-w-[1360px] space-y-4">
      <Link to={`/planta/${plantaId}`} className="inline-flex min-h-tap items-center gap-1 text-small text-brand">
        <ChevronLeft className="h-4 w-4" /> Planilla de ronda
      </Link>
      {query.isPending ? <p role="status" className="text-small text-ink-3">Cargando evaluación…</p>
        : query.isError || !evaluacion ? (
          <Alert>No se pudo cargar la evaluación. <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Reintentar</Button></Alert>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3">
              <div>
                <h1 className="font-mono text-title font-semibold text-ink">{evaluacion.ronda.individuo.codigo_display}</h1>
                <p className="text-small text-ink-3">{[`Ronda ${evaluacion.ronda.numero_ronda}`, evaluacion.ronda.tipo_ronda, temporadaDeRonda(evaluacion.ronda) && `Temporada ${temporadaDeRonda(evaluacion.ronda)}`].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <BotonNuevaEvaluacion evaluacion={evaluacion} plantaId={plantaId} />
                <BotonCorregir evaluacion={evaluacion} />
                <BotonPedirCorreccion evaluacion={evaluacion} />
                {evaluacion.ronda.tipo_ronda === 'anual' && <EnlacesComparar evaluacion={evaluacion} plantaId={plantaId} />}
              </div>
            </header>
            <EvaluacionPasada evaluacion={evaluacion} />
          </>
        )}
    </div>
  );
}
