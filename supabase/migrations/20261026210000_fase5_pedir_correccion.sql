-- Fase 5, paso 59 — «Pedir corrección» (decisión G15).
--
-- En una evaluación cerrada, su autor pide una corrección con una nota obligatoria. El pedido aparece en el Inicio del admin
-- («Correcciones pedidas», con enlace a la evaluación) y en el historial de la evaluación. Al corregir, el pedido queda
-- resuelto. El operario no edita nada: corregir sigue siendo solo del admin (A8, sin cambios en esas reglas).
--
-- Qué hace:
--   1. Tabla `pedido_correccion` con RLS: cada usuario lee sus propios pedidos y el admin todos; nadie escribe directo (ni el
--      admin): se crean solo con `pedir_correccion` y se resuelven solo al corregir. Un pedido abierto por evaluación.
--   2. `pedir_correccion(evaluacion, nota)`: solo quien hizo la evaluación (created_by), solo si está cerrada (completa o
--      corregida) y con el cruce sin archivar; nota obligatoria (hasta 1.000 caracteres). Audita «pedido_correccion».
--   3. Disparador `trg_evaluaciones_resolver_pedidos_correccion`: cuando el admin corrige una evaluación cerrada (estado
--      `corregida`), sus pedidos abiertos quedan resueltos (quién y cuándo) y se audita «pedido_correccion_resuelto».
--   4. `listar_correcciones_pedidas()` (solo admin): los pedidos abiertos, con el cruce, el individuo, la ronda, la nota, quién
--      lo pidió y cuándo. `pedidos_correccion_evaluacion(evaluacion)`: el historial de pedidos de una evaluación que el usuario
--      puede ver (el admin todos; los demás, los suyos). Ninguna expone el linaje.
--
-- Aditivo: la app de hoy no lee la tabla ni llama a las funciones. Rollback: docs/fase5/rollback/59_pedir_correccion.sql
-- (se niega si ya hay pedidos).

create table public.pedido_correccion (
  id uuid primary key default gen_random_uuid(),
  -- En cascada: una evaluación (o su cruce) solo se borra de verdad al purgar un cruce de prueba; sus pedidos se van con ella.
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  planta_id uuid not null references public.plantas(id) on delete cascade,
  individuo_id uuid not null references public.individuos(id) on delete cascade,
  nota text not null check (length(btrim(nota)) between 1 and 1000),
  created_by uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resuelto_en timestamptz,
  resuelto_por uuid references public.perfiles(id) on delete set null,
  constraint pedido_correccion_resuelto_check check (resuelto_por is null or resuelto_en is not null)
);
create unique index pedido_correccion_abierto_uidx on public.pedido_correccion (evaluacion_id) where resuelto_en is null;
create index idx_pedido_correccion_abiertos on public.pedido_correccion (created_at desc) where resuelto_en is null;
create index idx_pedido_correccion_created_by on public.pedido_correccion (created_by);
create index idx_pedido_correccion_planta on public.pedido_correccion (planta_id);
create index idx_pedido_correccion_individuo on public.pedido_correccion (individuo_id);
create index idx_pedido_correccion_resuelto_por on public.pedido_correccion (resuelto_por);
comment on table public.pedido_correccion is
  'Fase 5 (G15): pedidos de corrección de una evaluación cerrada, hechos por su autor con una nota. Se crean solo con pedir_correccion y se resuelven solo cuando el admin corrige la evaluación.';

alter table public.pedido_correccion enable row level security;
create policy pedido_correccion_select_propios_o_admin on public.pedido_correccion
  for select to authenticated
  using (created_by = (select auth.uid()) or (select public.es_admin()));
revoke all on public.pedido_correccion from public, anon, authenticated;
grant select on public.pedido_correccion to authenticated;

-- 2. Pedir una corrección ----------------------------------------------------------------------------------------------------
create function public.pedir_correccion(p_evaluacion_id uuid, p_nota text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_eval evaluaciones;
  v_individuo uuid;
  v_planta uuid;
  v_archivado timestamptz;
  v_nota text := btrim(coalesce(p_nota, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  select * into v_eval from evaluaciones where id = p_evaluacion_id;
  if not found then
    raise exception 'Evaluación no encontrada.' using errcode = 'P0002';
  end if;
  if v_eval.created_by is distinct from v_uid then
    raise exception 'Solo quien hizo la evaluación puede pedir una corrección.' using errcode = '42501';
  end if;
  if v_eval.estado not in ('completa', 'corregida') then
    raise exception 'Solo se puede pedir la corrección de una evaluación cerrada.' using errcode = '22023';
  end if;
  if v_nota = '' then
    raise exception 'Escribe qué hay que corregir.' using errcode = '22023';
  end if;
  if length(v_nota) > 1000 then
    raise exception 'La nota puede tener hasta 1.000 caracteres.' using errcode = '22023';
  end if;
  select r.individuo_id, i.planta_id, p.eliminado_at into v_individuo, v_planta, v_archivado
    from ronda_evaluacion_anual r
    join individuos i on i.id = r.individuo_id
    join plantas p on p.id = i.planta_id
   where r.id = v_eval.ronda_id;
  if v_archivado is not null then
    raise exception 'El cruce está archivado: no se pueden pedir correcciones.' using errcode = '23514';
  end if;
  begin
    insert into pedido_correccion (evaluacion_id, planta_id, individuo_id, nota, created_by)
    values (p_evaluacion_id, v_planta, v_individuo, v_nota, v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya pediste una corrección de esta evaluación y todavía no se resuelve.' using errcode = '23505';
  end;
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, v_planta, 'pedido_correccion', array['nota'],
          jsonb_build_object('pedido_id', v_id, 'evaluacion_id', p_evaluacion_id, 'individuo_id', v_individuo, 'nota', v_nota));
  return v_id;
end;
$$;
comment on function public.pedir_correccion(uuid, text) is
  'Fase 5 (G15): el autor de una evaluación cerrada pide una corrección con una nota obligatoria. Un pedido abierto por evaluación. Auditado (pedido_correccion).';
revoke all on function public.pedir_correccion(uuid, text) from public, anon;
grant execute on function public.pedir_correccion(uuid, text) to authenticated;

-- 3. Al corregir, los pedidos abiertos quedan resueltos --------------------------------------------------------------------
create function public.resolver_pedidos_correccion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido record;
begin
  if new.estado <> 'corregida' or old.estado not in ('completa', 'corregida') then
    return new;
  end if;
  for v_pedido in
    update pedido_correccion
       set resuelto_en = now(), resuelto_por = auth.uid()
     where evaluacion_id = new.id and resuelto_en is null
    returning id, planta_id, individuo_id
  loop
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (auth.uid(), v_pedido.planta_id, 'pedido_correccion_resuelto', array['resuelto_en'],
            jsonb_build_object('pedido_id', v_pedido.id, 'evaluacion_id', new.id, 'individuo_id', v_pedido.individuo_id));
  end loop;
  return new;
end;
$$;
comment on function public.resolver_pedidos_correccion() is
  'Fase 5 (G15): cuando el admin corrige una evaluación cerrada, sus pedidos de corrección abiertos quedan resueltos (auditado: pedido_correccion_resuelto).';
revoke all on function public.resolver_pedidos_correccion() from public, anon, authenticated;

create trigger trg_evaluaciones_resolver_pedidos_correccion
  after update on public.evaluaciones
  for each row execute function public.resolver_pedidos_correccion();

-- 4. Lecturas ------------------------------------------------------------------------------------------------------------------
create function public.listar_correcciones_pedidas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin ve las correcciones pedidas.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pc.id,
      'evaluacion_id', pc.evaluacion_id,
      'planta_id', pc.planta_id,
      'especie_id', p.especie_id,
      'codigo_sistema', p.codigo_sistema,
      'individuo_id', pc.individuo_id,
      'codigo_display', i.codigo_display,
      'numero_ronda', r.numero_ronda,
      'tipo_ronda', r.tipo_ronda,
      'nota', pc.nota,
      'pedido_por', coalesce(pf.nombre, 'Usuario eliminado'),
      'pedido_en', pc.created_at
    ) order by pc.created_at, pc.id)
    from pedido_correccion pc
    join evaluaciones e on e.id = pc.evaluacion_id
    join ronda_evaluacion_anual r on r.id = e.ronda_id
    join individuos i on i.id = pc.individuo_id
    join plantas p on p.id = pc.planta_id
    left join perfiles pf on pf.id = pc.created_by
    where pc.resuelto_en is null and p.eliminado_at is null
  ), '[]'::jsonb);
end;
$$;
comment on function public.listar_correcciones_pedidas() is
  'Fase 5 (G15): pedidos de corrección abiertos para el Inicio del admin (cruce, individuo, ronda, nota, quién y cuándo). Solo admin; sin linaje.';
revoke all on function public.listar_correcciones_pedidas() from public, anon;
grant execute on function public.listar_correcciones_pedidas() to authenticated;

create function public.pedidos_correccion_evaluacion(p_evaluacion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  v_admin := es_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pc.id,
      'nota', pc.nota,
      'pedido_por', coalesce(pp.nombre, 'Usuario eliminado'),
      'pedido_en', pc.created_at,
      'estado', case when pc.resuelto_en is null then 'abierto' else 'resuelto' end,
      'resuelto_en', pc.resuelto_en,
      'resuelto_por', case when pc.resuelto_en is null then null else coalesce(pr.nombre, 'Usuario eliminado') end
    ) order by pc.created_at desc, pc.id desc)
    from pedido_correccion pc
    left join perfiles pp on pp.id = pc.created_by
    left join perfiles pr on pr.id = pc.resuelto_por
    where pc.evaluacion_id = p_evaluacion_id
      and (v_admin or pc.created_by = v_uid)
  ), '[]'::jsonb);
end;
$$;
comment on function public.pedidos_correccion_evaluacion(uuid) is
  'Fase 5 (G15): historial de pedidos de corrección de una evaluación (nota, quién y cuándo, abierto o resuelto y por quién). El admin ve todos; los demás, los suyos.';
revoke all on function public.pedidos_correccion_evaluacion(uuid) from public, anon;
grant execute on function public.pedidos_correccion_evaluacion(uuid) to authenticated;
