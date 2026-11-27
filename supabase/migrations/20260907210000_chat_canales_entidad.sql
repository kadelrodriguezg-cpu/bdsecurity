-- Generaliza el chat operativo a entidades reales: cruce y predio.
-- El acceso sigue el modelo vigente del sistema: todo perfil autenticado
-- accede a esas entidades. No introduce una asignación usuario/entidad nueva.
-- Los nombres son copias operativas para conservar canales históricos; nunca
-- contienen linaje genético.
begin;

drop function public.obtener_canal_chat(uuid);
drop function public.listar_canales_chat();

alter table public.chat_canales
  add column entidad_id uuid,
  add column entidad_nombre text;

-- Los canales cuyo cruce todavía existe conservan su UUID. Un canal histórico
-- de un cruce ya borrado perdió planta_id por el antiguo ON DELETE SET NULL;
-- usa su propio UUID como identidad estable para no perder mensajes ni nombre.
update public.chat_canales
set entidad_id = coalesce(planta_id, id),
    entidad_nombre = codigo_cruce
where tipo = 'cruce';

drop index public.chat_un_canal_por_cruce;
alter table public.chat_canales
  drop constraint chat_canales_planta_id_fkey,
  drop constraint chat_canales_check,
  drop constraint chat_canales_tipo_check,
  drop column planta_id,
  drop column codigo_cruce;

alter table public.chat_canales
  add constraint chat_canales_tipo_check
    check (tipo in ('general', 'cruce', 'predio')),
  add constraint chat_canales_entidad_check
    check (
      (tipo = 'general' and entidad_id is null and entidad_nombre is null)
      or (tipo in ('cruce', 'predio') and entidad_id is not null and entidad_nombre is not null)
    );

create unique index chat_un_canal_por_entidad
  on public.chat_canales(tipo, entidad_id)
  where tipo in ('cruce', 'predio');

comment on column public.chat_canales.entidad_id is
  'UUID de la entidad asociada. NULL exclusivamente para el canal general. No tiene FK polimórfica para preservar conversaciones históricas.';
comment on column public.chat_canales.entidad_nombre is
  'Nombre operativo copiado al crear el canal; preserva la identificación de entidades inactivas o eliminadas.';

-- Despacho común de acceso y disponibilidad. Hoy plantas y predios son
-- visibles para cualquier autenticado; exigir perfiles conserva el límite real
-- de la aplicación. p_solo_activa=true se usa para crear/escribir, false para
-- lectura histórica. El último EXISTS mantiene accesible una entidad eliminada
-- que ya tenía canal, sin permitir crear un canal huérfano nuevo.
create function public.puede_acceder_entidad_chat(
  p_tipo text,
  p_entidad_id uuid,
  p_solo_activa boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perfiles where id = auth.uid())
    and case p_tipo
      when 'general' then p_entidad_id is null
      when 'cruce' then
        exists(
          select 1 from public.plantas
          where id = p_entidad_id and (not p_solo_activa or eliminado_at is null)
        )
        or (not p_solo_activa and exists(
          select 1 from public.chat_canales where tipo = 'cruce' and entidad_id = p_entidad_id
        ))
      when 'predio' then
        exists(
          select 1 from public.predio
          where id = p_entidad_id and (not p_solo_activa or activo)
        )
        or (not p_solo_activa and exists(
          select 1 from public.chat_canales where tipo = 'predio' and entidad_id = p_entidad_id
        ))
      else false
    end;
$$;

create or replace function public.puede_acceder_chat(p_canal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from public.chat_canales c
    where c.id = p_canal_id
      and public.puede_acceder_entidad_chat(c.tipo, c.entidad_id, false)
  );
$$;

create function public.obtener_canal_chat(
  p_tipo text default 'general',
  p_entidad_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_nombre text;
begin
  if not exists(select 1 from public.perfiles where id = auth.uid()) then
    raise exception 'Se requiere una cuenta con perfil.' using errcode = '42501';
  end if;

  if p_tipo not in ('general', 'cruce', 'predio')
    or (p_tipo = 'general' and p_entidad_id is not null)
    or (p_tipo <> 'general' and p_entidad_id is null) then
    raise exception 'Tipo o entidad de chat inválidos.' using errcode = '22023';
  end if;

  select id into v_id
  from public.chat_canales
  where tipo = p_tipo and entidad_id is not distinct from p_entidad_id;
  if found then return v_id; end if;

  if p_tipo = 'general' then
    raise exception 'La conversación general no está disponible.' using errcode = 'P0002';
  elsif p_tipo = 'cruce' then
    select codigo_sistema into v_nombre
    from public.plantas
    where id = p_entidad_id and eliminado_at is null
    for share;
  else
    select nombre into v_nombre
    from public.predio
    where id = p_entidad_id and activo
    for share;
  end if;

  if not found then
    raise exception 'La entidad no está disponible.' using errcode = 'P0002';
  end if;

  insert into public.chat_canales(tipo, entidad_id, entidad_nombre)
    values (p_tipo, p_entidad_id, v_nombre)
    on conflict (tipo, entidad_id) where tipo in ('cruce', 'predio') do nothing;
  select id into strict v_id
  from public.chat_canales
  where tipo = p_tipo and entidad_id = p_entidad_id;
  return v_id;
end;
$$;

create function public.listar_canales_chat()
returns table(
  id uuid,
  tipo text,
  entidad_id uuid,
  entidad_nombre text,
  ultima_posicion integer,
  archivado boolean,
  creado_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    c.id,
    c.tipo,
    c.entidad_id,
    case c.tipo
      when 'cruce' then coalesce(p.codigo_sistema, c.entidad_nombre)
      when 'predio' then coalesce(pr.nombre, c.entidad_nombre)
      else null
    end,
    c.ultima_posicion,
    case c.tipo
      when 'cruce' then p.id is null or p.eliminado_at is not null
      when 'predio' then pr.id is null or not pr.activo
      else false
    end,
    c.creado_at
  from public.chat_canales c
  left join public.plantas p on c.tipo = 'cruce' and p.id = c.entidad_id
  left join public.predio pr on c.tipo = 'predio' and pr.id = c.entidad_id
  where public.puede_acceder_entidad_chat(c.tipo, c.entidad_id, false)
  order by
    (c.tipo = 'general') desc,
    case c.tipo when 'cruce' then 1 when 'predio' then 2 else 0 end,
    c.entidad_nombre,
    c.id;
$$;

create or replace function public.enviar_mensaje_chat(
  p_canal_id uuid,
  p_contenido text,
  p_clave_envio uuid
)
returns public.chat_mensajes language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text;
  v_canal public.chat_canales;
  v_mensaje public.chat_mensajes;
  v_contenido text := btrim(p_contenido);
begin
  if not public.puede_acceder_chat(p_canal_id) then
    raise exception 'No tienes acceso a esta conversación.' using errcode = '42501';
  end if;
  if p_clave_envio is null or v_contenido is null or char_length(v_contenido) not between 1 and 4000
    or v_contenido !~ '[^[:space:]]' then
    raise exception 'Escribe un mensaje de entre 1 y 4000 caracteres.' using errcode = '22023';
  end if;

  select * into v_canal from public.chat_canales where id = p_canal_id;
  -- La entidad se bloquea antes que el canal, conservando el orden del Sprint 1
  -- para que una desactivación no compita con un envío ya validado.
  if v_canal.tipo = 'cruce' then
    perform 1 from public.plantas
    where id = v_canal.entidad_id and eliminado_at is null
    for share;
    if not found then
      raise exception 'Esta conversación está archivada.' using errcode = '55000';
    end if;
  elsif v_canal.tipo = 'predio' then
    perform 1 from public.predio
    where id = v_canal.entidad_id and activo
    for share;
    if not found then
      raise exception 'Esta conversación está archivada.' using errcode = '55000';
    end if;
  end if;

  select * into v_canal from public.chat_canales where id = p_canal_id for update;
  select * into v_mensaje from public.chat_mensajes
    where canal_id = p_canal_id and autor_id = v_uid and clave_envio = p_clave_envio;
  if found then
    if v_mensaje.contenido <> v_contenido then
      raise exception 'Este envío ya fue usado para otro mensaje.' using errcode = '22023';
    end if;
    return v_mensaje;
  end if;

  select nombre into strict v_nombre from public.perfiles where id = v_uid;
  update public.chat_canales
  set ultima_posicion = ultima_posicion + 1
  where id = p_canal_id
  returning ultima_posicion into v_canal.ultima_posicion;
  insert into public.chat_mensajes(canal_id, posicion, autor_id, autor_nombre, contenido, clave_envio)
    values (p_canal_id, v_canal.ultima_posicion, v_uid, v_nombre, v_contenido, p_clave_envio)
    returning * into v_mensaje;
  return v_mensaje;
end;
$$;

revoke all on function public.puede_acceder_entidad_chat(text, uuid, boolean),
  public.obtener_canal_chat(text, uuid), public.listar_canales_chat()
  from public, anon;
grant execute on function public.puede_acceder_entidad_chat(text, uuid, boolean),
  public.obtener_canal_chat(text, uuid), public.listar_canales_chat()
  to authenticated;

notify pgrst, 'reload schema';
commit;
