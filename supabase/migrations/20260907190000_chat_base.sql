-- Chat operativo. Separado de audit_log y registros_evento; no lee linaje.
-- Acceso actual: todos los perfiles autenticados, igual que las vistas
-- operativas. No introduce la asignación operario/planta pendiente de decisión.
begin;

create table public.chat_canales (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('general', 'cruce')),
  planta_id uuid references public.plantas(id) on delete set null,
  codigo_cruce text,
  ultima_posicion integer not null default 0 check (ultima_posicion >= 0),
  creado_at timestamptz not null default now(),
  check ((tipo = 'general' and planta_id is null and codigo_cruce is null)
    or (tipo = 'cruce' and codigo_cruce is not null))
);
create unique index chat_un_general on public.chat_canales(tipo) where tipo = 'general';
create unique index chat_un_canal_por_cruce on public.chat_canales(planta_id) where planta_id is not null;

create table public.chat_mensajes (
  id uuid primary key default gen_random_uuid(),
  canal_id uuid not null references public.chat_canales(id) on delete restrict,
  posicion integer not null check (posicion > 0),
  autor_id uuid references public.perfiles(id) on delete set null,
  autor_nombre text not null,
  contenido text not null check (char_length(btrim(contenido)) between 1 and 4000),
  clave_envio uuid not null,
  creado_at timestamptz not null default now(),
  unique(canal_id, posicion),
  unique(canal_id, autor_id, clave_envio)
);

create table public.chat_lecturas (
  canal_id uuid not null references public.chat_canales(id) on delete cascade,
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  ultima_posicion integer not null check (ultima_posicion >= 0),
  actualizado_at timestamptz not null default now(),
  primary key(canal_id, usuario_id)
);

alter table public.chat_canales enable row level security;
alter table public.chat_mensajes enable row level security;
alter table public.chat_lecturas enable row level security;

create function public.puede_acceder_chat(p_canal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perfiles where id = auth.uid())
    and exists(select 1 from public.chat_canales where id = p_canal_id);
$$;

create policy chat_canales_lectura on public.chat_canales for select to authenticated
  using (public.puede_acceder_chat(id));
create policy chat_mensajes_lectura on public.chat_mensajes for select to authenticated
  using (public.puede_acceder_chat(canal_id));
create policy chat_lecturas_propias on public.chat_lecturas for select to authenticated
  using (usuario_id = auth.uid() and public.puede_acceder_chat(canal_id));

-- Toda escritura pasa por RPC: no se puede falsificar autor/nombre/fecha,
-- editar ni borrar mensajes, tampoco siendo admin de la aplicación.
revoke all on public.chat_canales, public.chat_mensajes, public.chat_lecturas from anon, authenticated;
grant select on public.chat_canales, public.chat_mensajes, public.chat_lecturas to authenticated;
grant all on public.chat_canales, public.chat_mensajes, public.chat_lecturas to service_role;

insert into public.chat_canales(tipo) values ('general');

create function public.obtener_canal_chat(p_planta_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_codigo text;
begin
  if not exists(select 1 from public.perfiles where id = auth.uid()) then
    raise exception 'Se requiere una cuenta con perfil.' using errcode = '42501';
  end if;
  if p_planta_id is null then
    select id into v_id from public.chat_canales where tipo = 'general';
    return v_id;
  end if;
  -- El bloqueo comparte orden con enviar_mensaje_chat: planta antes de canal.
  select codigo_sistema into v_codigo from public.plantas
    where id = p_planta_id and eliminado_at is null for share;
  if not found then
    -- Un canal histórico existente sí puede abrirse, pero no escribirse.
    select id into v_id from public.chat_canales where planta_id = p_planta_id;
    if found then return v_id; end if;
    raise exception 'El cruce no está disponible.' using errcode = 'P0002';
  end if;
  insert into public.chat_canales(tipo, planta_id, codigo_cruce)
    values ('cruce', p_planta_id, v_codigo)
    on conflict (planta_id) where planta_id is not null do nothing;
  select id into v_id from public.chat_canales where planta_id = p_planta_id;
  return v_id;
end;
$$;

create function public.listar_canales_chat()
returns table(id uuid, tipo text, planta_id uuid, codigo_cruce text,
  ultima_posicion integer, archivado boolean, creado_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.tipo, c.planta_id, coalesce(p.codigo_sistema, c.codigo_cruce),
    c.ultima_posicion, (c.tipo = 'cruce' and (p.id is null or p.eliminado_at is not null)), c.creado_at
  from public.chat_canales c left join public.plantas p on p.id = c.planta_id
  where public.puede_acceder_chat(c.id)
  order by (c.tipo = 'general') desc, c.creado_at, c.id;
$$;

create function public.enviar_mensaje_chat(p_canal_id uuid, p_contenido text, p_clave_envio uuid)
returns public.chat_mensajes language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_nombre text; v_canal public.chat_canales;
  v_mensaje public.chat_mensajes; v_contenido text := btrim(p_contenido);
begin
  if not public.puede_acceder_chat(p_canal_id) then
    raise exception 'No tienes acceso a esta conversación.' using errcode = '42501';
  end if;
  if p_clave_envio is null or v_contenido is null or char_length(v_contenido) not between 1 and 4000
    or v_contenido !~ '[^[:space:]]' then
    raise exception 'Escribe un mensaje de entre 1 y 4000 caracteres.' using errcode = '22023';
  end if;
  select * into v_canal from public.chat_canales where id = p_canal_id;
  -- Bloquea soft/hard delete hasta terminar la escritura. No consulta linaje.
  if v_canal.tipo = 'cruce' then
    perform 1 from public.plantas where id = v_canal.planta_id and eliminado_at is null for share;
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
  update public.chat_canales set ultima_posicion = ultima_posicion + 1 where id = p_canal_id
    returning ultima_posicion into v_canal.ultima_posicion;
  insert into public.chat_mensajes(canal_id, posicion, autor_id, autor_nombre, contenido, clave_envio)
    values (p_canal_id, v_canal.ultima_posicion, v_uid, v_nombre, v_contenido, p_clave_envio)
    returning * into v_mensaje;
  return v_mensaje;
end;
$$;

create function public.marcar_chat_leido(p_canal_id uuid, p_posicion integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puede_acceder_chat(p_canal_id) then
    raise exception 'No tienes acceso a esta conversación.' using errcode = '42501';
  end if;
  if p_posicion is null or p_posicion < 0 or p_posicion >
    (select ultima_posicion from public.chat_canales where id = p_canal_id) then
    raise exception 'Posición de lectura inválida.' using errcode = '22023';
  end if;
  insert into public.chat_lecturas(canal_id, usuario_id, ultima_posicion)
    values (p_canal_id, auth.uid(), p_posicion)
    on conflict (canal_id, usuario_id) do update
      set ultima_posicion = greatest(chat_lecturas.ultima_posicion, excluded.ultima_posicion),
          actualizado_at = now();
end;
$$;

revoke all on function public.puede_acceder_chat(uuid), public.obtener_canal_chat(uuid),
  public.listar_canales_chat(), public.enviar_mensaje_chat(uuid, text, uuid),
  public.marcar_chat_leido(uuid, integer) from public, anon;
grant execute on function public.puede_acceder_chat(uuid), public.obtener_canal_chat(uuid),
  public.listar_canales_chat(), public.enviar_mensaje_chat(uuid, text, uuid),
  public.marcar_chat_leido(uuid, integer) to authenticated;

-- Solo mensajes persistidos; no publicar perfiles, audit_log ni tablas genéticas.
alter publication supabase_realtime add table public.chat_mensajes;
notify pgrst, 'reload schema';
commit;
