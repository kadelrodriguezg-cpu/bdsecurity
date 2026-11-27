import { formatearFecha } from '@/lib/v3/formatos';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { EveclFichaLista } from '@/api/evecl';
import { EstadoVacio } from '@/components/v3/estados';

const claveVariedad = (variedad: string) => variedad.trim().toLowerCase();

function AnilloCompletitud({ respondidos, total }: { respondidos: number; total: number }) {
  const proporcion = total > 0 ? Math.min(1, respondidos / total) : 0;
  const radio = 16;
  const circunferencia = 2 * Math.PI * radio;
  return (
    <div className="relative grid h-12 w-12 shrink-0 place-items-center" aria-label={`${respondidos} de ${total} descriptores respondidos`}>
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r={radio} fill="none" className="stroke-line" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r={radio}
          fill="none"
          className="stroke-brand"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={circunferencia * (1 - proporcion)}
        />
      </svg>
      <span className="font-mono text-[10px] font-semibold">{respondidos}/{total}</span>
    </div>
  );
}

export function FichasLista({ fichas, codigoParcela }: { fichas: EveclFichaLista[]; codigoParcela: string }) {
  const variedades = useMemo(() => {
    const nombres = new Map<string, string>();
    fichas.forEach((ficha) => {
      const clave = claveVariedad(ficha.variedad);
      if (!nombres.has(clave)) nombres.set(clave, ficha.variedad.trim());
    });
    return [...nombres.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [fichas]);
  const [variedadActiva, setVariedadActiva] = useState<string | null>(null);
  const visibles = variedadActiva ? fichas.filter((ficha) => claveVariedad(ficha.variedad) === variedadActiva) : fichas;
  const grupos = useMemo(() => {
    const mapa = new Map<string, EveclFichaLista[]>();
    visibles.forEach((ficha) => {
      const clave = claveVariedad(ficha.variedad);
      mapa.set(clave, [...(mapa.get(clave) ?? []), ficha]);
    });
    return [...mapa.entries()];
  }, [visibles]);

  if (fichas.length === 0) return <EstadoVacio titulo="Todavía no hay fichas en este ensayo" descripcion="Crea la primera con «Nueva ficha»." />;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por variedad">
        <Button size="sm" variant={variedadActiva === null ? 'default' : 'outline'} onClick={() => setVariedadActiva(null)}>Todas</Button>
        {variedades.map(([variedad, nombre]) => (
          <Button key={variedad} size="sm" variant={variedadActiva === variedad ? 'default' : 'outline'} onClick={() => setVariedadActiva(variedad)}>
            {nombre}
          </Button>
        ))}
      </div>
      {grupos.map(([variedad, fichasGrupo]) => (
        <section key={variedad} className="space-y-2" aria-labelledby={`variedad-${encodeURIComponent(variedad)}`}>
          <div className="flex items-center gap-2">
            <h2 id={`variedad-${encodeURIComponent(variedad)}`} className="font-semibold">{fichasGrupo[0].variedad.trim()}</h2>
            <span className="font-mono text-xs text-ink-3">{fichasGrupo.length} {fichasGrupo.length === 1 ? 'planta' : 'plantas'}</span>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {fichasGrupo.map((ficha) => (
              <li key={ficha.id}>
                <Link to={`/evecl/fichas/${ficha.id}`}>
                  <Card className="flex items-center justify-between gap-3 border-t-4 border-t-brand p-3 transition-colors hover:bg-surface-2">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-sm font-semibold">{ficha.codigo_planta || '—'}</span>
                        <Badge variant={ficha.tipo === 'testigo' ? 'warning' : 'success'}>{ficha.tipo === 'testigo' ? 'Testigo' : 'Evaluación'}</Badge>
                        <Badge variant="outline" className="font-mono">{codigoParcela}</Badge>
                      </div>
                      <p className="text-xs text-ink-3">Repetición <span className="font-mono">{ficha.numero_repeticion}</span> · {formatearFecha(ficha.fecha_evaluacion)}</p>
                    </div>
                    <AnilloCompletitud respondidos={ficha.respondidos} total={ficha.total_descriptores} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {visibles.length === 0 ? <EstadoVacio titulo="No hay fichas para este filtro" /> : null}
    </div>
  );
}
