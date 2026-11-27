import { formatearFecha } from '@/lib/v3/formatos';
import type { ComponentProps } from 'react';
import { useVigenciaFormulario } from '@/lib/useVigenciaFormulario';
import { useAuth } from '@/features/auth/AuthContext';
import { EstadoBorradorLocal } from '@/components/shared/EstadoBorradorLocal';
import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Save, Trash2 } from 'lucide-react';
import { z } from 'zod';
import {
  descriptoresPorEje,
  guardarFichaEvecl,
  type EveclDescriptor,
  type EveclFicha,
  type EveclFichaEntrada,
  type EveclFotoPendiente,
  type EveclRespuesta,
  type EveclRespuestaEntrada,
} from '@/api/evecl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { qk } from '@/lib/queryKeys';
import { useBorradorLocal } from '@/lib/useBorradorLocal';
import { hoyChileISO } from '@/lib/fechas';
import { DescriptorEstadoPicker } from './DescriptorEstadoPicker';
import { DescriptorValorInput } from './DescriptorValorInput';
import { FotoDescriptor } from './FotoDescriptor';

type RespuestaForm = {
  nota: number | null;
  valor_numerico: string;
  valor_texto: string;
  foto_path: string | null;
  fecha_observada: string;
};

type FichaFormValues = {
  variedad: string;
  codigo_genotipo: string;
  origen_cruza: string;
  tipo: '' | 'evaluacion' | 'testigo';
  numero_repeticion: string;
  codigo_planta: string;
  encargado: string;
  fecha_siembra: string;
  fecha_evaluacion: string;
  notas: string;
  respuestas: Record<string, RespuestaForm>;
};

const respuestaSchema = z.object({
  nota: z.number().nullable(),
  valor_numerico: z.string().refine((valor) => valor === '' || (Number.isFinite(Number(valor)) && Number(valor) >= 0), 'Ingresa un número mayor o igual a cero.'),
  valor_texto: z.string(),
  foto_path: z.string().nullable(),
  fecha_observada: z.string(),
});

/** Se invoca desde Zod al validar, para no capturar una fecha al importar el módulo. */
export function fechaEvaluacionNoEsFutura(valor: string): boolean {
  return valor <= hoyChileISO();
}

const fichaSchema = z.object({
  variedad: z.string().trim().min(1, 'Ingresa la variedad.'),
  codigo_genotipo: z.string(),
  origen_cruza: z.string(),
  tipo: z.enum(['evaluacion', 'testigo'], { message: 'Selecciona el tipo de ficha.' }),
  numero_repeticion: z.string().refine((valor) => {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero >= 1 && numero <= 20;
  }, 'La repetición debe ser un entero entre 1 y 20.'),
  codigo_planta: z.string(),
  encargado: z.string(),
  fecha_siembra: z.string(),
  fecha_evaluacion: z.string().min(1, 'Ingresa la fecha de evaluación.').refine(fechaEvaluacionNoEsFutura, 'La fecha de evaluación no puede ser futura.'),
  notas: z.string(),
  respuestas: z.record(respuestaSchema),
});

const RESPUESTA_VACIA: RespuestaForm = { nota: null, valor_numerico: '', valor_texto: '', foto_path: null, fecha_observada: '' };
type BorradorFicha = { contenido: string };
const BORRADOR_VACIO: BorradorFicha = { contenido: '' };

const EJES = [
  ['fenologia', 'Fenología'],
  ['adaptabilidad', 'Adaptabilidad'],
  ['calidad', 'Calidad'],
  ['productividad', 'Productividad'],
] as const;

function aTexto(valor: string): string | null {
  return valor.trim() || null;
}

function respuestaTieneDato(respuesta?: RespuestaForm, archivo?: File): boolean {
  if (!respuesta) return Boolean(archivo);
  return Boolean(
    respuesta.nota != null
    || respuesta.valor_numerico !== ''
    || respuesta.valor_texto.trim()
    || respuesta.foto_path
    || archivo,
  );
}

function valoresDeFicha(ficha?: EveclFicha): FichaFormValues {
  const respuestas = Object.fromEntries((ficha?.respuestas ?? []).map((respuesta) => [String(respuesta.descriptor_id), {
    nota: respuesta.nota,
    valor_numerico: respuesta.valor_numerico == null ? '' : String(respuesta.valor_numerico),
    valor_texto: respuesta.valor_texto ?? '',
    foto_path: respuesta.foto_path,
    fecha_observada: respuesta.fecha_observada ?? '',
  } satisfies RespuestaForm]));
  return {
    variedad: ficha?.variedad ?? '',
    codigo_genotipo: ficha?.codigo_genotipo ?? '',
    origen_cruza: ficha?.origen_cruza ?? '',
    tipo: ficha?.tipo ?? 'evaluacion',
    numero_repeticion: ficha ? String(ficha.numero_repeticion) : '1',
    codigo_planta: ficha?.codigo_planta ?? '',
    encargado: ficha?.encargado ?? '',
    fecha_siembra: ficha?.fecha_siembra ?? '',
    fecha_evaluacion: ficha?.fecha_evaluacion ?? hoyChileISO(),
    notas: ficha?.notas ?? '',
    respuestas,
  };
}

function recuperarValores(contenido: string, respaldo: FichaFormValues): FichaFormValues {
  if (!contenido) return respaldo;
  try {
    // Un borrador anterior tampoco puede reemplazar el origen del servidor.
    return { ...respaldo, ...(JSON.parse(contenido) as FichaFormValues), origen_cruza: respaldo.origen_cruza };
  } catch {
    return respaldo;
  }
}

function aRespuestaEntrada(descriptor: EveclDescriptor, respuesta: RespuestaForm): EveclRespuestaEntrada {
  const esTexto = descriptor.tipo === 'valor' && descriptor.nombre.includes('%');
  return {
    descriptor_id: descriptor.id,
    nota: descriptor.tipo === 'estado' ? respuesta.nota : null,
    valor_numerico: descriptor.tipo === 'valor' && !esTexto && respuesta.valor_numerico !== ''
      ? Number(respuesta.valor_numerico)
      : null,
    valor_texto: esTexto ? aTexto(respuesta.valor_texto) : null,
    foto_path: respuesta.foto_path,
    // fecha_observada acompaña una nota real; sin nota no se persiste (el
    // trigger de coherencia de evecl_respuesta exige nota en descriptores
    // tipo 'estado', que es el único tipo que vive en el eje fenologia).
    fecha_observada: descriptor.eje === 'fenologia' && respuesta.nota != null ? aTexto(respuesta.fecha_observada) : null,
  };
}

function FichaFormContenido({
  ensayoId,
  ficha,
  catalogo,
  alGuardado,
  alCancelar,
  alTocadoChange,
}: {
  ensayoId: number;
  ficha?: EveclFicha;
  catalogo: EveclDescriptor[];
  alGuardado: (fichaId: number) => void;
  alCancelar: () => void;
  alTocadoChange?: (tocado: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const ciclo = useVigenciaFormulario();
  const { user } = useAuth();
  const catalogoEditable = useMemo(() => catalogo.filter((descriptor) =>
    !ficha?.respuestas.some((respuesta) => respuesta.descriptor_id === descriptor.id && respuesta.descriptor.activo === false)),
  [catalogo, ficha?.respuestas]);
  const claveBorrador = `borrador:evecl:ficha:${ficha?.id ?? `nueva-${ensayoId}`}`;
  const borrador = useBorradorLocal<BorradorFicha>(claveBorrador, BORRADOR_VACIO, { usuarioId: user?.id ?? null });
  const valoresServidor = useMemo(() => valoresDeFicha(ficha), [ficha]);
  const valoresIniciales = recuperarValores(borrador.valor.contenido, valoresServidor);
  const [archivos, setArchivos] = useState<Record<number, File>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const descriptorRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<FichaFormValues>({ resolver: zodResolver(fichaSchema), defaultValues: valoresIniciales });
  const respuestas = watch('respuestas');
  const hayArchivos = Object.keys(archivos).length > 0;
  const hayCambios = isDirty || hayArchivos || Boolean(borrador.recuperadoEn);

  const respuestasAnteriores = useMemo(
    () => new Map<number, EveclRespuesta>((ficha?.respuestas ?? [])
      .filter((respuesta) => catalogoEditable.some((descriptor) => descriptor.id === respuesta.descriptor_id))
      .map((respuesta) => [respuesta.descriptor_id, respuesta])),
    [ficha?.respuestas, catalogoEditable],
  );
  const retiradas = (ficha?.respuestas ?? []).filter((respuesta) =>
    !catalogoEditable.some((descriptor) => descriptor.id === respuesta.descriptor_id));

  useEffect(() => {
    const suscripcion = watch((valores) => {
      // El origen se mantiene en RHF/API, nunca en el borrador del dispositivo.
      const { origen_cruza: _origenCruza, ...valoresLocales } = valores;
      borrador.setValor({ contenido: JSON.stringify(valoresLocales) });
    });
    return () => suscripcion.unsubscribe();
    // El setter conserva identidad al editar y cambia al cargar otra clave.
  }, [watch, borrador.setValor]);

  useEffect(() => alTocadoChange?.(hayCambios), [alTocadoChange, hayCambios]);

  const mutacion = useMutation({
    mutationFn: async (valores: FichaFormValues) => {
      const respuestasEntrada = catalogoEditable.flatMap((descriptor) => {
        const respuesta = valores.respuestas[String(descriptor.id)] ?? RESPUESTA_VACIA;
        return respuestaTieneDato(respuesta, archivos[descriptor.id]) ? [aRespuestaEntrada(descriptor, respuesta)] : [];
      });
      const entrada: EveclFichaEntrada = {
        id: ficha?.id,
        ensayo_id: ensayoId,
        variedad: valores.variedad.trim(),
        codigo_genotipo: aTexto(valores.codigo_genotipo),
        origen_cruza: aTexto(valores.origen_cruza),
        tipo: valores.tipo as 'evaluacion' | 'testigo',
        numero_repeticion: Number(valores.numero_repeticion),
        codigo_planta: aTexto(valores.codigo_planta),
        encargado: aTexto(valores.encargado),
        fecha_siembra: valores.fecha_siembra || null,
        fecha_evaluacion: valores.fecha_evaluacion,
        notas: aTexto(valores.notas),
        respuestas: respuestasEntrada,
        idempotency_key: ficha ? undefined : idempotencyKey,
      };
      const fotos: EveclFotoPendiente[] = Object.entries(archivos)
        .filter(([descriptorId]) => catalogoEditable.some((descriptor) => descriptor.id === Number(descriptorId)))
        .map(([descriptorId, archivo]) => ({
        descriptorId: Number(descriptorId),
        archivo,
        fotoPathAnterior: respuestasAnteriores.get(Number(descriptorId))?.foto_path ?? null,
      }));
      return guardarFichaEvecl(entrada, fotos, respuestasAnteriores);
    },
    onSuccess: (fichaId) => {
      if (!ciclo.sesionVigente()) return;
      if (!ciclo.uiVigente()) return;
      setError(null);
      borrador.limpiar();
      setIdempotencyKey(crypto.randomUUID());
      alGuardado(fichaId);
    },
    onError: (cause) => {
      if (!ciclo.uiVigente()) return;
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la ficha.');
    },
    onSettled: (fichaId) => {
      if (!ciclo.sesionVigente()) return;
      const id = fichaId ?? ficha?.id;
      if (id) void queryClient.invalidateQueries({ queryKey: qk.evecl.ficha(id) });
      // La ficha alimenta la lista/completitud, el conteo del ensayo y toda
      // comparación EVECL. El prefijo de fotos cubre URLs firmadas cuyo objeto
      // fue reemplazado en el mismo path.
      void queryClient.invalidateQueries({ queryKey: qk.evecl.fichasEnsayo(ensayoId) });
      void queryClient.invalidateQueries({ queryKey: qk.evecl.ensayo(ensayoId) });
      void queryClient.invalidateQueries({ queryKey: qk.evecl.ensayos });
      void queryClient.invalidateQueries({ queryKey: qk.evecl.comparaciones });
      void queryClient.invalidateQueries({ queryKey: qk.evecl.fotos });
    },
  });

  const respondidos = catalogoEditable.filter((descriptor) => respuestaTieneDato(respuestas?.[String(descriptor.id)], archivos[descriptor.id])).length;

  const descartarRecuperado = () => {
    borrador.descartarRecuperado();
    reset(valoresServidor);
    setArchivos({});
  };

  const cancelar = () => {
    if (hayCambios && !window.confirm('Tienes cambios sin guardar. ¿Descartar el borrador?')) return;
    alCancelar();
  };

  return (
    <form className="space-y-4" noValidate onSubmit={(evento) => void handleSubmit((valores) => mutacion.mutate(valores), (errores) => {
      // RHF enfoca los campos registrados; los descriptores conservan su valor controlado.
      if (Object.keys(errores).some((campo) => campo !== 'respuestas')) return;
      const clave = Object.keys(errores.respuestas ?? {}).find((id) => errores.respuestas?.[id]?.valor_numerico);
      if (clave) descriptorRefs.current[clave]?.focus();
    })(evento)}>
      {borrador.recuperadoEn ? (
        <Alert variant="success">
          Se recuperó un borrador local sin guardar.{' '}
          <button type="button" className="font-semibold underline" onClick={descartarRecuperado}>Descartarlo</button>
        </Alert>
      ) : null}
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Completitud de la ficha" aria-valuemin={0} aria-valuemax={catalogoEditable.length} aria-valuenow={respondidos}>
        <div className="h-full origin-left rounded-full bg-brand transition-transform" style={{ transform: `scaleX(${catalogoEditable.length ? respondidos / catalogoEditable.length : 0})` }} />
      </div>
      <p className="font-mono text-xs text-ink-3">{respondidos}/{catalogoEditable.length} descriptores con dato · se permite guardar parcialmente</p>

      <div className="grid gap-5 min-[900px]:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3 min-[900px]:sticky min-[900px]:top-0 min-[900px]:self-start">
          <h2 className="font-semibold text-brand-ink">Identificación</h2>
          <div className="space-y-1"><Label htmlFor="evecl-variedad">Variedad *</Label><Input id="evecl-variedad" aria-invalid={errors.variedad ? true : undefined} aria-describedby={errors.variedad ? "evecl-variedad-error" : undefined} data-autofocus {...register('variedad')} />{errors.variedad ? <p id="evecl-variedad-error" className="text-xs text-danger">{errors.variedad.message}</p> : null}</div>
          <div className="grid grid-cols-2 gap-2 min-[900px]:grid-cols-1">
            <div className="space-y-1"><Label htmlFor="evecl-tipo">Tipo</Label><Select id="evecl-tipo" {...register('tipo')}><option value="evaluacion">Evaluación</option><option value="testigo">Testigo</option></Select></div>
            <div className="space-y-1"><Label htmlFor="evecl-repeticion">Repetición *</Label><Input id="evecl-repeticion" aria-invalid={errors.numero_repeticion ? true : undefined} aria-describedby={errors.numero_repeticion ? "evecl-repeticion-error" : undefined} type="number" min="1" max="20" inputMode="numeric" className="font-mono" {...register('numero_repeticion')} />{errors.numero_repeticion ? <p id="evecl-repeticion-error" className="text-xs text-danger">{errors.numero_repeticion.message}</p> : null}</div>
          </div>
          <div className="space-y-1"><Label htmlFor="evecl-codigo-planta">Código de planta</Label><Input id="evecl-codigo-planta" className="font-mono" placeholder="—" {...register('codigo_planta')} /></div>
          <div className="space-y-1"><Label htmlFor="evecl-genotipo">Código de genotipo</Label><Input id="evecl-genotipo" className="font-mono" placeholder="—" {...register('codigo_genotipo')} /></div>
          <div className="space-y-1"><Label htmlFor="evecl-origen">Origen de cruza</Label><Input id="evecl-origen" placeholder="—" {...register('origen_cruza')} /></div>
          <div className="space-y-1"><Label htmlFor="evecl-encargado-ficha">Encargado</Label><Input id="evecl-encargado-ficha" {...register('encargado')} /></div>
          <div className="space-y-1"><Label htmlFor="evecl-fecha-siembra">Fecha de siembra</Label><Input id="evecl-fecha-siembra" type="date" {...register('fecha_siembra')} /></div>
          <div className="space-y-1"><Label htmlFor="evecl-fecha-evaluacion">Fecha de evaluación *</Label><Input id="evecl-fecha-evaluacion" aria-invalid={errors.fecha_evaluacion ? true : undefined} aria-describedby={errors.fecha_evaluacion ? "evecl-fecha-evaluacion-error" : undefined} type="date" max={hoyChileISO()} {...register('fecha_evaluacion')} />{errors.fecha_evaluacion ? <p id="evecl-fecha-evaluacion-error" className="text-xs text-danger">{errors.fecha_evaluacion.message}</p> : null}</div>
          <div className="space-y-1"><Label htmlFor="evecl-notas-ficha">Notas</Label><Textarea id="evecl-notas-ficha" {...register('notas')} /></div>
        </aside>

        <div className="space-y-6">
          {EJES.map(([eje, label]) => {
            const descriptores = descriptoresPorEje(catalogoEditable, eje);
            // Un eje sin ningún descriptor activo en el catálogo no se
            // renderiza — mismo criterio genérico que EveclCompararPage,
            // vía la misma función descriptoresPorEje (no hardcodea qué
            // eje ocultar).
            if (descriptores.length === 0) return null;
            return (
              <fieldset key={eje} className="space-y-3">
                <legend className="w-full border-b border-brand-c pb-2 font-semibold text-brand-ink">{label}</legend>
                <div className="grid gap-3 min-[900px]:grid-cols-2">
                  {descriptores.map((descriptor) => {
                    const clave = String(descriptor.id);
                    const respuesta = respuestas?.[clave] ?? RESPUESTA_VACIA;
                    const esTexto = descriptor.tipo === 'valor' && descriptor.nombre.includes('%');
                    const tieneDato = respuestaTieneDato(respuesta, archivos[descriptor.id]);
                    return (
                      <article key={descriptor.id} className="space-y-3 rounded-lg border border-line border-t-4 border-t-brand bg-surface p-3 shadow-sm">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <Label htmlFor={`descriptor-${descriptor.id}`} className="leading-snug">{descriptor.nombre}</Label>
                            {descriptor.codigo_upov != null ? <span className="shrink-0 font-mono text-[10px] text-ink-3">UPOV {descriptor.codigo_upov}</span> : null}
                          </div>
                          {!tieneDato ? <p className="mt-1 text-xs text-ink-3">Sin dato: —</p> : null}
                          {descriptor.nota_especial ? <p className="mt-1 text-xs text-warn">{descriptor.nota_especial}</p> : null}
                        </div>
                        {descriptor.tipo === 'estado' ? (
                          <DescriptorEstadoPicker
                            nombre={descriptor.nombre}
                            estados={descriptor.estados}
                            valor={respuesta.nota}
                            alCambiar={(nota) => setValue(`respuestas.${clave}`, { ...respuesta, nota }, { shouldDirty: true, shouldValidate: true })}
                            eje={descriptor.eje}
                            fechaObservada={respuesta.fecha_observada || null}
                            alCambiarFecha={(fecha_observada) => setValue(`respuestas.${clave}`, { ...respuesta, fecha_observada }, { shouldDirty: true })}
                          />
                        ) : (
                          <DescriptorValorInput
                            id={`descriptor-${descriptor.id}`}
                            inputRef={(input) => { descriptorRefs.current[clave] = input; }}
                            aria-invalid={errors.respuestas?.[clave]?.valor_numerico ? true : undefined}
                            aria-describedby={errors.respuestas?.[clave]?.valor_numerico ? `descriptor-${descriptor.id}-error` : undefined}
                            unidad={descriptor.unidad}
                            esTexto={esTexto}
                            valor={esTexto ? respuesta.valor_texto : respuesta.valor_numerico}
                            alCambiar={(valor) => setValue(
                              `respuestas.${clave}`,
                              esTexto ? { ...respuesta, valor_texto: valor } : { ...respuesta, valor_numerico: valor },
                              { shouldDirty: true, shouldValidate: true },
                            )}
                          />
                        )}
                        {errors.respuestas?.[clave]?.valor_numerico ? <p id={`descriptor-${descriptor.id}-error`} className="text-xs text-danger">{errors.respuestas[clave]?.valor_numerico?.message}</p> : null}
                        <FotoDescriptor
                          descriptorId={descriptor.id}
                          fotoPath={respuesta.foto_path}
                          archivo={archivos[descriptor.id]}
                          alCambiar={(archivo) => setArchivos((actuales) => ({ ...actuales, [descriptor.id]: archivo }))}
                          alBorrar={() => {
                            setArchivos((actuales) => {
                              const siguientes = { ...actuales };
                              delete siguientes[descriptor.id];
                              return siguientes;
                            });
                            setValue(`respuestas.${clave}`, { ...respuesta, foto_path: null }, { shouldDirty: true });
                          }}
                        />
                        {tieneDato ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            onClick={() => {
                              if (!window.confirm('¿Borrar esta respuesta y su foto?')) return;
                              setValue(`respuestas.${clave}`, { ...RESPUESTA_VACIA }, { shouldDirty: true });
                              setArchivos((actuales) => {
                                const siguientes = { ...actuales };
                                delete siguientes[descriptor.id];
                                return siguientes;
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Borrar respuesta
                          </Button>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>

      {retiradas.length > 0 && (
        <section aria-label="Descriptores retirados" className="space-y-3">
          <h3 className="font-medium">Descriptores retirados</h3>
          {retiradas.map((respuesta) => (
            <article key={respuesta.descriptor_id} className="rounded-md border p-3 space-y-2">
              <h4>{respuesta.descriptor.nombre} (descriptor retirado)</h4>
              <p>{[respuesta.nota, respuesta.valor_numerico, respuesta.valor_texto].filter((valor) => valor != null && valor !== '').join(' · ') || '—'} {respuesta.descriptor.unidad}</p>
              {respuesta.fecha_observada && <p>Fecha observada: {formatearFecha(respuesta.fecha_observada)}</p>}
              {respuesta.foto_path && <FotoDescriptor descriptorId={respuesta.descriptor_id} fotoPath={respuesta.foto_path}
                soloLectura alCambiar={() => undefined} alBorrar={() => undefined} />}
            </article>
          ))}
        </section>
      )}
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <EstadoBorradorLocal estado={borrador.estado} errorPersistencia={borrador.errorPersistencia} textoIdle={borrador.persistenciaHabilitada ? "Los campos incompletos se pueden guardar." : "Los cambios se mantienen solo en este formulario mientras se confirma la sesión."} compacto={false} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={cancelar} disabled={mutacion.isPending}>Cancelar</Button>
          <Button type="submit" disabled={mutacion.isPending}>
            <Save className="h-4 w-4" /> {mutacion.isPending ? 'Guardando…' : 'Guardar ficha'}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function FichaForm(props: ComponentProps<typeof FichaFormContenido>) {
  const { user, generacionSesion } = useAuth();
  return <FichaFormContenido key={JSON.stringify([user?.id ?? null, generacionSesion, props.ensayoId, props.ficha?.id])} {...props} />;
}
