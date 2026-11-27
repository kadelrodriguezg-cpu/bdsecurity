import { useAuth } from '@/features/auth/AuthContext';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { obtenerCatalogoEvecl, obtenerFichaEvecl } from '@/api/evecl';
import { Sheet } from '@/components/ui/sheet';
import { EstadoCargando, EstadoError } from '@/components/v3/estados';
import { FichaForm } from '@/features/evecl/FichaForm';
import { qk } from '@/lib/queryKeys';

function FichaEveclEditarContenido() {
  const navigate = useNavigate();
  const id = Number(useParams().id);
  const valido = Number.isSafeInteger(id) && id > 0;
  const [tocado, setTocado] = useState(false);
  const ficha = useQuery({ queryKey: qk.evecl.ficha(id), queryFn: () => obtenerFichaEvecl(id), enabled: valido });
  const catalogo = useQuery({ queryKey: qk.evecl.catalogo, queryFn: obtenerCatalogoEvecl, enabled: valido });

  if (!valido) return <EstadoError titulo="Ficha no válida" mensaje="El enlace no corresponde a una ficha EVECL." />;
  const errores = [{ query: ficha, nombre: 'ficha' }, { query: catalogo, nombre: 'catálogo' }]
    .filter(({ query }) => query.isError);
  const avisos = errores.map(({ query, nombre }) => <Alert key={nombre}>
    No se pudo cargar {nombre}.{query.data && ' Se conservan los datos disponibles.'}
    <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Reintentar {nombre}</Button>
  </Alert>);
  if (!ficha.data || !catalogo.data) {
    // Sin datos todavía no hay formulario que conservar: cada fallo se muestra con su «Reintentar» (ficha o catálogo).
    if (errores.length) {
      return (
        <div className="space-y-3">
          {errores.map(({ query, nombre }) => (
            <EstadoError
              key={nombre}
              titulo={`No se pudo cargar ${nombre}`}
              mensaje="Revisa tu conexión e inténtalo de nuevo."
              etiquetaReintentar={`Reintentar ${nombre}`}
              onReintentar={() => void query.refetch()}
            />
          ))}
        </div>
      );
    }
    return <EstadoCargando etiqueta="Cargando formulario…" forma="esqueleto" />;
  }
  const volver = () => navigate(`/evecl/fichas/${id}`);

  return (
    <Sheet titulo="Editar ficha EVECL" subtitulo={`${ficha.data.variedad} · ${ficha.data.ensayo.codigo_parcela}`} size="evaluacion" hayContenido={tocado} onCerrar={volver}>
      {avisos}
      <FichaForm
        ensayoId={ficha.data.ensayo_id}
        ficha={ficha.data}
        catalogo={catalogo.data}
        alTocadoChange={setTocado}
        alCancelar={volver}
        alGuardado={(fichaId) => navigate(`/evecl/fichas/${fichaId}`)}
      />
    </Sheet>
  );
}

export function FichaEveclEditarPage() {
  const { user, generacionSesion } = useAuth();
  const { id } = useParams();
  return <FichaEveclEditarContenido key={JSON.stringify([user?.id, generacionSesion, id])} />;
}
