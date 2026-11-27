-- Las helpers SECURITY DEFINER solo deben ser invocadas internamente por las
-- RPC públicas validadas. PostgreSQL otorga EXECUTE a PUBLIC por defecto.

revoke all on function procedimiento_planta_auditable(uuid) from public, anon, authenticated;
revoke all on function reemplazar_objetivos_procedimiento(uuid, jsonb) from public, anon, authenticated;
revoke all on function reemplazar_insumos_procedimiento(uuid, jsonb) from public, anon, authenticated;

grant execute on function procedimiento_planta_auditable(uuid) to service_role;
grant execute on function reemplazar_objetivos_procedimiento(uuid, jsonb) to service_role;
grant execute on function reemplazar_insumos_procedimiento(uuid, jsonb) to service_role;

