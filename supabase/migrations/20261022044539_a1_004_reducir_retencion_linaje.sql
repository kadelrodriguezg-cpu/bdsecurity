-- A1-004: conservar identificadores, autores, fechas y acciones, sin texto
-- de linaje en copias auxiliares. La redacción histórica se entrega separada
-- en scripts/redactar_linaje_historico_audit_log.sql; requiere decisión de Kadel.
create or replace function public.redactar_texto_linaje(p_dato jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare v_resultado jsonb; v_clave text; v_valor jsonb;
begin
  if jsonb_typeof(p_dato) = 'object' then
    v_resultado := '{}';
    for v_clave, v_valor in select key, value from jsonb_each(p_dato) loop
      if v_clave not in ('cruzamiento', 'mama', 'papa', 'mama_nombre', 'papa_nombre') then
        v_resultado := v_resultado || jsonb_build_object(v_clave, public.redactar_texto_linaje(v_valor));
      end if;
    end loop;
    return v_resultado;
  elsif jsonb_typeof(p_dato) = 'array' then
    select coalesce(jsonb_agg(public.redactar_texto_linaje(value) order by ord), '[]')
      into v_resultado from jsonb_array_elements(p_dato) with ordinality as a(value, ord);
    return v_resultado;
  end if;
  return p_dato;
end;
$$;
revoke all on function public.redactar_texto_linaje(jsonb) from public, anon, authenticated;

create or replace function public.redactar_auditoria_linaje()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  new.detalle := public.redactar_texto_linaje(new.detalle);
  return new;
end;
$$;
revoke all on function public.redactar_auditoria_linaje() from public, anon, authenticated;
create trigger audit_log_redactar_linaje before insert or update on public.audit_log
for each row execute function public.redactar_auditoria_linaje();

revoke select on public.importacion_lote from authenticated;
drop policy if exists importacion_lote_select_admin on public.importacion_lote;
alter table public.importacion_lote add column caduca_at timestamptz not null default (now() + interval '24 hours');
update public.importacion_lote set caduca_at = created_at + interval '24 hours';
alter table public.importacion_lote drop constraint importacion_lote_estado_check;
alter table public.importacion_lote add constraint importacion_lote_estado_check
  check (estado in ('previsualizado', 'confirmado', 'revertido', 'descartado', 'caducado'));

create or replace function public.limpiar_filas_lote_finalizado()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.estado = 'previsualizado' and new.caduca_at <= now() then new.estado := 'caducado'; end if;
  if new.estado <> 'previsualizado' then new.filas := '[]'::jsonb; end if;
  return new;
end;
$$;
revoke all on function public.limpiar_filas_lote_finalizado() from public, anon, authenticated;
create trigger importacion_lote_limpiar_filas before insert or update on public.importacion_lote
for each row execute function public.limpiar_filas_lote_finalizado();
update public.importacion_lote set filas = '[]' where estado <> 'previsualizado' or caduca_at <= now();

create or replace function public.caducar_importaciones_cruces()
returns bigint language plpgsql security definer set search_path = pg_catalog as $$
declare v_total bigint;
begin
  update public.importacion_lote set estado = 'caducado', filas = '[]'
    where estado = 'previsualizado' and caduca_at <= now();
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;
revoke all on function public.caducar_importaciones_cruces() from public, anon, authenticated;
select cron.schedule('importaciones-caducar', '*/5 * * * *', 'select public.caducar_importaciones_cruces();');

create or replace function public.descartar_importacion_cruces(p_lote_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Solo un admin puede descartar una importación' using errcode = '42501';
  end if;
  update public.importacion_lote set estado = 'descartado', filas = '[]'
    where id = p_lote_id and estado = 'previsualizado';
end;
$$;
revoke all on function public.descartar_importacion_cruces(uuid) from public, anon;
grant execute on function public.descartar_importacion_cruces(uuid) to authenticated, service_role;

create or replace function confirmar_importacion_cruces(
  p_lote_id uuid,
  p_crear_variedades boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_lote        importacion_lote;
  v_recientes   integer;
  v_con_error   integer;
  v_faltantes   integer;
  v_variedades  integer;
  v_cruces      integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede importar cruces' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Falta la clave de idempotencia' using errcode = '22023';
  end if;

  select * into v_lote from importacion_lote where id = p_lote_id for update;
  if not found then
    raise exception 'Lote de importación no encontrado' using errcode = 'P0002';
  end if;

  -- Reintento del mismo pedido (doble clic, red que se cortó): mismo resultado.
  if v_lote.estado = 'confirmado' and v_lote.idempotency_key = p_idempotency_key then
    return jsonb_build_object('lote_id', v_lote.id, 'cruces_creados', v_lote.cruces_creados,
                              'variedades_creadas', v_lote.variedades_creadas, 'repetido', true);
  end if;
  if v_lote.estado <> 'previsualizado' then
    raise exception 'Este lote ya está %: no se puede confirmar de nuevo', v_lote.estado using errcode = '55000';
  end if;

  if v_lote.caduca_at <= now() then
    raise exception 'Este lote ha caducado: vuelve a previsualizar el archivo' using errcode = '55000';
  end if;
  -- Límite de frecuencia por LOTE (no por fila).
  select count(*) into v_recientes
  from audit_log
  where usuario_id = v_uid
    and accion = 'importacion_cruces'
    and ocurrido_en > now() - interval '60 seconds';
  if v_recientes >= 3 then
    raise exception 'Rate limit excedido: máximo 3 importaciones por minuto por usuario' using errcode = '58503';
  end if;

  -- Se revalida: entre la previsualización y la confirmación pudo cambiar la base.
  create temporary table _filas_import on commit drop as
    select * from validar_filas_importacion_cruces(v_lote.filas);

  select count(*) filter (where cardinality(errores) > 0),
         count(*) filter (where cardinality(variedades_faltantes) > 0)
    into v_con_error, v_faltantes
  from _filas_import;

  if v_con_error > 0 then
    raise exception 'El archivo tiene % fila(s) con errores. Corrígelas y vuelve a previsualizar.', v_con_error
      using errcode = '23514';
  end if;
  if v_faltantes > 0 and not coalesce(p_crear_variedades, false) then
    raise exception 'Hay % fila(s) con progenitores que no existen como variedades. Confirma creando las variedades nuevas o corrige el archivo.', v_faltantes
      using errcode = '23514';
  end if;

  insert into variedades (especie_id, nombre, created_by)
  select distinct on (f.especie_id, lower(nombre)) f.especie_id, nombre, v_uid
  from _filas_import f, unnest(f.variedades_faltantes) nombre
  on conflict (especie_id, lower(btrim(nombre))) do nothing;
  get diagnostics v_variedades = row_count;

  insert into plantas (codigo_sistema, especie_id, cruzamiento, mama_id, papa_id, es_prueba, lote_importacion_id)
  select
    f.codigo_sistema,
    f.especie_id,
    f.cruzamiento,
    coalesce(f.mama_id, (select v.id from variedades v where v.especie_id = f.especie_id and lower(btrim(v.nombre)) = lower(f.mama))),
    coalesce(f.papa_id, (select v.id from variedades v where v.especie_id = f.especie_id and lower(btrim(v.nombre)) = lower(f.papa))),
    f.es_prueba,
    v_lote.id
  from _filas_import f
  order by f.n;
  get diagnostics v_cruces = row_count;

  update importacion_lote
     set estado = 'confirmado', confirmado_at = now(), idempotency_key = p_idempotency_key,
         cruces_creados = v_cruces, variedades_creadas = v_variedades
   where id = v_lote.id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, null, 'importacion_cruces', array['cruzamiento', 'mama_id', 'papa_id'],
          jsonb_build_object('lote_id', v_lote.id, 'archivo', v_lote.archivo_nombre,
                             'cruces_creados', v_cruces, 'variedades_creadas', v_variedades));

  return jsonb_build_object('lote_id', v_lote.id, 'cruces_creados', v_cruces,
                            'variedades_creadas', v_variedades, 'repetido', false);
end;
$$;

comment on function confirmar_importacion_cruces(uuid, boolean, uuid) is
  'Solo admin. Crea todos los cruces de un lote previsualizado en una sola transacción (si una fila falla, no entra ninguna). Idempotente por clave. Límite: 3 lotes por minuto. Cada alta queda auditada como alta_cruce.';

revoke all on function confirmar_importacion_cruces(uuid, boolean, uuid) from public, anon;
grant execute on function confirmar_importacion_cruces(uuid, boolean, uuid) to authenticated, service_role;
