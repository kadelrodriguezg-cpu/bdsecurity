-- Fase 3, Sprint 3 (S3-5) — advisor «unindexed_foreign_keys», solo las tablas que crecen.
--
-- Una clave foránea sin índice obliga a recorrer entera la tabla hija cada vez que
-- se borra o se cambia la fila padre (comprobación de integridad referencial,
-- ON DELETE CASCADE / SET NULL) y encarece los joins y filtros por esa columna.
-- El advisor reporta 60 claves sin índice; se cubren 20, las de tablas cuyo
-- volumen crece con los individuos y el tiempo, o que son llave de filtro/join:
--
--   plantas (especie_id, predio_id, mama_id, papa_id): filtro del ranking por
--     especie, listados por predio, y «descendientes de esta variedad».
--   evaluaciones, individuos, ronda_evaluacion_anual, emplazamiento_individuo,
--   registros_evento, evento_archivos, evaluacion_reducida (created_by):
--     las tablas de mayor volumen; el borrado de un perfil las recorría enteras.
--   ronda_evaluacion_anual.predio_id: avance por predio.
--   ranking_snapshot_resultado (individuo_id, evaluacion_id): cada snapshot
--     congela una fila por individuo; la clave primaria solo cubre snapshot_id.
--   procedimiento_objetivos.planta_id, procedimiento_reasignaciones.procedimiento_id,
--   evecl_respuesta.descriptor_id: llaves de join de tablas que crecen.
--   chat_mensajes.autor_id, chat_lecturas.usuario_id, chat_canal_participantes.usuario_id:
--     el chat filtra siempre por usuario.
--
-- Quedan fuera (documentado en docs/evidencia_sprint3.md): created_by/updated_by de
-- catálogos y tablas pequeñas, y claves hacia catálogos diminutos (contenedor, insumo,
-- sustrato, rango_referencia, scoring_*, esquema_fase_campo, multisitio, ranking_snapshot).
--
-- No cambia ningún resultado ni permiso; solo agrega índices (create index if not exists).
-- Los volúmenes de estas tablas son de miles de filas: cada índice se construye en
-- milisegundos, así que no hace falta `concurrently`.

create index if not exists idx_plantas_especie_id on public.plantas (especie_id);
create index if not exists idx_plantas_predio_id on public.plantas (predio_id);
create index if not exists idx_plantas_mama_id on public.plantas (mama_id);
create index if not exists idx_plantas_papa_id on public.plantas (papa_id);

create index if not exists idx_evaluaciones_created_by on public.evaluaciones (created_by);
create index if not exists idx_individuos_created_by on public.individuos (created_by);
create index if not exists idx_ronda_evaluacion_anual_created_by on public.ronda_evaluacion_anual (created_by);
create index if not exists idx_ronda_evaluacion_anual_predio_id on public.ronda_evaluacion_anual (predio_id);
create index if not exists idx_emplazamiento_individuo_created_by on public.emplazamiento_individuo (created_by);
create index if not exists idx_registros_evento_created_by on public.registros_evento (created_by);
create index if not exists idx_evento_archivos_created_by on public.evento_archivos (created_by);
create index if not exists idx_evaluacion_reducida_created_by on public.evaluacion_reducida (created_by);

create index if not exists idx_ranking_snapshot_resultado_individuo_id on public.ranking_snapshot_resultado (individuo_id);
create index if not exists idx_ranking_snapshot_resultado_evaluacion_id on public.ranking_snapshot_resultado (evaluacion_id);

create index if not exists idx_procedimiento_objetivos_planta_id on public.procedimiento_objetivos (planta_id);
create index if not exists idx_procedimiento_reasignaciones_procedimiento_id on public.procedimiento_reasignaciones (procedimiento_id);
create index if not exists idx_evecl_respuesta_descriptor_id on public.evecl_respuesta (descriptor_id);

create index if not exists idx_chat_mensajes_autor_id on public.chat_mensajes (autor_id);
create index if not exists idx_chat_lecturas_usuario_id on public.chat_lecturas (usuario_id);
create index if not exists idx_chat_canal_participantes_usuario_id on public.chat_canal_participantes (usuario_id);
