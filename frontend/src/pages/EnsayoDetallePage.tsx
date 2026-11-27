import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Edit3, MapPin, Plus } from 'lucide-react';
import {
  guardarEnsayoEvecl,
  listarFichasEvecl,
  obtenerCatalogoEvecl,
  obtenerEnsayoEvecl,
  type EveclEnsayoEntrada,
} from '@/api/evecl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { EnsayoForm } from '@/features/evecl/EnsayoForm';
import { EveclEncabezado } from '@/features/evecl/EveclEncabezado';
import { FichaForm } from '@/features/evecl/FichaForm';
import { FichasLista } from '@/features/evecl/FichasLista';
import { EstadoCargando, EstadoError } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';

export function EnsayoDetallePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = Number(useParams().id);
  const valido = Number.isSafeInteger(id) && id > 0;
  const [creandoFicha, setCreandoFicha] = useState(false);
  const [editandoEnsayo, setEditandoEnsayo] = useState(false);
  const [tocado, setTocado] = useState(false);
  const cerrarEdicionEnsayo = () => {
    setTocado(false);
    setEditandoEnsayo(false);
  };
  const cerrarNuevaFicha = () => {
    setTocado(false);
    setCreandoFicha(false);
  };
  const ensayo = useQuery({ queryKey: qk.evecl.ensayo(id), queryFn: () => obtenerEnsayoEvecl(id), enabled: valido });
  const fichas = useQuery({ queryKey: qk.evecl.fichas(id), queryFn: () => listarFichasEvecl(id), enabled: valido });
  const catalogo = useQuery({ queryKey: qk.evecl.catalogo, queryFn: obtenerCatalogoEvecl, enabled: creandoFicha });
  const guardarEnsayo = useMutation({
    mutationFn: (entrada: EveclEnsayoEntrada) => guardarEnsayoEvecl(entrada),
    onSuccess: (ensayoId) => {
      // Editar ubicación o metadatos afecta tanto esta ficha de ensayo como
      // la tarjeta agregada de la lista general.
      void queryClient.invalidateQueries({ queryKey: qk.evecl.ensayo(ensayoId) });
      void queryClient.invalidateQueries({ queryKey: qk.evecl.ensayos });
      // codigo_parcela/localidad alimentan grupo_label en evecl_comparar;
      // editar el ensayo debe refrescar también cualquier comparación E4.
      void queryClient.invalidateQueries({ queryKey: qk.evecl.comparaciones });
      cerrarEdicionEnsayo();
    },
  });

  if (!valido) return <EstadoError titulo="Ensayo no válido" mensaje="El enlace no corresponde a un ensayo EVECL." />;
  if (ensayo.isLoading || fichas.isLoading) return <EstadoCargando etiqueta="Cargando ensayo…" forma="esqueleto" />;
  if (ensayo.isError) return <EstadoError titulo="No se pudo cargar el ensayo" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void ensayo.refetch()} />;
  if (fichas.isError) return <EstadoError titulo="No se pudieron cargar las fichas del ensayo" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void fichas.refetch()} />;
  const dato = ensayo.data;
  if (!dato) return null;

  return (
    <div className="space-y-5">
      <EveclEncabezado
        titulo={`Ensayo ${dato.codigo_parcela}`}
        descripcion="Fichas UPOV agrupadas por variedad y repetición."
        acciones={<Button onClick={() => { setTocado(false); setCreandoFicha(true); }}><Plus className="h-4 w-4" /> Nueva ficha</Button>}
      />
      <Card className="border-t-4 border-t-brand p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-x-8 gap-y-2 break-words text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="block text-xs text-ink-3">Productor</span>{dato.nombre_productor || '—'}</div>
            <div><span className="block text-xs text-ink-3">Empresa</span>{dato.empresa || '—'}</div>
            <div><span className="block text-xs text-ink-3">Localidad</span>{dato.localidad || '—'}</div>
            <div><span className="block text-xs text-ink-3">Área evaluada</span>{dato.area_evaluada || '—'}</div>
            <div className="sm:col-span-2"><span className="block text-xs text-ink-3">Dirección</span>{dato.direccion || '—'}</div>
            <div>
              <span className="block text-xs text-ink-3">Geolocalización</span>
              {dato.latitud != null && dato.longitud != null
                ? <span className="flex items-center gap-1 font-mono"><MapPin className="h-3.5 w-3.5 text-brand" />{dato.latitud.toFixed(6)}, {dato.longitud.toFixed(6)}</span>
                : '—'}
            </div>
            <div><span className="block text-xs text-ink-3">Resumen</span><Badge variant="success">{dato.total_fichas} fichas · {dato.total_variedades} variedades</Badge></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setTocado(false); setEditandoEnsayo(true); }}><Edit3 className="h-4 w-4" /> Editar ensayo</Button>
        </div>
      </Card>
      <h2 className="text-lg font-semibold">Fichas del ensayo</h2>
      <FichasLista fichas={fichas.data ?? []} codigoParcela={dato.codigo_parcela} />

      {editandoEnsayo ? (
        <Sheet titulo="Editar ensayo EVECL" subtitulo={dato.codigo_parcela} size="ancho" hayContenido={tocado} onCerrar={cerrarEdicionEnsayo}>
          <EnsayoForm
            ensayo={dato}
            guardando={guardarEnsayo.isPending}
            error={guardarEnsayo.error instanceof Error ? guardarEnsayo.error.message : null}
            alGuardar={(entrada) => guardarEnsayo.mutate(entrada)}
            alCancelar={cerrarEdicionEnsayo}
            alTocadoChange={setTocado}
          />
        </Sheet>
      ) : null}

      {creandoFicha ? (
        <Sheet titulo="Nueva ficha EVECL" subtitulo={dato.codigo_parcela} size="evaluacion" hayContenido={tocado} onCerrar={cerrarNuevaFicha}>
          {catalogo.isLoading ? <EstadoCargando etiqueta="Cargando descriptores…" forma="esqueleto" /> : null}
          {catalogo.isError ? <EstadoError titulo="No se pudieron cargar los descriptores" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void catalogo.refetch()} /> : null}
          {catalogo.data ? (
            <FichaForm
              ensayoId={id}
              catalogo={catalogo.data}
              alTocadoChange={setTocado}
              alCancelar={cerrarNuevaFicha}
              alGuardado={(fichaId) => {
                cerrarNuevaFicha();
                navigate(`/evecl/fichas/${fichaId}`);
              }}
            />
          ) : null}
        </Sheet>
      ) : null}
    </div>
  );
}
