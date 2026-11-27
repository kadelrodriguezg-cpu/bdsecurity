-- Rollback del paso 53 (retroceder la fase de un cruce). Quita las dos funciones nuevas. Las filas «retroceso_fase» que
-- queden en audit_log se conservan (es append-only y son historia); los cambios de fase hechos siguen auditados como «cambio_estado».
DROP FUNCTION public.poscosecha_incompleta_cruce(uuid);
DROP FUNCTION public.retroceder_fase_cruce(uuid, public.estado_planta, text);
