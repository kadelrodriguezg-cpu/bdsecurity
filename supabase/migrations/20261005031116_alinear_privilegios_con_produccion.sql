-- Alinea los privilegios efectivos de authenticated con la foto de producción
-- del 04-10-2026. Solo elimina los siete grupos de permisos sobrantes locales.
-- En la producción fotografiada estas revocaciones son un no-op efectivo.
-- No modifica anon, service_role, funciones, RLS ni privilegios por defecto.
--
-- REVOKE de tabla también puede quitar grants de columna del mismo privilegio.
-- plantas no se toca; en emplazamiento_individuo solo se revoca I/U/D y se
-- conservan sus grants de SELECT por columna. La comprobación transaccional
-- siguiente aborta toda la migración si cualquiera de esas ACL cambia.
do $alineacion$
declare
  v_columnas_antes jsonb;
  v_columnas_despues jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'tabla', c.relname, 'columna', a.attname, 'acl', a.attacl::text
  ) order by c.relname, a.attnum), '[]'::jsonb)
  into v_columnas_antes
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('plantas', 'emplazamiento_individuo')
    and a.attnum > 0 and not a.attisdropped;

  -- 1) Local SIUD -> producción S: quitar I/U/D.
  revoke insert, update, delete on
    public.audit_log, public.emplazamiento_coordenada, public.plantas_operativas,
    public.predio_clima_mensual, public.procedimiento_insumos,
    public.procedimiento_objetivos, public.procedimiento_reasignaciones,
    public.ranking_snapshot, public.ranking_snapshot_resultado
  from authenticated;

  -- 2) Local SIUD -> producción SIU: quitar D.
  revoke delete on
    public.baja_motivo, public.evaluacion_reducida, public.evaluaciones,
    public.individuos, public.pcr_analisis, public.rango_referencia,
    public.scoring_categoria_peso, public.scoring_metrica, public.scoring_version,
    public.sector, public.sitio, public.variedades
  from authenticated;

  -- 3) Local SIUD -> producción SID: quitar U.
  revoke update on
    public.cosecha_fruto, public.evento_archivos, public.plantas_insumo,
    public.plantas_sustrato, public.polinizacion_evento
  from authenticated;

  -- 4) Local SIUD -> producción SI: quitar U/D.
  revoke update, delete on public.germinacion_evento, public.ronda_evaluacion_anual
  from authenticated;

  -- 5) Local SID -> producción S: quitar I/D.
  revoke insert, delete on public.procedimientos from authenticated;

  -- 6) Local IUD -> producción sin grants de tabla: conservar SELECT de columna.
  revoke insert, update, delete on public.emplazamiento_individuo from authenticated;

  -- 7) Local SIUD -> producción sin privilegios.
  revoke select, insert, update, delete on public.predio_clima_sync_pendiente
  from authenticated;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tabla', c.relname, 'columna', a.attname, 'acl', a.attacl::text
  ) order by c.relname, a.attnum), '[]'::jsonb)
  into v_columnas_despues
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('plantas', 'emplazamiento_individuo')
    and a.attnum > 0 and not a.attisdropped;

  if v_columnas_antes is distinct from v_columnas_despues then
    raise exception 'La alineación modificó ACL de columna en plantas o emplazamiento_individuo';
  end if;
end;
$alineacion$;

notify pgrst, 'reload schema';
