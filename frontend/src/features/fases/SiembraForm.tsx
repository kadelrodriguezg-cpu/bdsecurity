/**
 * Formulario estructurado de Siembra: escarificación (subtipo + duración
 * condicional), insumos (multiselect contra catálogo) y contenedor (single
 * select contra catálogo).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout, StickyNote } from 'lucide-react';
import {
  obtenerDatosFase, actualizarSiembra, listarInsumoIdsDePlanta, listarSustratosDePlanta,
  obtenerUltimaNotaSiembra, ESCARIFICACION_SUBTIPO_LABEL, type EscarificacionSubtipo, type SustratoPorcentaje,
} from '@/api/fases';
import { listarInsumos, listarContenedores, listarSustratos, TIPO_INSUMO_LABEL } from '@/api/catalogos';
import { etiquetaContenedor } from '@/lib/contenedores';
import { Contador } from '@/components/shared/Contador';
import { AdjuntarArchivoFase } from '@/components/shared/AdjuntarArchivoFase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

const SUBTIPOS = Object.keys(ESCARIFICACION_SUBTIPO_LABEL) as EscarificacionSubtipo[];

export function SiembraForm({
  plantaId,
  codigoSistema,
  onTocadoChange,
}: {
  plantaId: string;
  codigoSistema: string;
  onTocadoChange?: (tocado: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: datos } = useQuery({ queryKey: qk.fase.datos(plantaId), queryFn: () => obtenerDatosFase(plantaId) });
  const { data: insumoIdsActuales } = useQuery({ queryKey: qk.siembra.insumos(plantaId), queryFn: () => listarInsumoIdsDePlanta(plantaId) });
  const { data: sustratosActuales } = useQuery({ queryKey: qk.siembra.sustratos(plantaId), queryFn: () => listarSustratosDePlanta(plantaId) });
  const { data: notaExistente } = useQuery({ queryKey: qk.siembra.nota(plantaId), queryFn: () => obtenerUltimaNotaSiembra(plantaId) });
  const { data: insumos } = useQuery({ queryKey: qk.catalogos.insumos.activos, queryFn: () => listarInsumos(true) });
  const { data: contenedores } = useQuery({ queryKey: qk.catalogos.contenedores.activos, queryFn: () => listarContenedores(true) });
  const { data: sustratosCatalogo } = useQuery({ queryKey: qk.catalogos.sustratos.activos, queryFn: () => listarSustratos(true) });

  const [subtipo, setSubtipo] = useState<EscarificacionSubtipo | null>(null);
  const [duracionDias, setDuracionDias] = useState<number | null>(null);
  const [protocolo, setProtocolo] = useState('');
  const [contenedorId, setContenedorId] = useState<string>('');
  const [insumoIds, setInsumoIds] = useState<string[] | null>(null);
  const [sustratos, setSustratos] = useState<SustratoPorcentaje[] | null>(null);
  const [semillasSembradas, setSemillasSembradas] = useState<number | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [tocado, setTocado] = useState(false);
  const [protocoloExpandido, setProtocoloExpandido] = useState(false);

  // Precarga desde los datos existentes (1 registro por cruce) recién cuando
  // llegan, sin pisar lo que el usuario ya haya tocado en este formulario.
  useEffect(() => {
    if (tocado || !datos) return;
    setSubtipo(datos.escarificacion_subtipo);
    setDuracionDias(datos.escarificacion_duracion_dias);
    setContenedorId(datos.contenedor_id ?? '');
    setSemillasSembradas(datos.semillas_sembradas);
  }, [datos, tocado]);

  useEffect(() => {
    if (tocado || insumoIds !== null || !insumoIdsActuales) return;
    setInsumoIds(insumoIdsActuales);
  }, [insumoIdsActuales, insumoIds, tocado]);

  useEffect(() => {
    if (tocado || sustratos !== null || !sustratosActuales) return;
    setSustratos(sustratosActuales);
  }, [sustratosActuales, sustratos, tocado]);

  useEffect(() => {
    if (tocado || !notaExistente) return;
    setProtocolo(notaExistente);
    setProtocoloExpandido(true);
  }, [notaExistente, tocado]);

  useEffect(() => {
    onTocadoChange?.(tocado);
  }, [tocado, onTocadoChange]);

  const toggleInsumo = (id: string) => {
    setTocado(true);
    setInsumoIds((prev) => {
      const actual = prev ?? [];
      return actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id];
    });
  };

  const toggleSustrato = (id: string) => {
    setTocado(true);
    setSustratos((prev) => {
      const actual = prev ?? [];
      const yaEsta = actual.some((s) => s.sustrato_id === id);
      return yaEsta ? actual.filter((s) => s.sustrato_id !== id) : [...actual, { sustrato_id: id, porcentaje: 0 }];
    });
  };

  const cambiarPorcentajeSustrato = (id: string, porcentaje: number) => {
    setTocado(true);
    setSustratos((prev) => (prev ?? []).map((s) => (s.sustrato_id === id ? { ...s, porcentaje } : s)));
  };

  const sumaPorcentajes = (sustratos ?? []).reduce((acc, s) => acc + (s.porcentaje || 0), 0);

  const mutacion = useMutation({
    mutationFn: () =>
      actualizarSiembra(plantaId, {
        escarificacion_subtipo: subtipo,
        escarificacion_duracion_dias: subtipo === 'estratificacion' ? duracionDias : null,
        contenedor_id: contenedorId || null,
        insumo_ids: insumoIds ?? [],
        sustratos: (sustratos ?? []).filter((s) => s.porcentaje > 0),
        semillas_sembradas: semillasSembradas,
        protocoloEscarificacion: protocolo.trim() || null,
        codigoSistema,
        archivo,
      }),
    onSuccess: () => {
      setError(null);
      setOk(true);
      setArchivo(null);
      setTocado(false);
      void queryClient.invalidateQueries({ queryKey: qk.fase.datos(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.siembra.insumos(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.siembra.sustratos(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.siembra.nota(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.eventos.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    },
    onError: (e) => {
      setOk(false);
      setError(e instanceof Error ? e.message : 'No se pudo guardar la siembra.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sprout className="h-4 w-4 text-primary" /> Siembra
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutacion.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label>Escarificación (opcional)</Label>
            <div className="flex flex-wrap gap-3">
              {SUBTIPOS.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="escarificacion_subtipo"
                    checked={subtipo === s}
                    onChange={() => {
                      setTocado(true);
                      setSubtipo(s);
                    }}
                  />
                  {ESCARIFICACION_SUBTIPO_LABEL[s]}
                </label>
              ))}
              <label className="flex items-center gap-1.5 text-sm text-ink-3">
                <input
                  type="radio"
                  name="escarificacion_subtipo"
                  checked={subtipo === null}
                  onChange={() => {
                    setTocado(true);
                    setSubtipo(null);
                    setDuracionDias(null);
                  }}
                />
                Ninguna
              </label>
            </div>
          </div>

          {subtipo === 'estratificacion' && (
            <div className="space-y-1.5">
              <Label htmlFor="duracion_dias">Duración estratificación (días)</Label>
              <Input
                id="duracion_dias"
                type="number"
                min={0}
                value={duracionDias ?? ''}
                onChange={(e) => {
                  setTocado(true);
                  setDuracionDias(e.target.value === '' ? null : Number(e.target.value));
                }}
                className="w-32"
              />
            </div>
          )}

          {protocoloExpandido ? (
            <div className="space-y-1.5">
              <Label htmlFor="protocolo_escarificacion">Protocolo de escarificación (opcional)</Label>
              <Textarea
                id="protocolo_escarificacion"
                placeholder="Temperatura, concentración, tiempo, observaciones del procedimiento…"
                value={protocolo}
                onChange={(e) => {
                  setTocado(true);
                  setProtocolo(e.target.value);
                }}
              />
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setProtocoloExpandido(true)}>
              <StickyNote className="h-3.5 w-3.5" /> Agregar notas del protocolo
            </Button>
          )}

          <Contador
            label="Cantidad de semillas sembradas"
            value={semillasSembradas}
            onChange={(v) => {
              setTocado(true);
              setSemillasSembradas(v);
            }}
          />

          <div className="space-y-1.5">
            <Label>Insumo/producto (opcional, elige uno o varios)</Label>
            {!insumos || insumos.length === 0 ? (
              <p className="text-xs text-ink-3">No hay insumos activos cargados en el catálogo todavía.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {insumos.map((i) => {
                  const seleccionado = (insumoIds ?? []).includes(i.id);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => toggleInsumo(i.id)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs font-medium',
                        seleccionado ? 'border-primary bg-brand-l text-primary' : 'border-line-strong bg-white hover:bg-surface-2',
                      )}
                    >
                      {i.nombre} <span className="text-ink-3">({TIPO_INSUMO_LABEL[i.tipo]})</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contenedor">Contenedor (opcional)</Label>
            {!contenedores || contenedores.length === 0 ? (
              <p className="text-xs text-ink-3">No hay contenedores activos cargados en el catálogo todavía.</p>
            ) : (
              <Select
                id="contenedor"
                value={contenedorId}
                onChange={(e) => {
                  setTocado(true);
                  setContenedorId(e.target.value);
                }}
              >
                <option value="">Sin contenedor</option>
                {contenedores.map((c) => (
                  // La capacidad se muestra sola junto al nombre («Macetero · 10 L»): no hay que escribirla.
                  <option key={c.id} value={c.id}>{etiquetaContenedor(c)}</option>
                ))}
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Sustrato (opcional, elige uno o varios con su porcentaje)</Label>
            {!sustratosCatalogo || sustratosCatalogo.length === 0 ? (
              <p className="text-xs text-ink-3">No hay sustratos activos cargados en el catálogo todavía.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {sustratosCatalogo.map((s) => {
                    const seleccionado = (sustratos ?? []).find((x) => x.sustrato_id === s.id);
                    return (
                      <div key={s.id} className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleSustrato(s.id)}
                          className={cn(
                            'rounded-md border px-3 py-1.5 text-xs font-medium',
                            seleccionado ? 'border-primary bg-brand-l text-primary' : 'border-line-strong bg-white hover:bg-surface-2',
                          )}
                        >
                          {s.nombre}
                        </button>
                        {seleccionado && (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="0.1"
                              value={seleccionado.porcentaje || ''}
                              onChange={(e) => cambiarPorcentajeSustrato(s.id, Number(e.target.value) || 0)}
                              className="w-20"
                            />
                            <span className="text-xs text-ink-3">%</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(sustratos ?? []).length > 0 && (
                  <p className="text-xs text-ink-3">Suma actual: {sumaPorcentajes}% (no hace falta que llegue a 100).</p>
                )}
              </>
            )}
          </div>

          <AdjuntarArchivoFase archivo={archivo} onArchivoChange={setArchivo} />

          {error && <Alert>{error}</Alert>}
          {ok && <Alert variant="success">Siembra guardada.</Alert>}

          <Button type="submit" disabled={mutacion.isPending}>
            {mutacion.isPending ? 'Guardando…' : 'Guardar siembra'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
