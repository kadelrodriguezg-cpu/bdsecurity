-- El modelo simple anterior no representa objetivos múltiples ni reasignación.
-- Se conserva como archivo histórico, sin consumidores operativos ni escritura
-- desde authenticated; la fuente de verdad es `procedimientos`.

drop policy if exists procedimiento_cultivo_select_autenticados on procedimiento_cultivo;
drop policy if exists procedimiento_cultivo_insert_autenticados on procedimiento_cultivo;

create policy procedimiento_cultivo_legacy_select_admin on procedimiento_cultivo
  for select using (es_admin());

revoke all on procedimiento_cultivo from authenticated;
grant select on procedimiento_cultivo to authenticated;

comment on table procedimiento_cultivo is
  'DEPRECADA: archivo histórico del modelo simple a nivel de cruce. La aplicación usa procedimientos, procedimiento_objetivos y procedimiento_reasignaciones.';

