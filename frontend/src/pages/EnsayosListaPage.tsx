import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { MapPin, MapPinOff, Plus, Sprout } from 'lucide-react';
import { guardarEnsayoEvecl, listarEnsayosEvecl, type EveclEnsayoEntrada } from '@/api/evecl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { EnsayoForm } from '@/features/evecl/EnsayoForm';
import { EveclEncabezado } from '@/features/evecl/EveclEncabezado';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';

export function EnsayosListaPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [tocado, setTocado] = useState(false);
  const cerrarFormulario = () => {
    setTocado(false);
    setCreando(false);
  };
  const ensayos = useQuery({ queryKey: qk.evecl.ensayos, queryFn: listarEnsayosEvecl });
  const guardar = useMutation({
    mutationFn: (entrada: EveclEnsayoEntrada) => guardarEnsayoEvecl(entrada),
    onSuccess: (ensayoId) => {
      void queryClient.invalidateQueries({ queryKey: qk.evecl.ensayos });
      void queryClient.invalidateQueries({ queryKey: qk.evecl.ensayo(ensayoId) });
      cerrarFormulario();
      navigate(`/evecl/ensayos/${ensayoId}`);
    },
  });

  return (
    <div className="space-y-5">
      <EveclEncabezado
        titulo="Evaluación varietal externa"
        descripcion="Ensayos de variedades foráneas en predios y condiciones locales."
        acciones={<Button onClick={() => { setTocado(false); setCreando(true); }}><Plus className="h-4 w-4" /> Nuevo ensayo</Button>}
      />
      {ensayos.isLoading ? <EstadoCargando etiqueta="Cargando ensayos…" forma="esqueleto" /> : null}
      {ensayos.isError ? <EstadoError titulo="No se pudieron cargar los ensayos" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void ensayos.refetch()} /> : null}
      {ensayos.data?.length === 0 ? <EstadoVacio titulo="Todavía no hay ensayos EVECL" descripcion="Crea el primero con «Nuevo ensayo»." /> : null}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ensayos.data?.map((ensayo) => (
          <li key={ensayo.id}>
            <button type="button" className="h-full w-full text-left" onClick={() => navigate(`/evecl/ensayos/${ensayo.id}`)}>
              <Card className="h-full space-y-3 border-t-4 border-t-brand p-4 transition-colors hover:bg-surface-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 break-words">
                    <span className="font-mono text-lg font-semibold text-brand-ink">{ensayo.codigo_parcela}</span>
                    <p className="mt-0.5 text-sm text-ink-2">{ensayo.nombre_productor || ensayo.empresa || 'Productor sin informar'}</p>
                  </div>
                  {ensayo.latitud != null && ensayo.longitud != null
                    ? <MapPin className="h-5 w-5 text-brand" aria-label="Con geolocalización" />
                    : <MapPinOff className="h-5 w-5 text-ink-3" aria-label="Sin geolocalización" />}
                </div>
                <p className="text-sm text-ink-3">{ensayo.localidad || 'Localidad sin informar'}</p>
                <div className="flex gap-4 border-t border-line pt-3 text-xs text-ink-3">
                  <span className="flex items-center gap-1"><Sprout className="h-4 w-4" /><strong className="font-mono text-ink">{ensayo.total_fichas}</strong> fichas</span>
                  <span><strong className="font-mono text-ink">{ensayo.total_variedades}</strong> variedades</span>
                </div>
              </Card>
            </button>
          </li>
        ))}
      </ul>
      {creando ? (
        <Sheet titulo="Nuevo ensayo EVECL" subtitulo="Material externo" size="ancho" hayContenido={tocado} onCerrar={cerrarFormulario}>
          <EnsayoForm
            guardando={guardar.isPending}
            error={guardar.error instanceof Error ? guardar.error.message : null}
            alGuardar={(entrada) => guardar.mutate(entrada)}
            alCancelar={cerrarFormulario}
            alTocadoChange={setTocado}
          />
        </Sheet>
      ) : null}
    </div>
  );
}
