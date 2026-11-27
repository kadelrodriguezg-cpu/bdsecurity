-- Sprint 3: resumen de conversaciones, no leídos y sincronización de lecturas.
-- Los contadores se calculan en servidor desde el cursor monotónico de cada
-- usuario. Realtime solo avisa que hay que volver a consultar esta fuente.
begin;

alter table public.chat_canales
  add column ultima_actividad_at timestamptz not null default now();

update public.chat_canales c
set ultima_actividad_at = coalesce(
  (select max(m.creado_at) from public.chat_mensajes m where m.canal_id = c.id),
  c.creado_at
);

create function public.actualizar_actividad_canal_chat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_canales
  set ultima_actividad_at = greatest(ultima_actividad_at, new.creado_at)
  where id = new.canal_id;
  return new;
end;
$$;

create trigger chat_mensaje_actualiza_actividad
after insert on public.chat_mensajes
for each row execute function public.actualizar_actividad_canal_chat();

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
    coalesce(l.ultima_posicion, 0),
    greatest(c.ultima_posicion - coalesce(l.ultima_posicion, 0), 0),
    c.ultima_actividad_at,
    case c.tipo
      when 'cruce' then p.id is null or p.eliminado_at is not null
      when 'predio' then pr.id is null or not pr.activo
      else false
    end,
    c.creado_at
  from public.chat_canales c
  left join public.chat_lecturas l
    on l.canal_id = c.id and l.usuario_id = auth.uid()
  left join public.plantas p on c.tipo = 'cruce' and p.id = c.entidad_id
  left join public.predio pr on c.tipo = 'predio' and pr.id = c.entidad_id
  where public.puede_acceder_entidad_chat(c.tipo, c.entidad_id, false)
  order by c.ultima_actividad_at desc, c.id;
$$;

revoke all on function public.actualizar_actividad_canal_chat(),
  public.listar_canales_chat() from public, anon;
grant execute on function public.listar_canales_chat() to authenticated;

-- Publicar únicamente el cursor de lectura, protegido por su RLS propia.
-- Así otro dispositivo del mismo usuario puede refrescar el contador sin
-- exponer lecturas ajenas ni ampliar el acceso a mensajes.
alter publication supabase_realtime add table public.chat_lecturas;

notify pgrst, 'reload schema';
commit;
