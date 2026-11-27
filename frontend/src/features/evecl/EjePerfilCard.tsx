import { AlertTriangle } from 'lucide-react';
import type { EveclPerfilItem } from '@/api/evecl';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EstadoVacio } from '@/components/v3/estados';

interface EjePerfilCardProps {
  titulo: string;
  descripcion: string;
  items: EveclPerfilItem[];
  descriptores: string[];
}

interface GrupoPerfil {
  key: string;
  label: string;
  respuestas: Map<string, EveclPerfilItem>;
}

function agruparPerfil(items: EveclPerfilItem[]): GrupoPerfil[] {
  const grupos = new Map<string, GrupoPerfil>();
  for (const item of items) {
    const grupo = grupos.get(item.grupo_key) ?? {
      key: item.grupo_key,
      label: item.grupo_label,
      respuestas: new Map<string, EveclPerfilItem>(),
    };
    grupo.respuestas.set(item.descriptor, item);
    grupos.set(item.grupo_key, grupo);
  }
  return [...grupos.values()];
}

export function EjePerfilCard({ titulo, descripcion, items, descriptores }: EjePerfilCardProps) {
  const grupos = agruparPerfil(items);
  const divergencias = items.filter((item) => item.divergente);

  return (
    <Card data-testid={`perfil-${titulo.toLowerCase()}`} className="evecl-print-card overflow-hidden border-t-4 border-t-brand">
      <div className="border-b border-line px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">Perfil por moda</p>
        <h2 className="mt-1 text-lg font-semibold">{titulo}</h2>
        <p className="mt-1 text-sm text-ink-3">{descripcion}</p>
      </div>

      <div className="space-y-4 p-4">
        {grupos.length === 0 ? (
          <EstadoVacio titulo="Sin estados registrados" descripcion="Todavía no hay estados registrados para este eje." className="py-5" />
        ) : grupos.map((grupo) => (
          <section key={grupo.key} className="evecl-print-card overflow-hidden rounded-md border border-line">
            <h3 className="bg-surface-2 px-3 py-2 text-sm font-semibold">{grupo.label}</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-y border-line text-ink-3">
                    <th className="px-3 py-2 font-medium">Descriptor</th>
                    <th className="px-3 py-2 font-medium">Moda</th>
                    <th className="px-3 py-2 font-medium">Evidencia</th>
                  </tr>
                </thead>
                <tbody>
                  {descriptores.map((descriptor) => {
                    const item = grupo.respuestas.get(descriptor);
                    return (
                      <tr key={descriptor} className={`border-b border-line-soft last:border-0 ${item?.divergente ? 'bg-warn-l/60' : ''}`}>
                        <th className="px-3 py-2 font-medium">{descriptor}</th>
                        <td className="px-3 py-2">
                          {item ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{item.label_moda}</span>
                              <span className="font-mono text-[11px] text-ink-3">UPOV {item.nota_moda}</span>
                              {item.divergente ? <Badge variant="warning">Divergencia</Badge> : null}
                            </div>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-ink-3">{item ? `n=${item.n_con_dato}/${item.n_total}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {divergencias.length > 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-l px-3 py-2 text-xs text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Divergencia detectada: las plantas no coinciden en {divergencias.length} {divergencias.length === 1 ? 'combinación' : 'combinaciones'} grupo–descriptor. Revísala como señal de uniformidad varietal.
            </span>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
