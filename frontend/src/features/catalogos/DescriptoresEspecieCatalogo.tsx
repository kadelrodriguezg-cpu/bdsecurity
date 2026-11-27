/**
 * «Configurar descriptores» (fase 4, decisión 4): de los descriptores que ya existen, cuáles usa cada especie, con etiquetas por
 * nivel propias si hace falta. Una tabla por categoría con un interruptor por especie. Antes de guardar un cambio que afecta
 * evaluaciones ya cargadas se advierte; ningún dato se borra. Crear un descriptor nuevo no se hace aquí (es un cambio del
 * sistema). Solo admin (AdminRoute + RLS de `esquema_campo_especie`).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Pencil } from 'lucide-react';
import { listarEspecies, type Especie } from '@/api/especies';
import { contarValoresDescriptor, guardarConfigDescriptor, listarConfigDescriptores, type ConfigDescriptorEspecie } from '@/api/descriptoresEspecie';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet } from '@/components/ui/sheet';
import { DataTableFrame } from '@/components/ui/data-table-frame';
import { EstadoCargando, EstadoError } from '@/components/v3/estados';
import { PuntoEspecie } from '@/components/shell/SelectorEspecie';
import { useEsquemaEvaluacionAnual } from '@/lib/esquemaFase/useEsquemaFase';
import { camposDeSeccion, estaActivo, type CampoFase } from '@/lib/esquemaFase/tipos';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

type Pendiente =
  | { tipo: 'activo'; campo: CampoFase; especie: Especie; activo: boolean; evaluaciones: number }
  | { tipo: 'etiquetas'; campo: CampoFase; especie: Especie };

const pl = (n: number) => `${n} ${n === 1 ? 'evaluación cerrada' : 'evaluaciones cerradas'}`;

function EditorEtiquetas({ campo, especie, propias, onCerrar }: {
  campo: CampoFase;
  especie: Especie;
  propias: string[] | null;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const escala = campo.escala!;
  const delEsquema = escala.etiquetasNivel
    ?? Array.from({ length: escala.maximo - escala.minimo + 1 }, (_, i) => (i === 0 ? escala.etiquetaMinimo : i === escala.maximo - escala.minimo ? escala.etiquetaMaximo : ''));
  const [niveles, setNiveles] = useState<string[]>(() => [...(propias ?? delEsquema)]);
  const [error, setError] = useState<string | null>(null);
  const cargadas = useQuery({ queryKey: ['contar-valores', especie.id, campo.clave], queryFn: () => contarValoresDescriptor(especie.id, campo.clave) });
  const guardar = useMutation({
    mutationFn: (etiquetas: string[] | null) => guardarConfigDescriptor({ especieId: especie.id, clave: campo.clave, activo: true, etiquetasNivel: etiquetas }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: qk.descriptoresEspecie() }); onCerrar(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudieron guardar las etiquetas.'),
  });
  const incompletas = niveles.some((t) => !t.trim());
  return (
    <Sheet
      titulo={`Etiquetas de ${campo.etiqueta}`}
      subtitulo={`En ${especie.nombre}`}
      onCerrar={onCerrar}
      footer={(
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" disabled={guardar.isPending || !propias} onClick={() => guardar.mutate(null)}>Usar las de siempre</Button>
          <Button disabled={guardar.isPending || incompletas} onClick={() => guardar.mutate(niveles.map((t) => t.trim()))}>{guardar.isPending ? 'Guardando…' : 'Guardar etiquetas'}</Button>
        </div>
      )}
    >
      <div className="space-y-3">
        <p className="text-small text-ink-2">Un texto por nivel, de menor a mayor. El nivel sigue valiendo lo mismo en el puntaje: solo cambia cómo se lee.</p>
        {niveles.map((texto, i) => (
          <div key={i} className="space-y-1">
            <Label htmlFor={`nivel-${i}`}>Nivel {escala.minimo + i}</Label>
            <Input id={`nivel-${i}`} value={texto} onChange={(e) => setNiveles((actual) => actual.map((t, j) => (j === i ? e.target.value : t)))} />
          </div>
        ))}
        {(cargadas.data ?? 0) > 0 && (
          <p className="rounded-md bg-warn-l p-3 text-small text-warn">{especie.nombre} tiene {pl(cargadas.data!)} con {campo.etiqueta.toLowerCase()}: se leerán con estas etiquetas.</p>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </Sheet>
  );
}

export function DescriptoresEspecieCatalogo() {
  const queryClient = useQueryClient();
  const [parametros] = useSearchParams();
  const resaltada = parametros.get('especie');
  const esquema = useEsquemaEvaluacionAnual();
  const especies = useQuery({ queryKey: qk.especies.all, queryFn: listarEspecies });
  const config = useQuery({ queryKey: qk.descriptoresEspecie(), queryFn: () => listarConfigDescriptores() });
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [revisando, setRevisando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configDe = (clave: string, especieId: string): ConfigDescriptorEspecie | undefined =>
    config.data?.find((c) => c.clave === clave && c.especie_id === especieId);
  const usa = (clave: string, especieId: string) => configDe(clave, especieId)?.activo !== false;

  const guardarActivo = useMutation({
    mutationFn: (p: { campo: CampoFase; especie: Especie; activo: boolean }) =>
      guardarConfigDescriptor({ especieId: p.especie.id, clave: p.campo.clave, activo: p.activo, etiquetasNivel: configDe(p.campo.clave, p.especie.id)?.etiquetas_nivel ?? null }),
    onSuccess: () => { setPendiente(null); setError(null); void queryClient.invalidateQueries({ queryKey: qk.descriptoresEspecie() }); },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio.'),
  });

  /** Antes de cambiar, se cuenta cuántas evaluaciones cerradas de la especie ya traen ese descriptor: si hay, se advierte. */
  async function alternar(campo: CampoFase, especie: Especie) {
    const activo = !usa(campo.clave, especie.id);
    setError(null);
    setRevisando(`${campo.clave}:${especie.id}`);
    try {
      const evaluaciones = await contarValoresDescriptor(especie.id, campo.clave);
      if (evaluaciones > 0) setPendiente({ tipo: 'activo', campo, especie, activo, evaluaciones });
      else guardarActivo.mutate({ campo, especie, activo });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo revisar el descriptor.');
    } finally {
      setRevisando(null);
    }
  }

  if (especies.isError || config.isError) {
    return <EstadoError mensaje="No se pudo cargar la configuración de descriptores." onReintentar={() => { void especies.refetch(); void config.refetch(); }} />;
  }
  if (!especies.data || !config.data) return <EstadoCargando etiqueta="Cargando descriptores…" forma="esqueleto" />;

  const lista = especies.data;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-small text-ink-2">
        Elige qué descriptores usa cada especie. Lo que una especie no usa no se pide en sus evaluaciones ni cuenta en su puntaje.
        Los valores ya cargados no se borran y se siguen viendo en las evaluaciones pasadas. Para agregar un descriptor nuevo hay que pedirlo.
      </p>
      {error && <Alert>{error}</Alert>}
      {esquema.secciones.map((seccion) => {
        const campos = camposDeSeccion(esquema, seccion.id).filter((c) => c.rol === 'descriptor' && estaActivo(c));
        if (campos.length === 0) return null;
        return (
          <section key={seccion.id} aria-label={seccion.etiqueta} className="space-y-2">
            <h2 className="text-body-l font-semibold text-ink">{seccion.etiqueta}</h2>
            <DataTableFrame label={`Descriptores de ${seccion.etiqueta}`} className="max-h-none border border-line bg-surface">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-ink-3">
                    <th className="px-4 py-2.5 font-medium">Descriptor</th>
                    {lista.map((especie) => (
                      <th key={especie.id} className={cn('px-3 py-2.5 text-center font-medium', especie.id === resaltada && 'bg-brand-l text-brand-ink')}>
                        <span className="inline-flex items-center gap-1.5"><PuntoEspecie especie={especie} />{especie.nombre}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campos.map((campo) => (
                    <tr key={campo.clave} className="border-b last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink">{campo.etiqueta}</th>
                      {lista.map((especie) => {
                        const activo = usa(campo.clave, especie.id);
                        const propias = configDe(campo.clave, especie.id)?.etiquetas_nivel ?? null;
                        const ocupado = revisando === `${campo.clave}:${especie.id}` || (guardarActivo.isPending && guardarActivo.variables?.campo.clave === campo.clave && guardarActivo.variables.especie.id === especie.id);
                        return (
                          <td key={especie.id} className={cn('px-3 py-2 text-center', especie.id === resaltada && 'bg-brand-l')}>
                            <span className="inline-flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                role="switch"
                                className="h-4 w-4 accent-primary"
                                aria-label={`${especie.nombre} usa ${campo.etiqueta}`}
                                checked={activo}
                                disabled={ocupado}
                                onChange={() => { void alternar(campo, especie); }}
                              />
                              {campo.tipo === 'escala' && activo && (
                                <button
                                  type="button"
                                  aria-label={`Etiquetas de ${campo.etiqueta} en ${especie.nombre}`}
                                  title={propias ? 'Etiquetas propias' : 'Editar etiquetas'}
                                  onClick={() => setPendiente({ tipo: 'etiquetas', campo, especie })}
                                  className={cn('grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', propias ? 'text-brand' : 'text-ink-3')}
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </span>
                            {propias && <span className="block text-micro text-brand-ink">propias</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableFrame>
          </section>
        );
      })}

      {pendiente?.tipo === 'activo' && (
        <Sheet
          titulo={pendiente.activo ? `¿Volver a usar ${pendiente.campo.etiqueta} en ${pendiente.especie.nombre}?` : `¿Dejar de usar ${pendiente.campo.etiqueta} en ${pendiente.especie.nombre}?`}
          onCerrar={() => setPendiente(null)}
          footer={(
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendiente(null)}>Cancelar</Button>
              <Button variant={pendiente.activo ? 'default' : 'destructive'} disabled={guardarActivo.isPending} onClick={() => guardarActivo.mutate(pendiente)}>
                {guardarActivo.isPending ? 'Guardando…' : pendiente.activo ? 'Volver a usarlo' : 'Dejar de usarlo'}
              </Button>
            </div>
          )}
        >
          <div className="space-y-2 text-small text-ink-2">
            <p className="rounded-md bg-warn-l p-3 text-warn">{pendiente.especie.nombre} tiene {pl(pendiente.evaluaciones)} con {pendiente.campo.etiqueta.toLowerCase()}.</p>
            {pendiente.activo
              ? <p>Vuelve a pedirse en las evaluaciones nuevas y esos valores vuelven a contar en el puntaje de {pendiente.especie.nombre}.</p>
              : <p>Deja de pedirse en las evaluaciones nuevas y sale del puntaje de {pendiente.especie.nombre}. Los valores no se borran: se siguen viendo en cada evaluación y vuelven a contar si lo activas otra vez.</p>}
            <p>Los rankings congelados no cambian.</p>
          </div>
        </Sheet>
      )}
      {pendiente?.tipo === 'etiquetas' && (
        <EditorEtiquetas campo={pendiente.campo} especie={pendiente.especie} propias={configDe(pendiente.campo.clave, pendiente.especie.id)?.etiquetas_nivel ?? null} onCerrar={() => setPendiente(null)} />
      )}
    </div>
  );
}
