-- `multisitio` fue el modelo mutable anterior (una fila por individuo).
-- Se preserva como archivo histórico, pero deja de ser una fuente operativa
-- de ubicación: la única fuente de verdad pasa a emplazamiento_individuo.

drop policy if exists multisitio_select_autenticados on multisitio;
drop policy if exists multisitio_insert_autenticados on multisitio;
drop policy if exists multisitio_update_autor_o_admin on multisitio;

create policy multisitio_legacy_select_admin on multisitio
  for select using (es_admin());

revoke all on multisitio from authenticated;
grant select on multisitio to authenticated;

comment on table multisitio is
  'DEPRECADA: archivo histórico del modelo mutable anterior. La aplicación no la lee ni escribe; usar emplazamiento_individuo y registrar_traslado_individuo().';

