import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { EveclEnsayo, EveclEnsayoEntrada } from '@/api/evecl';
import { PredioLocationPicker, type Coordenadas } from '@/features/catalogos/predios/PredioLocationPicker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const ensayoSchema = z.object({
  codigo_parcela: z.string().trim().min(1, 'Ingresa el código de parcela.'),
  nombre_productor: z.string(),
  empresa: z.string(),
  encargado_predio: z.string(),
  localidad: z.string(),
  direccion: z.string(),
  area_evaluada: z.string(),
  notas: z.string(),
});

type EnsayoFormValues = z.infer<typeof ensayoSchema>;

function textoONull(valor: string): string | null {
  return valor.trim() || null;
}

export function EnsayoForm({
  ensayo,
  guardando,
  error,
  alGuardar,
  alCancelar,
  alTocadoChange,
}: {
  ensayo?: EveclEnsayo;
  guardando: boolean;
  error?: string | null;
  alGuardar: (entrada: EveclEnsayoEntrada) => void;
  alCancelar: () => void;
  alTocadoChange?: (tocado: boolean) => void;
}) {
  const [coordenadas, setCoordenadas] = useState<Coordenadas>(ensayo?.latitud != null && ensayo.longitud != null
    ? { latitud: ensayo.latitud, longitud: ensayo.longitud }
    : null);
  const [coordenadasTocadas, setCoordenadasTocadas] = useState(false);
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<EnsayoFormValues>({
    resolver: zodResolver(ensayoSchema),
    defaultValues: {
      codigo_parcela: ensayo?.codigo_parcela ?? '',
      nombre_productor: ensayo?.nombre_productor ?? '',
      empresa: ensayo?.empresa ?? '',
      encargado_predio: ensayo?.encargado_predio ?? '',
      localidad: ensayo?.localidad ?? '',
      direccion: ensayo?.direccion ?? '',
      area_evaluada: ensayo?.area_evaluada ?? '',
      notas: ensayo?.notas ?? '',
    },
  });

  useEffect(() => alTocadoChange?.(isDirty || coordenadasTocadas), [alTocadoChange, coordenadasTocadas, isDirty]);

  const enviar = (valores: EnsayoFormValues) => alGuardar({
    id: ensayo?.id,
    codigo_parcela: valores.codigo_parcela.trim(),
    nombre_productor: textoONull(valores.nombre_productor),
    empresa: textoONull(valores.empresa),
    encargado_predio: textoONull(valores.encargado_predio),
    localidad: textoONull(valores.localidad),
    direccion: textoONull(valores.direccion),
    latitud: coordenadas?.latitud ?? null,
    longitud: coordenadas?.longitud ?? null,
    area_evaluada: textoONull(valores.area_evaluada),
    notas: textoONull(valores.notas),
  });

  const cancelar = () => {
    if ((isDirty || coordenadasTocadas) && !window.confirm('Tienes cambios sin guardar. ¿Descartar los cambios?')) return;
    alCancelar();
  };

  return (
    <form className="space-y-4" noValidate onSubmit={(evento) => void handleSubmit(enviar)(evento)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="evecl-codigo-parcela">Código de parcela *</Label>
          <Input id="evecl-codigo-parcela" aria-invalid={errors.codigo_parcela ? true : undefined} aria-describedby={errors.codigo_parcela ? 'evecl-codigo-parcela-error' : undefined} data-autofocus className="font-mono" {...register('codigo_parcela')} />
          {errors.codigo_parcela ? <p id="evecl-codigo-parcela-error" className="text-xs text-danger">{errors.codigo_parcela.message}</p> : null}
        </div>
        <div className="space-y-1"><Label htmlFor="evecl-localidad">Localidad</Label><Input id="evecl-localidad" {...register('localidad')} /></div>
        <div className="space-y-1"><Label htmlFor="evecl-productor">Productor</Label><Input id="evecl-productor" {...register('nombre_productor')} /></div>
        <div className="space-y-1"><Label htmlFor="evecl-empresa">Empresa</Label><Input id="evecl-empresa" {...register('empresa')} /></div>
        <div className="space-y-1"><Label htmlFor="evecl-encargado">Encargado del predio</Label><Input id="evecl-encargado" {...register('encargado_predio')} /></div>
        <div className="space-y-1"><Label htmlFor="evecl-area">Área evaluada</Label><Input id="evecl-area" placeholder="Ej. 0,5 ha" {...register('area_evaluada')} /></div>
      </div>
      <div className="space-y-1"><Label htmlFor="evecl-direccion">Dirección</Label><Input id="evecl-direccion" {...register('direccion')} /></div>
      <PredioLocationPicker
        valor={coordenadas}
        alCambiar={(valor) => {
          setCoordenadas(valor);
          setCoordenadasTocadas(true);
        }}
      />
      <div className="space-y-1"><Label htmlFor="evecl-notas-ensayo">Notas</Label><Textarea id="evecl-notas-ensayo" {...register('notas')} /></div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" onClick={cancelar} disabled={guardando}>Cancelar</Button>
        <Button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : ensayo ? 'Guardar cambios' : 'Crear ensayo'}</Button>
      </div>
    </form>
  );
}
