-- A1-121: guardia común a ambas RPC y al INSERT directo, sin ampliar permisos.
create function public.validar_cruce_activo_ronda()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_planta_id uuid;
  v_archivado timestamptz;
begin
  if auth.uid() is null then return new; end if;
  select planta_id into v_planta_id from public.individuos where id = new.individuo_id for share;
  if not found then raise exception 'El individuo no existe.' using errcode = 'P0002'; end if;
  select eliminado_at into v_archivado from public.plantas where id = v_planta_id for share;
  if v_archivado is not null then
    raise exception 'El cruce está archivado. Restáuralo antes de iniciar una ronda.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_cruce_activo_ronda() from public, anon, authenticated;
create trigger ronda_validar_cruce_activo before insert on public.ronda_evaluacion_anual
for each row execute function public.validar_cruce_activo_ronda();
