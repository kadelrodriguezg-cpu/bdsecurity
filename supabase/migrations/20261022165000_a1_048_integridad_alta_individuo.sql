-- A1-048: reglas ya definidas de identidad/alta. La fase permitida para
-- CLONAR sigue pendiente de decisión; no se inventa una lista de fases.
create function public.validar_alta_individuo()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_estado public.estado_planta;
  v_archivado timestamptz;
  v_origen_planta uuid;
  v_origen_estado public.estado_vital;
begin
  if auth.uid() is null then return new; end if;
  select estado, eliminado_at into v_estado, v_archivado
    from public.plantas where id = new.planta_id for share;
  if not found then raise exception 'El cruce no existe.' using errcode = 'P0002'; end if;
  if v_archivado is not null then
    raise exception 'El cruce está archivado. Restáuralo antes de crear individuos.' using errcode = '55000';
  end if;
  if new.clon_de_id is null then
    if v_estado <> 'trasplante' then
      raise exception 'Los individuos nuevos se crean en Trasplante.' using errcode = '55000';
    end if;
    return new;
  end if;
  if new.clon_de_id = new.id then
    raise exception 'Un individuo no puede ser clon de sí mismo.' using errcode = '23514';
  end if;
  select planta_id, estado_vital into v_origen_planta, v_origen_estado
    from public.individuos where id = new.clon_de_id for share;
  if not found then raise exception 'El origen del clon no existe.' using errcode = 'P0002'; end if;
  if v_origen_planta <> new.planta_id then
    raise exception 'El origen del clon debe pertenecer al mismo cruce.' using errcode = '23514';
  end if;
  if v_origen_estado <> 'vivo' then
    raise exception 'Solo se puede clonar un individuo vivo.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_alta_individuo() from public, anon, authenticated;
create trigger individuos_validar_alta before insert on public.individuos
for each row execute function public.validar_alta_individuo();
