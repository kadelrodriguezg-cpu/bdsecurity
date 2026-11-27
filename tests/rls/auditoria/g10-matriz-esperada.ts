/**
 * G10 — Matriz de permisos ESPERADA (auditoría integral, Corrida 1).
 *
 * Se escribió ANTES de ejecutar nada contra la base: describe lo que DEBERÍA
 * pasar según el modelo de seguridad (CLAUDE.md sección 4, inventario sección 3
 * y 4.1, decisiones documentadas en `frontend/src/api/*.ts`), no lo que hoy
 * hace la base. La prueba `g10-matriz-permisos.test.ts` la compara contra el
 * comportamiento real con usuarios reales; cada diferencia es un hallazgo y
 * queda en `DESVIACIONES_CONOCIDAS` (al final) con su ID.
 *
 * Roles:
 *   anon      sin login (clave anon pelada)
 *   operario  rol operario, NO creó las filas, sin puede_ver_linaje
 *   autor     rol operario que CREÓ las filas de prueba
 *   linaje    rol operario con puede_ver_linaje = true (no creó las filas)
 *   admin     rol admin
 *
 * Resultados por celda (tabla × operación × rol):
 *   permitido             la operación se ejecuta y toca al menos una fila
 *   denegado              error (grant faltante, policy WITH CHECK, trigger)
 *   permitido_sin_efecto  la operación corre pero el RLS la deja en 0 filas
 *
 * Resultados por RPC × rol:
 *   ejecuta           la función corre (sin error de permisos/rol)
 *   rechaza_por_rol   la función corre y se niega por rol/autoría
 *   no_concedida      "permission denied for function" (sin EXECUTE)
 */

export type Rol = 'anon' | 'operario' | 'autor' | 'linaje' | 'admin';
export const ROLES: readonly Rol[] = ['anon', 'operario', 'autor', 'linaje', 'admin'];

export type Real = 'permitido' | 'denegado' | 'permitido_sin_efecto';
export type Op = 'select' | 'insert' | 'update' | 'delete';
export const OPS: readonly Op[] = ['select', 'insert', 'update', 'delete'];

export type RpcResultado = 'ejecuta' | 'rechaza_por_rol' | 'no_concedida';

export const AUT: readonly Rol[] = ['operario', 'autor', 'linaje', 'admin'];
export const ADM: readonly Rol[] = ['admin'];
export const AA: readonly Rol[] = ['autor', 'admin'];
export const NADIE: readonly Rol[] = [];

/**
 * `quien`: roles para los que la operación es `permitido`.
 * Si `quien` está vacío se espera que NO exista ni grant: todo es `denegado`.
 * Si no está vacío se espera que exista el grant y que el RLS filtre al resto
 * (UPDATE/DELETE/SELECT → `permitido_sin_efecto`; INSERT → `denegado`).
 */
export interface OpEsperada {
  quien: readonly Rol[];
  nota?: string;
}
export type TablaEsperada = Record<Op, OpEsperada>;

const t = (select: OpEsperada, insert: OpEsperada, update: OpEsperada, del: OpEsperada): TablaEsperada => ({
  select,
  insert,
  update,
  delete: del,
});
const q = (quien: readonly Rol[], nota?: string): OpEsperada => ({ quien, nota });
const NO = (nota?: string): OpEsperada => ({ quien: NADIE, nota });

/** Catálogo de solo lectura para todo autenticado; escritura solo admin. */
const catalogoAdmin = (): TablaEsperada => t(q(AUT), q(ADM), q(ADM), q(ADM));

export const TABLAS: Record<string, TablaEsperada> = {
  // ---- Auditoría (append-only) ------------------------------------------------
  audit_log: t(
    q(ADM, 'CLAUDE.md 5: SELECT solo admin; escritura solo vía RPC/triggers'),
    NO('sin INSERT directo: lo escriben triggers y RPC SECURITY DEFINER'),
    NO('append-only'),
    NO('append-only'),
  ),

  // ---- Individuos y bajas ------------------------------------------------------
  baja_motivo: t(
    q(AUT),
    NO('INSERT solo por marcar_baja_individuo/dar_baja_individuos (incluye admin)'),
    q(ADM, 'policy baja_motivo_update_admin explícita (corrección del motivo)'),
    NO('baja_motivo_delete_nadie'),
  ),
  individuos: t(
    q(AUT),
    q(AUT, 'DECISIÓN DOCUMENTADA: clonación por INSERT directo (frontend/src/api/individuos.ts:196); created_by = auth.uid()'),
    q(AA, 'solo autor o admin; las columnas de identidad las protege el trigger (ver variantes)'),
    NO('individuos_delete_nadie: sin borrado físico, la baja es estado_vital'),
  ),

  // ---- Cruces ---------------------------------------------------------------
  plantas: t(
    q(AUT, 'SELECT solo de columnas no sensibles (el linaje se prueba en variantes)'),
    q(ADM, 'plantas_insert_admin; el alta real pasa por la UI de admin'),
    q(AUT, 'DECISIÓN PENDIENTE DEL DUEÑO (docs/decision-pendiente-asignacion.md): UPDATE por columnas de fase abierto a todo autenticado'),
    NO('MODELO: el borrado de un cruce solo pasa por borrar_cruzamiento (soft/hard con guardas y snapshot en audit_log); sin DELETE directo ni para admin'),
  ),
  plantas_insumo: t(q(AUT), q(AUT, 'siembra: cualquier operario'), NO('sin UPDATE: se reemplaza con delete+insert'), q(AUT, 'siembra: reemplazo del set completo')),
  plantas_sustrato: t(q(AUT), q(AUT, 'siembra: cualquier operario'), NO('sin UPDATE: se reemplaza con delete+insert'), q(AUT, 'siembra: reemplazo del set completo')),
  polinizacion_evento: t(q(AUT), q(AUT, 'created_by = auth.uid()'), NO('sin UPDATE: solo alta y borrado de la última sesión'), q(AA)),
  cosecha_fruto: t(q(AUT), q(AUT), NO('sin UPDATE'), q(AA)),
  germinacion_evento: t(q(AUT), q(AUT), NO('sin UPDATE'), NO('sin DELETE: el evento de germinación es permanente')),
  registros_evento: t(
    q(AUT, 'los eliminados (soft delete) solo los ve admin'),
    q(AUT),
    q(AA, 'el soft delete (eliminado_at) lo restringe a admin el trigger bloquear_borrado_no_admin; ver variantes'),
    NO('A1-003: bitácora solo soft delete'),
  ),
  evento_archivos: t(q(AUT), q(AUT), NO('sin UPDATE'), q(AA)),

  // ---- Evaluación anual -----------------------------------------------------------
  ronda_evaluacion_anual: t(
    q(AUT),
    NO('MODELO: las rondas nacen solo de iniciar_ronda_esperada, que delega en iniciar_ronda_evaluacion / iniciar_ronda_multisitio (validan fase, individuo vivo y tope de 3); el INSERT directo se salta esas reglas'),
    NO('una ronda no se edita'),
    NO('una ronda no se borra'),
  ),
  evaluaciones: t(
    q(AUT),
    q(AUT, 'frontend/src/api/rondas.ts:190 inserta directo con idempotency_key; policy exige individuo vivo y created_by'),
    q(AA, 'autor solo en borrador; admin corrige/anula'),
    NO('evaluaciones_delete_nadie: se anulan, no se borran'),
  ),
  evaluacion_reducida: t(q(AUT), q(AUT), q(ADM), NO('sin DELETE')),
  pcr_analisis: t(q(AUT), q(AUT), q(ADM), NO('sin DELETE')),
  multisitio: t(q(ADM, 'tabla legado, solo admin'), NO('legado: sin escritura'), NO('legado: sin escritura'), NO('legado: sin escritura')),
  procedimiento_cultivo: t(q(ADM, 'tabla legado, solo admin'), NO('legado: sin escritura'), NO('legado: sin escritura'), NO('legado: sin escritura')),

  // ---- Scoring -----------------------------------------------------------------
  scoring_version: t(q(AUT), q(ADM, 'config científica: solo admin'), q(ADM), NO('sin DELETE')),
  scoring_metrica: t(q(AUT), q(ADM), q(ADM), NO('sin DELETE')),
  scoring_categoria_peso: t(q(AUT), q(ADM), q(ADM), NO('sin DELETE')),
  rango_referencia: t(q(AUT), q(ADM), q(ADM), NO('sin DELETE')),
  ranking_snapshot: t(q(AUT), NO('solo congelar_ranking (admin, por RPC)'), NO('snapshot inmutable'), NO('snapshot inmutable')),
  ranking_snapshot_resultado: t(q(AUT), NO('solo congelar_ranking'), NO('snapshot inmutable'), NO('snapshot inmutable')),
  // Fase 2: esquema de fase, única fuente de descriptores; se mantiene por migraciones.
  esquema_fase_seccion: t(q(AUT), NO('solo por migración'), NO('solo por migración'), NO('solo por migración')),
  esquema_fase_campo: t(q(AUT), NO('solo por migración'), NO('solo por migración'), NO('solo por migración')),
  // Fase 4: qué descriptores usa cada especie; lectura para todos, escritura solo admin (validado y auditado por trigger).
  esquema_campo_especie: t(q(AUT), q(ADM), q(ADM), q(ADM)),
  // Fase 5 (G4): historial de reactivaciones; lectura para autenticados, sin escritura directa (solo reactivar_individuo).
  reactivacion_individuo: t(q(AUT), NO('solo reactivar_individuo (admin, por RPC)'), NO('historial inmutable'), NO('historial inmutable')),
  // Fase 5 (G15): pedidos de corrección; cada quien lee los suyos y el admin todos; se crean solo con pedir_correccion.
  pedido_correccion: t(q(AA, 'fixture = pedido del autor sobre su propia evaluación cerrada'), NO('solo pedir_correccion (el autor, por RPC)'), NO('se resuelve solo al corregir'), NO('historial')),
  // Fase 5 (G6): rangos por edad de una versión de puntaje; lectura para autenticados, se escriben solo por migración (o nueva_version_scoring).
  scoring_metrica_rango_edad: t(q(AUT), NO('solo por migración o nueva_version_scoring'), NO('versionado con la versión de puntaje'), NO('versionado con la versión de puntaje')),
  // Fase 2: protocolo de ronda; versiones inmutables, solo por definir_protocolo_ronda (admin).
  protocolo_ronda: t(q(AUT), NO('solo definir_protocolo_ronda (admin, por RPC)'), NO('versiones inmutables'), NO('versiones inmutables')),
  // Fase 2: una fila de parámetros del ranking por grupos; solo admin la cambia (auditado).
  configuracion_ranking: t(q(AUT), NO('fila única creada por migración'), q(ADM, 'mínimo y umbral de cobertura'), NO('fila única')),

  // ---- Territorio y clima ----------------------------------------------------------
  predio: catalogoAdmin(),
  sector: t(q(AUT), q(ADM), q(ADM), NO('sin DELETE')),
  sitio: t(q(AUT), q(ADM), q(ADM), NO('sin DELETE')),
  emplazamiento_individuo: t(
    q(AUT, 'SELECT por columnas (sin referencia_operativa)'),
    NO('solo registrar_traslado_individuo'),
    NO('solo cierre vía RPC'),
    NO('historial territorial: nunca se borra'),
  ),
  emplazamiento_coordenada: t(q(ADM, 'coordenadas exactas: solo admin'), NO(), NO(), NO()),
  predio_clima_mensual: t(q(AUT), NO('lo escribe el cron/pg_net'), NO(), NO()),
  predio_clima_sync_pendiente: t(NO('cola interna de pg_net: sin acceso por API'), NO(), NO(), NO()),

  // ---- Procedimientos (solo lectura directa; escritura por RPC) ---------------------------
  procedimientos: t(q(AUT), NO('solo crear_procedimiento'), NO('solo actualizar_procedimiento'), NO('sin DELETE')),
  procedimiento_objetivos: t(q(AUT), NO('por RPC'), NO('por RPC'), NO('por RPC')),
  procedimiento_insumos: t(q(AUT), NO('por RPC'), NO('por RPC'), NO('por RPC')),
  procedimiento_reasignaciones: t(q(ADM, 'bitácora de reasignaciones: solo admin'), NO(), NO(), NO()),

  // ---- Catálogos --------------------------------------------------------------------
  especies: t(q(AUT), q(ADM), q(ADM), NO('A1-003: sin borrado físico directo')),
  contenedor: catalogoAdmin(),
  insumo: catalogoAdmin(),
  sustrato: catalogoAdmin(),
  variedades: t(
    q(AUT),
    q(AUT, 'DECISIÓN DOCUMENTADA (frontend/src/api/variedades.ts:42): cualquier operario puede crear una variedad desde el selector'),
    q(ADM, 'renombrar/corregir solo admin (sin pantalla)'),
    NO('sin DELETE'),
  ),

  // ---- Usuarios -------------------------------------------------------------------
  perfiles: t(
    q(AA, 'fixture = perfil del autor: lo ve él y el admin; el resto (otro operario, linaje) no ve perfiles ajenos'),
    q(ADM, 'MODELO: las cuentas se dan de alta en Auth (handle_new_user crea el perfil); perfiles_admin_todo permite INSERT, pero el alta por API no tiene pantalla'),
    q(AA, 'cada uno edita su propio nombre; admin edita cualquiera; rol/puede_ver_linaje/id se prueban en variantes'),
    NO('A1-003: bajas de cuenta por Auth, sin DELETE directo'),
  ),

  // ---- Chat (solo lectura directa; escritura por RPC) ---------------------------------------
  chat_canales: t(q(AA, 'fixture = canal libre creado por el admin con el autor como participante'), NO(), NO(), NO()),
  chat_canal_participantes: t(q(AA), NO(), NO(), NO()),
  chat_mensajes: t(q(AA), NO('solo enviar_mensaje_chat'), NO('los mensajes no se editan'), NO('los mensajes no se borran')),
  chat_lecturas: t(q(AA, 'cada uno ve sus lecturas'), NO(), NO(), NO()),
  chat_menciones: t(q(['autor'], 'el autor fue mencionado: solo ve sus menciones'), NO(), NO(), NO()),

  // ---- Notificaciones push (20261030100000) ---------------------------------------------------
  push_suscripcion: t(
    q(['autor'], 'fixture = suscripción del autor: cada uno ve las suyas'),
    NO('solo registrar_suscripcion_push'),
    NO('sin UPDATE directo'),
    q(['autor'], 'cada uno borra las suyas (cierre de sesión, desactivar)'),
  ),
  push_envio: t(q(['autor'], 'el autor fue mencionado en el fixture: ve su envío'), NO('lo escribe el trigger de chat_menciones'), NO('lo actualiza el cron'), NO()),

  // ---- EVECL ------------------------------------------------------------------------
  evecl_descriptor: t(q(AUT), q(ADM, 'catálogo UPOV'), q(ADM), NO('sin DELETE')),
  evecl_descriptor_estado: t(q(AUT), q(ADM), q(ADM), NO('sin DELETE')),
  evecl_ensayo: t(
    q(AUT),
    q(AUT, 'evecl_guardar_ensayo es el camino de la UI, pero la policy permite INSERT directo con created_by = auth.uid()'),
    q(AA),
    NO('el borrado es lógico (eliminado_at)'),
  ),
  evecl_ficha: t(q(AUT), q(AUT), q(AA), NO('el borrado es lógico (eliminado_at)')),
  evecl_respuesta: t(q(AUT), q(AUT, 'frontend/src/api/evecl.ts inserta/borra respuestas directo'), q(AA, 'autor de la ficha o admin'), q(AA, 'autor de la ficha o admin')),

  // ---- Importador -----------------------------------------------------------------------
  importacion_lote: t(NO('A1-004: sin SELECT directo'), NO('solo previsualizar_importacion_cruces'), NO(), NO()),

  // ---- Vista -----------------------------------------------------------------------------
  plantas_operativas: t(q(AUT, 'vista security_invoker sin linaje'), NO('vista de solo lectura'), NO(), NO()),
};

/** Tablas/vistas del esquema `public` que el RLS no gobierna (solo la vista). */
export const VISTAS = ['plantas_operativas'] as const;

/** Resultado esperado de una celda tabla × operación × rol. */
export function esperado(tabla: string, op: Op, rol: Rol): Real {
  const e = TABLAS[tabla][op];
  if (e.quien.includes(rol)) return 'permitido';
  if (rol === 'anon') return 'denegado';
  if (op === 'insert') return 'denegado';
  return e.quien.length > 0 ? 'permitido_sin_efecto' : 'denegado';
}

/** ¿Se espera algún grant para `authenticated` en esta operación? */
export function grantEsperado(tabla: string, op: Op): boolean {
  return TABLAS[tabla][op].quien.length > 0;
}

// ============================================================================
// RPC
// ============================================================================

export interface RpcEsperada {
  /** Roles para los que la función "ejecuta". El resto: rechaza_por_rol (o no_concedida para anon). */
  quien: readonly Rol[];
  /** Nadie con sesión debería tener EXECUTE (interna/servicio/cron). */
  internaSinEjecutar?: boolean;
  /** Se escribe `quien` pero la prueba NO ejecuta estos roles (efecto irreversible o llamada externa). */
  noProbar?: readonly Rol[];
  nota?: string;
}

const r = (quien: readonly Rol[], nota?: string, extra: Partial<RpcEsperada> = {}): RpcEsperada => ({ quien, nota, ...extra });
const INTERNA = (nota?: string): RpcEsperada => ({ quien: NADIE, internaSinEjecutar: true, nota });

/**
 * Nota de criterio para las funciones auxiliares: las que usan las policies
 * (`es_admin`, `individuo_esta_vivo`, `ronda_individuo_esta_vivo`,
 * `puede_acceder_chat`) o las funciones SECURITY INVOKER del motor de ranking
 * necesitan EXECUTE para `authenticated`: se aceptan como `ejecuta`. Las que
 * nadie usa desde el cliente ni desde una policy deberían estar sin EXECUTE.
 */
export const RPC: Record<string, RpcEsperada> = {
  // ---- Cruces: administración ----------------------------------------------------------
  borrar_cruzamiento: r(ADM, 'admin; hard solo para cruces es_prueba', { noProbar: [] }),
  reiniciar_cruzamiento: r(ADM),
  restaurar_cruzamiento: r(ADM),
  actualizar_linaje: r(ADM, 'único camino de escritura de linaje; solo admin (CLAUDE.md 8), incluso con puede_ver_linaje'),
  obtener_planta: r(AUT, 'único camino de lectura de ficha; el linaje solo se devuelve a admin/puede_ver_linaje'),
  individualizar_plantas: INTERNA('paso 39: firma vieja cerrada para authenticated; la usa su envoltura individualizar_plantas_una_vez (DEFINER)'),
  conteo_cruces_por_estado: r(AUT),
  listar_cruces_analiticos: r(AUT),
  listar_predios_activos_cruzamiento: r(AUT),
  obtener_resumen_individuos: r(AUT),
  resumen_individuos_cruce: r(AUT),

  // ---- Importador (admin) ----------------------------------------------------------------
  previsualizar_importacion_cruces: r(ADM),
  descartar_importacion_cruces: r(ADM),
  caducar_importaciones_cruces: INTERNA('solo cron'),
  redactar_texto_linaje: INTERNA('solo trigger de auditoría'),
  confirmar_importacion_cruces: r(ADM, 'crea cruces en lote', { noProbar: ['admin'] }),
  revertir_importacion: r(ADM, 'archiva cruces', { noProbar: ['admin'] }),
  validar_filas_importacion_cruces: INTERNA('solo service_role'),

  // ---- Individuos y bajas -------------------------------------------------------------------
  marcar_baja_individuo: r(AA, 'autor del individuo o admin (la RPC lo valida)'),
  dar_baja_individuos: r(ADM, 'baja en lote: solo admin (la RPC lo valida; el inventario decía «cualquiera»)', { noProbar: ['admin'] }),
  previsualizar_baja_individuos: r(ADM),
  aplicar_baja_individuos: INTERNA('interna de las RPC de baja'),
  evaluar_baja_individuos: INTERNA('interna de las RPC de baja; solo service_role'),
  registrar_traslado_individuo: r(ADM, 'traslado: solo admin (g4-traslado.test.ts); crea historial territorial que nunca se borra', { noProbar: ['admin'] }),
  individuo_esta_vivo: r(AUT, 'la usa la policy evaluacion_reducida_insert'),
  ronda_individuo_esta_vivo: r(AUT, 'la usan las policies de evaluaciones y pcr_analisis'),
  limite_baja_en_lote: INTERNA('helper puro IMMUTABLE; solo lo llaman previsualizar_baja_individuos y dar_baja_individuos (DEFINER): nadie con sesión necesita ejecutarlo'),
  validar_parametros_baja: INTERNA('helper puro IMMUTABLE; solo lo llaman marcar_baja_individuo y dar_baja_individuos (DEFINER): nadie con sesión necesita ejecutarlo'),
  clave_nombre_variedad: INTERNA('helper puro IMMUTABLE; solo lo llama validar_filas_importacion_cruces (DEFINER): nadie con sesión necesita ejecutarlo'),

  // ---- Evaluación anual -----------------------------------------------------------------
  iniciar_ronda_evaluacion: INTERNA('paso 39: firma vieja cerrada para authenticated; la usa su envoltura iniciar_ronda_esperada (DEFINER)'),
  iniciar_ronda_multisitio: INTERNA('paso 39: firma vieja cerrada para authenticated; la usa su envoltura iniciar_ronda_esperada (DEFINER)'),
  obtener_referencias_evaluacion: r(AUT),
  obtener_procedencia_calidad_ronda: r(AUT, 'la llaman funciones SECURITY INVOKER del motor: necesita EXECUTE'),
  evaluacion_exige_muestra: INTERNA('Fase 2: regla de frutos; solo la llama validar_evaluacion_integridad (DEFINER)'),
  evaluacion_tiene_descriptores_completos: INTERNA('MODELO: nadie la llama (ni cliente, ni policy, ni función); no debería estar expuesta'),

  // ---- Scoring y resultados --------------------------------------------------------------
  nueva_version_scoring: r(ADM, 'config científica: solo admin (sin pantalla)'),
  activar_version_scoring: r(ADM, 'cambia el scoring vigente', { noProbar: ['admin'] }),
  congelar_ranking: r(ADM, 'lo valida la RPC'),
  congelar_ranking_grupos: r(ADM, 'Fase 2; lo valida la RPC'),
  definir_protocolo_ronda: r(ADM, 'Fase 2; lo valida la RPC'),
  obtener_planilla_ronda: r(AUT, 'Fase 2; SECURITY INVOKER'),
  obtener_estados_evaluacion: r(AUT, 'Fase 2; SECURITY INVOKER'),
  estados_descriptores: r(AUT, 'Fase 2; SECURITY INVOKER: la llama obtener_planilla_ronda'),
  descriptores_fuera_de_revision: r(AUT, 'Fase 2; SECURITY INVOKER: la llaman estados_descriptores y el trigger de integridad'),
  validar_descriptores_protocolo: INTERNA('Fase 2; solo la llama definir_protocolo_ronda (DEFINER)'),
  obtener_ranking_por_grupos: r(AUT, 'Fase 2; SECURITY INVOKER'),
  calcular_ranking_grupos: r(AUT, 'Fase 2; SECURITY INVOKER: la llama obtener_ranking_por_grupos'),
  calcular_ranking_base: r(AUT, 'Fase 2; SECURITY INVOKER: motor común del ranking operativo y por grupos'),
  calcular_ranking_nucleo: r(AUT, 'Fase 2 (S2-5); SECURITY INVOKER: motor por conjuntos que envuelven calcular_ranking_base, _operativo y _grupos'),
  obtener_ranking_polinizacion_varietal: r(ADM, 'lee mama_id/papa_id agregado: solo admin (la RPC lo valida)'),
  obtener_ranking_operativo: r(AUT),
  obtener_ranking_global_filtrado: r(AUT),
  obtener_scoring_planta: r(AUT),
  comparar_snapshot_vivo: r(AUT),
  listar_snapshots_ranking: r(AUT),
  obtener_detalle_snapshot: r(AUT),
  obtener_comparacion_rondas: r(AUT),
  obtener_dashboard_cientifico: r(AUT),
  obtener_series_historicas_cientificas: r(AUT),
  // Motor de ranking: expuesto porque lo llaman funciones SECURITY INVOKER.
  calcular_ranking_operativo: r(AUT, 'SECURITY INVOKER: respeta el RLS; la necesitan las RPC INVOKER del ranking'),
  calcular_metricas_evaluacion: r(AUT, 'SECURITY INVOKER; la necesitan obtener_comparacion_rondas y similares'),
  calcular_categorias_evaluacion: r(AUT, 'SECURITY INVOKER; la necesitan obtener_comparacion_rondas y similares'),
  unificar_evaluacion_ronda: r(AUT, 'SECURITY INVOKER; la llama el motor'),
  resolver_scoring_version: r(AUT, 'SECURITY INVOKER; la llama el motor'),
  scoring_version_en_uso: r(AUT, 'la llaman los triggers INVOKER de inmutabilidad (escribe admin con rol authenticated)'),
  codigo_display_numero: r(AUT, 'helper puro; lo llama el motor'),
  extraer_metrica_evaluacion: r(AUT, 'helper IMMUTABLE; lo llama el motor y un trigger'),
  normalizar_metrica_scoring: r(AUT, 'helper puro; lo llama el motor'),
  etiquetar_delta: r(AUT, 'helper puro; lo llama el motor'),
  ronda_contiene_metrica_marcada: r(AUT, 'lo llama el motor INVOKER'),

  // ---- Procedimientos ------------------------------------------------------------------------
  crear_procedimiento: r(AUT),
  actualizar_procedimiento: r(AUT, 'el responsable edita; admin cierra/cancela; con args del responsable'),
  reasignar_procedimiento: r(ADM, 'solo admin'),
  listar_individuos_procedimiento_predio: INTERNA('MODELO: nadie la llama (ni cliente ni función); no debería estar expuesta'),
  procedimiento_planta_auditable: INTERNA('solo service_role'),
  reemplazar_insumos_procedimiento: INTERNA('solo service_role; la llama actualizar_procedimiento (DEFINER)'),
  reemplazar_objetivos_procedimiento: INTERNA('solo service_role; la llama actualizar_procedimiento (DEFINER)'),

  // ---- Territorio y clima -----------------------------------------------------------------------
  obtener_mapa_cruce: r(AUT),
  obtener_resumen_mapa_territorial: r(AUT, 'agregado por sector; sin coordenadas exactas'),
  consultar_mapa_viewport: r(ADM, 'coordenadas exactas: solo admin (la RPC lo valida)'),
  obtener_clima_predio: r(AUT),
  sincronizar_clima_predio: INTERNA('MODELO: dispara una llamada HTTP saliente (pg_net) y escribe en la cola; solo el trigger de predio y el cron deben llamarla. Hoy tiene EXECUTE para authenticated y ningún chequeo de rol'),
  procesar_respuesta_clima_predio: INTERNA('solo cron/pg_net'),
  recolectar_clima_pendiente: INTERNA('solo cron'),
  refrescar_clima_predios: INTERNA('solo cron'),
  sitio_predeterminado_legacy: r(AUT, 'es el DEFAULT de predio.sitio_id: lo evalúa el rol que inserta (admin vía PostgREST), así que necesita EXECUTE'),

  // ---- Chat ----------------------------------------------------------------------------------------
  obtener_canal_chat: r(AUT),
  listar_canales_chat: r(AUT),
  listar_notificaciones_chat: r(AUT),
  marcar_todas_notificaciones_chat_leidas: r(AUT),
  marcar_notificacion_chat_leida: r(AUT),
  crear_canal_libre: r(ADM, 'solo admin'),
  enviar_mensaje_chat: r(AA, 'participantes del canal libre de la prueba: autor (agregado) y admin (creador)'),
  marcar_chat_leido: r(AA, 'participantes'),
  listar_participantes_chat: r(AA, 'participantes'),
  nombres_de_usuarios: r(AUT, 'N15 (v3): solo id y nombre de los ids pedidos, máx. 200; cualquier autenticado'),
  // Fase 4: panorama por especie, estado operativo de cada cruce, descriptores por especie y cierre de temporada.
  panorama_especies: r(AUT, 'fase 4: cifras por especie como la planilla; sin cruces de prueba salvo admin'),
  estado_operativo_cruce: r(AUT, 'fase 4: vivos, ronda actual, pendientes y última actividad de un cruce (RLS del que llama)'),
  ultima_accion_auditada_cruce: r(AUT, 'fase 4: solo fecha y autor de la última acción de trabajo; sin detalle ni linaje'),
  descriptor_activo_en_especie: r(AUT, 'fase 4'),
  contar_valores_descriptor: r(AUT, 'fase 4: cuenta evaluaciones cerradas con valor (las evaluaciones ya son legibles por autenticados)'),
  anio_temporada: r(AUT, 'fase 4'),
  cerrar_temporada_ranking: r(ADM, 'fase 4: solo admin; lo valida la RPC. Fase 5 (G2): nombre editable, tercer argumento opcional'),
  // Fase 5: arreglos de la guía del administrador.
  retroceder_fase_cruce: r(ADM, 'fase 5 (G1): solo admin, con motivo; lo valida la RPC'),
  poscosecha_incompleta_cruce: r(AUT, 'fase 5: conteo de un cruce visible (RLS del que llama)'),
  etiqueta_temporada: r(AUT, 'fase 5 (G2): regla de julio a junio'),
  temporada_sugerida: r(AUT, 'fase 5 (G2)'),
  temporadas_especie: r(AUT, 'fase 5 (G2): etiquetas por cruce y especie, sin linaje'),
  marcar_ronda_no_evaluada: r(ADM, 'fase 5 (G3): solo admin [provisional]; lo valida la RPC'),
  quitar_ronda_no_evaluada: r(ADM, 'fase 5 (G3): solo admin; lo valida la RPC'),
  reactivar_individuo: r(ADM, 'fase 5 (G4): solo admin, con motivo; lo valida la RPC'),
  codigo_natural: r(AUT, 'fase 5 (G16): clave de orden natural de un código; sin datos'),
  pedir_correccion: r(['autor'], 'fase 5 (G15): solo el autor de la evaluación cerrada (ni el admin que no la hizo); lo valida la RPC'),
  listar_correcciones_pedidas: r(ADM, 'fase 5 (G15): Inicio del admin; sin linaje'),
  pedidos_correccion_evaluacion: r(AUT, 'fase 5 (G15): historial de una evaluación (el admin todos; los demás, los suyos)'),
  obtener_correcciones_individuo: r(AUT, 'A8 (v3): historial de correcciones del individuo (fecha, nombre, motivo, campos); cualquier autenticado'),
  actualizar_participantes_canal_libre: r(ADM, 'creador admin'),
  archivar_canal_libre: r(ADM, 'creador admin'),
  limpiar_canal_chat: r(ADM, 'admin participante', { noProbar: ['admin'] }),
  puede_acceder_chat: r(AUT, 'la usan las policies del chat'),
  puede_acceder_entidad_chat: INTERNA('MODELO: solo la llama puede_acceder_chat (DEFINER); no necesita EXECUTE para authenticated'),
  es_participante_chat: INTERNA('interna'),
  registrar_suscripcion_push: r(AUT, 'cada uno registra su dispositivo'),
  eliminar_suscripcion_push: r(AUT, 'borra solo una suscripción propia'),
  despachar_push_envio: INTERNA('la llaman el trigger de chat_menciones y el cron; dispara net.http_post'),
  programar_reintento_push: INTERNA('interna del trigger y del cron'),
  recoger_respuestas_push: INTERNA('solo cron'),
  limpiar_push_envio: INTERNA('solo cron'),
  puede_gestionar_canal_libre: INTERNA('interna'),

  // ---- Seguridad: helpers ------------------------------------------------------------------------------
  es_admin: r(AUT, 'la usan todas las policies'),
  captura_tiene_respaldo: INTERNA('MODELO: solo la llaman los triggers de captura por etapa (A1-028, DEFINER); sin EXECUTE para authenticated'),
  puede_ver_linaje_actual: INTERNA('MODELO: solo la llama obtener_planta (DEFINER); no necesita EXECUTE para authenticated'),

  // ---- EVECL ---------------------------------------------------------------------------------------------
  evecl_guardar_ensayo: r(AUT),
  evecl_guardar_ficha: INTERNA('paso 39: firma vieja de 14 argumentos cerrada para authenticated; la usa su envoltura evecl_guardar_ficha_con_bajas (DEFINER)'),
  evecl_guardar_ficha_con_bajas: r(AUT),
  guardar_siembra: r(AUT, 'INVOKER: escritura de siembra con los mismos grants y RLS'),
  guardar_cosecha: r(AUT, 'INVOKER: escritura de cosecha con los mismos grants y RLS'),
  iniciar_ronda_esperada: r(AUT, 'DEFINER desde el paso 39: mismo número esperado recupera la ronda sin consumir otra'),
  individualizar_plantas_una_vez: r(AUT, 'reintento por actor/clave con resultado auditado'),
  evecl_obtener_catalogo: r(AUT),
  evecl_obtener_ensayos: r(AUT),
  evecl_obtener_ficha: r(AUT),
  evecl_obtener_fichas: r(AUT),
  evecl_comparar: r(AUT),
  evecl_eliminar_ficha: r(AA, 'autor de la ficha o admin (la RPC lo valida); sin llamada en el frontend'),
};

// ============================================================================
// Desviaciones conocidas (hallazgos de la matriz)
// ============================================================================

export interface Desviacion {
  /** Resultado REAL observado y documentado. La prueba exige que siga siendo ese: si se corrige, el test avisa. */
  real: string;
  hallazgo: string;
  nota: string;
}

/**
 * Clave: `tabla.op.rol` (celdas de tabla), `rpc.nombre.rol`, `var.<id>.rol` o
 * `sto.<id>.rol`. Se completa tras la primera corrida.
 */
export const DESVIACIONES_CONOCIDAS: Record<string, Desviacion> = {};

function desv(claves: string[], real: string, hallazgo: string, nota: string): void {
  for (const k of claves) DESVIACIONES_CONOCIDAS[k] = { real, hallazgo, nota };
}
const AUT4: Rol[] = ['operario', 'autor', 'linaje', 'admin'];
const celdas = (prefijo: string, roles: readonly Rol[]): string[] => roles.map((r) => `${prefijo}.${r}`);

// ---- A1-G1-02 (ya reportado por G1): DELETE directo de plantas (salta borrar_cruzamiento) ------------------------------------------------
// A1-003 corregido: se exige el modelo sin DELETE, sin desviaciones conocidas.

// ---- A1-G3-09 (ya reportado por G3): la bitácora se puede mover de cruce y retrodatar sin auditoría ----------------------
desv(celdas('var.registros_evento.update_planta_id', ['autor', 'admin']), 'permitido', 'A1-G3-09', 'UPDATE de planta_id: el evento se mueve a otro cruce y auditar_escritura_evento no lo registra');
desv(celdas('var.registros_evento.update_created_at', ['autor', 'admin']), 'permitido', 'A1-G3-09', 'UPDATE de created_at: la bitácora se retrodata sin rastro');

// ---- A1-G5-02 / A1-G5-14 (ya reportados por G5): el borrador/la evaluación se reasignan a la ronda de otro individuo -------------
// A1-058 corregido en la Fase 2 (20261023110000): ronda_id es inmutable; se exige el modelo sin desviaciones.

// ---- A1-G5-01 (ya reportado por G5/G4): INSERT directo de rondas ----------------------------------------------------------
// A1-007 corregido: se exige el modelo sin INSERT directo.

// ---- A1-G4-06 (ya reportado por G4): identidad del individuo ------------------------------------------------------------------
desv(celdas('var.individuos.update_clon_de_id', ['autor', 'admin']), 'permitido', 'A1-G4-06', 'clon_de_id se reescribe después del alta');
desv(celdas('var.individuos.update_created_at', ['autor', 'admin']), 'permitido', 'A1-G4-06', 'created_at se reescribe después del alta');
desv(['var.individuos.update_created_by.admin'], 'permitido', 'A1-G4-06', 'el admin reasigna la autoría de un individuo (ampliación del hallazgo de G4: created_by también queda sin protección)');

// ---- A1-G8-01: registro abierto. Mitigado el 22-10-2026 (producción y config.toml con enable_signup = false):
// ya no es una desviación; si el registro vuelve a abrirse, var.auth.registro_propio.anon pasa a 'permitido' y la matriz falla.

// ---- A1-G10-03: Storage por la API REST ------------------------------------------------------------------------------------------------------
desv(celdas('var.storage_rest.insert_objeto_con_owner_ajeno', AUT4), 'permitido', 'A1-G10-03', 'la policy de INSERT en storage.objects solo mira bucket_id: owner y name son libres');

// ---- A1-G10-01 (anon) y A1-G10-02 (authenticated): funciones expuestas sin necesidad ------------------------------------------------------------------------------------------------
for (const f of ['limite_baja_en_lote', 'validar_parametros_baja', 'clave_nombre_variedad']) {
  desv(celdas(`rpc.${f}`, ['anon', ...AUT4]), 'ejecuta', 'A1-G10-01', 'helper creado después de la migración 20261004130000: proacl NULL = EXECUTE para PUBLIC (anon y authenticated)');
}
for (const f of ['evaluacion_tiene_descriptores_completos', 'listar_individuos_procedimiento_predio', 'puede_acceder_entidad_chat', 'puede_ver_linaje_actual']) {
  desv(celdas(`rpc.${f}`, AUT4), 'ejecuta', 'A1-G10-02', 'función sin llamadores externos con EXECUTE para authenticated');
}

// ---- A1-G7-01 (ya reportado por G7): sincronizar_clima_predio ------------------------------------------------------------------------------------------------------------
desv(celdas('rpc.sincronizar_clima_predio', AUT4), 'ejecuta', 'A1-G7-01', 'sin chequeo de rol: pasa el permiso y solo se detiene por "predio sin coordenadas"; con coordenadas dispararía net.http_get');

