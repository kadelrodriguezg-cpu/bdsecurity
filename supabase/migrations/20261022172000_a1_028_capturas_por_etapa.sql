-- A1-028: acuerdo delegado, feedback/dominio_c2.md. Orden del enum, no historial.
create function public.captura_tiene_respaldo(p_planta uuid, p_etapa public.estado_planta)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select case p_etapa
    when 'polinizacion' then exists(select 1 from public.polinizacion_evento where planta_id = p_planta)
    when 'cosecha' then exists(select 1 from public.cosecha_fruto where planta_id = p_planta)
    when 'siembra_semilla' then exists(select 1 from public.plantas_insumo where planta_id = p_planta)
      or exists(select 1 from public.plantas_sustrato where planta_id = p_planta)
    when 'germinacion' then exists(select 1 from public.germinacion_evento where planta_id = p_planta)
    else false end;
$$;
revoke all on function public.captura_tiene_respaldo(uuid,public.estado_planta) from public, anon, authenticated;

create function public.validar_etapa_captura()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_fila jsonb;
  v_planta uuid;
  v_etapa public.estado_planta;
  v_estado public.estado_planta;
  v_archivado timestamptz;
  v_nueva boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and public.es_admin()
    and current_setting('bdsecurity.purga_cruce', true) = old.planta_id::text then return old; end if;
  if tg_op = 'UPDATE' and to_jsonb(old)->>'created_by' is not null
    and to_jsonb(new)->>'created_by' is null
    and (to_jsonb(new) - 'created_by' - 'updated_at') = (to_jsonb(old) - 'created_by' - 'updated_at')
    and not exists(select 1 from public.perfiles where id = (to_jsonb(old)->>'created_by')::uuid)
  then return new; end if;
  -- Comprueba también el origen de una reasignación; nunca permite mover fuera de un ciclo cerrado.
  for v_fila in select value from jsonb_array_elements(case tg_op
    when 'INSERT' then jsonb_build_array(to_jsonb(new))
    when 'DELETE' then jsonb_build_array(to_jsonb(old))
    else jsonb_build_array(to_jsonb(old), to_jsonb(new)) end)
  loop
    v_planta := (v_fila->>'planta_id')::uuid;
    v_etapa := case tg_table_name
      when 'polinizacion_evento' then 'polinizacion'::public.estado_planta
      when 'cosecha_fruto' then 'cosecha'::public.estado_planta
      when 'germinacion_evento' then 'germinacion'::public.estado_planta
      when 'plantas_insumo' then 'siembra_semilla'::public.estado_planta
      when 'plantas_sustrato' then 'siembra_semilla'::public.estado_planta
      when 'registros_evento' then case v_fila->>'tipo_evento'
        when 'polinizacion' then 'polinizacion'::public.estado_planta
        when 'cosecha' then 'cosecha'::public.estado_planta
        when 'siembra_semilla' then 'siembra_semilla'::public.estado_planta
        when 'germinacion' then 'germinacion'::public.estado_planta end end;
    if v_etapa is null then continue; end if;
    select estado, eliminado_at into v_estado, v_archivado from public.plantas where id = v_planta for share;
    if v_archivado is not null or v_estado = 'proceso_finalizado' then
      raise exception 'No se puede registrar % en un cruce en etapa % o archivado.', v_etapa, v_estado using errcode = '55000';
    end if;
    v_nueva := tg_op = 'INSERT' or (tg_op = 'UPDATE' and
      (new.planta_id is distinct from old.planta_id or
       (tg_table_name = 'registros_evento' and to_jsonb(new)->>'tipo_evento' is distinct from to_jsonb(old)->>'tipo_evento')));
    if v_nueva and v_estado < v_etapa and not
      (tg_table_name = 'registros_evento' and public.captura_tiene_respaldo(v_planta, v_etapa)) then
      raise exception 'No se puede registrar % en un cruce en etapa %.', v_etapa, v_estado using errcode = '55000';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.validar_etapa_captura() from public, anon, authenticated;
create trigger polinizacion_validar_etapa before insert or update or delete on public.polinizacion_evento for each row execute function public.validar_etapa_captura();
create trigger cosecha_validar_etapa before insert or update or delete on public.cosecha_fruto for each row execute function public.validar_etapa_captura();
create trigger germinacion_validar_etapa before insert or update or delete on public.germinacion_evento for each row execute function public.validar_etapa_captura();
create trigger insumos_validar_etapa before insert or update or delete on public.plantas_insumo for each row execute function public.validar_etapa_captura();
create trigger sustratos_validar_etapa before insert or update or delete on public.plantas_sustrato for each row execute function public.validar_etapa_captura();
create trigger eventos_validar_etapa before insert or update or delete on public.registros_evento for each row execute function public.validar_etapa_captura();

create function public.validar_etapa_columnas_captura()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_campo text;
  v_etapa public.estado_planta;
  v_antes jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_despues jsonb := to_jsonb(new);
begin
  if auth.uid() is null then return new; end if;
  for v_campo, v_etapa in select * from (values
    ('fecha_polinizacion', 'polinizacion'::public.estado_planta), ('n_flores_cruzadas', 'polinizacion'),
    ('fecha_cosecha', 'cosecha'), ('n_semillas', 'cosecha'), ('conteo_f1', 'cosecha'), ('conteo_f2', 'cosecha'),
    ('escarificacion_subtipo', 'siembra_semilla'), ('escarificacion_duracion_dias', 'siembra_semilla'),
    ('contenedor_id', 'siembra_semilla'), ('semillas_sembradas', 'siembra_semilla')) as campos(campo, etapa)
  loop
    if (v_antes->v_campo) is not distinct from (v_despues->v_campo)
      or (tg_op = 'INSERT' and v_despues->>v_campo is null) then continue; end if;
    if new.eliminado_at is not null or new.estado = 'proceso_finalizado'
      or (tg_op = 'UPDATE' and old.estado = 'proceso_finalizado') then
      raise exception 'No se puede registrar % en un cruce en etapa % o archivado.', v_etapa, new.estado using errcode = '55000';
    end if;
    if v_despues->>v_campo is null then continue; end if;
    -- Resincronización vacía de sesiones tras quitar la última: cero no es una captura.
    if v_campo = 'n_flores_cruzadas' and new.n_flores_cruzadas = 0
      and new.fecha_polinizacion is null and not public.captura_tiene_respaldo(new.id, 'polinizacion') then continue; end if;
    if new.estado < v_etapa and not public.captura_tiene_respaldo(new.id, v_etapa) then
      raise exception 'No se puede registrar % en un cruce en etapa %.', v_etapa, new.estado using errcode = '55000';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validar_etapa_columnas_captura() from public, anon, authenticated;
create trigger plantas_validar_etapa_captura before insert or update on public.plantas
for each row execute function public.validar_etapa_columnas_captura();
