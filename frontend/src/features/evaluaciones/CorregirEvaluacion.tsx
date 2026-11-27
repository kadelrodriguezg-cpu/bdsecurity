/**
 * «Corregir» una evaluación cerrada (decisión A8; docs/rediseno_v3/corregir.md). Solo la abre el admin, desde la
 * lectura única de la evaluación. Muestra lo guardado, deja cambiar los valores y exige un motivo; envía solo lo que
 * cambió, con control de versión. La base vuelve a validar todo (solo admin, motivo, fase del cruce, regla de frutos).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { corregirEvaluacion, type CambiosCorreccion } from '@/api/correcciones';
import type { EvaluacionConContexto } from '@/api/rondas';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { camposDeSeccion, esquemaVisibleDe, type CampoFase, type EsquemaFase } from '@/lib/esquemaFase/tipos';
import { qk } from '@/lib/queryKeys';

type Valores = Record<string, string>;

const aTexto = (valor: unknown): string => (valor === null || valor === undefined ? '' : String(valor));

/** Lo que se envía a la base: '' es «sin valor» (null); números como número. */
function aValor(campo: Pick<CampoFase, 'tipo'> | null, texto: string): string | number | null {
  const limpio = texto.trim();
  if (limpio === '') return null;
  if (!campo || campo.tipo === 'fecha') return limpio;
  const numero = Number(limpio.replace(',', '.'));
  return Number.isFinite(numero) ? numero : limpio;
}

function CampoCorreccion({ campo, valor, onCambio }: { campo: CampoFase; valor: string; onCambio: (v: string) => void }) {
  const id = `corregir-${campo.clave}`;
  const etiqueta = campo.unidad ? `${campo.etiqueta} (${campo.unidad})` : campo.etiqueta;
  if (campo.tipo === 'escala' && campo.escala) {
    const { minimo, maximo } = campo.escala;
    return (
      <div className="space-y-1">
        <Label htmlFor={id}>{etiqueta}</Label>
        <Select id={id} value={valor} onChange={(e) => onCambio(e.target.value)}>
          <option value="">Sin valor</option>
          {Array.from({ length: maximo - minimo + 1 }, (_, i) => minimo + i).map((n) => (
            <option key={n} value={String(n)}>{campo.escala?.etiquetasNivel ? `${n} · ${campo.escala.etiquetasNivel[n - minimo]}` : n}</option>
          ))}
        </Select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        type={campo.tipo === 'fecha' ? 'date' : 'text'}
        inputMode={campo.tipo === 'entero' ? 'numeric' : campo.tipo === 'numero' ? 'decimal' : undefined}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
      />
    </div>
  );
}

export function CorregirEvaluacion({ evaluacion, esquema: esquemaCompleto, onCerrar }: {
  evaluacion: EvaluacionConContexto;
  esquema: EsquemaFase;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const registro = evaluacion as unknown as Record<string, unknown>;
  // Un campo desactivado (rend_t_ha) se puede corregir solo si esta evaluación ya trae un valor.
  const esquema = useMemo(() => esquemaVisibleDe(esquemaCompleto, registro), [esquemaCompleto, registro]);
  const editables = useMemo(() => esquema.campos.filter((c) => c.rol !== 'derivado'), [esquema]);
  const originales = useMemo<Valores>(() => ({
    fecha: aTexto(evaluacion.fecha),
    evaluador: aTexto(evaluacion.evaluador),
    observaciones: aTexto(evaluacion.observaciones),
    ...Object.fromEntries(editables.map((c) => [c.clave, aTexto(registro[c.clave])])),
  }), [editables, evaluacion, registro]);
  const [valores, setValores] = useState<Valores>(originales);
  const [motivo, setMotivo] = useState('');
  const set = (clave: string) => (v: string) => setValores((actual) => ({ ...actual, [clave]: v }));

  const cambios = useMemo<CambiosCorreccion>(() => {
    const campoDe = new Map(editables.map((c) => [c.clave, c]));
    const salida: CambiosCorreccion = {};
    for (const [clave, texto] of Object.entries(valores)) {
      if (texto.trim() === originales[clave].trim()) continue;
      salida[clave] = clave === 'fecha' ? texto : clave === 'evaluador' || clave === 'observaciones' ? (texto.trim() || null) : aValor(campoDe.get(clave) ?? null, texto);
    }
    return salida;
  }, [editables, originales, valores]);
  const hayCambios = Object.keys(cambios).length > 0;

  const mutacion = useMutation({
    mutationFn: () => corregirEvaluacion(evaluacion.id, cambios, motivo, evaluacion.updated_at),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.porId(evaluacion.id) });
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.correcciones(evaluacion.ronda.individuo.id) });
      // Fase 5 (G15): al corregir, la base deja resueltos los pedidos de corrección abiertos.
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.pedidos(evaluacion.id) });
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.pedidosAbiertos });
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.ronda(evaluacion.ronda_id) });
      void queryClient.invalidateQueries({ queryKey: qk.protocolo.estados(evaluacion.id) });
      void queryClient.invalidateQueries({ queryKey: ['ranking'] });
      onCerrar();
    },
  });

  return (
    <Sheet
      titulo="Corregir evaluación"
      subtitulo={`${evaluacion.ronda.individuo.codigo_display} · ronda ${evaluacion.ronda.numero_ronda}. Queda como «Corregida», con tu nombre, la fecha y el motivo en el historial.`}
      onCerrar={onCerrar}
      hayContenido={hayCambios || motivo.trim() !== ''}
      size="evaluacion"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button disabled={!hayCambios || !motivo.trim() || mutacion.isPending} onClick={() => mutacion.mutate()}>
            {mutacion.isPending ? 'Guardando…' : 'Guardar corrección'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="space-y-1">
          <Label htmlFor="corregir-motivo">Motivo de la corrección (obligatorio)</Label>
          <Textarea id="corregir-motivo" required rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Brix mal tipeado: era 13,5" />
        </div>
        <section aria-label="Datos de la visita" className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="corregir-fecha">Fecha efectiva</Label><Input id="corregir-fecha" type="date" value={valores.fecha} onChange={(e) => set('fecha')(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="corregir-evaluador">Evaluador en terreno</Label><Input id="corregir-evaluador" value={valores.evaluador} onChange={(e) => set('evaluador')(e.target.value)} /></div>
        </section>
        {esquema.secciones.map((seccion) => {
          const campos = camposDeSeccion(esquema, seccion.id).filter((c) => c.rol !== 'derivado');
          if (campos.length === 0) return null;
          return (
            <section key={seccion.id} aria-label={seccion.etiqueta} className="space-y-2">
              <h3 className="text-body font-semibold text-ink">{seccion.etiqueta}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {campos.map((campo) => <CampoCorreccion key={campo.clave} campo={campo} valor={valores[campo.clave] ?? ''} onCambio={set(campo.clave)} />)}
              </div>
            </section>
          );
        })}
        <div className="space-y-1">
          <Label htmlFor="corregir-observaciones">Observaciones</Label>
          <Textarea id="corregir-observaciones" rows={3} value={valores.observaciones} onChange={(e) => set('observaciones')(e.target.value)} />
        </div>
        {mutacion.error && <Alert>{(mutacion.error as Error).message}</Alert>}
      </div>
    </Sheet>
  );
}
