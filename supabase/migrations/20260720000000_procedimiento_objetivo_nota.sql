-- Mejora 2 (Procedimientos): nota adicional específica para un objetivo de
-- procedimiento -- separada de la nota general del procedimiento
-- (procedimientos.notas). Se guarda en el mismo registro del objetivo
-- (procedimiento_objetivos), sin fila separada: mantiene el modelo actual
-- de un individuo/predio adicional por vez. Verificado antes de escribir
-- esta migración que procedimiento_objetivos NO tenía columna de nota
-- utilizable.

alter table procedimiento_objetivos add column nota text;

comment on column procedimiento_objetivos.nota is
  'Nota específica de este objetivo (ej. detalle del individuo adicional), distinta de procedimientos.notas que es general al procedimiento.';

create or replace function reemplazar_objetivos_procedimiento(
  p_procedimiento_id uuid,
  p_objetivos jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_objetivo jsonb;
  v_tipo tipo_objetivo_procedimiento;
  v_id uuid;
  v_nota text;
  v_planta_contexto uuid;
  v_predio_id uuid;
  v_predios_activos integer;
begin
  if jsonb_typeof(p_objetivos) <> 'array' or jsonb_array_length(p_objetivos) = 0 then
    raise exception 'El procedimiento requiere al menos un objetivo' using errcode = '23514';
  end if;

  delete from procedimiento_objetivos where procedimiento_id = p_procedimiento_id;

  for v_objetivo in select value from jsonb_array_elements(p_objetivos)
  loop
    v_tipo := (v_objetivo ->> 'tipo')::tipo_objetivo_procedimiento;
    v_id := (v_objetivo ->> 'id')::uuid;
    v_nota := nullif(btrim(v_objetivo ->> 'nota'), '');

    if v_tipo = 'cruzamiento' then
      perform 1 from plantas where id = v_id and eliminado_at is null;
      if not found then raise exception 'Cruce objetivo no encontrado' using errcode = '23503'; end if;
      insert into procedimiento_objetivos (procedimiento_id, tipo, planta_id, nota)
      values (p_procedimiento_id, v_tipo, v_id, v_nota);
    elsif v_tipo = 'predio' then
      perform 1 from predio where id = v_id and activo;
      if not found then raise exception 'Predio objetivo no encontrado o inactivo' using errcode = '23503'; end if;
      insert into procedimiento_objetivos (procedimiento_id, tipo, predio_id, nota)
      values (p_procedimiento_id, v_tipo, v_id, v_nota);
    else
      perform 1 from individuos where id = v_id;
      if not found then raise exception 'Individuo objetivo no encontrado' using errcode = '23503'; end if;
      insert into procedimiento_objetivos (procedimiento_id, tipo, individuo_id, nota)
      values (p_procedimiento_id, v_tipo, v_id, v_nota);
    end if;
  end loop;

  if exists (select 1 from procedimiento_objetivos where procedimiento_id = p_procedimiento_id and tipo = 'predio') then
    select planta_id into v_planta_contexto
    from procedimiento_objetivos
    where procedimiento_id = p_procedimiento_id and tipo = 'cruzamiento'
    limit 1;
    if v_planta_contexto is null
       or (select count(*) from procedimiento_objetivos where procedimiento_id = p_procedimiento_id and tipo = 'cruzamiento') <> 1 then
      raise exception 'Un procedimiento por predio requiere exactamente un cruce objetivo' using errcode = '23514';
    end if;

    select count(distinct s.predio_id) into v_predios_activos
    from emplazamiento_individuo e
    join individuos i on i.id = e.individuo_id
    join sector s on s.id = e.sector_id
    where i.planta_id = v_planta_contexto and e.fecha_fin is null;
    if v_predios_activos < 2 then
      raise exception 'El procedimiento por predio requiere un contexto multisitio real' using errcode = '23514';
    end if;

    for v_predio_id in
      select predio_id from procedimiento_objetivos
      where procedimiento_id = p_procedimiento_id and tipo = 'predio'
    loop
      perform 1
      from emplazamiento_individuo e
      join individuos i on i.id = e.individuo_id
      join sector s on s.id = e.sector_id
      where i.planta_id = v_planta_contexto
        and s.predio_id = v_predio_id
        and e.fecha_fin is null;
      if not found then
        raise exception 'El predio objetivo no tiene individuos activos de ese cruce' using errcode = '23514';
      end if;
    end loop;
  end if;
end;
$$;
