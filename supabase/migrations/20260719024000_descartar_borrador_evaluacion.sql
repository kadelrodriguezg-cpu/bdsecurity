-- =============================================================================
-- Sprint 9 (calidad) — permite al autor descartar su propio borrador.
--
-- Hallazgo Grave del E2E ("borradores de evaluación huérfanos"): "Nueva
-- evaluación" siempre abría un formulario en blanco sin revisar si ya
-- existía un borrador (estado='borrador') para esa ronda — crearEvaluacion
-- es un INSERT liso, sin upsert ni chequeo previo. Sin acción de descarte,
-- cada intento fallido dejaba un borrador huérfano más, sin límite.
--
-- evaluaciones_delete_nadie (using (false), desde la migración de esquema
-- original) bloquea el DELETE por completo — coherente con el resto del
-- proyecto (nunca hard-delete). "Descartar" se modela como transición de
-- estado a 'anulada', no como borrado físico.
--
-- La policy evaluaciones_update_borrador_o_admin (20260719003000) ya
-- dejaba al autor completar su propio borrador (-> 'completa'), pero el
-- with check no incluía 'anulada' — un operario no podía autodescartar su
-- borrador, solo un admin. Se amplía el with check para permitir esa
-- transición específica. Es seguro ampliarlo así porque el using clause ya
-- garantiza que, para un no-admin, la fila de partida tenía
-- estado='borrador' Y era suya — la transición a 'anulada' solo puede
-- ocurrir desde ese punto de partida acotado, nunca sobre una evaluación ya
-- cerrada (que sigue siendo admin-only, sin cambios).
-- =============================================================================

drop policy if exists evaluaciones_update_borrador_o_admin on evaluaciones;

create policy evaluaciones_update_borrador_o_admin on evaluaciones
  for update
  using (es_admin() or (created_by = auth.uid() and estado = 'borrador'))
  with check (es_admin() or (created_by = auth.uid() and estado in ('borrador', 'completa', 'anulada')));

comment on policy evaluaciones_update_borrador_o_admin on evaluaciones is
  'El autor puede completar (-> completa) o descartar (-> anulada) su propio borrador. Una vez cerrada, cualquier edición/corrección/reapertura queda exclusivamente en admin (using clause ya lo garantiza: un no-admin nunca puede tocar una fila que no está en estado=borrador).';
