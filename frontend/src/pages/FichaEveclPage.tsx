import { formatearFecha } from '@/lib/v3/formatos';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Edit3 } from 'lucide-react';
import { obtenerCatalogoEvecl, obtenerFichaEvecl } from '@/api/evecl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EveclEncabezado } from '@/features/evecl/EveclEncabezado';
import { FotoPrivada } from '@/features/evecl/FotoPrivada';
import { EstadoCargando, EstadoError } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';

const EJES = [
  ['fenologia', 'Fenología'],
  ['adaptabilidad', 'Adaptabilidad'],
  ['calidad', 'Calidad'],
  ['productividad', 'Productividad'],
] as const;

export function FichaEveclPage() {
  const id = Number(useParams().id);
  const valido = Number.isSafeInteger(id) && id > 0;
  const ficha = useQuery({ queryKey: qk.evecl.ficha(id), queryFn: () => obtenerFichaEvecl(id), enabled: valido });
  const catalogo = useQuery({ queryKey: qk.evecl.catalogo, queryFn: obtenerCatalogoEvecl, enabled: valido });
  const respuestaPorDescriptor = useMemo(() => new Map((ficha.data?.respuestas ?? []).map((respuesta) => [respuesta.descriptor_id, respuesta])), [ficha.data?.respuestas]);

  if (!valido) return <EstadoError titulo="Ficha no válida" mensaje="El enlace no corresponde a una ficha EVECL." />;
  if (ficha.isLoading || catalogo.isLoading) return <EstadoCargando etiqueta="Cargando ficha…" forma="esqueleto" />;
  if (ficha.isError) return <EstadoError titulo="No se pudo cargar la ficha" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void ficha.refetch()} />;
  if (catalogo.isError) return <EstadoError titulo="No se pudieron cargar los descriptores" mensaje="Revisa tu conexión e inténtalo de nuevo." onReintentar={() => void catalogo.refetch()} />;
  const dato = ficha.data;
  if (!dato || !catalogo.data) return null;

  return (
    <div className="space-y-5">
      <EveclEncabezado
        titulo={dato.variedad}
        descripcion={`Ficha EVECL · parcela ${dato.ensayo.codigo_parcela}`}
        acciones={<Link to={`/evecl/fichas/${dato.id}/editar`}><Button><Edit3 className="h-4 w-4" /> Editar ficha</Button></Link>}
      />
      <Card className="grid gap-3 break-words border-t-4 border-t-brand p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><span className="block text-xs text-ink-3">Código de planta</span><span className="font-mono">{dato.codigo_planta || '—'}</span></div>
        <div><span className="block text-xs text-ink-3">Repetición</span><span className="font-mono">{dato.numero_repeticion}</span></div>
        <div><span className="block text-xs text-ink-3">Tipo</span><Badge variant={dato.tipo === 'testigo' ? 'warning' : 'success'}>{dato.tipo === 'testigo' ? 'Testigo' : 'Evaluación'}</Badge></div>
        <div><span className="block text-xs text-ink-3">Fecha de evaluación</span><span className="font-mono">{formatearFecha(dato.fecha_evaluacion)}</span></div>
        <div><span className="block text-xs text-ink-3">Código de genotipo</span><span className="font-mono">{dato.codigo_genotipo || '—'}</span></div>
        <div><span className="block text-xs text-ink-3">Origen de cruza</span>{dato.origen_cruza || '—'}</div>
        <div><span className="block text-xs text-ink-3">Encargado</span>{dato.encargado || '—'}</div>
        <div><span className="block text-xs text-ink-3">Fecha de siembra</span><span className="font-mono">{dato.fecha_siembra ? formatearFecha(dato.fecha_siembra) : '—'}</span></div>
        <div className="sm:col-span-2 lg:col-span-4"><span className="block text-xs text-ink-3">Notas</span>{dato.notas || '—'}</div>
      </Card>
      {EJES.map(([eje, label]) => (
        <section key={eje} className="space-y-3">
          <h2 className="border-b border-brand-c pb-2 font-semibold text-brand-ink">{label}</h2>
          <div className="grid gap-3 min-[900px]:grid-cols-2">
            {catalogo.data.filter((descriptor) => descriptor.eje === eje).map((descriptor) => {
              const respuesta = respuestaPorDescriptor.get(descriptor.id);
              const estado = descriptor.estados.find((opcion) => opcion.nota === respuesta?.nota);
              const valor = descriptor.tipo === 'estado'
                ? estado ? `${estado.label} · UPOV ${estado.nota}` : '—'
                : respuesta?.valor_texto || (respuesta?.valor_numerico != null ? `${respuesta.valor_numerico}${descriptor.unidad ? ` ${descriptor.unidad}` : ''}` : '—');
              return (
                <Card key={descriptor.id} className="space-y-2 border-t-4 border-t-brand p-3">
                  <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-medium">{descriptor.nombre}</h3>{descriptor.codigo_upov != null ? <span className="font-mono text-[10px] text-ink-3">UPOV {descriptor.codigo_upov}</span> : null}</div>
                  <p className="font-mono text-sm">{valor}</p>
                  {respuesta?.foto_path ? <FotoPrivada path={respuesta.foto_path} alt={`Foto de ${descriptor.nombre}`} /> : null}
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
