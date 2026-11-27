import { useManualTabs } from '@/components/ui/useManualTabs';
/**
 * Administración de catálogos (especie, descriptores, contenedor, insumo, predio, sustrato) — solo admin,
 * protegida por AdminRoute + RLS (mismo patrón que UsuariosPage.tsx).
 * Arrancan vacíos: esta pantalla es donde se cargan desde cero.
 * No hay borrado físico: "activo" es la única baja posible.
 */
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { PrediosCatalogo } from '@/features/catalogos/predios/PrediosCatalogo';
import { EspeciesCatalogo } from '@/features/catalogos/EspeciesCatalogo';
import { DescriptoresEspecieCatalogo } from '@/features/catalogos/DescriptoresEspecieCatalogo';
import { ContenedoresCatalogo } from '@/features/catalogos/ContenedoresCatalogo';
import { InsumosCatalogo, SustratosCatalogo } from '@/features/catalogos/InsumosSustratosCatalogo';
import { EncabezadoPagina } from '@/components/v3/estados';

const PESTANAS = [
  ['especies', 'Especies'],
  // Fase 4: qué descriptores usa cada especie («Configurar descriptores»).
  ['descriptores', 'Descriptores'],
  ['contenedores', 'Contenedores'],
  ['insumos', 'Insumos'],
  ['predios', 'Predios'],
  ['sustratos', 'Sustratos'],
] as const;
type PestanaCatalogo = (typeof PESTANAS)[number][0];

export function CatalogosPage() {
  // v3 paso 6: la pestaña vive en la URL (?tipo=especies…) para poder enlazarla (p. ej. /nueva-especie redirige aquí).
  const [parametros, setParametros] = useSearchParams();
  const tipo = parametros.get('tipo');
  const pestana: PestanaCatalogo = PESTANAS.some(([id]) => id === tipo) ? tipo as PestanaCatalogo : 'especies';
  const setPestana = (siguiente: PestanaCatalogo) => setParametros(siguiente === 'especies' ? {} : { tipo: siguiente }, { replace: true });
  const subtitulo = pestana === 'descriptores'
    ? 'Qué descriptores usa cada especie y cómo se llaman sus niveles.'
    : 'Especies, y los contenedores, insumos, predios y sustratos que usan los formularios de Siembra y Ensayos multisitio.';
  const tabs = useManualTabs(PESTANAS.map(([id]) => id), pestana, setPestana);

  return (
    <div className="space-y-4">
      <EncabezadoPagina titulo="Catálogos" subtitulo={subtitulo} />
      <div className="flex gap-1 overflow-x-auto rounded-md border border-line bg-surface-2 p-1" role="tablist" aria-label="Tipos de catálogo">
        {PESTANAS.map(([id, etiqueta]) => (
          <Button
            key={id}
            {...tabs.tabProps(id)}
            variant={pestana === id ? 'default' : 'ghost'}
            size="sm"
            className="shrink-0"
          >
            {etiqueta}
          </Button>
        ))}
      </div>
      <div {...tabs.panelProps('especies')} className={pestana === 'especies' ? '' : 'hidden'}>
        <EspeciesCatalogo />
      </div>
      <div {...tabs.panelProps('descriptores')} className={pestana === 'descriptores' ? '' : 'hidden'}>
        {pestana === 'descriptores' && <DescriptoresEspecieCatalogo />}
      </div>
      <div {...tabs.panelProps('contenedores')} className={pestana === 'contenedores' ? '' : 'hidden'}>
        <ContenedoresCatalogo />
      </div>
      <div {...tabs.panelProps('insumos')} className={pestana === 'insumos' ? '' : 'hidden'}>
        <InsumosCatalogo />
      </div>
      <div {...tabs.panelProps('predios')} className={pestana === 'predios' ? '' : 'hidden'}>
        <PrediosCatalogo />
      </div>
      <div {...tabs.panelProps('sustratos')} className={pestana === 'sustratos' ? '' : 'hidden'}>
        <SustratosCatalogo />
      </div>
    </div>
  );
}
