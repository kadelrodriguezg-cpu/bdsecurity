-- Canales libres con membresía explícita, menciones persistentes,
-- notificaciones y /clear sin borrado físico.
begin;

alter table public.chat_canales
  add column creado_por uuid references public.perfiles(id) on delete set null,
  add column archivado_at timestamptz,
  add column oculto_desde integer not null default 0 check (oculto_desde >= 0);

alter table public.chat_canales
  drop constraint chat_canales_tipo_check,
  drop constraint chat_canales_entidad_check,
  add constraint chat_canales_tipo_check
    check (tipo in ('general', 'cruce', 'predio', 'libre')),
  add constraint chat_canales_entidad_check
    check (
      (tipo = 'general' and entidad_id is null and entidad_nombre is null)
      or (tipo in ('cruce', 'predio') and entidad_id is not null and entidad_nombre is not null)
      or (tipo = 'libre' and entidad_id is null and btrim(entidad_nombre) <> '')
    ),
  add constraint chat_canales_oculto_desde_valido
    check (oculto_desde <= ultima_posicion);

create table public.chat_canal_participantes (
  canal_id uuid not null references public.chat_canales(id) on delete cascade,
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  agregado_por uuid references public.perfiles(id) on delete set null,
  agregado_at timestamptz not null default now(),
  primary key (canal_id, usuario_id)
);

create table public.chat_menciones (
  mensaje_id uuid not null references public.chat_mensajes(id) on delete restrict,
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  tipo text not null check (tipo in ('directa', 'todos')),
  leida_at timestamptz,
  creado_at timestamptz not null default now(),
  primary key (mensaje_id, usuario_id)
);

create index chat_menciones_usuario_pendientes
  on public.chat_menciones(usuario_id, creado_at desc)
  where leida_at is null;

alter table public.chat_canal_participantes enable row level security;
alter table public.chat_menciones enable row level security;

-- Un participante es cualquier perfil activo para los canales de dominio y
-- únicamente una fila de membresía para los canales libres.
create function public.es_participante_chat(p_canal_id uuid, p_usuario_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perfiles where id = p_usuario_id)
    and exists(
      select 1
      from public.chat_canales c
      where c.id = p_canal_id
        and (
          c.tipo <> 'libre'
          or exists(
            select 1 from public.chat_canal_participantes cp
            where cp.canal_id = c.id and cp.usuario_id = p_usuario_id
          )
        )
    );
$$;

create or replace function public.puede_acceder_chat(p_canal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.es_participante_chat(p_canal_id, auth.uid())
    and exists(
      select 1
      from public.chat_canales c
      where c.id = p_canal_id
        and (
          c.tipo = 'libre'
          or public.puede_acceder_entidad_chat(c.tipo, c.entidad_id, false)
        )
    );
$$;

create policy chat_canal_participantes_lectura on public.chat_canal_participantes
  for select to authenticated
  using (public.puede_acceder_chat(canal_id));

create policy chat_menciones_propias on public.chat_menciones
  for select to authenticated
  using (
    usuario_id = auth.uid()
    and exists(
      select 1 from public.chat_mensajes m
      where m.id = mensaje_id and public.puede_acceder_chat(m.canal_id)
    )
  );

-- El corte de /clear se aplica también al camino de lectura directa.
drop policy chat_mensajes_lectura on public.chat_mensajes;
create policy chat_mensajes_lectura on public.chat_mensajes
  for select to authenticated
  using (
    public.puede_acceder_chat(canal_id)
    and posicion > (
      select c.oculto_desde from public.chat_canales c where c.id = canal_id
    )
  );

revoke all on public.chat_canal_participantes, public.chat_menciones from anon, authenticated;
grant select on public.chat_canal_participantes, public.chat_menciones to authenticated;
grant all on public.chat_canal_participantes, public.chat_menciones to service_role;

-- Solo el admin creador gestiona un canal libre. Se elige esta regla para que
-- otro admin no pueda incorporarse y leer una conversación sin haber sido
-- incluido por su responsable. El creador queda siempre dentro del canal.
create function public.puede_gestionar_canal_libre(p_canal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.es_admin()
    and exists(
      select 1 from public.chat_canales
      where id = p_canal_id and tipo = 'libre' and creado_por = auth.uid()
    );
$$;

create function public.crear_canal_libre(p_nombre text, p_participantes uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_nombre text := btrim(p_nombre);
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede crear canales.' using errcode = '42501';
  end if;
  if v_nombre is null or char_length(v_nombre) not between 2 and 80 then
    raise exception 'El nombre debe tener entre 2 y 80 caracteres.' using errcode = '22023';
  end if;
  if exists(
    select 1 from unnest(coalesce(p_participantes, '{}')) participante
    where not exists(select 1 from public.perfiles where id = participante)
  ) then
    raise exception 'Hay participantes que no existen.' using errcode = '22023';
  end if;

  insert into public.chat_canales(tipo, entidad_nombre, creado_por)
    values ('libre', v_nombre, v_uid)
    returning id into v_id;
  insert into public.chat_canal_participantes(canal_id, usuario_id, agregado_por)
    select v_id, participante, v_uid
    from (
      select distinct unnest(array_append(coalesce(p_participantes, '{}'), v_uid)) participante
    ) seleccionados;
  return v_id;
end;
$$;

create function public.actualizar_participantes_canal_libre(
  p_canal_id uuid,
  p_participantes uuid[]
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_creador uuid;
begin
  if not public.puede_gestionar_canal_libre(p_canal_id) then
    raise exception 'No puedes gestionar este canal.' using errcode = '42501';
  end if;
  if exists(
    select 1 from unnest(coalesce(p_participantes, '{}')) participante
    where not exists(select 1 from public.perfiles where id = participante)
  ) then
    raise exception 'Hay participantes que no existen.' using errcode = '22023';
  end if;
  select creado_por into strict v_creador
  from public.chat_canales where id = p_canal_id for update;

  delete from public.chat_canal_participantes
  where canal_id = p_canal_id
    and usuario_id <> v_creador
    and not (usuario_id = any(coalesce(p_participantes, '{}')));
  insert into public.chat_canal_participantes(canal_id, usuario_id, agregado_por)
    select p_canal_id, participante, auth.uid()
    from (
      select distinct unnest(array_append(coalesce(p_participantes, '{}'), v_creador)) participante
    ) seleccionados
    on conflict (canal_id, usuario_id) do nothing;
end;
$$;

create function public.archivar_canal_libre(p_canal_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_gestionar_canal_libre(p_canal_id) then
    raise exception 'No puedes archivar este canal.' using errcode = '42501';
  end if;
  update public.chat_canales set archivado_at = coalesce(archivado_at, now())
  where id = p_canal_id;
end;
$$;

create function public.listar_participantes_chat(p_canal_id uuid)
returns table(id uuid, nombre text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.puede_acceder_chat(p_canal_id) then
    raise exception 'No tienes acceso a esta conversación.' using errcode = '42501';
  end if;
  return query
    select p.id, p.nombre
    from public.perfiles p
    where public.es_participante_chat(p_canal_id, p.id)
    order by p.nombre, p.id;
end;
$$;

drop function public.listar_canales_chat();
create function public.listar_canales_chat()
returns table(
  id uuid,
  tipo text,
  entidad_id uuid,
  entidad_nombre text,
  ultima_posicion integer,
  ultima_lectura integer,
  no_leidos integer,
  ultima_actividad_at timestamptz,
  archivado boolean,
  creado_por uuid,
  oculto_desde integer,
  puede_gestionar boolean,
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
      when 'libre' then c.entidad_nombre
      else null
    end,
    c.ultima_posicion,
    greatest(coalesce(l.ultima_posicion, 0), c.oculto_desde),
    greatest(c.ultima_posicion - greatest(coalesce(l.ultima_posicion, 0), c.oculto_desde), 0),
    c.ultima_actividad_at,
    case c.tipo
      when 'cruce' then p.id is null or p.eliminado_at is not null
      when 'predio' then pr.id is null or not pr.activo
      when 'libre' then c.archivado_at is not null
      else false
    end,
    c.creado_por,
    c.oculto_desde,
    public.puede_gestionar_canal_libre(c.id),
    c.creado_at
  from public.chat_canales c
  left join public.chat_lecturas l
    on l.canal_id = c.id and l.usuario_id = auth.uid()
  left join public.plantas p on c.tipo = 'cruce' and p.id = c.entidad_id
  left join public.predio pr on c.tipo = 'predio' and pr.id = c.entidad_id
  where public.puede_acceder_chat(c.id)
  order by c.ultima_actividad_at desc, c.id;
$$;

drop function public.enviar_mensaje_chat(uuid, text, uuid);
create function public.enviar_mensaje_chat(
  p_canal_id uuid,
  p_contenido text,
  p_clave_envio uuid,
  p_mencionados uuid[] default '{}',
  p_mencionar_todos boolean default false
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
  if exists(
    select 1 from unnest(coalesce(p_mencionados, '{}')) mencionado
    where not public.es_participante_chat(p_canal_id, mencionado)
  ) then
    raise exception 'Solo puedes mencionar participantes del canal.' using errcode = '42501';
  end if;

  select * into v_canal from public.chat_canales where id = p_canal_id;
  if p_mencionar_todos and v_canal.tipo = 'general' and not public.es_admin() then
    raise exception 'Solo un administrador puede usar @all en General.' using errcode = '42501';
  end if;
  if v_canal.tipo = 'cruce' then
    perform 1 from public.plantas
    where id = v_canal.entidad_id and eliminado_at is null for share;
    if not found then raise exception 'Esta conversación está archivada.' using errcode = '55000'; end if;
  elsif v_canal.tipo = 'predio' then
    perform 1 from public.predio
    where id = v_canal.entidad_id and activo for share;
    if not found then raise exception 'Esta conversación está archivada.' using errcode = '55000'; end if;
  elsif v_canal.tipo = 'libre' and v_canal.archivado_at is not null then
    raise exception 'Esta conversación está archivada.' using errcode = '55000';
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

  insert into public.chat_menciones(mensaje_id, usuario_id, tipo)
    select v_mensaje.id, mencionado, 'directa'
    from (select distinct unnest(coalesce(p_mencionados, '{}')) mencionado) directas
    where mencionado <> v_uid;
  if p_mencionar_todos then
    insert into public.chat_menciones(mensaje_id, usuario_id, tipo)
      select v_mensaje.id, p.id, 'todos'
      from public.perfiles p
      where p.id <> v_uid and public.es_participante_chat(p_canal_id, p.id)
      on conflict (mensaje_id, usuario_id) do nothing;
  end if;
  return v_mensaje;
end;
$$;

create function public.listar_notificaciones_chat()
returns table(
  mensaje_id uuid,
  canal_id uuid,
  canal_tipo text,
  canal_nombre text,
  autor_nombre text,
  contenido text,
  tipo text,
  creado_at timestamptz,
  leida_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    m.id,
    m.canal_id,
    c.tipo,
    case c.tipo
      when 'general' then 'General'
      else c.entidad_nombre
    end,
    m.autor_nombre,
    m.contenido,
    mn.tipo,
    mn.creado_at,
    mn.leida_at
  from public.chat_menciones mn
  join public.chat_mensajes m on m.id = mn.mensaje_id
  join public.chat_canales c on c.id = m.canal_id
  where mn.usuario_id = auth.uid()
    and public.puede_acceder_chat(m.canal_id)
    and m.posicion > c.oculto_desde
  order by mn.creado_at desc, mn.mensaje_id
  limit 100;
$$;

create function public.marcar_notificacion_chat_leida(p_mensaje_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chat_menciones
  set leida_at = coalesce(leida_at, now())
  where mensaje_id = p_mensaje_id and usuario_id = auth.uid();
$$;

create function public.marcar_todas_notificaciones_chat_leidas()
returns void language sql security definer set search_path = '' as $$
  update public.chat_menciones
  set leida_at = now()
  where usuario_id = auth.uid() and leida_at is null;
$$;

create function public.limpiar_canal_chat(p_canal_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_canal public.chat_canales;
begin
  if not public.es_admin() or not public.puede_acceder_chat(p_canal_id) then
    raise exception 'Solo un administrador participante puede limpiar este canal.' using errcode = '42501';
  end if;
  select * into strict v_canal from public.chat_canales where id = p_canal_id for update;
  if v_canal.tipo = 'libre' and v_canal.archivado_at is not null then
    raise exception 'Esta conversación está archivada.' using errcode = '55000';
  end if;
  update public.chat_canales
  set oculto_desde = ultima_posicion
  where id = p_canal_id
  returning * into v_canal;
  insert into public.audit_log(usuario_id, accion, detalle)
    values (auth.uid(), 'chat_clear', jsonb_build_object(
      'canal_id', p_canal_id,
      'oculto_hasta_posicion', v_canal.oculto_desde
    ));
  return v_canal.oculto_desde;
end;
$$;

revoke all on function public.es_participante_chat(uuid, uuid),
  public.puede_gestionar_canal_libre(uuid),
  public.crear_canal_libre(text, uuid[]),
  public.actualizar_participantes_canal_libre(uuid, uuid[]),
  public.archivar_canal_libre(uuid),
  public.listar_participantes_chat(uuid),
  public.listar_canales_chat(),
  public.enviar_mensaje_chat(uuid, text, uuid, uuid[], boolean),
  public.listar_notificaciones_chat(),
  public.marcar_notificacion_chat_leida(uuid),
  public.marcar_todas_notificaciones_chat_leidas(),
  public.limpiar_canal_chat(uuid)
  from public, anon;

grant execute on function public.crear_canal_libre(text, uuid[]),
  public.actualizar_participantes_canal_libre(uuid, uuid[]),
  public.archivar_canal_libre(uuid),
  public.listar_participantes_chat(uuid),
  public.listar_canales_chat(),
  public.enviar_mensaje_chat(uuid, text, uuid, uuid[], boolean),
  public.listar_notificaciones_chat(),
  public.marcar_notificacion_chat_leida(uuid),
  public.marcar_todas_notificaciones_chat_leidas(),
  public.limpiar_canal_chat(uuid)
  to authenticated;

-- Los cambios de canal despiertan /clear y archivado; las menciones despiertan
-- el centro de notificaciones. Cada tabla conserva RLS en la entrega.
alter publication supabase_realtime add table public.chat_canales, public.chat_menciones;

notify pgrst, 'reload schema';
commit;
