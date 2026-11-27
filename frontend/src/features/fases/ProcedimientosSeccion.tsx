import type { ComponentProps } from 'react';
import { useVigenciaFormulario } from '@/lib/useVigenciaFormulario';
import { EstadoBorradorLocal } from '@/components/shared/EstadoBorradorLocal';
/** Procedimientos operativos con objetivos por cruce, predio e individuo. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import {
  crearProcedimiento,
  actualizarProcedimiento,
  listarPrediosActivosCruce,
  listarProcedimientos,
  reasignarProcedimiento,
  ESTADO_PROCEDIMIENTO_LABEL,
  type EstadoProcedimiento,
  type ObjetivoProcedimientoInput,
  type Procedimiento,
} from '@/api/procedimientos';
import { listarInsumos, TIPO_INSUMO_LABEL } from '@/api/catalogos';
import { listarIndividuosDePlanta } from '@/api/individuos';
import { listarPerfiles } from '@/api/perfiles';
import { etiquetaTipoProcedimiento } from '@/lib/etiquetas';
import { useAuth } from '@/features/auth/AuthContext';
import { useBorradorLocal } from '@/lib/useBorradorLocal';
import { useMarcarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { hoyChileISO } from '@/lib/fechas';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { qk } from '@/lib/queryKeys';
import { formatearActividad, formatearFecha } from '@/lib/v3/formatos';

const TIPOS = ['poda', 'fertilizacion', 'aplicacion'] as const;
const ESTADOS = Object.keys(ESTADO_PROCEDIMIENTO_LABEL) as EstadoProcedimiento[];
const UNIDADES = ['ml', 'mg', 'g', 'L', 'u'] as const;

interface ProcedimientoBorrador {
  nombre: string;
  tipo: (typeof TIPOS)[number];
  fecha: string;
  insumoId: string;
  cantidad: string;
  unidad: (typeof UNIDADES)[number] | 'otra' | '';
  unidadOtra: string;
  notas: string;
  predioObjetivoId: string;
  individuoObjetivoId: string;
  notaIndividuo: string;
  [key: string]: unknown;
}

const VALOR_INICIAL_PROCEDIMIENTO: ProcedimientoBorrador = {
  nombre: '',
  tipo: 'poda',
  fecha: hoyChileISO(),
  insumoId: '',
  cantidad: '',
  unidad: '',
  unidadOtra: '',
  notas: '',
  predioObjetivoId: '',
  individuoObjetivoId: '',
  notaIndividuo: '',
};

function objetivosPara(procedimiento: Procedimiento): ObjetivoProcedimientoInput[] {
  return procedimiento.objetivos;
}

/** Objetivos adicionales (predio/individuo) de un procedimiento -- el objetivo
 * 'cruzamiento' no se lista porque es implícito en todo procedimiento de esta sección. */
function objetivosAdicionales(procedimiento: Procedimiento): ObjetivoProcedimientoInput[] {
  return procedimiento.objetivos.filter((objetivo) => objetivo.tipo !== 'cruzamiento');
}

function ProcedimientosSeccionContenido({ plantaId }: { plantaId: string }) {
  const { user, esAdmin } = useAuth();
  const queryClient = useQueryClient();
  const ciclo = useVigenciaFormulario();
  const { data: procedimientos, isLoading } = useQuery({
    queryKey: qk.procedimientos.planta(plantaId),
    queryFn: () => listarProcedimientos(plantaId),
  });
  const { data: insumos } = useQuery({ queryKey: qk.catalogos.insumos.activos, queryFn: () => listarInsumos(true) });
  const { data: individuos } = useQuery({ queryKey: qk.individuos.lista(plantaId), queryFn: () => listarIndividuosDePlanta(plantaId) });
  const { data: prediosActivos } = useQuery({
    queryKey: qk.procedimientoPredios.activos(plantaId),
    queryFn: () => listarPrediosActivosCruce(plantaId),
  });
  const { data: perfiles } = useQuery({ queryKey: qk.perfiles.all, queryFn: listarPerfiles, enabled: esAdmin });

  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoProcedimiento>('todos');
  const [error, setError] = useState<string | null>(null);
  // Generada una sola vez al montar -- identifica el intento de guardado, no
  // el contenido. Este formulario NO se desmonta tras guardar (sigue visible
  // para registrar el siguiente procedimiento), así que se regenera
  // explícitamente en onSuccess -- a diferencia de EvaluacionForm/PcrForm/
  // BajaForm, que suelen cerrarse (remontar ya trae una key nueva).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // Autosave de borrador (hallazgo #3 de la auditoría pre-lanzamiento,
  // 0.terdecies): mismo mecanismo que EvaluacionForm.tsx -- localStorage,
  // debounce 1.5s, hidratación síncrona al montar. idempotencyKey queda
  // FUERA del objeto persistido a propósito: se regenera por diseño, y
  // guardarla rompería el propósito de la idempotencia.
  const claveBorrador = `borrador:procedimiento:${plantaId}`;
  const {
    valor: form,
    setValor: setForm,
    estado: estadoBorrador,
    errorPersistencia,
    hayContenido,
    recuperadoEn,
    limpiar,
    descartarRecuperado,
  } = useBorradorLocal<ProcedimientoBorrador>(claveBorrador, VALOR_INICIAL_PROCEDIMIENTO, { usuarioId: user?.id ?? null });
  // El formulario sigue montado tras guardar (vuelve a su valor inicial): sin contenido = nada sin guardar.
  useMarcarCambiosSinGuardar(hayContenido);
  const set = <K extends keyof ProcedimientoBorrador>(campo: K) => (valor: ProcedimientoBorrador[K]) =>
    setForm((actual) => ({ ...actual, [campo]: valor }));

  const procedimientosVisibles = useMemo(
    () => (procedimientos ?? []).filter((procedimiento) => filtroEstado === 'todos' || procedimiento.estado === filtroEstado),
    [filtroEstado, procedimientos],
  );

  const invalidar = () => {
    if (!ciclo.sesionVigente()) return;
    void queryClient.invalidateQueries({ queryKey: qk.procedimientos.planta(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
    void queryClient.invalidateQueries({ queryKey: qk.resumenFinal.all });
  };

  const crear = useMutation({
    mutationFn: () => {
      if (!form.nombre.trim()) throw new Error('Indica un nombre para el procedimiento.');
      const objetivos: ObjetivoProcedimientoInput[] = [{ tipo: 'cruzamiento', id: plantaId }];
      if (form.predioObjetivoId) objetivos.push({ tipo: 'predio', id: form.predioObjetivoId });
      if (form.individuoObjetivoId) objetivos.push({ tipo: 'individuo', id: form.individuoObjetivoId, nota: form.notaIndividuo || undefined });
      const unidadFinal = form.unidad === 'otra' ? form.unidadOtra.trim() : form.unidad;
      return crearProcedimiento({
        nombre: form.nombre,
        tipo: form.tipo,
        fechaInicio: form.fecha,
        notas: form.notas || null,
        objetivos,
        insumos: form.insumoId && form.cantidad !== '' ? [{ insumo_id: form.insumoId, cantidad: Number(form.cantidad), unidad: unidadFinal || undefined }] : [],
      }, idempotencyKey);
    },
    onSuccess: () => {
      if (!ciclo.sesionVigente()) return;
      invalidar();
      if (!ciclo.uiVigente()) return;
      setError(null);
      limpiar();
      setForm(VALOR_INICIAL_PROCEDIMIENTO);
      setIdempotencyKey(crypto.randomUUID());
    },
    onError: (cause) => {
      if (!ciclo.uiVigente()) return;
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el procedimiento.');
    },
  });

  const actualizar = useMutation({
    mutationFn: ({ procedimiento, estado }: { procedimiento: Procedimiento; estado: EstadoProcedimiento }) =>
      actualizarProcedimiento({
        id: procedimiento.id,
        nombre: procedimiento.nombre,
        tipo: procedimiento.tipo,
        estado,
        fechaInicio: procedimiento.fecha_inicio,
        fechaFin: estado === 'completado' ? procedimiento.fecha_fin ?? hoyChileISO() : procedimiento.fecha_fin,
        notas: procedimiento.notas,
        objetivos: objetivosPara(procedimiento),
        insumos: procedimiento.insumos,
      }),
    onSuccess: invalidar,
    onError: (cause) => {
      if (!ciclo.uiVigente()) return;
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el procedimiento.');
    },
  });

  const reasignar = useMutation({
    mutationFn: ({ id, responsableId }: { id: string; responsableId: string }) => reasignarProcedimiento(id, responsableId),
    onSuccess: invalidar,
    onError: (cause) => {
      if (!ciclo.uiVigente()) return;
      setError(cause instanceof Error ? cause.message : 'No se pudo reasignar el procedimiento.');
    },
  });

  const nombrePerfil = (id: string) => perfiles?.find((perfil) => perfil.id === id)?.nombre ?? 'Responsable asignado';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sprout className="h-4 w-4 text-primary" /> Procedimientos
          </CardTitle>
          <label className="flex items-center gap-2 text-xs text-ink-3">
            Estado
            <Select value={filtroEstado} onChange={(event) => setFiltroEstado(event.target.value as typeof filtroEstado)} className="h-8">
              <option value="todos">Todos</option>
              {ESTADOS.map((estado) => <option key={estado} value={estado}>{ESTADO_PROCEDIMIENTO_LABEL[estado]}</option>)}
            </Select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="space-y-1.5">
          <h5 className="text-xs font-semibold text-ink-2">Registrados</h5>
          {isLoading ? (
            <p className="text-xs text-ink-3">Cargando…</p>
          ) : procedimientosVisibles.length === 0 ? (
            <p className="text-xs text-ink-3">No hay procedimientos para este filtro.</p>
          ) : (
            <ul className="divide-y rounded-md border text-xs">
              {procedimientosVisibles.map((procedimiento) => {
                const puedeEditar = esAdmin || procedimiento.responsable_id === user?.id;
                return (
                  <li key={procedimiento.id} className="space-y-1.5 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{procedimiento.nombre}</span>
                      <Badge variant="outline">{ESTADO_PROCEDIMIENTO_LABEL[procedimiento.estado]}</Badge>
                    </div>
                    <p className="text-ink-3">{etiquetaTipoProcedimiento(procedimiento.tipo)} · {formatearFecha(procedimiento.fecha_inicio)}</p>
                    {objetivosAdicionales(procedimiento).map((objetivo) => (
                      <p key={`${objetivo.tipo}-${objetivo.id}`} className="text-ink-3">
                        {objetivo.tipo === 'individuo' ? 'Individuo' : 'Predio'}: {objetivo.etiqueta ?? objetivo.id}
                        {objetivo.nota && <span className="italic"> — {objetivo.nota}</span>}
                      </p>
                    ))}
                    {esAdmin && <p className="text-ink-3">Responsable: {nombrePerfil(procedimiento.responsable_id)}</p>}
                    {procedimiento.notas && <p className="text-ink-3">{procedimiento.notas}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {puedeEditar && procedimiento.estado !== 'completado' && procedimiento.estado !== 'cancelado' && (
                        <Select
                          value={procedimiento.estado}
                          disabled={actualizar.isPending}
                          onChange={(event) => actualizar.mutate({ procedimiento, estado: event.target.value as EstadoProcedimiento })}
                          className="h-8 w-32"
                        >
                          {!esAdmin && <option value="planificado">Planificado</option>}
                          {!esAdmin && <option value="en_curso">En curso</option>}
                          {esAdmin && ESTADOS.map((estado) => <option key={estado} value={estado}>{ESTADO_PROCEDIMIENTO_LABEL[estado]}</option>)}
                        </Select>
                      )}
                      {esAdmin && perfiles && (
                        <Select
                          value={procedimiento.responsable_id}
                          disabled={reasignar.isPending}
                          onChange={(event) => reasignar.mutate({ id: procedimiento.id, responsableId: event.target.value })}
                          className="h-8 w-44"
                          aria-label={`Responsable de ${procedimiento.nombre}`}
                        >
                          {perfiles.map((perfil) => <option key={perfil.id} value={perfil.id}>{perfil.nombre}</option>)}
                        </Select>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            crear.mutate();
          }}
          className="space-y-3 border-t pt-3"
        >
          <h5 className="text-xs font-semibold text-ink-2">Registrar procedimiento</h5>
          {recuperadoEn && (
            <Alert variant="success">
              Se recuperó un borrador sin guardar de {formatearActividad(new Date(recuperadoEn).toISOString())}.{' '}
              <button type="button" className="underline" onClick={descartarRecuperado}>
                Descartar
              </button>
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nombre_procedimiento">Nombre</Label>
              <Input id="nombre_procedimiento" value={form.nombre} onChange={(event) => set('nombre')(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tipo_procedimiento">Tipo</Label>
              <Select id="tipo_procedimiento" value={form.tipo} onChange={(event) => set('tipo')(event.target.value as ProcedimientoBorrador['tipo'])}>
                {TIPOS.map((valor) => <option key={valor} value={valor}>{etiquetaTipoProcedimiento(valor)}</option>)}
              </Select>
            </div>
          </div>
          <CampoFecha id="fecha_procedimiento" label="Fecha de inicio" value={form.fecha} onChange={set('fecha')} required />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="predio_objetivo">Objetivo adicional por predio</Label>
              <Select id="predio_objetivo" value={form.predioObjetivoId} onChange={(event) => set('predioObjetivoId')(event.target.value)} disabled={(prediosActivos?.length ?? 0) < 2}>
                <option value="">Solo cruzamiento</option>
                {prediosActivos?.map((predio) => <option key={predio.predio_id} value={predio.predio_id}>{predio.predio_nombre} ({predio.individuos_activos})</option>)}
              </Select>
              {(prediosActivos?.length ?? 0) < 2 && <p className="text-xs text-ink-3">El objetivo por predio requiere individuos activos del cruce en más de un predio.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="individuo_objetivo">Objetivo adicional por individuo</Label>
              <Select id="individuo_objetivo" value={form.individuoObjetivoId} onChange={(event) => set('individuoObjetivoId')(event.target.value)}>
                <option value="">Sin individuo específico</option>
                {individuos?.map((individuo) => <option key={individuo.id} value={individuo.id}>{individuo.codigo_display}</option>)}
              </Select>
              {form.individuoObjetivoId && (
                <div className="space-y-1.5 pt-1.5">
                  <Label htmlFor="nota_individuo_objetivo">Nota del individuo</Label>
                  <Textarea
                    id="nota_individuo_objetivo"
                    value={form.notaIndividuo}
                    onChange={(event) => set('notaIndividuo')(event.target.value)}
                    placeholder="Detalle específico de este individuo, aparte de la nota general del procedimiento"
                  />
                </div>
              )}
            </div>
          </div>

          {form.tipo !== 'poda' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="insumo_procedimiento">Insumo</Label>
                <Select id="insumo_procedimiento" value={form.insumoId} onChange={(event) => set('insumoId')(event.target.value)}>
                  <option value="">Sin insumo</option>
                  {insumos?.map((insumo) => <option key={insumo.id} value={insumo.id}>{insumo.nombre} ({TIPO_INSUMO_LABEL[insumo.tipo]})</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cantidad_procedimiento">Cantidad/dosis</Label>
                <div className="flex gap-2">
                  <Input id="cantidad_procedimiento" type="number" step="0.01" min="0" value={form.cantidad} onChange={(event) => set('cantidad')(event.target.value)} className="flex-1" />
                  <Select
                    id="unidad_procedimiento"
                    aria-label="Unidad de la cantidad/dosis"
                    value={form.unidad}
                    onChange={(event) => set('unidad')(event.target.value as ProcedimientoBorrador['unidad'])}
                    className="w-24"
                  >
                    <option value="">Unidad</option>
                    {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                    <option value="otra">Otra…</option>
                  </Select>
                </div>
                {form.unidad === 'otra' && (
                  <Input
                    aria-label="Especificar otra unidad"
                    value={form.unidadOtra}
                    onChange={(event) => set('unidadOtra')(event.target.value)}
                    placeholder="Especifica la unidad"
                    className="mt-1.5"
                  />
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notas_procedimiento">Notas</Label>
            <Textarea id="notas_procedimiento" value={form.notas} onChange={(event) => set('notas')(event.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={crear.isPending}>{crear.isPending ? 'Guardando…' : 'Guardar procedimiento'}</Button>
            <EstadoBorradorLocal estado={estadoBorrador} errorPersistencia={errorPersistencia} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ProcedimientosSeccion(props: ComponentProps<typeof ProcedimientosSeccionContenido>) {
  const { user, generacionSesion } = useAuth();
  return <ProcedimientosSeccionContenido key={JSON.stringify([user?.id ?? null, generacionSesion, props.plantaId])} {...props} />;
}
