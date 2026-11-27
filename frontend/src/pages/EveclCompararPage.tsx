import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import {
  compararEvecl,
  descriptoresPorEje,
  listarEnsayosEvecl,
  listarFichasEvecl,
  obtenerCatalogoEvecl,
  type EveclComparacionFiltros,
  type EveclConjuntoComparacion,
  type EveclModoComparacion,
} from '@/api/evecl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EjePerfilCard } from '@/features/evecl/EjePerfilCard';
import { EjeRankingCard } from '@/features/evecl/EjeRankingCard';
import { EveclEncabezado } from '@/features/evecl/EveclEncabezado';
import { ExportCsvComparacion } from '@/features/evecl/ExportCsvComparacion';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

const CONJUNTOS: Array<{ valor: EveclConjuntoComparacion; label: string; ayuda: string }> = [
  { valor: 'todos', label: 'Todos', ayuda: 'Todas las fichas activas.' },
  { valor: 'solo_evaluacion', label: 'Solo evaluación', ayuda: 'Excluye fichas testigo.' },
  { valor: 'evaluacion_vs_testigo', label: 'Evaluación vs. testigo', ayuda: 'Separa cada variedad por tipo.' },
];

export function EveclCompararPage() {
  const [modo, setModo] = useState<EveclModoComparacion>('entre_grupos');
  const [conjunto, setConjunto] = useState<EveclConjuntoComparacion>('todos');
  const [ensayoId, setEnsayoId] = useState<number | undefined>();
  const [variedad, setVariedad] = useState('');
  const [vistaPreviaImpresion, setVistaPreviaImpresion] = useState(false);

  const ensayos = useQuery({ queryKey: qk.evecl.ensayos, queryFn: listarEnsayosEvecl });
  const fichas = useQuery({
    queryKey: qk.evecl.fichas(ensayoId ?? 0),
    queryFn: () => listarFichasEvecl(ensayoId!),
    enabled: modo === 'entre_fichas' && ensayoId != null,
  });
  const catalogo = useQuery({ queryKey: qk.evecl.catalogo, queryFn: obtenerCatalogoEvecl });
  const variedades = useMemo(
    () => [...new Set((fichas.data ?? []).map((ficha) => ficha.variedad))].sort((a, b) => a.localeCompare(b, 'es')),
    [fichas.data],
  );
  const filtros = useMemo<EveclComparacionFiltros>(() => ({ modo, conjunto, ensayoId, variedad }), [modo, conjunto, ensayoId, variedad]);
  const listo = modo === 'entre_grupos' || (ensayoId != null && variedad.length > 0);
  const comparacion = useQuery({
    queryKey: qk.evecl.comparacion(filtros),
    queryFn: () => compararEvecl(filtros),
    enabled: listo,
  });

  const descriptoresFenologia = descriptoresPorEje(catalogo.data ?? [], 'fenologia').map((descriptor) => descriptor.nombre);
  const descriptoresAdaptabilidad = descriptoresPorEje(catalogo.data ?? [], 'adaptabilidad').map((descriptor) => descriptor.nombre);
  const dato = comparacion.data;

  return (
    <div className={cn('evecl-print-root space-y-5', vistaPreviaImpresion && 'evecl-print-preview')}>
      {vistaPreviaImpresion ? (
        <div data-print-preview-toolbar className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setVistaPreviaImpresion(false)}>
            <X className="h-4 w-4" /> Cerrar vista previa
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
        </div>
      ) : null}

      <EveclEncabezado
        titulo="Comparación EVECL"
        descripcion="Ranking relativo y perfiles varietales de las fichas comparadas."
        acciones={(
          <Button data-print-control variant="outline" disabled={!dato} onClick={() => setVistaPreviaImpresion(true)}>
            <Printer className="h-4 w-4" /> Vista previa e impresión
          </Button>
        )}
      />

      <Card data-print-control className="space-y-4 border-t-4 border-t-brand p-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Modo de comparación</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ['entre_fichas', 'Entre fichas', 'Uniformidad de una variedad dentro de un ensayo.'],
              ['entre_grupos', 'Entre grupos', 'Variedad × ensayo, conservando el efecto de sitio.'],
            ] as const).map(([valor, label, ayuda]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={modo === valor}
                onClick={() => setModo(valor)}
                className={cn(
                  'min-h-tap rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  modo === valor ? 'border-brand-d bg-brand-l text-brand-ink' : 'border-line bg-surface hover:bg-surface-2',
                )}
              >
                <span className="block font-semibold">{label}</span>
                <span className="mt-0.5 block text-xs opacity-80">{ayuda}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {modo === 'entre_fichas' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Ensayo</span>
              <Select
                value={ensayoId ?? ''}
                onChange={(evento) => {
                  setEnsayoId(evento.target.value ? Number(evento.target.value) : undefined);
                  setVariedad('');
                }}
              >
                <option value="">Selecciona un ensayo</option>
                {ensayos.data?.map((ensayo) => <option key={ensayo.id} value={ensayo.id}>{ensayo.codigo_parcela}</option>)}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Variedad</span>
              <Select value={variedad} onChange={(evento) => setVariedad(evento.target.value)} disabled={ensayoId == null || fichas.isLoading}>
                <option value="">Selecciona una variedad</option>
                {variedades.map((nombre) => <option key={nombre} value={nombre}>{nombre}</option>)}
              </Select>
            </label>
          </div>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Conjunto</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {CONJUNTOS.map((opcion) => (
                <button
                  key={opcion.valor}
                  type="button"
                  aria-pressed={conjunto === opcion.valor}
                  onClick={() => setConjunto(opcion.valor)}
                  className={cn(
                    'min-h-tap rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    conjunto === opcion.valor ? 'border-brand-d bg-brand-l text-brand-ink' : 'border-line bg-surface hover:bg-surface-2',
                  )}
                >
                  <span className="block font-semibold">{opcion.label}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{opcion.ayuda}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}
      </Card>

      {!listo ? <EstadoVacio titulo="Selecciona ensayo y variedad" descripcion="Elige un ensayo y una variedad para comparar sus fichas." /> : null}
      {comparacion.isLoading ? <EstadoCargando etiqueta="Calculando la comparación…" forma="esqueleto" /> : null}
      {comparacion.isError ? <EstadoError titulo="No se pudo calcular la comparación" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void comparacion.refetch()} /> : null}
      {catalogo.isError ? <EstadoError titulo="No se pudieron cargar los descriptores" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void catalogo.refetch()} /> : null}
      {modo === 'entre_fichas' && ensayos.isError ? <EstadoError titulo="No se pudieron cargar los ensayos" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void ensayos.refetch()} /> : null}

      {dato ? (
        <>
          <div className="evecl-print-grid grid items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            <EjeRankingCard titulo="Calidad" descripcion="Firmeza, dulzor, ratio °Brix/Acidez, cicatriz peduncular y tamaño del fruto." items={dato.ranking_calidad} />
            <EjeRankingCard titulo="Productividad" descripcion="Rendimiento, días de postcosecha y densidad de infrutescencia." items={dato.ranking_productividad} />
            {/*
              Un eje sin ningún descriptor activo en el catálogo no se
              renderiza — ni vacío, ni con mensaje "sin datos". La condición
              es genérica (cuenta descriptores reales del catálogo, no
              hardcodea qué eje ocultar): si en el futuro se agregan
              descriptores a adaptabilidad, la tarjeta reaparece sola.
            */}
            {descriptoresFenologia.length > 0 ? (
              <EjePerfilCard titulo="Fenología" descripcion="Moda observada por grupo; no expresa mejor o peor desempeño." items={dato.perfil_fenologia} descriptores={descriptoresFenologia} />
            ) : null}
            {descriptoresAdaptabilidad.length > 0 ? (
              <EjePerfilCard titulo="Adaptabilidad" descripcion="Moda observada por grupo con divergencia visible entre plantas." items={dato.perfil_adaptabilidad} descriptores={descriptoresAdaptabilidad} />
            ) : null}
          </div>
          <ExportCsvComparacion key={`${modo}-${ensayoId ?? 'todos'}-${variedad}-${conjunto}`} comparacion={dato} />
        </>
      ) : null}
    </div>
  );
}
