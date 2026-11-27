/**
 * «Pedir corrección» (fase 5, decisión G15). En una evaluación cerrada, su autor pide una corrección con una nota obligatoria:
 * el pedido llega al Inicio del admin («Correcciones pedidas») y queda en el historial de la evaluación. Al corregir, el admin
 * lo deja resuelto (lo hace la base). El autor no edita nada: corregir sigue siendo solo del admin (A8).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pedirCorreccion, pedidosDeEvaluacion, type PedidoCorreccion } from '@/api/correcciones';
import type { EvaluacionConContexto } from '@/api/rondas';
import { useAuth } from '@/features/auth/AuthContext';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Sheet } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { formatearFechaHora } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';

export function usePedidosCorreccion(evaluacionId: string) {
  return useQuery({ queryKey: qk.evaluaciones.pedidos(evaluacionId), queryFn: () => pedidosDeEvaluacion(evaluacionId), staleTime: 30_000 });
}

const esCerrada = (e: Pick<EvaluacionConContexto, 'estado'>) => e.estado === 'completa' || e.estado === 'corregida';

/** El botón (o «Corrección pedida» si ya hay un pedido abierto). Solo para el autor que no es admin: el admin corrige directo. */
export function BotonPedirCorreccion({ evaluacion }: { evaluacion: EvaluacionConContexto }) {
  const { esAdmin, user } = useAuth();
  const [abierta, setAbierta] = useState(false);
  const esAutor = !!user?.id && evaluacion.created_by === user.id;
  const pedidos = usePedidosCorreccion(evaluacion.id);
  if (esAdmin || !esAutor || !esCerrada(evaluacion)) return null;
  if (pedidos.isPending) return null;
  if ((pedidos.data ?? []).some((p) => p.estado === 'abierto')) {
    return <span className="inline-flex min-h-tap items-center rounded-md bg-warn-l px-3 text-small font-medium text-warn">Corrección pedida</span>;
  }
  return (
    <>
      <Button variant="outline" onClick={() => setAbierta(true)}>Pedir corrección</Button>
      {abierta && <HojaPedirCorreccion evaluacion={evaluacion} onCerrar={() => setAbierta(false)} />}
    </>
  );
}

function HojaPedirCorreccion({ evaluacion, onCerrar }: { evaluacion: EvaluacionConContexto; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [nota, setNota] = useState('');
  const pedir = useMutation({
    mutationFn: () => pedirCorreccion(evaluacion.id, nota),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.evaluaciones.pedidos(evaluacion.id) });
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.pedidosAbiertos });
      onCerrar();
    },
  });
  const listo = nota.trim().length > 0;
  return (
    <Sheet
      titulo={`Pedir corrección · ${evaluacion.ronda.individuo.codigo_display}`}
      onCerrar={onCerrar}
      hayContenido={listo}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button disabled={!listo || pedir.isPending} onClick={() => pedir.mutate()}>{pedir.isPending ? 'Enviando…' : 'Enviar pedido'}</Button>
        </div>
      )}
    >
      <div className="space-y-3 text-small text-ink-2">
        <p>El pedido le llega al administrador, que es quien corrige. Tú no cambias nada de la evaluación. Cuando la corrija, el pedido queda resuelto.</p>
        <div className="space-y-1">
          <Label htmlFor="nota-pedido-correccion">¿Qué hay que corregir?</Label>
          <Textarea id="nota-pedido-correccion" rows={3} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Por ejemplo: el calibre es 18, no 81." />
        </div>
        {pedir.isError && <Alert>{pedir.error instanceof Error ? pedir.error.message : 'No se pudo enviar el pedido.'}</Alert>}
      </div>
    </Sheet>
  );
}

export function textoPedido(p: PedidoCorreccion): string {
  return `Pedida por ${p.pedido_por} el ${formatearFechaHora(p.pedido_en)} · «${p.nota}»`;
}

/** Historial de pedidos de la evaluación (el admin ve todos; los demás, los suyos). Nada si no hay. */
export function HistorialPedidosCorreccion({ evaluacionId }: { evaluacionId: string }) {
  const pedidos = usePedidosCorreccion(evaluacionId);
  if (pedidos.isPending || pedidos.isError || (pedidos.data ?? []).length === 0) return null;
  return (
    <section aria-label="Correcciones pedidas" className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-body-l font-semibold text-ink">Correcciones pedidas</h2>
      <ul className="space-y-1.5 text-small text-ink-2">
        {(pedidos.data ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
            <span>{textoPedido(p)}</span>
            {p.estado === 'abierto'
              ? <span className="rounded-full bg-warn-l px-2 py-0.5 text-warn">Pendiente</span>
              : <span className="rounded-full bg-ok-l px-2 py-0.5 text-ok">Resuelta por {p.resuelto_por} el {formatearFechaHora(p.resuelto_en as string)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
