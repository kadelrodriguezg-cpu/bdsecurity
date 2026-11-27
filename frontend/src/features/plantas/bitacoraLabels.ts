export interface AccionInfo {
  label: string;
  sutil?: boolean;
  sensible: boolean;
}

/** Acciones emitidas por las migraciones de auditoría del backend. */
export const ACCION_INFO: Record<string, AccionInfo> = {
  lectura_ficha: { label: 'Consultó la ficha', sutil: true, sensible: false },
  lectura_linaje: { label: 'Consultó el linaje', sutil: true, sensible: false },
  alta_cruce: { label: 'Dio de alta el cruce', sensible: true },
  cambio_estado: { label: 'Cambió de fase', sensible: false },
  // Fase 5 (G1): retroceso de fase con motivo (retroceder_fase_cruce).
  retroceso_fase: { label: 'Retrocedió de fase', sensible: true },
  // Fase 5 (G3): «No evaluada en esta ronda».
  ronda_no_evaluada: { label: 'Marcó una ronda como no evaluada', sensible: true },
  ronda_no_evaluada_quitada: { label: 'Quitó la marca «No evaluada» de una ronda', sensible: true },
  // Fase 5 (G4): reactivación de una planta dada de baja.
  reactivacion_individuo: { label: 'Reactivó una planta dada de baja', sensible: true },
  pedido_correccion: { label: 'Pidió la corrección de una evaluación', sensible: true },
  pedido_correccion_resuelto: { label: 'Resolvió un pedido de corrección', sensible: true },
  escritura_linaje: { label: 'Editó el linaje', sensible: true },
  escritura_fase: { label: 'Actualizó datos de la fase', sensible: false },
  edicion_evento: { label: 'Editó un registro científico', sensible: false },
  eliminacion_evento: { label: 'Eliminó un registro científico', sensible: true },
  individualizacion: { label: 'Individualizó plantas', sensible: false },
  creacion_individuo: { label: 'Dio de alta un individuo', sensible: false },
  edicion_individuo: { label: 'Editó un individuo', sensible: false },
  creacion_ronda_evaluacion_anual: { label: 'Inició una ronda', sensible: false },
  creacion_evaluacion: { label: 'Registró una evaluación', sensible: false },
  edicion_evaluacion: { label: 'Editó una evaluación', sensible: false },
  creacion_evaluacion_reducida: { label: 'Registró una evaluación reducida', sensible: false },
  edicion_evaluacion_reducida: { label: 'Editó una evaluación reducida', sensible: false },
  avance_fase_individuo: { label: 'Actualizó la etapa de un individuo', sensible: false },
  creacion_pcr: { label: 'Registró un PCR', sensible: false },
  edicion_pcr: { label: 'Editó un PCR', sensible: false },
  creacion_baja_motivo: { label: 'Registró una baja', sensible: false },
  edicion_baja_motivo: { label: 'Editó un motivo de baja', sensible: false },
  creacion_evento_germinacion: { label: 'Registró una germinación', sensible: false },
  creacion_cosecha_fruto: { label: 'Registró un fruto cosechado', sensible: false },
  eliminacion_cosecha_fruto: { label: 'Quitó un fruto cosechado', sensible: false },
  creacion_multisitio: { label: 'Registró un ensayo multisitio', sensible: false },
  edicion_multisitio: { label: 'Editó un ensayo multisitio', sensible: false },
  registro_emplazamiento: { label: 'Registró un emplazamiento', sensible: false },
  traslado_individuo: { label: 'Registró un traslado territorial', sensible: false },
  creacion_procedimiento_cultivo: { label: 'Registró un procedimiento de cultivo', sensible: false },
  creacion_procedimiento: { label: 'Registró un procedimiento', sensible: false },
  edicion_procedimiento: { label: 'Editó un procedimiento', sensible: false },
  reasignacion_procedimiento: { label: 'Reasignó un procedimiento', sensible: true },
  reinicio_cruzamiento: { label: 'Reinició el cruce', sensible: true },
  borrado_cruzamiento_soft: { label: 'Marcó el cruce como eliminado', sensible: true },
  borrado_cruzamiento_hard: { label: 'Eliminó el cruce permanentemente', sensible: true },
  // Sprint 8 (3.g): restaurar_cruzamiento ya escribía en audit_log desde
  // Sprint 5 — solo faltaba esta etiqueta, sin ella caía en el fallback
  // genérico "Actividad del sistema" de infoDeAccion().
  restauracion_cruzamiento: { label: 'Restauró el cruce', sensible: true },
};

export function infoDeAccion(accion: string): AccionInfo {
  return ACCION_INFO[accion] ?? { label: 'Actividad del sistema', sensible: false };
}
