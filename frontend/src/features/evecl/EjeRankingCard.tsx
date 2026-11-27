import { AlertTriangle } from 'lucide-react';
import type { EveclRankingItem } from '@/api/evecl';
import { Card } from '@/components/ui/card';
import { EstadoVacio } from '@/components/v3/estados';

interface EjeRankingCardProps {
  titulo: string;
  descripcion: string;
  items: EveclRankingItem[];
}

const NOTA_RELATIVA = 'El puntaje es relativo al conjunto comparado, no un estándar de mercado.';

export function EjeRankingCard({ titulo, descripcion, items }: EjeRankingCardProps) {
  const gruposDebiles = items.filter((item) => item.n_con_dato < 3);

  return (
    <Card data-testid={`ranking-${titulo.toLowerCase()}`} className="evecl-print-card overflow-hidden border-t-4 border-t-brand">
      <div className="border-b border-line px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">Ranking 0–100</p>
        <h2 className="mt-1 text-lg font-semibold">{titulo}</h2>
        <p className="mt-1 text-sm text-ink-3">{descripcion}</p>
      </div>

      <div className="space-y-4 p-4">
        {items.length === 0 ? (
          <EstadoVacio titulo="No hay datos suficientes" descripcion="Todavía no hay datos suficientes para calcular este eje." className="py-5" />
        ) : (
          <ol className="space-y-4">
            {items.map((item, indice) => {
              const evidenciaDebil = item.n_con_dato < 3;
              const ancho = `${Math.max(0, Math.min(100, item.puntaje))}%`;
              return (
                <li key={item.grupo_key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className="mr-2 font-mono text-xs text-ink-3">#{indice + 1}</span>
                      <span className="font-medium">{item.grupo_label}</span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-3">
                      <span className={`font-mono text-xs ${evidenciaDebil ? 'font-semibold text-warn' : 'text-ink-3'}`}>
                        n={item.n_con_dato}/{item.n_total}
                      </span>
                      <span className="min-w-8 text-right font-mono text-base font-semibold tabular-nums">
                        {item.puntaje.toLocaleString('es-CL', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${evidenciaDebil ? 'evecl-barra-rayada' : 'bg-brand'}`}
                      style={{ width: ancho }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {gruposDebiles.length > 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-l px-3 py-2 text-xs text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Evidencia débil: {gruposDebiles.map((item) => item.grupo_label).join(', ')} tiene{gruposDebiles.length > 1 ? 'n' : ''} menos de 3 plantas con dato.
            </span>
          </p>
        ) : null}

        <p className="border-t border-line pt-3 text-xs text-ink-3">{NOTA_RELATIVA}</p>
      </div>
    </Card>
  );
}
