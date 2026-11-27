-- Un cambio directo de responsable eludiría procedimiento_reasignaciones.
-- La API autenticada no escribe la tabla padre: edición y reasignación pasan
-- exclusivamente por las RPC SECURITY DEFINER que validan y auditan.

drop policy if exists procedimientos_update_responsable_temprano_o_admin on procedimientos;
revoke update on procedimientos from authenticated;

comment on table procedimientos is
  'Entidad operativa con responsable, estado y objetivos múltiples. La edición y reasignación se realizan solo mediante RPC auditadas; procedimiento_cultivo queda como archivo legacy.';

