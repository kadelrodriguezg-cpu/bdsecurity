import { useVigenciaFormulario } from '@/lib/useVigenciaFormulario';
import { useAuth } from '@/features/auth/AuthContext';
import { EstadoBorradorLocal } from '@/components/shared/EstadoBorradorLocal';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { crearPlanta, listarPlantas } from '@/api/plantas';
import { listarEspecies } from '@/api/especies';
import { useEspacioEspecieOpcional } from '@/features/especies/EspacioEspecie';
import { ESTADOS_ORDEN, ESTADO_LABEL, type EstadoPlanta } from '@/types/domain';
import { sugerirSiguienteCodigo } from '@/lib/codigoSistema';
import { useBorradorLocal } from '@/lib/useBorradorLocal';
import { useMarcarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { SelectorVariedad } from '@/features/plantas/SelectorVariedad';
import { qk } from '@/lib/queryKeys';
import { formatearActividad } from '@/lib/v3/formatos';

interface BorradorNuevaPlanta {
  intentoId?: string;
  especie_id: string;
  codigo_sistema: string;
  estado: EstadoPlanta;
  /**
   * Marca de cruce de prueba. El flujo normal de un operario nunca la toca
   * (default false, detrás de una opción avanzada). Una vez creado el cruce
   * no se puede cambiar: la columna no tiene grant de UPDATE.
   */
  es_prueba: boolean;
  [key: string]: unknown;
}

interface LinajeNuevaPlanta {
  cruzamiento: string;
  mamaId: string | null;
  papaId: string | null;
}

const BORRADOR_INICIAL: BorradorNuevaPlanta = {
  especie_id: '',
  codigo_sistema: '',
  estado: 'sin_empezar',
  es_prueba: false,
};

const LINAJE_INICIAL: LinajeNuevaPlanta = {
  cruzamiento: '',
  mamaId: null,
  papaId: null,
};

function NuevaPlantaPageContenido() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ciclo = useVigenciaFormulario();
  const { user } = useAuth();

  // Autosave de borrador (Bloque 3, Parte 3A de la auditoría de UX): mismo
  // patrón que ProcedimientosSeccion/CosechaForm — localStorage, debounce
  // 1.5s, hidratación síncrona al montar. "Nuevo cruce" era el único
  // formulario real de varios campos sin esta protección.
  const {
    valor: form,
    setValor: setForm,
    estado: estadoBorrador,
    errorPersistencia,
    hayContenido,
    recuperadoEn,
    limpiar,
    descartarRecuperado,
    guardarAhora,
  } = useBorradorLocal<BorradorNuevaPlanta>('borrador:nueva-planta', BORRADOR_INICIAL, { usuarioId: user?.id ?? null });
  useMarcarCambiosSinGuardar(hayContenido);
  const intentoId = useRef(form.intentoId ?? crypto.randomUUID());
  // El linaje es sensible y vive solo en memoria: nunca se serializa en localStorage.
  const [linaje, setLinaje] = useState<LinajeNuevaPlanta>(LINAJE_INICIAL);

  const { data: especies } = useQuery({ queryKey: qk.especies.all, queryFn: listarEspecies });
  // Fase 4: el cruce nuevo nace en la especie pedida («+ Primer cruce» del panorama) o en la especie activa.
  const [parametrosUrl] = useSearchParams();
  const espacio = useEspacioEspecieOpcional();
  const especieInicial = parametrosUrl.get('especie') || espacio?.activa?.id || '';
  useEffect(() => {
    if (form.especie_id || !especieInicial || !especies?.some((e) => e.id === especieInicial)) return;
    setForm((prev) => ({ ...prev, especie_id: especieInicial }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [especieInicial, especies]);

  // Código sugerido (Parte 3B): al elegir especie, se consulta el máximo
  // codigo_sistema ya usado por esa especie y se sugiere (editable) el
  // siguiente correlativo. `codigoTocado` arranca en true si el borrador
  // recuperado ya traía un código propio, para no pisarlo con la sugerencia.
  const [codigoTocado, setCodigoTocado] = useState(() => form.codigo_sistema.trim() !== '');
  const { data: crucesDeLaEspecie } = useQuery({
    queryKey: qk.plantas.lista({ especieId: form.especie_id, incluirPruebas: true }),
    // Acá SÍ se incluyen los cruces de prueba: `codigo_sistema` es único en
    // toda la tabla, así que el correlativo sugerido tiene que ver todos los
    // códigos ocupados. Filtrarlos haría sugerir un código ya tomado.
    queryFn: () => listarPlantas({ especieId: form.especie_id, incluirPruebas: true }),
    enabled: !!form.especie_id,
  });

  useEffect(() => {
    if (codigoTocado || !crucesDeLaEspecie) return;
    const sugerido = sugerirSiguienteCodigo(crucesDeLaEspecie.map((p) => p.codigo_sistema));
    if (sugerido) setForm((prev) => ({ ...prev, codigo_sistema: sugerido }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crucesDeLaEspecie, codigoTocado]);

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => {
      const conservado = guardarAhora({ especie_id: form.especie_id, codigo_sistema: form.codigo_sistema,
        estado: form.estado, es_prueba: form.es_prueba, intentoId: intentoId.current });
      if (!conservado) throw new Error('No se pudo conservar el intento en este dispositivo. No se envió la creación; habilita el almacenamiento local y vuelve a intentarlo.');
      return crearPlanta({
        intentoId: intentoId.current,
        codigo_sistema: form.codigo_sistema.trim(),
        especie_id: form.especie_id,
        estado: form.estado,
        cruzamiento: linaje.cruzamiento.trim() || undefined,
        mamaId: linaje.mamaId ?? undefined,
        papaId: linaje.papaId ?? undefined,
        esPrueba: form.es_prueba,
      });
    },
    onSuccess: (data) => {
      if (!ciclo.sesionVigente()) return;
      queryClient.invalidateQueries({ queryKey: qk.plantas.all });
      if (!ciclo.uiVigente()) return;
      limpiar();
      navigate(`/planta/${data.id}`);
    },
  });

  const set =
    (key: keyof BorradorNuevaPlanta) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      // codigoTocado es monótono (mismo criterio que `tocado` en el resto de
      // los formularios de fase): una vez que el usuario edita el código a
      // mano, ningún cambio posterior de especie lo vuelve a pisar con una
      // sugerencia nueva.
      if (key === 'codigo_sistema') setCodigoTocado(true);
      if (key === 'especie_id' && e.target.value !== form.especie_id) setLinaje(LINAJE_INICIAL);
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
    };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.especie_id || !form.codigo_sistema.trim()) return;
    mutate();
  };

  const disabled = isPending || !form.especie_id || !form.codigo_sistema.trim();

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Nuevo cruce</h1>
      <Card>
        <CardHeader><CardTitle className="text-sm">Datos del cruce</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {recuperadoEn && (
              <Alert variant="success">
                Se recuperó un borrador sin guardar de {formatearActividad(new Date(recuperadoEn).toISOString())}.{' '}
                El linaje no se conserva en el borrador. Si el envío anterior se confirmó, reintentar recuperará ese cruce para revisarlo.{' '}
                <button type="button" className="underline" onClick={() => {
                  descartarRecuperado();
                  intentoId.current = crypto.randomUUID();
                  setLinaje(LINAJE_INICIAL);
                }}>
                  Descartar
                </button>
              </Alert>
            )}

            <div className="space-y-1">
              <Label htmlFor="especie">Especie *</Label>
              <Select id="especie" value={form.especie_id} onChange={set('especie_id')} required>
                <option value="">Selecciona una especie</option>
                {especies?.map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="codigo">Código de sistema *</Label>
              <Input
                id="codigo"
                value={form.codigo_sistema}
                onChange={set('codigo_sistema')}
                placeholder="Ej. 02-025"
                required
              />
              {!codigoTocado && form.especie_id && form.codigo_sistema && (
                <p className="text-xs text-ink-3">Sugerido a partir del último código de esta especie — editable.</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="estado">Estado inicial</Label>
              <Select id="estado" value={form.estado} onChange={set('estado')}>
                {ESTADOS_ORDEN.map((s) => (
                  <option key={s} value={s}>{ESTADO_LABEL[s]}</option>
                ))}
              </Select>
            </div>

            <fieldset className="space-y-3 rounded border p-3">
              <legend className="px-1 text-xs font-semibold text-ink-3">Linaje genético</legend>
              <div className="space-y-1">
                <Label htmlFor="cruzamiento">Cruzamiento</Label>
                <Input
                  id="cruzamiento"
                  value={linaje.cruzamiento}
                  onChange={(evento) => setLinaje((actual) => ({ ...actual, cruzamiento: evento.target.value }))}
                  placeholder="Ej. 01-003 × 01-007"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SelectorVariedad
                  id="mama"
                  label="Mamá"
                  especieId={form.especie_id || null}
                  valorId={linaje.mamaId}
                  onCambiar={(id) => setLinaje((actual) => ({ ...actual, mamaId: id }))}
                />
                <SelectorVariedad
                  id="papa"
                  label="Papá"
                  especieId={form.especie_id || null}
                  valorId={linaje.papaId}
                  onCambiar={(id) => setLinaje((actual) => ({ ...actual, papaId: id }))}
                />
              </div>
            </fieldset>

            {/* Opción avanzada, deliberadamente poco prominente: el flujo
                normal de un operario nunca debería tocarla. Es la única
                oportunidad de marcarla — después no es editable. */}
            <details className="rounded border border-line px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-ink-3">Opciones avanzadas</summary>
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={form.es_prueba}
                  onChange={(evento) => setForm((prev) => ({ ...prev, es_prueba: evento.target.checked }))}
                />
                <span>
                  Es un cruce de prueba
                  <span className="block text-xs text-ink-3">
                    No es población real. Queda fuera de los listados y del ranking, y es el único tipo de cruce que
                    se puede eliminar de forma permanente. No se puede cambiar después de crear el cruce.
                  </span>
                </span>
              </label>
            </details>

            {error && <p className="text-sm text-danger">{(error as Error).message}</p>}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={disabled}>
                {isPending ? 'Guardando…' : 'Crear cruce'}
              </Button>
              <EstadoBorradorLocal estado={estadoBorrador} errorPersistencia={errorPersistencia} />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function NuevaPlantaPage() {
  const { user, generacionSesion } = useAuth();
  return <NuevaPlantaPageContenido key={JSON.stringify([user?.id ?? null, generacionSesion])} />;
}
