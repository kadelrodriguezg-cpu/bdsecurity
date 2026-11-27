-- A1-140: misma fase que la RPC de ronda, también al guardar borradores.
create function public.validar_ciclo_evaluacion()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_ronda uuid;
  v_individuo uuid;
  v_tipo text;
  v_planta uuid;
  v_vital public.estado_vital;
  v_estado public.estado_planta;
  v_archivado timestamptz;
begin
  if auth.uid() is null then return new; end if;
  -- Conserva la limpieza FK de autoría; no habilita cambios de autor por API.
  if tg_op = 'UPDATE' and old.created_by is not null and new.created_by is null
    and (to_jsonb(new) - 'created_by' - 'updated_at') = (to_jsonb(old) - 'created_by' - 'updated_at')
    and not exists(select 1 from public.perfiles where id = old.created_by)
  then return new; end if;
  for v_ronda in select distinct id from unnest(array[new.ronda_id,
    case when tg_op = 'UPDATE' then old.ronda_id end]) id where id is not null order by id
  loop
    select individuo_id, tipo_ronda::text into v_individuo, v_tipo
      from public.ronda_evaluacion_anual where id = v_ronda for share;
    if not found then raise exception 'La ronda no existe.' using errcode = 'P0002'; end if;
    select planta_id, estado_vital into v_planta, v_vital
      from public.individuos where id = v_individuo for share;
    if v_vital <> 'vivo' then
      raise exception 'El individuo no está vivo. No se puede guardar la evaluación.' using errcode = '42501';
    end if;
    select estado, eliminado_at into v_estado, v_archivado
      from public.plantas where id = v_planta for share;
    if v_archivado is not null then
      raise exception 'El cruce está archivado. Restáuralo antes de guardar la evaluación.' using errcode = '55000';
    end if;
    if (v_tipo = 'anual' and v_estado <> 'evaluacion_anual')
      or (v_tipo = 'multisitio' and v_estado <> 'traslado_destino') then
      raise exception 'La fase del cruce no permite guardar evaluaciones de esta ronda.' using errcode = '55000';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validar_ciclo_evaluacion() from public, anon, authenticated;
create trigger evaluaciones_validar_ciclo before insert or update on public.evaluaciones
for each row execute function public.validar_ciclo_evaluacion();
