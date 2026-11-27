-- Fase 3, Sprint 3 (S3-5) — advisor «auth_rls_initplan», SIN cambiar ningún resultado.
--
-- Una política que llama auth.uid() (o una función sin argumentos como es_admin())
-- directamente en su expresión la reevalúa por cada fila examinada. Envuelta en
-- un subselect — (select auth.uid()) — Postgres la evalúa una sola vez por
-- consulta (InitPlan) y reutiliza el valor. Es semánticamente idéntica: las dos
-- funciones son STABLE y no reciben columnas de la fila, así que valen lo mismo
-- para todas las filas de una consulta.
--
-- Qué se cambia: 111 políticas de public y storage.objects. Cada `alter policy`
-- copia EXACTAMENTE la expresión vigente (leída de pg_policies) y solo agrega el
-- `(select ...)` alrededor de auth.uid() y es_admin(). No se cambia ningún
-- permiso (roles, comando, permisivas), ninguna función ni ningún grant.
--
-- Qué NO se toca: las llamadas con argumentos de la fila (puede_acceder_chat(canal_id),
-- individuo_esta_vivo(individuo_id), ronda_individuo_esta_vivo(ronda_id)) dependen
-- de la fila y envolverlas cambiaría el resultado. Las políticas de linaje no
-- cambian (el linaje sigue oculto por el REVOKE de columna, la vista y la RPC).
--
-- Verificación: huella de lecturas/efectos de RLS como admin, operario con y sin
-- puede_ver_linaje y anon, antes y después (ver docs/evidencia_sprint3.md, S3-5).
set local search_path = public;

alter policy audit_select_admin on public.audit_log
  using ((select es_admin()));

alter policy baja_motivo_select_autenticados on public.baja_motivo
  using (((select auth.uid()) IS NOT NULL));

alter policy baja_motivo_update_admin on public.baja_motivo
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy chat_lecturas_propias on public.chat_lecturas
  using (((usuario_id = (select auth.uid())) AND puede_acceder_chat(canal_id)));

alter policy chat_menciones_propias on public.chat_menciones
  using (((usuario_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM chat_mensajes m
  WHERE ((m.id = chat_menciones.mensaje_id) AND puede_acceder_chat(m.canal_id))))));

alter policy configuracion_ranking_admin_actualiza on public.configuracion_ranking
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy configuracion_ranking_select_autenticados on public.configuracion_ranking
  using (((select auth.uid()) IS NOT NULL));

alter policy contenedor_admin_escribe on public.contenedor
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy contenedor_select_autenticados on public.contenedor
  using (((select auth.uid()) IS NOT NULL));

alter policy cosecha_fruto_delete_autor_o_admin on public.cosecha_fruto
  using (((created_by = (select auth.uid())) OR (select es_admin())));

alter policy cosecha_fruto_insert_autenticados on public.cosecha_fruto
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy cosecha_fruto_select_autenticados on public.cosecha_fruto
  using (((select auth.uid()) IS NOT NULL));

alter policy emplazamiento_coordenada_select_admin on public.emplazamiento_coordenada
  using ((select es_admin()));

alter policy emplazamiento_select_autenticados on public.emplazamiento_individuo
  using (((select auth.uid()) IS NOT NULL));

alter policy especies_admin_escribe on public.especies
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy especies_select_autenticados on public.especies
  using (((select auth.uid()) IS NOT NULL));

alter policy esquema_fase_campo_select_autenticados on public.esquema_fase_campo
  using (((select auth.uid()) IS NOT NULL));

alter policy esquema_fase_seccion_select_autenticados on public.esquema_fase_seccion
  using (((select auth.uid()) IS NOT NULL));

alter policy evaluacion_reducida_insert_autenticados on public.evaluacion_reducida
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid())) AND individuo_esta_vivo(individuo_id)));

alter policy evaluacion_reducida_select_autenticados on public.evaluacion_reducida
  using (((select auth.uid()) IS NOT NULL));

alter policy evaluacion_reducida_update_admin on public.evaluacion_reducida
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy evaluaciones_insert_autenticados on public.evaluaciones
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid())) AND ronda_individuo_esta_vivo(ronda_id)));

alter policy evaluaciones_select_autenticados on public.evaluaciones
  using (((select auth.uid()) IS NOT NULL));

alter policy evaluaciones_update_borrador_o_admin on public.evaluaciones
  using (((select es_admin()) OR ((created_by = (select auth.uid())) AND (estado = 'borrador'::estado_evaluacion))))
  with check (((select es_admin()) OR ((created_by = (select auth.uid())) AND (estado = ANY (ARRAY['borrador'::estado_evaluacion, 'completa'::estado_evaluacion, 'anulada'::estado_evaluacion])))));

alter policy evecl_descriptor_admin_insert on public.evecl_descriptor
  with check ((select es_admin()));

alter policy evecl_descriptor_admin_update on public.evecl_descriptor
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy evecl_descriptor_select_autenticados on public.evecl_descriptor
  using (((select auth.uid()) IS NOT NULL));

alter policy evecl_descriptor_estado_admin_insert on public.evecl_descriptor_estado
  with check ((select es_admin()));

alter policy evecl_descriptor_estado_admin_update on public.evecl_descriptor_estado
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy evecl_descriptor_estado_select_autenticados on public.evecl_descriptor_estado
  using (((select auth.uid()) IS NOT NULL));

alter policy evecl_ensayo_insert_autenticados on public.evecl_ensayo
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy evecl_ensayo_select_autenticados on public.evecl_ensayo
  using ((((select auth.uid()) IS NOT NULL) AND (eliminado_at IS NULL)));

alter policy evecl_ensayo_update_autor_o_admin on public.evecl_ensayo
  using (((created_by = (select auth.uid())) OR (select es_admin())))
  with check (((created_by = (select auth.uid())) OR (select es_admin())));

alter policy evecl_ficha_insert_autenticados on public.evecl_ficha
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy evecl_ficha_select_autenticados on public.evecl_ficha
  using ((((select auth.uid()) IS NOT NULL) AND (eliminado_at IS NULL)));

alter policy evecl_ficha_update_autor_o_admin on public.evecl_ficha
  using (((created_by = (select auth.uid())) OR (select es_admin())))
  with check (((created_by = (select auth.uid())) OR (select es_admin())));

alter policy evecl_respuesta_delete_autor_ficha_o_admin on public.evecl_respuesta
  using (((select es_admin()) OR (EXISTS ( SELECT 1
   FROM evecl_ficha f
  WHERE ((f.id = evecl_respuesta.ficha_id) AND (f.created_by = (select auth.uid())))))));

alter policy evecl_respuesta_insert_autenticados on public.evecl_respuesta
  with check ((((select auth.uid()) IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM evecl_ficha f
  WHERE ((f.id = evecl_respuesta.ficha_id) AND (f.eliminado_at IS NULL))))));

alter policy evecl_respuesta_select_via_ficha on public.evecl_respuesta
  using ((((select auth.uid()) IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM evecl_ficha f
  WHERE ((f.id = evecl_respuesta.ficha_id) AND (f.eliminado_at IS NULL))))));

alter policy evecl_respuesta_update_autor_ficha_o_admin on public.evecl_respuesta
  using (((select es_admin()) OR (EXISTS ( SELECT 1
   FROM evecl_ficha f
  WHERE ((f.id = evecl_respuesta.ficha_id) AND (f.created_by = (select auth.uid())))))))
  with check (((select es_admin()) OR (EXISTS ( SELECT 1
   FROM evecl_ficha f
  WHERE ((f.id = evecl_respuesta.ficha_id) AND (f.created_by = (select auth.uid())))))));

alter policy archivos_delete_autor_o_admin on public.evento_archivos
  using (((created_by = (select auth.uid())) OR (select es_admin())));

alter policy archivos_insert_autenticados on public.evento_archivos
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy archivos_select_autenticados on public.evento_archivos
  using (((select auth.uid()) IS NOT NULL));

alter policy germinacion_evento_insert_autenticados on public.germinacion_evento
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy germinacion_evento_select_autenticados on public.germinacion_evento
  using (((select auth.uid()) IS NOT NULL));

alter policy individuos_insert_autenticados on public.individuos
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy individuos_select_autenticados on public.individuos
  using (((select auth.uid()) IS NOT NULL));

alter policy individuos_update_autor_o_admin on public.individuos
  using (((created_by = (select auth.uid())) OR (select es_admin())))
  with check (((created_by = (select auth.uid())) OR (select es_admin())));

alter policy insumo_admin_escribe on public.insumo
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy insumo_select_autenticados on public.insumo
  using (((select auth.uid()) IS NOT NULL));

alter policy multisitio_legacy_select_admin on public.multisitio
  using ((select es_admin()));

alter policy pcr_analisis_insert_autenticados on public.pcr_analisis
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid())) AND ronda_individuo_esta_vivo(ronda_id)));

alter policy pcr_analisis_select_autenticados on public.pcr_analisis
  using (((select auth.uid()) IS NOT NULL));

alter policy pcr_analisis_update_admin on public.pcr_analisis
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy perfiles_admin_todo on public.perfiles
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy perfiles_select_admin on public.perfiles
  using ((select es_admin()));

alter policy perfiles_select_propio on public.perfiles
  using ((id = (select auth.uid())));

alter policy perfiles_update_propio on public.perfiles
  using ((id = (select auth.uid())))
  with check ((id = (select auth.uid())));

alter policy plantas_insert_admin on public.plantas
  with check ((select es_admin()));

alter policy plantas_select_autenticados on public.plantas
  using (((select auth.uid()) IS NOT NULL));

alter policy plantas_update_autenticados on public.plantas
  using (((select auth.uid()) IS NOT NULL))
  with check (((select auth.uid()) IS NOT NULL));

alter policy plantas_insumo_delete_autenticados on public.plantas_insumo
  using (((select auth.uid()) IS NOT NULL));

alter policy plantas_insumo_insert_autenticados on public.plantas_insumo
  with check (((select auth.uid()) IS NOT NULL));

alter policy plantas_insumo_select_autenticados on public.plantas_insumo
  using (((select auth.uid()) IS NOT NULL));

alter policy plantas_sustrato_delete_autenticados on public.plantas_sustrato
  using (((select auth.uid()) IS NOT NULL));

alter policy plantas_sustrato_insert_autenticados on public.plantas_sustrato
  with check (((select auth.uid()) IS NOT NULL));

alter policy plantas_sustrato_select_autenticados on public.plantas_sustrato
  using (((select auth.uid()) IS NOT NULL));

alter policy polinizacion_evento_delete_autor_o_admin on public.polinizacion_evento
  using (((created_by = (select auth.uid())) OR (select es_admin())));

alter policy polinizacion_evento_insert_autenticados on public.polinizacion_evento
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy polinizacion_evento_select_autenticados on public.polinizacion_evento
  using (((select auth.uid()) IS NOT NULL));

alter policy predio_admin_escribe on public.predio
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy predio_select_autenticados on public.predio
  using (((select auth.uid()) IS NOT NULL));

alter policy predio_clima_mensual_select_autenticados on public.predio_clima_mensual
  using (((select auth.uid()) IS NOT NULL));

alter policy procedimiento_cultivo_legacy_select_admin on public.procedimiento_cultivo
  using ((select es_admin()));

alter policy procedimiento_insumos_select_autenticados on public.procedimiento_insumos
  using (((select auth.uid()) IS NOT NULL));

alter policy procedimiento_objetivos_select_autenticados on public.procedimiento_objetivos
  using (((select auth.uid()) IS NOT NULL));

alter policy procedimiento_reasignaciones_select_admin on public.procedimiento_reasignaciones
  using ((select es_admin()));

alter policy procedimientos_select_autenticados on public.procedimientos
  using (((select auth.uid()) IS NOT NULL));

alter policy protocolo_ronda_select_autenticados on public.protocolo_ronda
  using (((select auth.uid()) IS NOT NULL));

alter policy rango_referencia_admin_actualiza on public.rango_referencia
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy rango_referencia_admin_inserta on public.rango_referencia
  with check ((select es_admin()));

alter policy rango_referencia_select_autenticados on public.rango_referencia
  using (((select auth.uid()) IS NOT NULL));

alter policy ranking_snapshot_select_autenticados on public.ranking_snapshot
  using (((select auth.uid()) IS NOT NULL));

alter policy ranking_snapshot_resultado_select_autenticados on public.ranking_snapshot_resultado
  using (((select auth.uid()) IS NOT NULL));

alter policy registros_insert_autenticados on public.registros_evento
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy registros_select_autenticados on public.registros_evento
  using ((((select auth.uid()) IS NOT NULL) AND ((eliminado_at IS NULL) OR (select es_admin()))));

alter policy registros_update_autor_o_admin on public.registros_evento
  using (((created_by = (select auth.uid())) OR (select es_admin())))
  with check (((created_by = (select auth.uid())) OR (select es_admin())));

alter policy ronda_evaluacion_anual_insert_autenticados on public.ronda_evaluacion_anual
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy ronda_evaluacion_anual_select_autenticados on public.ronda_evaluacion_anual
  using (((select auth.uid()) IS NOT NULL));

alter policy scoring_categoria_peso_admin_actualiza on public.scoring_categoria_peso
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy scoring_categoria_peso_admin_inserta on public.scoring_categoria_peso
  with check ((select es_admin()));

alter policy scoring_categoria_peso_select_autenticados on public.scoring_categoria_peso
  using (((select auth.uid()) IS NOT NULL));

alter policy scoring_metrica_admin_actualiza on public.scoring_metrica
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy scoring_metrica_admin_inserta on public.scoring_metrica
  with check ((select es_admin()));

alter policy scoring_metrica_select_autenticados on public.scoring_metrica
  using (((select auth.uid()) IS NOT NULL));

alter policy scoring_version_admin_actualiza on public.scoring_version
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy scoring_version_admin_inserta on public.scoring_version
  with check ((select es_admin()));

alter policy scoring_version_select_autenticados on public.scoring_version
  using (((select auth.uid()) IS NOT NULL));

alter policy sector_admin_actualiza on public.sector
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy sector_admin_inserta on public.sector
  with check ((select es_admin()));

alter policy sector_select_autenticados on public.sector
  using (((select auth.uid()) IS NOT NULL));

alter policy sitio_admin_actualiza on public.sitio
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy sitio_admin_inserta on public.sitio
  with check ((select es_admin()));

alter policy sitio_select_autenticados on public.sitio
  using (((select auth.uid()) IS NOT NULL));

alter policy sustrato_admin_escribe on public.sustrato
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy sustrato_select_autenticados on public.sustrato
  using (((select auth.uid()) IS NOT NULL));

alter policy variedades_admin_actualiza on public.variedades
  using ((select es_admin()))
  with check ((select es_admin()));

alter policy variedades_insert_autenticados on public.variedades
  with check ((((select auth.uid()) IS NOT NULL) AND (created_by = (select auth.uid()))));

alter policy variedades_select_autenticados on public.variedades
  using (((select auth.uid()) IS NOT NULL));

alter policy storage_evecl_fotos_delete_propietario on storage.objects
  using (((bucket_id = 'evecl-fotos'::text) AND (owner = (select auth.uid()))));

alter policy storage_media_delete_propietario on storage.objects
  using (((bucket_id = 'media-plantas'::text) AND (owner = (select auth.uid()))));


-- Comprobación: ninguna política de public/storage conserva un auth.uid() o es_admin()
-- sin envolver (en el texto desparseado, un llamado envuelto aparece como
-- «( SELECT auth.uid() AS uid)» y «( SELECT es_admin() AS es_admin)»).
do $chk$
declare
  v_sueltas int;
begin
  select count(*) into v_sueltas
  from pg_policies p
  where p.schemaname in ('public', 'storage')
    and (
      (length(coalesce(p.qual, '') || coalesce(p.with_check, '')) - length(replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), 'auth.uid()', ''))) / length('auth.uid()')
        <> (length(coalesce(p.qual, '') || coalesce(p.with_check, '')) - length(replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), 'SELECT auth.uid() AS uid', ''))) / length('SELECT auth.uid() AS uid')
      or
      (length(coalesce(p.qual, '') || coalesce(p.with_check, '')) - length(replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), 'es_admin()', ''))) / length('es_admin()')
        <> (length(coalesce(p.qual, '') || coalesce(p.with_check, '')) - length(replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), 'SELECT es_admin() AS es_admin', ''))) / length('SELECT es_admin() AS es_admin')
    );
  if v_sueltas <> 0 then
    raise exception 'S3-5: % políticas conservan auth.uid()/es_admin() sin envolver', v_sueltas;
  end if;
end;
$chk$;
