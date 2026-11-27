/**
 * Iniciar la ronda N a todos los vivos que no la tienen (Sprint 1.1, solo
 * admin). Usa la RPC de siempre, iniciar_ronda_esperada, individuo por
 * individuo y con un máximo de 5 a la vez. Es seguro repetirlo: antes de
 * empezar se vuelve a leer la planilla y solo se tocan los que siguen sin
 * ronda; además la RPC devuelve la ronda existente en vez de crear otra.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { iniciarRonda, iniciarRondaMultisitio, type TipoRonda } from '@/api/rondas';
import { obtenerPlanillaRonda, type FilaPlanilla, type PlanillaRonda } from '@/api/protocolo';
import { qk } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { ejecutarEnLote } from './lote';

const corto = (f: Pick<FilaPlanilla, 'codigo_display'>) => f.codigo_display.split('-').pop() ?? f.codigo_display;

/**
 * La base rechaza abrir la ronda N+1 si la ronda N del individuo no tiene una
 * evaluación completa o corregida (55000, «La ronda N todavía no tiene una
 * evaluación completa…»). No es un fallo: ese individuo simplemente todavía no
 * toca, y el mensaje de la base ya dice por qué.
 */
export function esRondaAnteriorSinCerrar(error: unknown): boolean {
  const e = error as { message?: string; code?: string } | null;
  return e?.code === '55000' && /todavía no tiene una evaluación completa/i.test(e.message ?? '');
}

/** Motivo legible de un fallo; el 55000 de la RPC es «la ronda anterior sigue abierta» (se muestra el mensaje de la base) o «ya cambió». */
export function motivoFallo(error: unknown): string {
  const e = error as { message?: string; code?: string } | null;
  const mensaje = e?.message?.trim() || 'Error desconocido';
  if (esRondaAnteriorSinCerrar(error)) return mensaje;
  if (e?.code === '55000' || /rondas cambiaron/i.test(mensaje)) return 'Sus rondas no coinciden con la del cruce (le falta una anterior o cambió recién).';
  return mensaje;
}

/** Lo mismo que refresca el expediente al iniciar una ronda, más la planilla, el ranking y la actividad. */
export function invalidarTrasIniciar(queryClient: ReturnType<typeof useQueryClient>, plantaId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.protocolo.all }),
    queryClient.invalidateQueries({ queryKey: ['rondas'] }),
    queryClient.invalidateQueries({ queryKey: ['individuos', plantaId] }),
    queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) }),
    queryClient.invalidateQueries({ queryKey: qk.actividad.planta(plantaId) }),
    queryClient.invalidateQueries({ queryKey: qk.ranking.all }),
    queryClient.invalidateQueries({ queryKey: qk.temporadas() }),
  ]);
}

interface Resumen {
  iniciadas: number;
  yaTenian: number;
  /** Su ronda anterior sigue abierta: no se les inició y no cuentan como fallo. */
  omitidas: { fila: FilaPlanilla; motivo: string }[];
  fallidas: { fila: FilaPlanilla; motivo: string }[];
}

type Fase = { tipo: 'inicio' } | { tipo: 'confirmar'; objetivo: FilaPlanilla[]; yaTenian: number; fuera: number } | { tipo: 'corriendo'; hechos: number; total: number } | { tipo: 'fin'; resumen: Resumen };

export function IniciarRondaLote({ plantaId, planilla, tipo = 'anual', elegible, onDefinirProtocolo }: {
  plantaId: string;
  planilla: PlanillaRonda;
  /** Serie de la ronda; la multisitio lleva su propio contador. */
  tipo?: TipoRonda;
  /**
   * Quién entra al lote. Multisitio: solo los que ya tienen predio (una ronda no se anula, así que no se abre
   * para quien todavía no fue trasladado). Sin esta función entran todos los vivos sin ronda.
   */
  elegible?: (fila: FilaPlanilla) => boolean;
  /** Sin esta función no se avisa de la falta de protocolo ni se ofrece definirlo (solo la serie anual tiene editor). */
  onDefinirProtocolo?: () => void;
}) {
  const queryClient = useQueryClient();
  const numero = planilla.numero_ronda ?? 1;
  const nombreRonda = tipo === 'multisitio' ? `ronda multisitio ${numero}` : `ronda ${numero}`;
  const sinRonda = planilla.individuos.filter((f) => f.estado === 'sin_ronda' && (elegible?.(f) ?? true));
  const [fase, setFase] = useState<Fase>({ tipo: 'inicio' });

  const preparar = async (soloEstos?: FilaPlanilla[]) => {
    // Lectura fresca: lo que otra persona haya iniciado mientras tanto no se toca.
    const fresca = await queryClient.fetchQuery({ queryKey: qk.protocolo.planilla(plantaId, undefined, tipo), queryFn: () => obtenerPlanillaRonda(plantaId, undefined, tipo), staleTime: 0 });
    const sinRondaFresca = fresca.individuos.filter((f) => f.estado === 'sin_ronda');
    const vigentes = new Set(sinRondaFresca.map((f) => f.individuo_id));
    const elegibles = sinRondaFresca.filter((f) => elegible?.(f) ?? true);
    const base = soloEstos ?? elegibles;
    const objetivo = base.filter((f) => vigentes.has(f.individuo_id));
    // Todo el cruce: los vivos que ya tienen la ronda. Al reintentar: los fallidos que entretanto la obtuvieron.
    const yaTenian = soloEstos ? base.length - objetivo.length : fresca.individuos.length - vigentes.size;
    setFase({ tipo: 'confirmar', objetivo, yaTenian, fuera: sinRondaFresca.length - elegibles.length });
  };

  const ejecutar = async (objetivo: FilaPlanilla[], yaTenian: number) => {
    setFase({ tipo: 'corriendo', hechos: 0, total: objetivo.length });
    const resultado = await ejecutarEnLote(objetivo, (f) => (tipo === 'multisitio' ? iniciarRondaMultisitio : iniciarRonda)(f.individuo_id, numero), {
      concurrencia: 5,
      onAvance: (hechos, total) => setFase({ tipo: 'corriendo', hechos, total }),
    });
    await invalidarTrasIniciar(queryClient, plantaId);
    setFase({
      tipo: 'fin',
      resumen: {
        iniciadas: resultado.hechos.length,
        yaTenian,
        omitidas: resultado.fallidos.filter(({ error }) => esRondaAnteriorSinCerrar(error)).map(({ item, error }) => ({ fila: item, motivo: motivoFallo(error) })),
        fallidas: resultado.fallidos.filter(({ error }) => !esRondaAnteriorSinCerrar(error)).map(({ item, error }) => ({ fila: item, motivo: motivoFallo(error) })),
      },
    });
  };

  if (fase.tipo === 'inicio') {
    if (sinRonda.length === 0) return null;
    return (
      <Button variant="outline" onClick={() => void preparar()}>
        <Play className="h-4 w-4" aria-hidden="true" /> Iniciar {nombreRonda} para los {sinRonda.length} individuos vivos sin ronda
      </Button>
    );
  }

  if (fase.tipo === 'confirmar') {
    const { objetivo, yaTenian, fuera } = fase;
    return (
      <section aria-label="Confirmar inicio de ronda" className="space-y-3 rounded-lg border border-brand bg-brand-l p-4 text-small text-ink">
        {objetivo.length === 0 ? (
          <p>Ya no quedan vivos sin la {nombreRonda}: alguien la inició mientras tanto.</p>
        ) : (
          <p>
            Se iniciará la <span className="font-semibold">{nombreRonda}</span> para <span className="font-semibold">{objetivo.length} individuos vivos</span>, de a 5 a la vez.
            {yaTenian > 0 && ` Los ${yaTenian} que ya la tienen no se tocan.`} Nada se evalúa: quedan «Pendiente».
          </p>
        )}
        {fuera > 0 && objetivo.length > 0 && (
          <p className="text-ink-2">
            {fuera === 1 ? 'Queda fuera 1 individuo' : `Quedan fuera ${fuera} individuos`} sin predio: registra primero su traslado en Individuos.
          </p>
        )}
        {!planilla.protocolo && onDefinirProtocolo && objetivo.length > 0 && (
          <p className="flex gap-2 rounded-md bg-warn-l p-3 text-warn">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              La ronda {numero} todavía no tiene protocolo. Conviene definirlo antes: cada evaluación queda con el protocolo vigente al crearse,
              no al iniciar la ronda, así que también puedes definirlo después de iniciar.
            </span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {objetivo.length > 0 && (
            <Button onClick={() => void ejecutar(objetivo, yaTenian)}>
              Iniciar {nombreRonda} para {objetivo.length}
            </Button>
          )}
          {!planilla.protocolo && onDefinirProtocolo && objetivo.length > 0 && (
            <Button variant="outline" onClick={() => { setFase({ tipo: 'inicio' }); onDefinirProtocolo(); }}>Definir protocolo primero</Button>
          )}
          <Button variant="ghost" onClick={() => setFase({ tipo: 'inicio' })}>Cancelar</Button>
        </div>
      </section>
    );
  }

  if (fase.tipo === 'corriendo') {
    return (
      <section aria-label="Iniciando rondas" className="space-y-2 rounded-lg border border-line bg-surface p-4 text-small">
        <p className="tabular-nums text-ink">Iniciando {nombreRonda}: {fase.hechos} de {fase.total}…</p>
        <div className="h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-label="Avance del inicio de ronda" aria-valuemin={0} aria-valuemax={fase.total} aria-valuenow={fase.hechos}>
          <div className="h-full rounded-full bg-brand transition-[width] motion-reduce:transition-none" style={{ width: `${fase.total ? (fase.hechos / fase.total) * 100 : 0}%` }} />
        </div>
        <p className="text-ink-3">No cierres esta pestaña hasta que termine.</p>
      </section>
    );
  }

  const { resumen } = fase;
  return (
    <section aria-label="Resultado del inicio de ronda" className="space-y-2 rounded-lg border border-line bg-surface p-4 text-small">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
        <span className="flex items-center gap-1.5 text-ok"><CircleCheck className="h-4 w-4" aria-hidden="true" /> {resumen.iniciadas} iniciadas</span>
        <span className="text-ink-2">{resumen.yaTenian} ya la tenían</span>
        <span className={resumen.omitidas.length > 0 ? 'text-warn' : 'text-ink-3'}>{resumen.omitidas.length} omitidas</span>
        <span className={resumen.fallidas.length > 0 ? 'text-danger' : 'text-ink-3'}>{resumen.fallidas.length} fallidas</span>
      </p>
      {resumen.omitidas.length > 0 && (
        <ul aria-label="Omitidas" className="max-h-40 space-y-0.5 overflow-y-auto text-warn">
          {resumen.omitidas.map(({ fila, motivo }) => (
            <li key={fila.individuo_id}><span className="font-mono">{corto(fila)}</span>: {motivo}</li>
          ))}
        </ul>
      )}
      {resumen.fallidas.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-danger">
          {resumen.fallidas.map(({ fila, motivo }) => (
            <li key={fila.individuo_id}><span className="font-mono">{corto(fila)}</span>: {motivo}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {resumen.fallidas.length > 0 && (
          <Button variant="outline" onClick={() => void preparar(resumen.fallidas.map((f) => f.fila))}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reintentar fallidas
          </Button>
        )}
        <Button variant="ghost" onClick={() => setFase({ tipo: 'inicio' })}>Cerrar</Button>
      </div>
    </section>
  );
}
