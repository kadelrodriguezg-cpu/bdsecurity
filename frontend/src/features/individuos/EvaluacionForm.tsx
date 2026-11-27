import type { ComponentProps, ReactNode } from 'react';
import { useVigenciaFormulario } from '@/lib/useVigenciaFormulario';
import { useAuth } from '@/features/auth/AuthContext';
import { EstadoBorradorLocal } from '@/components/shared/EstadoBorradorLocal';
import { CLASE_ESTADO_ENCABEZADO, EncabezadoEvaluacion } from '@/components/shared/EncabezadoEvaluacion';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, ClipboardCheck, ClipboardX, FileEdit, Save, TriangleAlert, X } from 'lucide-react';
import {
  actualizarEvaluacion,
  buscarBorradorDeRonda,
  crearEvaluacion,
  obtenerReferenciasEvaluacion,
  type EstadoEvaluacion,
  type EvaluacionRow,
  type TipoRonda,
} from '@/api/rondas';
import { useBorradorLocal } from '@/lib/useBorradorLocal';
import { useMarcarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';
import { AYUDA_BUEN_ESTADO, exigeMuestraDeFrutos, exportableCalculado } from '@/lib/esquemaFase/evaluacionAnual';
import { useEspecieDeCruce, useEsquemaEvaluacionAnualDeEspecie } from '@/lib/esquemaFase/useEsquemaFase';
import { descriptoresDe } from '@/lib/esquemaFase/tipos';
import { contarObligatorios, NIVEL_SECCION_LABEL, obligatoriosQueFaltan, resumenSecciones } from '@/lib/esquemaFase/protocolo';
import { avisoFueraDeRango, CLAVES_NUMERICAS, validarValorNumerico } from '@/lib/esquemaFase/limites';
import { obtenerProtocolo, obtenerProtocoloVigente } from '@/api/protocolo';
import { hoyChileISO } from '@/lib/fechas';
import { nombreCorto } from '@/lib/nombres';
import { qk } from '@/lib/queryKeys';
import { tipoErrorApi } from '@/api/client';
import { CampoFecha } from '@/components/ui/campo-fecha';
import { cn } from '@/lib/utils';
import { Stepper1a5 } from './Stepper1a5';
import { SelectorNiveles } from './SelectorNiveles';
import { CampoNumerico } from '@/components/ui/campo-numerico';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { formatearActividad, formatearFecha } from '@/lib/v3/formatos';

/** Lo que el formulario informa al guardar: cuántos obligatorios (o descriptores, sin protocolo) quedaron cargados (U-19). */
export interface ResumenGuardado { llenos: number; total: number }

interface DescriptoresForm {
  evaluador: string;
  observaciones: string;
  sin_muestra?: boolean;
  cantidad_frutos: string;
  peso_total_g: string;
  brotacion?: number;
  floracion?: number;
  cuaja?: number;
  concentracion_cosecha?: number;
  distribucion_flores_frutos?: number;
  calibre_mm: string;
  firmeza?: number;
  color?: number;
  bloom?: number;
  brix: string;
  cicatriz?: number;
  rend_kg_planta: string;
  pct_buen_estado_15d: string;
  pct_buen_estado_30d: string;
  pct_buen_estado_45d: string;
  dano_calor?: number;
  golpe_sol?: number;
  caida_fruto?: number;
  n_varas_basales: string;
  n_varas_con_flor: string;
  n_flores_varas_basales: string;
  n_frutos_varas_basales: string;
  altura_brote_mm: string;
  diametro_brote_mm: string;
  vigor_vegetativo?: number;
  color_follaje?: number;
  presencia_yemas_florales?: number;
  fecha_inicio_floracion: string;
  precocidad?: number;
  [key: string]: unknown;
}

const VALOR_INICIAL: DescriptoresForm = {
  evaluador: '',
  observaciones: '',
  cantidad_frutos: '',
  peso_total_g: '',
  calibre_mm: '',
  brix: '',
  rend_kg_planta: '',
  pct_buen_estado_15d: '',
  pct_buen_estado_30d: '',
  pct_buen_estado_45d: '',
  n_varas_basales: '',
  n_varas_con_flor: '',
  n_flores_varas_basales: '',
  n_frutos_varas_basales: '',
  altura_brote_mm: '',
  diametro_brote_mm: '',
  fecha_inicio_floracion: '',
};

// Definición única de descriptores (lib/esquemaFase); el formulario todavía
// dibuja sus campos a mano hasta el esquema de fase del Sprint 1.


/** Mapea una fila de evaluación ya guardada (números) al shape del form (strings en los campos numéricos libres). */
function filaAForm(fila: EvaluacionRow): DescriptoresForm {
  return {
    evaluador: fila.evaluador ?? '',
    observaciones: fila.observaciones ?? '',
    sin_muestra: fila.sin_muestra ?? undefined,
    cantidad_frutos: fila.cantidad_frutos != null ? String(fila.cantidad_frutos) : '',
    peso_total_g: fila.peso_total_g != null ? String(fila.peso_total_g) : '',
    brotacion: fila.brotacion ?? undefined,
    floracion: fila.floracion ?? undefined,
    cuaja: fila.cuaja ?? undefined,
    concentracion_cosecha: fila.concentracion_cosecha ?? undefined,
    distribucion_flores_frutos: fila.distribucion_flores_frutos ?? undefined,
    calibre_mm: fila.calibre_mm != null ? String(fila.calibre_mm) : '',
    firmeza: fila.firmeza ?? undefined,
    color: fila.color ?? undefined,
    bloom: fila.bloom ?? undefined,
    brix: fila.brix != null ? String(fila.brix) : '',
    cicatriz: fila.cicatriz ?? undefined,
    rend_kg_planta: fila.rend_kg_planta != null ? String(fila.rend_kg_planta) : '',
    pct_buen_estado_15d: fila.pct_buen_estado_15d != null ? String(fila.pct_buen_estado_15d) : '',
    pct_buen_estado_30d: fila.pct_buen_estado_30d != null ? String(fila.pct_buen_estado_30d) : '',
    pct_buen_estado_45d: fila.pct_buen_estado_45d != null ? String(fila.pct_buen_estado_45d) : '',
    dano_calor: fila.dano_calor ?? undefined,
    golpe_sol: fila.golpe_sol ?? undefined,
    caida_fruto: fila.caida_fruto ?? undefined,
    n_varas_basales: fila.n_varas_basales != null ? String(fila.n_varas_basales) : '',
    n_varas_con_flor: fila.n_varas_con_flor != null ? String(fila.n_varas_con_flor) : '',
    n_flores_varas_basales: fila.n_flores_varas_basales != null ? String(fila.n_flores_varas_basales) : '',
    n_frutos_varas_basales: fila.n_frutos_varas_basales != null ? String(fila.n_frutos_varas_basales) : '',
    altura_brote_mm: fila.altura_brote_mm != null ? String(fila.altura_brote_mm) : '',
    diametro_brote_mm: fila.diametro_brote_mm != null ? String(fila.diametro_brote_mm) : '',
    vigor_vegetativo: fila.vigor_vegetativo ?? undefined,
    color_follaje: fila.color_follaje ?? undefined,
    presencia_yemas_florales: fila.presencia_yemas_florales ?? undefined,
    fecha_inicio_floracion: fila.fecha_inicio_floracion ?? '',
    precocidad: fila.precocidad ?? undefined,
  };
}

function estaLleno(valor: unknown): boolean {
  return valor !== undefined && valor !== null && valor !== '';
}

/** Descriptores con valor entre los que usa la especie (fase 4). */
function contarLlenos(d: DescriptoresForm, claves: readonly (keyof DescriptoresForm)[]): number {
  return claves.filter((key) => estaLleno(d[key])).length;
}

function numeroONull(valor: string): number | null {
  return valor.trim() === '' ? null : Number(valor);
}

function validarFechaFenologica(valor: string): string | null {
  if (valor === '') return null;
  if (valor < '2000-01-01' || valor > '2100-12-31') {
    return 'Inicio de floración debe estar entre los años 2000 y 2100.';
  }
  return null;
}

function EvaluacionFormContenido({
  rondaId,
  plantaId,
  codigoIndividuo,
  numeroRonda,
  tipoRonda = 'anual',
  onGuardado,
  onCerrar,
  onTocadoChange,
  variante = 'hoja',
  siguiente,
  textoVolver,
  barraIzquierda,
  avisoVisitaNueva,
  barraDerecha,
}: {
  rondaId: string;
  plantaId: string;
  codigoIndividuo?: string;
  numeroRonda?: number;
  /** Serie de la ronda (la multisitio tiene sus propios protocolos); por defecto la anual. */
  tipoRonda?: TipoRonda;
  /**
   * Se llama tras guardar; recibe el estado guardado (borrador o completa) y, al finalizar, qué acción se eligió (G12):
   * «seguir» (el botón principal) o «volver» (la segunda acción, `textoVolver`).
   */
  onGuardado?: (estado: Extract<EstadoEvaluacion, 'borrador' | 'completa'>, resumen?: ResumenGuardado, destino?: 'seguir' | 'volver') => void;
  onCerrar?: () => void;
  onTocadoChange?: (tocado: boolean) => void;
  /** 'pantalla': pantalla completa (índice, panel «Antes de finalizar», una sección por pantalla en celular). */
  variante?: 'hoja' | 'pantalla';
  /** Código corto del siguiente pendiente: el botón dice «Finalizar y seguir con …». */
  siguiente?: string;
  /** Fase 5 (G12): con `siguiente`, la segunda acción al cerrar, p. ej. «Finalizar y volver a la planilla». */
  textoVolver?: string;
  /** U-09: la ronda ya tiene una evaluación cerrada; este formulario agrega una visita nueva y lo dice arriba. */
  avisoVisitaNueva?: string;
  barraIzquierda?: ReactNode;
  barraDerecha?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const ciclo = useVigenciaFormulario();
  const { user, esAdmin, perfil } = useAuth();
  // U-20: el evaluador arranca con el nombre corto de quien está en la cuenta (editable); un valor inicial no cuenta como cambio.
  const evaluadorPorDefecto = nombreCorto(perfil?.nombre);
  const [error, setError] = useState<string | null>(null);
  // G12: qué acción de cierre se eligió («seguir» con el siguiente o «volver» a la planilla); se lee al terminar de guardar.
  const destinoFinalizar = useRef<'seguir' | 'volver'>('seguir');
  // U-04: guardado que falló por red; «Reintentar» lo repite con la misma
  // clave de idempotencia, así que nunca duplica la evaluación.
  const [reintentoRed, setReintentoRed] = useState<Extract<EstadoEvaluacion, 'borrador' | 'completa'> | null>(null);
  const [intentoValidacion, setIntentoValidacion] = useState<Extract<EstadoEvaluacion, 'borrador' | 'completa'> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const resumenRef = useRef<HTMLDivElement>(null);
  const [fecha, setFecha] = useState(hoyChileISO);
  // Generada una sola vez al montar el formulario (no en cada click de
  // guardar) -- identifica el INTENTO de guardado, no el contenido. Se
  // regenera solo cuando el formulario se resetea explícitamente
  // (descartar borrador / tras guardar con éxito), nunca en cada submit.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const clave = `borrador:evaluacion:${rondaId}`;
  const {
    valor: d,
    setValor: setD,
    estado: estadoBorrador,
    errorPersistencia,
    hayContenido,
    recuperadoEn,
    limpiar,
    descartarRecuperado,
  } = useBorradorLocal<DescriptoresForm>(clave, { ...VALOR_INICIAL, evaluador: evaluadorPorDefecto }, { usuarioId: user?.id ?? null });

  const { data: referencias } = useQuery({
    queryKey: qk.evaluaciones.referencias(rondaId, fecha),
    queryFn: () => obtenerReferenciasEvaluacion(rondaId, fecha),
  });

  // Borradores huérfanos (hallazgo Grave del E2E, Fase 4): antes "Nueva
  // evaluación" siempre abría en blanco sin revisar si esta ronda ya tenía
  // un borrador sin terminar — cada intento fallido dejaba un borrador más,
  // sin límite ni forma de descartarlo. Ahora se detecta antes de mostrar el
  // formulario y se ofrece continuar o descartar explícitamente. Consulta
  // propia (qk.evaluaciones.borrador), separada de qk.evaluaciones.ronda que
  // usa EvaluacionesLista: el historial filtra completa/corregida, pero este
  // formulario necesita ver un borrador aunque el historial nunca lo muestre.
  const borradorQuery = useQuery({
    queryKey: qk.evaluaciones.borrador(rondaId),
    queryFn: () => buscarBorradorDeRonda(rondaId),
  });
  const borradorExistente = borradorQuery.data ?? null;
  const [decisionTomada, setDecisionTomada] = useState(false);
  const [evaluacionIdEnEdicion, setEvaluacionIdEnEdicion] = useState<string | null>(null);
  const [versionEnEdicion, setVersionEnEdicion] = useState<string | null>(null);
  // Protocolo (Fase 2): una evaluación nueva usa el vigente de la ronda; un
  // borrador que se continúa conserva el suyo (null si es anterior a los
  // protocolos). `undefined` = evaluación nueva.
  const [protocoloIdEnEdicion, setProtocoloIdEnEdicion] = useState<string | null | undefined>(undefined);
  const protocoloQuery = useQuery({
    queryKey: protocoloIdEnEdicion !== undefined
      ? qk.protocolo.porId(protocoloIdEnEdicion ?? 'sin-protocolo')
      : qk.protocolo.vigente(plantaId, numeroRonda ?? 0, tipoRonda),
    queryFn: () => (protocoloIdEnEdicion !== undefined
      ? (protocoloIdEnEdicion ? obtenerProtocolo(protocoloIdEnEdicion) : Promise.resolve(null))
      : obtenerProtocoloVigente(plantaId, numeroRonda as number, tipoRonda)),
    enabled: protocoloIdEnEdicion !== undefined || numeroRonda !== undefined,
    retry: false,
  });
  const protocolo = protocoloQuery.data ?? null;
  const [seccionesAgregadas, setSeccionesAgregadas] = useState<ReadonlySet<string>>(new Set());
  const [seccionActiva, setSeccionActiva] = useState<string>('fenologia');
  const [preguntarFaltantes, setPreguntarFaltantes] = useState(false);

  const continuarBorrador = () => {
    if (!borradorExistente) return;
    limpiar(); // el autosave local, si existe, no debe pisar los valores ya guardados en el servidor
    setD(filaAForm(borradorExistente));
    setFecha(borradorExistente.fecha);
    setEvaluacionIdEnEdicion(borradorExistente.id);
    setVersionEnEdicion(borradorExistente.updated_at);
    setProtocoloIdEnEdicion(borradorExistente.protocolo_id ?? null);
    setDecisionTomada(true);
  };

  const descartarBorrador = useMutation({
    // motivo_cambio es obligatorio para cualquier transición a 'anulada'
    // (validar_evaluacion_integridad) — texto fijo porque el autodescarte de
    // un borrador propio no necesita pedirle una razón al usuario, solo
    // dejar rastro de auditoría coherente con el resto del sistema.
    mutationFn: () => actualizarEvaluacion(borradorExistente!.id, { estado: 'anulada', motivo_cambio: 'Borrador descartado por el autor' }, borradorExistente!.updated_at),
    onSuccess: () => {
      if (!ciclo.sesionVigente()) return;
      // El borrador recién anulado ya no debe ofrecerse para continuar.
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.borrador(rondaId) });
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.ronda(rondaId) });
      // La anulación ya está confirmada: el borrador local se retira aunque la hoja se haya cerrado (misma sesión).
      limpiar();
      if (!ciclo.uiVigente()) return;
      setError(null);
      setD(VALOR_INICIAL);
      setIdempotencyKey(crypto.randomUUID());
      setDecisionTomada(true);
    },
    onError: (e) => {
      if (!ciclo.uiVigente()) return;
      setError(e instanceof Error ? e.message : 'No se pudo descartar el borrador.');
    },
  });

  useEffect(() => {
    onTocadoChange?.(hayContenido);
  }, [hayContenido, onTocadoChange]);
  useMarcarCambiosSinGuardar(hayContenido); // actualización automática de la app: nunca recarga con la evaluación a medias

  // Fase 4: el formulario muestra solo los descriptores que usa la especie del cruce, con sus etiquetas propias.
  const esquemaEspecie = useEsquemaEvaluacionAnualDeEspecie(useEspecieDeCruce(plantaId));
  const clavesActivas = descriptoresDe(esquemaEspecie).map((c) => c.clave) as (keyof DescriptoresForm)[];
  const TOTAL_DESCRIPTORES = clavesActivas.length;
  const usa = (clave: string) => esquemaEspecie.campos.find((c) => c.clave === clave)?.activo !== false;
  /** Textos de la escala de un descriptor (extremos y, si los tiene, cada nivel), del esquema de la especie. */
  const escalaDe = (clave: string) => {
    const escala = esquemaEspecie.campos.find((c) => c.clave === clave)?.escala;
    return {
      labelMin: escala?.etiquetaMinimo ?? '',
      labelMax: escala?.etiquetaMaximo ?? '',
      minimo: (escala?.minimo === 0 ? 0 : 1) as 0 | 1,
      etiquetasNivel: escala?.etiquetasNivel,
    };
  };
  // Descriptor de 3 niveles con texto por nivel (EF12): sale del esquema, no de textos repetidos acá.
  const distribucion = esquemaEspecie.campos.find((c) => c.clave === 'distribucion_flores_frutos');
  const set = <K extends keyof DescriptoresForm>(campo: K) => (valor: DescriptoresForm[K]) =>
    setD((actual) => ({ ...actual, [campo]: valor }));

  const llenos = contarLlenos(d, clavesActivas);
  const obligatorios = protocolo ? contarObligatorios(protocolo.descriptores, d, esquemaEspecie) : null;
  const faltantes = protocolo ? obligatoriosQueFaltan(esquemaEspecie, protocolo.descriptores, d) : [];
  const resumenProtocolo = protocolo
    ? new Map(resumenSecciones(esquemaEspecie, protocolo.descriptores).map((s) => [s.id, s]))
    : null;
  const seccionConValores = (id: string) =>
    esquemaEspecie.campos.some((c) => c.seccion === id && c.rol !== 'derivado' && estaLleno(d[c.clave]));
  // Fuera del protocolo, sin datos y sin pedirla: la sección se pliega con «Agregar».
  // La muestra nunca se pliega si hay datos de fruta: la regla de frutos la exige.
  const plegada = (id: string) =>
    resumenProtocolo?.get(id)?.nivel === 'fuera' && !seccionConValores(id) && !seccionesAgregadas.has(id)
    && !(id === 'muestra' && exigeMuestraDeFrutos(d));
  const nivelSeccion = (id: string): string | null => {
    const s = resumenProtocolo?.get(id);
    if (!s) return null;
    if (s.nivel === 'fuera') return NIVEL_SECCION_LABEL.fuera;
    const llenosSeccion = s.obligatorios.filter((clave) => estaLleno(d[clave])).length;
    return s.obligatorios.length > 0
      ? `${NIVEL_SECCION_LABEL[s.nivel]} · ${llenosSeccion} de ${s.obligatorios.length}`
      : NIVEL_SECCION_LABEL[s.nivel];
  };
  const agregarSeccion = (id: string) => setSeccionesAgregadas((actual) => new Set(actual).add(id));
  const etiquetaSeccion = (id: string) => esquemaEspecie.secciones.find((s) => s.id === id)?.etiqueta ?? id;
  const seccionFuera = (id: string) => (
    <div id={`evaluacion-${id}`} className="flex scroll-mt-44 flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line px-3 py-2">
      <span className="text-small text-ink-3">{etiquetaSeccion(id)} · fuera del protocolo de esta ronda: no se pide ni bloquea el cierre.</span>
      <Button type="button" size="sm" variant="ghost" onClick={() => agregarSeccion(id)}>Agregar {etiquetaSeccion(id).toLowerCase()}</Button>
    </div>
  );
  const cantidadFrutos = numeroONull(d.cantidad_frutos);
  const pesoTotal = numeroONull(d.peso_total_g);
  const pesoPromedio = cantidadFrutos !== null && cantidadFrutos > 0 && pesoTotal !== null
    ? pesoTotal / cantidadFrutos
    : null;
  const nVarasBasales = numeroONull(d.n_varas_basales);
  const nVarasConFlor = numeroONull(d.n_varas_con_flor);
  const nFloresVarasBasales = numeroONull(d.n_flores_varas_basales);
  const nFrutosVarasBasales = numeroONull(d.n_frutos_varas_basales);
  const pctFlores = nVarasBasales !== null && nVarasBasales > 0 && nVarasConFlor !== null
    ? (nVarasConFlor / nVarasBasales) * 100
    : null;
  const pctFrutos = nFloresVarasBasales !== null && nFloresVarasBasales > 0 && nFrutosVarasBasales !== null
    ? (nFrutosVarasBasales / nFloresVarasBasales) * 100
    : null;
  // Poscosecha (fase 4): tres lecturas y el exportable calculado con la regla de la base.
  const poscosecha = [
    ['pct_buen_estado_15d', 'A los 15 días'],
    ['pct_buen_estado_30d', 'A los 30 días'],
    ['pct_buen_estado_45d', 'A los 45 días'],
  ] as const;
  const exportable = exportableCalculado({
    pct_buen_estado_15d: numeroONull(d.pct_buen_estado_15d),
    pct_buen_estado_30d: numeroONull(d.pct_buen_estado_30d),
    pct_buen_estado_45d: numeroONull(d.pct_buen_estado_45d),
  });
  const advertenciaVaras = nVarasBasales !== null && nVarasConFlor !== null && nVarasConFlor > nVarasBasales;
  const advertenciaFrutos = nFloresVarasBasales !== null
    && nFrutosVarasBasales !== null
    && nFrutosVarasBasales > nFloresVarasBasales;

  function validar(estado: Extract<EstadoEvaluacion, 'borrador' | 'completa'>): { mensaje: string; campo?: keyof DescriptoresForm } | null {
    // U-07: validación técnica por descriptor (lib/esquemaFase/limites): número finito, no negativo, entero donde cuenta cosas.
    const validaciones = [
      ...CLAVES_NUMERICAS.map((campo) => ({ campo: campo as keyof DescriptoresForm, mensaje: validarValorNumerico(campo, String(d[campo] ?? '')) })),
      { campo: 'fecha_inicio_floracion' as const, mensaje: validarFechaFenologica(d.fecha_inicio_floracion) },
    ];
    const errorNumero = validaciones.find((validacion) => validacion.mensaje);
    if (errorNumero?.mensaje) return { campo: errorNumero.campo, mensaje: errorNumero.mensaje };
    if (estado === 'borrador') return null;
    // Regla de frutos: la muestra solo se exige si hay datos de fruta o de muestra.
    if (!exigeMuestraDeFrutos(d)) return null;
    if (cantidadFrutos === null || cantidadFrutos <= 0) {
      return { mensaje: 'Hay datos de fruta o de muestra: la cantidad de frutos debe ser mayor que cero para finalizar. Si no se tomó muestra, marca «Sin muestra de frutos».', campo: 'cantidad_frutos' };
    }
    if (pesoTotal === null || pesoTotal <= 0) {
      return { mensaje: 'Hay datos de fruta o de muestra: el peso total debe ser mayor que cero para finalizar. Si no se tomó muestra, marca «Sin muestra de frutos».', campo: 'peso_total_g' };
    }
    return null;
  }

  const errorAsociado = intentoValidacion ? validar(intentoValidacion) : null;
  const atributosError = (campo: keyof DescriptoresForm) => ({
    'aria-invalid': errorAsociado?.campo === campo ? true as const : undefined,
    'aria-describedby': errorAsociado?.campo === campo ? 'evaluacion-error-validacion' : undefined,
  });
  // U-08: el mensaje de cada campo va bajo el campo (aria-invalid, aria-describedby y borde de «revisar»). El panel
  // «Antes de finalizar» no se ve en celular, así que un aviso fijo sobre la barra inferior repite el primer error.
  const erroresCampo = CLAVES_NUMERICAS.flatMap((clave) => {
    const mensaje = validarValorNumerico(clave, String(d[clave] ?? ''));
    return mensaje ? [{ campo: clave as keyof DescriptoresForm, mensaje }] : [];
  });
  const mensajeDe = (campo: keyof DescriptoresForm): string | null =>
    erroresCampo.find((e) => e.campo === campo)?.mensaje ?? (errorAsociado?.campo === campo ? errorAsociado.mensaje : null);
  const primerError: { campo?: keyof DescriptoresForm; mensaje: string } | null = erroresCampo[0] ?? errorAsociado ?? null;
  const irAlCampo = (campo: keyof DescriptoresForm) => {
    const seccion = esquemaEspecie.campos.find((c) => c.clave === campo)?.seccion;
    if (seccion) setSeccionActiva(seccion);
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>(`[id="${campo}"]`)?.focus());
  };

  function intentarGuardar(estado: Extract<EstadoEvaluacion, 'borrador' | 'completa'>, aceptarFaltantes = false) {
    const validacion = validar(estado);
    setIntentoValidacion(estado);
    setError(null);
    setReintentoRed(null);
    if (validacion) {
      setPreguntarFaltantes(false);
      // En celular el campo puede estar en otro paso: se muestra ese paso antes de enfocarlo.
      const seccionDelCampo = esquemaEspecie.campos.find((c) => c.clave === validacion.campo)?.seccion;
      if (seccionDelCampo) setSeccionActiva(seccionDelCampo);
      const enfocar = () => {
        const input = validacion.campo ? formRef.current?.querySelector<HTMLInputElement>(`[id="${validacion.campo}"]`) : null;
        if (input) input.focus();
        else resumenRef.current?.focus();
      };
      enfocar();
      if (variante === 'pantalla' && typeof window !== 'undefined') requestAnimationFrame(enfocar);
      return;
    }
    // Lo obligatorio que falta avisa y no bloquea: se pide confirmar una vez.
    if (estado === 'completa' && faltantes.length > 0 && !aceptarFaltantes) {
      setPreguntarFaltantes(true);
      if (variante === 'pantalla') setSeccionActiva('revisar');
      resumenRef.current?.focus();
      return;
    }
    setPreguntarFaltantes(false);
    mutacion.mutate(estado);
  }

  const cancelar = () => {
    if (hayContenido && !window.confirm('Tienes cambios sin guardar. ¿Descartar el borrador?')) return;
    onCerrar?.();
  };

  const mutacion = useMutation({
    mutationFn: (estado: Extract<EstadoEvaluacion, 'borrador' | 'completa'>) => {
      const errorValidacion = validar(estado);
      if (errorValidacion) throw new Error(errorValidacion.mensaje);
      const campos = {
        fecha,
        estado,
        evaluador: d.evaluador.trim() || undefined,
        observaciones: d.observaciones.trim() || undefined,
        sin_muestra: Boolean(d.sin_muestra),
        cantidad_frutos: cantidadFrutos ?? undefined,
        peso_total_g: pesoTotal ?? undefined,
        brotacion: d.brotacion,
        floracion: d.floracion,
        cuaja: d.cuaja,
        concentracion_cosecha: d.concentracion_cosecha,
        distribucion_flores_frutos: d.distribucion_flores_frutos,
        calibre_mm: numeroONull(d.calibre_mm) ?? undefined,
        firmeza: d.firmeza,
        color: d.color,
        bloom: d.bloom,
        brix: numeroONull(d.brix) ?? undefined,
        cicatriz: d.cicatriz,
        rend_kg_planta: numeroONull(d.rend_kg_planta) ?? undefined,
        // rend_t_ha ya no se pide ni se envía (EF11): una evaluación que lo traía conserva su valor en la base.
        // El % exportable ya no se envía: se calcula con la poscosecha (una evaluación histórica conserva el suyo en la base).
        pct_buen_estado_15d: numeroONull(d.pct_buen_estado_15d) ?? undefined,
        pct_buen_estado_30d: numeroONull(d.pct_buen_estado_30d) ?? undefined,
        pct_buen_estado_45d: numeroONull(d.pct_buen_estado_45d) ?? undefined,
        dano_calor: d.dano_calor,
        golpe_sol: d.golpe_sol,
        caida_fruto: d.caida_fruto,
        n_varas_basales: nVarasBasales ?? undefined,
        n_varas_con_flor: nVarasConFlor ?? undefined,
        n_flores_varas_basales: nFloresVarasBasales ?? undefined,
        n_frutos_varas_basales: nFrutosVarasBasales ?? undefined,
        altura_brote_mm: numeroONull(d.altura_brote_mm) ?? undefined,
        diametro_brote_mm: numeroONull(d.diametro_brote_mm) ?? undefined,
        vigor_vegetativo: d.vigor_vegetativo,
        color_follaje: d.color_follaje,
        presencia_yemas_florales: d.presencia_yemas_florales,
        fecha_inicio_floracion: d.fecha_inicio_floracion || undefined,
        precocidad: d.precocidad,
      };
      // A1-059: al actualizar un borrador, un campo vaciado viaja como null
      // explícito (supabase-js omite undefined y el valor viejo quedaba).
      const conNulos = Object.fromEntries(
        Object.entries(campos).map(([clave, valor]) => [clave, valor === undefined ? null : valor]),
      ) as typeof campos;
      return evaluacionIdEnEdicion
        ? actualizarEvaluacion(evaluacionIdEnEdicion, conNulos, versionEnEdicion ?? '')
        : crearEvaluacion({ ronda_id: rondaId, ...campos }, idempotencyKey);
    },
    onSuccess: (guardada, estadoGuardado) => {
      if (!ciclo.sesionVigente()) return;
      if (ciclo.uiVigente() && 'updated_at' in guardada && typeof guardada.updated_at === 'string') {
        setVersionEnEdicion(guardada.updated_at);
      }
      // Guardar como 'completa' saca la evaluación del borrador activo; guardar
      // como 'borrador' actualiza la misma fila que este formulario ya tenía
      // detectada -- en ambos casos la detección de borrador debe refrescarse.
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.borrador(rondaId) });
      void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.ronda(rondaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.scoring.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.ranking.all });
      void queryClient.invalidateQueries({ queryKey: qk.comparacion.all });
      void queryClient.invalidateQueries({ queryKey: qk.actividad.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
      void queryClient.invalidateQueries({ queryKey: qk.visualizacion.seriesAll });
      void queryClient.invalidateQueries({ queryKey: qk.resumenFinal.all });
      void queryClient.invalidateQueries({ queryKey: qk.protocolo.all });
      // El guardado ya está confirmado en el servidor: limpiar el borrador local y
      // avisar al padre no dependen de que la hoja siga abierta (misma sesión),
      // igual que antes del aislamiento por sesión. Solo el estado del formulario
      // exige que siga montado.
      limpiar();
      if (ciclo.uiVigente()) {
        setError(null);
        setReintentoRed(null);
        setIdempotencyKey(crypto.randomUUID());
      }
      // Prefijo completo, no solo ['ranking','planta',plantaId]: guardar una
      // evaluación también puede mover el ranking por ESPECIE (Ranking
      // General/Parámetro, RankingGlobal, y el widget nuevo del dashboard
      // científico — Sprint 8, 3.f), que usan qk.ranking.categorias/global,
      // no qk.ranking.planta. Sin esto quedaban desactualizados hasta que
      // venciera el staleTime de 30s — mismo patrón de bug de la sección 5
      // del documento maestro, encontrado acá al agregar el widget nuevo.
      // Mismo hallazgo que arriba, aplicado a deltas entre rondas (2.2):
      // ComparacionRondas (qk.comparacion.planta), el delta por individuo de
      // RankingParametro y el panel nuevo del dashboard (qk.comparacion.individuo)
      // tampoco se invalidaban tras guardar una evaluación.
      const resumenGuardado = obligatorios ? { llenos: obligatorios.llenos, total: obligatorios.total } : { llenos, total: TOTAL_DESCRIPTORES };
      if (estadoGuardado === 'completa') onGuardado?.(estadoGuardado, resumenGuardado, destinoFinalizar.current);
      else onGuardado?.(estadoGuardado, resumenGuardado);
    },
    onError: (cause, estadoIntentado) => {
      if (cause instanceof Error && cause.name === 'ConflictoBorradorActivoError') {
        // Otro cliente ganó la carrera. Refrescar transforma el formulario en
        // la pantalla de continuar/descartar ese borrador existente.
        void queryClient.invalidateQueries({ queryKey: qk.evaluaciones.borrador(rondaId) });
      }
      if (!ciclo.uiVigente()) return;
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la evaluación.');
      setReintentoRed(tipoErrorApi(cause) === 'red' ? estadoIntentado : null);
    },
  });

  const calibre = referencias?.calibre_mm;
  const brix = referencias?.brix;

  if (borradorQuery.isLoading) {
    return <p className="text-sm text-ink-3">Comprobando si esta ronda ya tiene un borrador…</p>;
  }

  // A1-061: un borrador ajeno solo lo continúa o descarta su autor o un admin
  // (la base también lo exige); al resto se le dice de quién es, sin botones que fallen.
  const borradorAjeno = Boolean(borradorExistente?.created_by && user && borradorExistente.created_by !== user.id && !esAdmin);
  if (borradorExistente && !decisionTomada && borradorAjeno) {
    return (
      <div className="space-y-3 rounded-md border border-line bg-surface-2 p-4 text-sm text-ink-2">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <FileEdit className="h-4 w-4" /> Esta ronda tiene un borrador de otra persona
        </p>
        <p>
          Guardado el {borradorExistente.fecha} ({formatearActividad(borradorExistente.updated_at)}). Solo quien lo empezó o
          un admin puede continuarlo o descartarlo. Pídele que lo termine o avisa a un admin.
        </p>
        {onCerrar && <Button type="button" size="sm" variant="outline" onClick={onCerrar}>Cerrar</Button>}
      </div>
    );
  }

  if (borradorExistente && !decisionTomada) {
    return (
      <div className="space-y-3 rounded-md border border-brand-c bg-brand-l p-4 text-sm text-brand-ink">
        <p className="flex items-center gap-1.5 font-medium">
          <FileEdit className="h-4 w-4" /> Esta ronda ya tiene un borrador sin terminar
        </p>
        <p>
          Guardado el {borradorExistente.fecha} ({formatearActividad(borradorExistente.updated_at)}), con{' '}
          {contarLlenos(filaAForm(borradorExistente), clavesActivas)} de {TOTAL_DESCRIPTORES} descriptores cargados. ¿Continuar
          editándolo o descartarlo y empezar de nuevo?
        </p>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={continuarBorrador}>
            <FileEdit className="h-4 w-4" /> Continuar borrador
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={descartarBorrador.isPending}
            onClick={() => {
              if (window.confirm('¿Descartar este borrador? No se puede deshacer.')) descartarBorrador.mutate();
            }}
          >
            <ClipboardX className="h-4 w-4" /> {descartarBorrador.isPending ? 'Descartando…' : 'Descartar y empezar de nuevo'}
          </Button>
          {onCerrar && <Button type="button" size="sm" variant="outline" onClick={onCerrar}>Cancelar</Button>}
        </div>
      </div>
    );
  }

  // ---- Disposición (Fase 2, referencia docs/diseno/v2/04 y 08) ----------------
  const pantalla = variante === 'pantalla';
  const etiquetaDe = (id: string) => (id === 'revisar' ? 'Revisar' : id === 'observaciones' ? 'Observaciones' : etiquetaSeccion(id));
  // Una sección sin ningún descriptor que la especie use no se muestra.
  const seccionesCampos = esquemaEspecie.secciones.map((s) => s.id)
    .filter((id) => esquemaEspecie.campos.some((c) => c.seccion === id && c.rol !== 'derivado' && c.activo !== false));
  // Pasos del celular: las secciones visibles (no plegadas) y al final «Revisar».
  const pasos = [...seccionesCampos.filter((id) => !plegada(id)), 'revisar'];
  const pasoActivo = pasos.includes(seccionActiva) ? seccionActiva : pasos[0];
  const indicePaso = pasos.indexOf(pasoActivo);
  const irAPaso = (id: string) => {
    setSeccionActiva(id);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => document.getElementById(`evaluacion-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  };
  // En celular solo se ve el paso activo; en escritorio, todo.
  const soloEnPaso = (id: string) => pantalla && pasoActivo !== id && 'max-md:hidden';
  // Nombres cortos para la barra de pasos del celular (cinco pasos en 358 px).
  const ETIQUETA_PASO: Record<string, string> = { brotes: 'Brotes', fruto: 'Fruto', muestra: 'Muestra', produccion: 'Producción', estres: 'Estrés' };
  // Pantalla completa: dos columnas de campos (las escalas 1–5 no se parten).
  const rejilla = cn('grid grid-cols-1 gap-4 sm:grid-cols-2', !pantalla && 'xl:grid-cols-3');
  // Escritorio: una sección vacía que no es la activa queda en su encabezado con «Empezar».
  const resumida = (id: string) => pantalla && pasoActivo !== id && !seccionConValores(id)
    && !(id === 'muestra' && exigeMuestraDeFrutos(d));
  const progresoSeccion = (id: string) => {
    const s = resumenProtocolo?.get(id);
    if (!s || s.nivel === 'fuera') return null;
    if (s.obligatorios.length === 0) return 'opcional';
    return `${s.obligatorios.filter((clave) => estaLleno(d[clave])).length}/${s.obligatorios.length}`;
  };

  const tarjeta = (id: string, contenido: ReactNode, nota?: ReactNode) => {
    if (plegada(id)) return <div key={id} className={cn(pantalla && pasoActivo !== 'revisar' && 'max-md:hidden')}>{seccionFuera(id)}</div>;
    const activa = pantalla && pasoActivo === id;
    return (
      <section
        key={id}
        id={`evaluacion-${id}`}
        aria-label={etiquetaDe(id)}
        onFocusCapture={() => { if (pantalla && seccionActiva !== id) setSeccionActiva(id); }}
        className={cn(
          'scroll-mt-28 space-y-3 rounded-lg border border-line bg-surface p-4',
          // Celular: la sección ocupa la pantalla, sin tarjeta.
          pantalla && 'max-md:border-0 max-md:bg-transparent max-md:p-0',
          activa && 'md:border-brand md:ring-1 md:ring-brand',
          soloEnPaso(id),
        )}
      >
        <h3 className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-body-l font-semibold text-ink">{etiquetaDe(id)}</span>
          <span className="text-small text-ink-3">
            {nivelSeccion(id)}
            {resumida(id) && (
              <>{nivelSeccion(id) ? ' · ' : ''}<button type="button" className="min-h-tap text-brand underline underline-offset-4" onClick={() => irAPaso(id)}>Empezar</button></>
            )}
          </span>
        </h3>
        {!resumida(id) && <>{nota}{contenido}</>}
      </section>
    );
  };

  const muestraIncompleta = exigeMuestraDeFrutos(d) && ((cantidadFrutos ?? 0) <= 0 || (pesoTotal ?? 0) <= 0);
  // U-07: lo que no pasa la validación técnica impide guardar; lo que cae fuera del rango esperado solo avisa (ámbar),
  // con el mismo texto único que muestra el campo. Un descriptor sin rango_referencia no tiene aviso.
  const imposibles = erroresCampo.map((e) => ({ clave: e.campo, mensaje: e.mensaje }));
  const avisosRango = [
    { clave: 'calibre_mm' as const, etiqueta: 'Calibre', valor: numeroONull(d.calibre_mm), ref: calibre, unidad: 'mm' },
    { clave: 'brix' as const, etiqueta: 'Brix', valor: numeroONull(d.brix), ref: brix, unidad: '°Bx' },
  ].flatMap((x) => {
    if (imposibles.some((i) => i.clave === x.clave)) return [];
    const mensaje = avisoFueraDeRango(x.etiqueta, x.valor, x.unidad, x.ref);
    return mensaje ? [{ clave: x.clave, mensaje }] : [];
  });
  const totalFaltantes = faltantes.reduce((n, s) => n + s.faltan.length, 0);

  // G12: la segunda acción al cerrar solo existe si hay a quién seguir (sin siguiente, finalizar ya vuelve a la planilla).
  const segundaAccion = siguiente && textoVolver ? textoVolver : null;
  const finalizarYVolver = () => { destinoFinalizar.current = 'volver'; intentarGuardar('completa'); };
  const antesDeFinalizar = (
    <section aria-label="Antes de finalizar" className="space-y-2.5 rounded-lg border border-line bg-surface p-4 text-small">
      <h3 className="text-body-l font-semibold text-ink">Antes de finalizar</h3>
      <ul className="space-y-2">
        {muestraIncompleta ? (
          <li className="flex gap-2 text-danger"><X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Falta la muestra de frutos. Impide finalizar porque se cargaron datos de fruta.</span></li>
        ) : exigeMuestraDeFrutos(d) ? (
          <li className="flex gap-2 text-ok"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Muestra de frutos cargada.</li>
        ) : null}
        {protocolo && (totalFaltantes > 0 ? (
          <li className="flex gap-2 text-warn"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Faltan {faltantes.map((s) => `${s.faltan.length} de ${s.etiqueta}`).join(' y ')}. Puedes finalizar igual.</span></li>
        ) : (
          <li className="flex gap-2 text-ok"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Obligatorios completos.</li>
        ))}
        {imposibles.map((x) => (
          <li key={x.clave} className="flex gap-2 text-danger"><X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{x.mensaje} Impide guardar.</span></li>
        ))}
        {imposibles.length + avisosRango.length > 0 ? avisosRango.map((x) => (
          <li key={x.clave} className="flex gap-2 text-warn"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{x.mensaje}</span></li>
        )) : (
          <li className="flex gap-2 text-ok"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Sin valores fuera de rango.</li>
        )}
        {(advertenciaVaras || advertenciaFrutos) && (
          <li className="flex gap-2 text-warn"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{advertenciaVaras ? 'Las varas con flor superan las varas basales. ' : ''}{advertenciaFrutos ? 'Los frutos superan las flores registradas. ' : ''}Se puede guardar igual.</span></li>
        )}
      </ul>
      <div ref={resumenRef} tabIndex={-1} id="evaluacion-error-validacion" className="outline-none">
        {errorAsociado ? <Alert>{errorAsociado.mensaje}</Alert> : error ? <Alert>{error}</Alert> : null}
        {mutacion.isPaused && (
          // Con el teléfono sin conexión, React Query deja el guardado en pausa y lo
          // envía solo al volver la red, con la misma clave de idempotencia.
          <p role="status" className="rounded-md border border-line bg-surface-2 p-3 text-sm text-ink-2">
            Sin conexión: tu evaluación sigue aquí. Se enviará sola cuando vuelva la conexión.
          </p>
        )}
        {!errorAsociado && error && reintentoRed && (
          <Button type="button" variant="outline" className="mt-2" disabled={mutacion.isPending} onClick={() => intentarGuardar(reintentoRed, true)}>
            Reintentar
          </Button>
        )}
        {!errorAsociado && !error && preguntarFaltantes && totalFaltantes > 0 && (
          <div role="alert" className="space-y-2 rounded-md border border-warn bg-warn-t p-3 text-small text-warn">
            <p>
              Faltan {totalFaltantes} obligatorios: {faltantes.map((s) => `${s.faltan.length} de ${s.etiqueta}`).join(' y ')}. Puedes
              finalizar igual; la evaluación competirá con las que midieron las mismas categorías.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => intentarGuardar('completa', true)} disabled={mutacion.isPending}>
                Finalizar igual
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPreguntarFaltantes(false)}>
                Seguir completando
              </Button>
            </div>
          </div>
        )}
      </div>
      {pantalla && (
        // U-05: en el paso «Revisar» del celular, guardar sin finalizar (la barra inferior de escritorio no se ve).
        <Button type="button" variant="outline" className="min-h-[52px] w-full md:hidden" disabled={mutacion.isPending} onClick={() => intentarGuardar('borrador')}>
          <Save className="h-4 w-4" aria-hidden="true" /> Guardar borrador
        </Button>
      )}
      {pantalla && segundaAccion && (
        // G12: en el celular, la segunda acción al cerrar va aquí (la barra inferior tiene un solo botón de finalizar).
        <Button type="button" variant="outline" className="min-h-[52px] w-full md:hidden" disabled={mutacion.isPending} onClick={finalizarYVolver}>
          {segundaAccion}
        </Button>
      )}
    </section>
  );

  const textoFinalizar = mutacion.isPending ? 'Guardando…' : siguiente ? `Finalizar y seguir con ${siguiente}` : 'Finalizar evaluación';

  const visita = (
    <section aria-label="Datos de la visita" className={cn('space-y-3 rounded-lg border border-line bg-surface p-4', pantalla && pasoActivo !== 'revisar' && 'max-md:hidden')}>
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoFecha id="fecha" label="Fecha efectiva" value={fecha} onChange={setFecha} required />
        <div className="space-y-1.5">
          <Label>Año calendario</Label>
          <div className="flex min-h-tap items-center rounded-md border border-line bg-surface-2 px-3 tabular-nums text-body-l">{fecha ? fecha.slice(0, 4) : '—'}</div>
          <p className="text-micro text-ink-3">Se deriva automáticamente de la fecha.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="evaluador">Evaluador (opcional)</Label>
          <Input id="evaluador" placeholder="(cuenta)" value={d.evaluador} onChange={(e) => set('evaluador')(e.target.value)} />
        </div>
      </div>
    </section>
  );

  const entradaNumero = (clave: string, etiqueta: string, { paso, modo, etiquetaExtra = null }: { paso: string; modo: 'numeric' | 'decimal'; etiquetaExtra?: string | null }) => {
    if (!usa(clave)) return null;
    const mensaje = mensajeDe(clave as keyof DescriptoresForm);
    return (
      <div key={clave} className="space-y-1.5">
        <div className="flex items-baseline gap-1.5"><Label htmlFor={clave}>{etiqueta}</Label>{etiquetaExtra && <span className="text-small text-warn">{etiquetaExtra}</span>}</div>
        <Input
          id={clave}
          type="number"
          step={paso}
          min="0"
          inputMode={modo}
          value={String(d[clave] ?? '')}
          onChange={(e) => set(clave)(e.target.value)}
          aria-invalid={mensaje ? true : undefined}
          aria-describedby={mensaje ? `${clave}-error` : undefined}
          className={mensaje ? 'border-danger' : undefined}
        />
        {mensaje && (
          <p id={`${clave}-error`} className="flex items-start gap-1.5 text-small text-danger">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{mensaje}
          </p>
        )}
      </div>
    );
  };

  const contenidoSecciones: Record<string, ReactNode> = {
    fenologia: (
      <div className={rejilla}>
        {usa('brotacion') && <Stepper1a5 label="Brotación" value={d.brotacion} onChange={set('brotacion')} {...escalaDe('brotacion')} />}
        {usa('presencia_yemas_florales') && <Stepper1a5 label="Presencia de yemas florales" value={d.presencia_yemas_florales} onChange={set('presencia_yemas_florales')} {...escalaDe('presencia_yemas_florales')} />}
        {usa('floracion') && <Stepper1a5 label="Floración" value={d.floracion} onChange={set('floracion')} {...escalaDe('floracion')} />}
        <CampoFecha id="fecha_inicio_floracion" label="Inicio de floración" value={d.fecha_inicio_floracion} onChange={set('fecha_inicio_floracion')} min="2000-01-01" max="2100-12-31" ayuda="Fecha fenológica observada; no es la fecha de la visita." />
        {usa('precocidad') && <Stepper1a5 label="Precocidad" value={d.precocidad} onChange={set('precocidad')} {...escalaDe('precocidad')} />}
        {usa('cuaja') && <Stepper1a5 label="Cuaja" value={d.cuaja} onChange={set('cuaja')} {...escalaDe('cuaja')} />}
        {usa('concentracion_cosecha') && <Stepper1a5 label="Concentración cosecha" value={d.concentracion_cosecha} onChange={set('concentracion_cosecha')} {...escalaDe('concentracion_cosecha')} />}
      </div>
    ),
    brotes: (
      <>
        <div className={cn(rejilla, !pantalla && 'xl:grid-cols-4')}>
          {entradaNumero('n_varas_basales', 'Varas basales', { paso: '1', modo: 'numeric' })}
          {entradaNumero('n_varas_con_flor', 'Varas basales con flor', { paso: '1', modo: 'numeric' })}
          {entradaNumero('n_flores_varas_basales', 'Flores en varas basales', { paso: '1', modo: 'numeric' })}
          {entradaNumero('n_frutos_varas_basales', 'Frutos en varas basales', { paso: '1', modo: 'numeric' })}
          {entradaNumero('altura_brote_mm', 'Altura del brote (mm)', { paso: '0.01', modo: 'decimal' })}
          {entradaNumero('diametro_brote_mm', 'Diámetro del brote (mm)', { paso: '0.01', modo: 'decimal' })}
          {usa('vigor_vegetativo') && <Stepper1a5 label="Vigor vegetativo" value={d.vigor_vegetativo} onChange={set('vigor_vegetativo')} {...escalaDe('vigor_vegetativo')} />}
          {usa('color_follaje') && <Stepper1a5 label="Color del follaje" value={d.color_follaje} onChange={set('color_follaje')} {...escalaDe('color_follaje')} />}
          {usa('distribucion_flores_frutos') && distribucion?.escala?.etiquetasNivel && (
            <SelectorNiveles label={distribucion.etiqueta} value={d.distribucion_flores_frutos} onChange={set('distribucion_flores_frutos')} niveles={distribucion.escala.etiquetasNivel} minimo={distribucion.escala.minimo} />
          )}
        </div>
        {(advertenciaVaras || advertenciaFrutos) && (
          <div role="status" className="rounded-md border border-warn bg-warn-l p-3 text-small text-warn">
            {advertenciaVaras && <p>Las varas con flor superan las varas basales. Confirma si los conteos corresponden a momentos distintos.</p>}
            {advertenciaFrutos && <p>Los frutos superan las flores registradas. Confirma si los conteos corresponden a momentos distintos.</p>}
          </div>
        )}
      </>
    ),
    fruto: (
      <>
        <label className="flex min-h-tap items-center gap-2 text-body text-ink-2">
          <input id="sin_muestra" {...atributosError('sin_muestra')} type="checkbox" checked={Boolean(d.sin_muestra)} onChange={(event) => set('sin_muestra')(event.target.checked || undefined)} />
          Sin muestra de frutos (permite finalizar sin cantidad ni peso)
        </label>
        <div className={rejilla}>
          {usa('calibre_mm') && <CampoNumerico label="Calibre" unidad="mm" errorExterno={validarValorNumerico('calibre_mm', d.calibre_mm)} min={calibre?.minimo_esperado ?? undefined} max={calibre?.maximo_esperado ?? undefined} minimoTecnico={0} limiteRevisionInferior={calibre?.limite_revision_inferior} limiteRevisionSuperior={calibre?.limite_revision_superior} notaReferencia={esAdmin ? calibre?.nota : null} modo="referencia" valor={d.calibre_mm} onChange={set('calibre_mm')} />}
          {usa('firmeza') && <Stepper1a5 label="Firmeza" value={d.firmeza} onChange={set('firmeza')} {...escalaDe('firmeza')} />}
          {usa('color') && <Stepper1a5 label="Color" value={d.color} onChange={set('color')} {...escalaDe('color')} />}
          {usa('bloom') && <Stepper1a5 label="Bloom" value={d.bloom} onChange={set('bloom')} {...escalaDe('bloom')} />}
          {usa('brix') && <CampoNumerico label="Brix" unidad="°Bx" errorExterno={validarValorNumerico('brix', d.brix)} min={brix?.minimo_esperado ?? undefined} max={brix?.maximo_esperado ?? undefined} minimoTecnico={0} limiteRevisionInferior={brix?.limite_revision_inferior} limiteRevisionSuperior={brix?.limite_revision_superior} notaReferencia={esAdmin ? brix?.nota : null} modo="referencia" valor={d.brix} onChange={set('brix')} />}
          {usa('cicatriz') && <Stepper1a5 label="Cicatriz" value={d.cicatriz} onChange={set('cicatriz')} {...escalaDe('cicatriz')} />}
        </div>
        {muestraIncompleta && (
          <p className="rounded-md bg-warn-l p-3 text-small text-warn">
            Cargaste datos de fruta, así que <span className="font-semibold">la muestra es necesaria para finalizar</span>: con cantidad y peso se calcula el peso promedio. Si no hubo muestra, marca «Sin muestra de frutos».
          </p>
        )}
      </>
    ),
    muestra: (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {entradaNumero('cantidad_frutos', 'Cantidad de frutos', { paso: '1', modo: 'numeric', etiquetaExtra: muestraIncompleta ? 'necesaria' : null })}
        {entradaNumero('peso_total_g', 'Peso total (g)', { paso: '0.01', modo: 'decimal', etiquetaExtra: muestraIncompleta ? 'necesario' : null })}
        <div className="space-y-1.5">
          <Label>Peso promedio</Label>
          <div className="flex min-h-tap items-center rounded-md border border-line bg-surface-2 px-3 tabular-nums text-body-l">{pesoPromedio === null ? '—' : `${pesoPromedio.toFixed(2)} g`}</div>
          <p className="text-micro text-ink-3">Calculado automáticamente.</p>
        </div>
      </div>
    ),
    produccion: (
      <>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Cobertura floral</Label>
          <div className="flex min-h-tap items-center rounded-md border border-line bg-surface-2 px-3 tabular-nums text-body-l">{pctFlores === null ? '—' : `${pctFlores.toFixed(2)} %`}</div>
          <p className="text-micro text-ink-3">Calculada desde varas con flor / varas basales.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Cuaja en varas basales</Label>
          <div className="flex min-h-tap items-center rounded-md border border-line bg-surface-2 px-3 tabular-nums text-body-l">{pctFrutos === null ? '—' : `${pctFrutos.toFixed(2)} %`}</div>
          <p className="text-micro text-ink-3">Calculada desde frutos / flores en varas basales.</p>
        </div>
        {entradaNumero('rend_kg_planta', 'Rendimiento (kg/planta)', { paso: '0.01', modo: 'decimal' })}
      </div>
      {poscosecha.some(([clave]) => usa(clave)) && (
        <fieldset className="space-y-3 rounded-md border border-line p-3">
          <legend className="px-1 text-small font-semibold text-ink-2">Poscosecha en refrigerador · % de frutos en buen estado</legend>
          <p className="text-small text-ink-3">{AYUDA_BUEN_ESTADO}</p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            {poscosecha.map(([clave, etiqueta]) => usa(clave) && (
              <CampoNumerico key={clave} label={etiqueta} unidad="%" errorExterno={validarValorNumerico(clave, d[clave])} min={0} max={100} valor={d[clave]} onChange={set(clave)} />
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>% exportable: calculado</Label>
            <div className="flex min-h-tap items-center rounded-md border border-line bg-surface-2 px-3 tabular-nums text-body-l">{exportable === null ? 'Sin dato' : `${exportable.toFixed(2).replace('.', ',')} %`}</div>
            <p className="text-micro text-ink-3">Es el valor a los 45 días; si una lectura anterior dio 0 %, es 0. Sin la lectura de 45 días queda sin dato. En el ranking se juntan las lecturas de todas las visitas de la ronda.</p>
          </div>
        </fieldset>
      )}
      </>
    ),
    estres: (
      <div className={rejilla}>
        {usa('dano_calor') && <Stepper1a5 label="Daño por calor" value={d.dano_calor} onChange={set('dano_calor')} {...escalaDe('dano_calor')} />}
        {usa('golpe_sol') && <Stepper1a5 label="Golpe de sol" value={d.golpe_sol} onChange={set('golpe_sol')} {...escalaDe('golpe_sol')} />}
        {usa('caida_fruto') && <Stepper1a5 label="Caída de fruto" value={d.caida_fruto} onChange={set('caida_fruto')} {...escalaDe('caida_fruto')} />}
      </div>
    ),
  };
  const notasSecciones: Record<string, ReactNode> = {
    brotes: <p className="text-small text-ink-3">Conteos y medidas de la misma inspección. Si algo no cuadra se avisa, no se bloquea.</p>,
  };

  const observaciones = (
    <section id="evaluacion-observaciones" aria-label="Observaciones" className={cn('scroll-mt-28 space-y-1.5 rounded-lg border border-line bg-surface p-4', pantalla && pasoActivo !== 'revisar' && 'max-md:hidden')}>
      <Label htmlFor="observaciones">Observaciones (opcional)</Label>
      <Textarea id="observaciones" placeholder="Detalle que no entra en los descriptores…" value={d.observaciones} onChange={(e) => set('observaciones')(e.target.value)} />
    </section>
  );

  const avisos = (
    <>
      {avisoVisitaNueva && <p role="status" className="rounded-md border border-brand bg-brand-s p-3 text-small text-brand-ink">{avisoVisitaNueva}</p>}
      {evaluacionIdEnEdicion && (
        <Alert variant="success">Continuando el borrador guardado el {formatearFecha(fecha)}. Guardar o finalizar actualiza esta misma evaluación, no crea una nueva.</Alert>
      )}
      {recuperadoEn && (
        <Alert variant="success">
          Se recuperó un borrador sin guardar de {formatearActividad(new Date(recuperadoEn).toISOString())}.{' '}
          <button type="button" className="font-semibold underline" onClick={descartarRecuperado}>Descartar</button>
        </Alert>
      )}
    </>
  );

  const subtituloIndividuo = (numeroRonda !== undefined ? `Ronda ${numeroRonda} · ${tipoRonda} ${fecha ? fecha.slice(0, 4) : ''}` : 'Evaluación anual')
    + (d.evaluador.trim() ? ` · evaluador: ${d.evaluador.trim()}` : '');

  const progreso = obligatorios && obligatorios.total > 0 ? (
    <div className="min-w-0 flex-1 space-y-1">
      <p className={cn('text-small text-ink-2', pantalla && 'tabular-nums max-md:text-xs')}>
        {pantalla ? (
          // Celular: solo los obligatorios; la barra de pasos ya muestra el avance por sección.
          <>{obligatorios.llenos} de {obligatorios.total} obligatorios<span className="max-md:hidden"> · protocolo «{protocolo!.nombre}» · {llenos} de {TOTAL_DESCRIPTORES} descriptores</span></>
        ) : `${obligatorios.llenos} de ${obligatorios.total} obligatorios · protocolo «${protocolo!.nombre}» · ${llenos} de ${TOTAL_DESCRIPTORES} descriptores`}
      </p>
      <div className={cn('h-2 overflow-hidden rounded-full bg-track', pantalla && 'max-md:hidden')} role="progressbar" aria-label="Obligatorios del protocolo" aria-valuemin={0} aria-valuemax={obligatorios.total} aria-valuenow={obligatorios.llenos}>
        <div className="h-full origin-left rounded-full bg-primary transition-transform" style={{ transform: `scaleX(${obligatorios.llenos / obligatorios.total})` }} />
      </div>
    </div>
  ) : (
    <div className="min-w-0 flex-1 space-y-1">
      <p className={cn('text-small tabular-nums text-ink-2', pantalla && 'max-md:text-xs')}>{llenos} de {TOTAL_DESCRIPTORES} descriptores{pantalla ? <span className="max-md:hidden"> completos</span> : ' completos'}</p>
      <div className={cn('h-2 overflow-hidden rounded-full bg-track', pantalla && 'max-md:hidden')} role="progressbar" aria-label="Completitud de la evaluación" aria-valuemin={0} aria-valuemax={TOTAL_DESCRIPTORES} aria-valuenow={llenos}>
        <div className="h-full origin-left rounded-full bg-primary transition-transform" style={{ transform: `scaleX(${llenos / TOTAL_DESCRIPTORES})` }} />
      </div>
    </div>
  );

  const botonesGuardar = (
    <>
      {onCerrar && <Button type="button" variant="outline" onClick={cancelar}>Cancelar</Button>}
      <Button type="button" variant="outline" disabled={mutacion.isPending} onClick={() => intentarGuardar('borrador')}>
        <Save className="h-4 w-4" /> Guardar borrador
      </Button>
      {segundaAccion && (
        <Button type="button" variant="outline" disabled={mutacion.isPending} onClick={finalizarYVolver}>
          {segundaAccion}
        </Button>
      )}
      <Button type="submit" disabled={mutacion.isPending}>
        <ClipboardCheck className="h-4 w-4" /> {textoFinalizar}
      </Button>
    </>
  );

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        destinoFinalizar.current = 'seguir';
        intentarGuardar('completa');
      }}
      className={cn(pantalla ? 'pb-28 md:pb-24' : 'space-y-4')}
      noValidate
    >
      {/* Barra superior: individuo, progreso de obligatorios y estado del guardado local. */}
      <div className={cn(
        'z-10 border-b border-line bg-surface',
        pantalla ? 'sticky top-0 -mx-4 mb-4 px-4 py-2 sm:-mx-6 sm:px-6 md:py-3' : 'sticky -top-4 -mx-4 px-4 pb-3 pt-1',
      )}>
        {pantalla ? (
          <EncabezadoEvaluacion
            izquierda={barraIzquierda}
            codigo={codigoIndividuo ?? 'Individuo seleccionado'}
            subtitulo={subtituloIndividuo}
            contador={progreso}
            estado={<EstadoBorradorLocal estado={estadoBorrador} errorPersistencia={errorPersistencia} className={CLASE_ESTADO_ENCABEZADO} ambito={<span className="md:hidden"> · solo en este teléfono</span>} />}
            derecha={barraDerecha}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {barraIzquierda}
            <div className="min-w-0">
              <p className="font-mono text-body-l font-semibold text-ink">{codigoIndividuo ?? 'Individuo seleccionado'}</p>
              <p className="text-small text-ink-3">{subtituloIndividuo}</p>
            </div>
            {progreso}
            <EstadoBorradorLocal estado={estadoBorrador} errorPersistencia={errorPersistencia} />
            {barraDerecha}
          </div>
        )}
        {!pantalla && (
          <nav aria-label="Secciones de la evaluación" className="mt-3 flex gap-1 overflow-x-auto pb-1 text-xs">
            {[...seccionesCampos.map((id) => [id, id === 'brotes' ? 'Brotes y varas' : id === 'fruto' ? 'Fruto' : id === 'muestra' ? 'Muestra' : id === 'estres' ? 'Estrés' : etiquetaDe(id)]), ['observaciones', 'Observaciones']].map(([id, label]) => (
              <a key={id} href={`#evaluacion-${id}`} className="whitespace-nowrap rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-surface-2">{label}</a>
            ))}
          </nav>
        )}
        {pantalla && (
          // Celular: pasos con su avance.
          <ol className="mt-3 flex gap-1.5 md:hidden" aria-label="Pasos de la evaluación">
            {pasos.map((id, i) => (
              <li key={id} className="min-w-0 flex-auto">
                <button type="button" onClick={() => irAPaso(id)} aria-current={id === pasoActivo ? 'step' : undefined} className="flex min-h-tap w-full flex-col justify-start text-left">
                  <span className={cn('block h-1.5 rounded-full', i < indicePaso ? 'bg-brand' : i === indicePaso ? 'bg-brand' : 'bg-track')} />
                  <span className={cn('mt-1 block truncate text-xs', id === pasoActivo ? 'font-semibold text-brand-ink' : 'text-ink-3')}>{ETIQUETA_PASO[id] ?? etiquetaDe(id)}</span>
                  {progresoSeccion(id) && id !== 'revisar' && (
                    <span className={cn('block truncate text-xs tabular-nums', id === pasoActivo ? 'text-brand-ink' : 'text-ink-3')}>{progresoSeccion(id) === 'opcional' ? 'opc.' : progresoSeccion(id)}</span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {pantalla ? (
        <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_19rem]">
          {/* Índice del protocolo (escritorio). */}
          <nav aria-label="Secciones de la evaluación" className="hidden self-start rounded-lg border border-line bg-surface p-3 md:sticky md:top-28 md:block">
            <p className="px-2 pb-1 text-small text-ink-3">{protocolo ? 'Protocolo de la ronda' : 'Secciones'}</p>
            <ul className="space-y-0.5">
              {seccionesCampos.filter((id) => !plegada(id)).map((id) => (
                <li key={id}>
                  <button type="button" onClick={() => irAPaso(id)} aria-current={pasoActivo === id ? 'true' : undefined}
                    className={cn('flex min-h-tap w-full items-center justify-between gap-2 rounded-md px-2 text-left text-small',
                      pasoActivo === id ? 'bg-brand-l text-brand-ink' : 'text-ink-2 hover:bg-surface-2')}>
                    <span>{etiquetaDe(id)}</span>
                    <span className="tabular-nums text-ink-3">{progresoSeccion(id) ?? ''}</span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={() => irAPaso('observaciones')} className="flex min-h-tap w-full items-center rounded-md px-2 text-left text-small text-ink-2 hover:bg-surface-2">Observaciones</button>
              </li>
            </ul>
            {seccionesCampos.some((id) => plegada(id)) && (
              <>
                <p className="px-2 pb-1 pt-3 text-small text-ink-3">Fuera del protocolo</p>
                <ul className="space-y-0.5">
                  {seccionesCampos.filter((id) => plegada(id)).map((id) => (
                    <li key={id}>
                      <button type="button" onClick={() => agregarSeccion(id)} className="flex min-h-tap w-full items-center justify-between rounded-md px-2 text-left text-small text-ink-3 hover:bg-surface-2">
                        <span>{etiquetaDe(id)}</span><span className="text-brand">+ agregar</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </nav>

          <div className="min-w-0 space-y-4">
            {avisos}
            {visita}
            {seccionesCampos.map((id) => tarjeta(id, contenidoSecciones[id], notasSecciones[id]))}
            {observaciones}
          </div>

          {/* Una sola instancia (lleva el foco de los errores): en celular, al inicio del paso
              «Revisar»; en pantallas medianas, bajo el formulario; en xl, a la derecha. */}
          <aside className={cn('min-w-0 self-start md:col-start-2 xl:sticky xl:top-28 xl:col-start-3 xl:row-start-1',
            pasoActivo === 'revisar' ? 'max-md:order-first' : 'max-md:hidden')}>
            {antesDeFinalizar}
          </aside>
        </div>
      ) : (
        <div className="space-y-4">
          {avisos}
          {visita}
          {seccionesCampos.map((id) => tarjeta(id, contenidoSecciones[id], notasSecciones[id]))}
          {observaciones}
          {antesDeFinalizar}
        </div>
      )}

      {pantalla && primerError && (
        <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 flex items-start gap-2 rounded-lg border border-danger bg-danger-l px-3 py-2 text-small text-danger md:hidden">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{primerError.mensaje}</span>
          {primerError.campo && (
            <button type="button" className="min-h-tap shrink-0 px-1 font-semibold underline underline-offset-4" onClick={() => irAlCampo(primerError.campo as keyof DescriptoresForm)}>Ir al campo</button>
          )}
        </div>
      )}

      {pantalla ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {/* Celular: atrás y siguiente paso; en el último, finalizar. */}
          <div className="mx-auto flex max-w-[1360px] gap-2 md:hidden">
            <Button type="button" variant="outline" className="min-h-[52px] flex-1" disabled={indicePaso === 0} onClick={() => irAPaso(pasos[indicePaso - 1])}>
              Atrás
            </Button>
            {/* U-05: el borrador en el servidor también se puede guardar desde el celular. */}
            <Button type="button" variant="outline" className="min-h-[52px] min-w-[52px] px-0" aria-label="Guardar borrador" title="Guardar borrador" disabled={mutacion.isPending} onClick={() => intentarGuardar('borrador')}>
              <Save className="h-5 w-5" aria-hidden="true" />
            </Button>
            {pasoActivo === 'revisar' ? (
              <Button type="submit" className="min-h-[52px] flex-[2]" disabled={mutacion.isPending}>{textoFinalizar}</Button>
            ) : (
              <Button type="button" className="min-h-[52px] flex-[2]" onClick={() => irAPaso(pasos[indicePaso + 1])}>
                {etiquetaDe(pasos[indicePaso + 1])}
              </Button>
            )}
          </div>
          <div className="mx-auto hidden max-w-[1360px] flex-wrap justify-end gap-2 md:flex">
            <span className="mr-auto self-center text-small text-ink-3">{llenos} de {TOTAL_DESCRIPTORES} descriptores</span>
            {botonesGuardar}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <span className="text-small text-ink-3">{llenos} de {TOTAL_DESCRIPTORES} descriptores · progreso informativo</span>
          <div className="flex flex-wrap gap-2">{botonesGuardar}</div>
        </div>
      )}
    </form>
  );
}

export function EvaluacionForm(props: ComponentProps<typeof EvaluacionFormContenido>) {
  const { user, generacionSesion } = useAuth();
  return <EvaluacionFormContenido key={JSON.stringify([user?.id ?? null, generacionSesion, props.plantaId, props.rondaId])} {...props} />;
}
