/**
 * «Todas las especies» (fase 4): una tarjeta por especie con una franja de su color arriba. Cuenta como la planilla:
 * cruces activos, individuos vivos, «sin evaluación cerrada» (ámbar, N8) y evaluaciones cerradas en la ronda actual;
 * barra de cruces por fase; última actividad (hoy/ayer + hora o dd-mm-aaaa, y quién); y «Entrar a <especie> →».
 * Una especie sin cruces va punteada; el admin la configura o crea su primer cruce desde ahí.
 */
import { Link } from 'react-router';
import { ArrowRight, Plus, SlidersHorizontal } from 'lucide-react';
import type { PanoramaEspecie } from '@/api/especies';
import { Button } from '@/components/ui/button';
import { EncabezadoPagina, EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { useAuth } from '@/features/auth/AuthContext';
import { colorEspecie } from '@/lib/especies';
import { formatearActividad } from '@/lib/v3/formatos';
import { ESTADOS_ORDEN, ESTADO_LABEL } from '@/types/domain';
import { useEspacioEspecie } from './EspacioEspecie';
import { useNombres } from './useNombres';

const fmt = new Intl.NumberFormat('es-CL');

/** Barra de cruces por fase: un tramo por fase con cruces, más intenso cuanto más avanzada la fase. */
export function BarraFasesEspecie({ especie }: { especie: PanoramaEspecie }) {
  const color = colorEspecie(especie);
  const tramos = ESTADOS_ORDEN.map((estado, i) => ({ estado, i, n: especie.cruces_por_fase[estado] ?? 0 })).filter((t) => t.n > 0);
  const total = tramos.reduce((suma, t) => suma + t.n, 0);
  const texto = tramos.map((t) => `${ESTADO_LABEL[t.estado]} ${t.n}`).join(' · ');
  return (
    <div className="space-y-1.5">
      <p className="text-small text-ink-3">Cruces por fase</p>
      <div role="img" aria-label={`Cruces por fase: ${texto}`} className="flex h-2.5 overflow-hidden rounded-full bg-track">
        {tramos.map((t) => (
          <span key={t.estado} title={`${ESTADO_LABEL[t.estado]}: ${t.n}`} className="h-full border-r border-surface last:border-r-0"
            style={{ width: `${(t.n / total) * 100}%`, backgroundColor: color, opacity: 0.3 + (0.7 * t.i) / (ESTADOS_ORDEN.length - 1) }} />
        ))}
      </div>
      <p aria-hidden="true" className="text-micro text-ink-3">{texto}</p>
    </div>
  );
}

function Cifra({ etiqueta, valor, ambar = false }: { etiqueta: string; valor: number; ambar?: boolean }) {
  return (
    <div className={ambar && valor > 0 ? 'rounded-md bg-warn-l p-2.5' : 'rounded-md bg-surface-2 p-2.5'}>
      <dt className={ambar && valor > 0 ? 'text-small text-warn' : 'text-small text-ink-3'}>{etiqueta}</dt>
      <dd className={ambar && valor > 0 ? 'text-title font-semibold tabular-nums text-warn' : 'text-title font-semibold tabular-nums text-ink'}>{fmt.format(valor)}</dd>
    </div>
  );
}

function TarjetaEspecie({ especie, nombreDe, onEntrar }: { especie: PanoramaEspecie; nombreDe: Map<string, string>; onEntrar: () => void }) {
  const { esAdmin } = useAuth();
  const color = colorEspecie(especie);
  if (especie.cruces === 0) {
    return (
      <article aria-label={especie.nombre} className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong p-4">
        <h2 className="flex items-center gap-2 text-body-l font-semibold text-ink">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{especie.nombre}
        </h2>
        <p className="text-small text-ink-3">Sin cruces todavía.</p>
        {esAdmin && (
          <div className="mt-auto flex flex-wrap gap-2">
            <Link to={`/catalogos?tipo=descriptores&especie=${especie.id}`}><Button variant="outline" size="sm"><SlidersHorizontal className="h-4 w-4" /> Configurar descriptores</Button></Link>
            <Link to={`/nueva-planta?especie=${especie.id}`}><Button size="sm"><Plus className="h-4 w-4" /> Primer cruce</Button></Link>
          </div>
        )}
      </article>
    );
  }
  const quien = especie.ultima_actividad_por ? nombreDe.get(especie.ultima_actividad_por) : undefined;
  return (
    <article aria-label={especie.nombre} className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div aria-hidden="true" className="h-1.5" style={{ backgroundColor: color }} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h2 className="flex items-center gap-2 text-body-l font-semibold text-ink">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{especie.nombre}
        </h2>
        <dl className="grid grid-cols-2 gap-2">
          <Cifra etiqueta="Cruces activos" valor={especie.cruces_activos} />
          <Cifra etiqueta="Individuos vivos" valor={especie.individuos_vivos} />
          <Cifra etiqueta="Sin evaluación cerrada" valor={especie.sin_evaluacion_cerrada} ambar />
          <Cifra etiqueta="Evaluaciones cerradas" valor={especie.evaluaciones_cerradas} />
        </dl>
        <BarraFasesEspecie especie={especie} />
        <p className="text-small text-ink-3">
          Última actividad: <span className="tabular-nums text-ink-2">{formatearActividad(especie.ultima_actividad, new Date(), 'sin registro')}</span>
          {quien && <> · {quien}</>}
        </p>
        <div className="mt-auto space-y-2">
          <Button variant="outline" className="w-full justify-between" onClick={onEntrar}>
            Entrar a {especie.nombre} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          {esAdmin && (
            <Link to={`/catalogos?tipo=descriptores&especie=${especie.id}`} className="inline-flex min-h-tap items-center gap-1.5 text-small font-medium text-brand hover:underline">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Configurar descriptores
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export function Panorama({ titulo = 'Todas las especies', subtitulo }: { titulo?: string; subtitulo?: string }) {
  const { esAdmin } = useAuth();
  const { panorama, panoramaError, reintentarPanorama, cambiar } = useEspacioEspecie();
  const nombres = useNombres((panorama ?? []).map((p) => p.ultima_actividad_por));
  return (
    <div className="space-y-4">
      <EncabezadoPagina
        titulo={titulo}
        subtitulo={subtitulo ?? 'Cómo va cada especie. Entra a una para trabajar en ella.'}
        acciones={esAdmin ? <Link to="/catalogos?tipo=especies"><Button variant="outline" size="sm"><Plus className="h-4 w-4" /> Nueva especie</Button></Link> : undefined}
      />
      {panoramaError && !panorama ? <EstadoError mensaje="No se pudo cargar el panorama de las especies." onReintentar={reintentarPanorama} />
        : !panorama ? <EstadoCargando etiqueta="Cargando especies…" forma="esqueleto" />
          : panorama.length === 0 ? <EstadoVacio titulo="Todavía no hay especies." />
            : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {panorama.map((especie) => (
                  <TarjetaEspecie key={especie.id} especie={especie} nombreDe={nombres} onEntrar={() => cambiar(especie.id)} />
                ))}
              </div>
            )}
    </div>
  );
}
