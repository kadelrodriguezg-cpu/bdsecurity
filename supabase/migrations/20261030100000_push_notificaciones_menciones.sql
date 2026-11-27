-- =============================================================================
-- Notificaciones push del chat, fase 1: menciones (docs/diseno_notificaciones_push.md).
--
-- Solo aditiva: crea dos tablas, sus funciones, un trigger nuevo sobre
-- chat_menciones y dos jobs de pg_cron. No modifica ningún objeto existente.
--
-- Mismo patrón de dos fases que el clima (20260719021000):
--   1) DESPACHO: el trigger AFTER INSERT de chat_menciones anota la mención en
--      push_envio y llama net.http_post a la función de Vercel. pg_net encola el
--      pedido en una tabla, así que nunca espera la red, y si la transacción del
--      mensaje se revierte el pedido desaparece con ella.
--   2) RECOLECCIÓN: recoger_respuestas_push() corre cada minuto por pg_cron, lee
--      net._http_response y marca enviado / fallido, borra las suscripciones
--      vencidas (404/410) y reintenta con espera creciente hasta 5 intentos.
--
-- La notificación nunca lleva el texto del mensaje (modelo de amenaza:
-- espionaje industrial; la notificación aparece en la pantalla bloqueada).
-- La URL de la función y el secreto compartido viven en Supabase Vault
-- (push_funcion_url, push_secreto); acá solo se leen por nombre.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Suscripciones: una fila por dispositivo y usuario. El endpoint se limita a
-- los servicios push de los navegadores soportados (Chrome/Android, Firefox,
-- Safari/iOS, Edge): además de exigir https, así ninguna suscripción puede
-- hacer que la función de Vercel llame a una IP privada u otro host.
-- ---------------------------------------------------------------------------
create table public.push_suscripcion (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  creada_at timestamptz not null default now(),
  ultimo_uso_at timestamptz not null default now(),
  constraint push_suscripcion_endpoint_valido check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?/[^[:space:]]*$'
  ),
  constraint push_suscripcion_p256dh_valido check (p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'),
  constraint push_suscripcion_auth_valido check (auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'),
  constraint push_suscripcion_user_agent_largo check (char_length(user_agent) <= 200)
);

create index push_suscripcion_usuario on public.push_suscripcion(usuario_id, ultimo_uso_at desc);

comment on table public.push_suscripcion is
  'Suscripciones Web Push por dispositivo. Se escriben solo por registrar_suscripcion_push / eliminar_suscripcion_push; cada usuario ve y borra las suyas.';

-- ---------------------------------------------------------------------------
-- Bandeja de salida e historial: una fila por mención. chat_menciones no tiene
-- columna id (su clave es mensaje_id + usuario_id), así que la FK es compuesta.
-- suscripciones_pendientes: en un reintento, solo las que fallaron con un error
-- transitorio (null = todas las del usuario).
-- ---------------------------------------------------------------------------
create table public.push_envio (
  id bigint generated always as identity primary key,
  mensaje_id uuid not null,
  usuario_id uuid not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'fallido', 'sin_suscripcion')),
  intentos integer not null default 0 check (intentos >= 0),
  request_id bigint,
  suscripciones_pendientes uuid[],
  ultimo_error text check (char_length(ultimo_error) <= 300),
  proximo_intento_at timestamptz,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  constraint push_envio_mencion_unica unique (mensaje_id, usuario_id),
  constraint push_envio_mencion_fkey foreign key (mensaje_id, usuario_id)
    references public.chat_menciones(mensaje_id, usuario_id) on delete cascade
);

create index push_envio_usuario on public.push_envio(usuario_id, creado_at desc);
create index push_envio_pendientes on public.push_envio(proximo_intento_at) where estado = 'pendiente';

comment on table public.push_envio is
  'Bandeja de salida de las notificaciones push de menciones. La escriben el trigger de chat_menciones y el cron; el usuario solo lee las suyas.';

alter table public.push_suscripcion enable row level security;
alter table public.push_envio enable row level security;

create policy push_suscripcion_lectura_propia on public.push_suscripcion
  for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy push_suscripcion_borrado_propio on public.push_suscripcion
  for delete to authenticated
  using (usuario_id = (select auth.uid()));
create policy push_envio_lectura_propia on public.push_envio
  for select to authenticated
  using (usuario_id = (select auth.uid()));

revoke all on public.push_suscripcion, public.push_envio from anon, authenticated;
grant select, delete on public.push_suscripcion to authenticated;
grant select on public.push_envio to authenticated;
grant all on public.push_suscripcion, public.push_envio to service_role;

-- ---------------------------------------------------------------------------
-- RPC del cliente
-- ---------------------------------------------------------------------------
create function public.registrar_suscripcion_push(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(select 1 from public.perfiles where id = v_uid) then
    raise exception 'Inicia sesión para activar las notificaciones.' using errcode = '42501';
  end if;
  begin
    -- Un endpoint que estaba a nombre de otra persona (PC compartido) pasa al
    -- usuario actual: el dispositivo es uno solo y recibe lo de quien lo usa.
    insert into public.push_suscripcion(usuario_id, endpoint, p256dh, auth, user_agent)
      values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
      on conflict (endpoint) do update set
        usuario_id = excluded.usuario_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        ultimo_uso_at = now();
  exception when check_violation or not_null_violation then
    raise exception 'Este navegador entregó una suscripción no válida.' using errcode = '22023';
  end;
  -- La función de Vercel acepta hasta 10 suscripciones por envío.
  delete from public.push_suscripcion
  where usuario_id = v_uid
    and id not in (
      select id from public.push_suscripcion
      where usuario_id = v_uid
      order by ultimo_uso_at desc, creada_at desc
      limit 10
    );
end;
$$;

create function public.eliminar_suscripcion_push(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_suscripcion
  where endpoint = p_endpoint and usuario_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Interno: programa el siguiente intento (1, 2, 4 y 8 minutos) o, al quinto
-- intento, deja el envío en fallido. p_contar = true cuando el intento falló
-- antes de llegar a net.http_post (Vault, datos): así también cuenta.
-- ---------------------------------------------------------------------------
create function public.programar_reintento_push(
  p_envio_id bigint,
  p_error text,
  p_pendientes uuid[] default null,
  p_contar boolean default false
)
returns void language sql security definer set search_path = '' as $$
  update public.push_envio e
  set
    intentos = e.intentos + case when p_contar then 1 else 0 end,
    request_id = null,
    ultimo_error = left(coalesce(p_error, 'error sin detalle'), 300),
    suscripciones_pendientes = coalesce(p_pendientes, e.suscripciones_pendientes),
    estado = case when e.intentos + case when p_contar then 1 else 0 end >= 5 then 'fallido' else 'pendiente' end,
    proximo_intento_at = case
      when e.intentos + case when p_contar then 1 else 0 end >= 5 then null
      else now() + make_interval(mins => power(2, greatest(e.intentos + case when p_contar then 1 else 0 end, 1) - 1)::integer)
    end,
    actualizado_at = now()
  where e.id = p_envio_id;
$$;

-- ---------------------------------------------------------------------------
-- Interno: arma el payload (sin texto del mensaje) y dispara net.http_post.
-- Devuelve el request_id, o null si el usuario ya no tiene suscripciones.
-- ---------------------------------------------------------------------------
create function public.despachar_push_envio(p_envio_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_envio public.push_envio;
  v_suscripciones jsonb;
  v_autor text;
  v_tipo text;
  v_canal_id uuid;
  v_canal_nombre text;
  v_url text;
  v_secreto text;
  v_request_id bigint;
begin
  select * into strict v_envio from public.push_envio where id = p_envio_id for update;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth
    )), '[]'::jsonb)
  into v_suscripciones
  from (
    select * from public.push_suscripcion
    where usuario_id = v_envio.usuario_id
      and (v_envio.suscripciones_pendientes is null or id = any(v_envio.suscripciones_pendientes))
    order by ultimo_uso_at desc
    limit 10
  ) s;

  if jsonb_array_length(v_suscripciones) = 0 then
    update public.push_envio
    set estado = 'sin_suscripcion', request_id = null, proximo_intento_at = null, actualizado_at = now()
    where id = p_envio_id;
    return null;
  end if;

  select m.autor_nombre, mn.tipo, m.canal_id,
    case c.tipo when 'general' then 'General' else c.entidad_nombre end
  into strict v_autor, v_tipo, v_canal_id, v_canal_nombre
  from public.chat_menciones mn
  join public.chat_mensajes m on m.id = mn.mensaje_id
  join public.chat_canales c on c.id = m.canal_id
  where mn.mensaje_id = v_envio.mensaje_id and mn.usuario_id = v_envio.usuario_id;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_funcion_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'push_secreto';
  if v_url is null or v_secreto is null then
    raise exception 'Faltan los secretos push_funcion_url o push_secreto en Vault.' using errcode = '55000';
  end if;

  v_request_id := net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'suscripciones', v_suscripciones,
      'notificacion', jsonb_build_object(
        'titulo', left(v_autor, 80) || case v_tipo when 'todos' then ' escribió a todos' else ' te mencionó' end,
        'cuerpo', 'En ' || left(coalesce(v_canal_nombre, 'el chat'), 80) || '. Abre la app para ver el mensaje.',
        'url', '/?chat=' || v_canal_id || '&mensaje=' || v_envio.mensaje_id,
        'tag', v_envio.mensaje_id::text
      )
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secreto', v_secreto),
    timeout_milliseconds := 15000
  );

  update public.push_envio
  set estado = 'pendiente', request_id = v_request_id, intentos = intentos + 1,
      proximo_intento_at = null, actualizado_at = now()
  where id = p_envio_id;
  return v_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: cada mención nueva pasa por la bandeja. Todo va dentro de un bloque
-- de excepción: una falla de Vault, de pg_net o de la propia bandeja nunca
-- revierte el mensaje ni la mención (mismo criterio que el clima). Si falla el
-- despacho, la fila queda para que el cron la reintente.
-- ---------------------------------------------------------------------------
create function public.trigger_push_mencion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_envio_id bigint;
  v_estado text;
begin
  begin
    insert into public.push_envio(mensaje_id, usuario_id, estado)
      values (
        new.mensaje_id,
        new.usuario_id,
        case when exists(select 1 from public.push_suscripcion where usuario_id = new.usuario_id)
          then 'pendiente' else 'sin_suscripcion' end
      )
      on conflict (mensaje_id, usuario_id) do nothing
      returning id, estado into v_envio_id, v_estado;
    if v_estado = 'pendiente' then
      begin
        perform public.despachar_push_envio(v_envio_id);
      exception when others then
        raise warning 'push mención %: no se pudo despachar: %', new.mensaje_id, sqlerrm;
        perform public.programar_reintento_push(v_envio_id, sqlerrm, null, true);
      end;
    end if;
  exception when others then
    raise warning 'push mención %: no se pudo registrar el envío: %', new.mensaje_id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger trg_push_mencion
  after insert on public.chat_menciones
  for each row
  execute function public.trigger_push_mencion();

comment on trigger trg_push_mencion on public.chat_menciones is
  'Despacha (no espera) la notificación push de la mención. Envuelto en su propio manejo de excepción: un fallo acá nunca revierte el mensaje.';

-- ---------------------------------------------------------------------------
-- Recolección (cron, cada minuto).
--   201 (o cualquier 2xx) → enviado; 404/410 → se borra la suscripción;
--   429, 5xx, 0 (sin conexión) o sin respuesta tras 2 minutos → reintento;
--   otro 4xx → error permanente de esa suscripción.
-- ---------------------------------------------------------------------------
create function public.recoger_respuestas_push()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_envio record;
  v_resp record;
  v_resultados jsonb;
  v_item jsonb;
  v_id uuid;
  v_estado integer;
  v_exito boolean;
  v_reintentar uuid[];
  v_permanente text;
begin
  for v_envio in
    select * from public.push_envio
    where estado = 'pendiente' and request_id is not null
    order by id
    for update skip locked
  loop
    begin
      select status_code, content, timed_out, error_msg into v_resp
      from net._http_response where id = v_envio.request_id;

      if not found then
        if v_envio.actualizado_at < now() - interval '2 minutes' then
          perform public.programar_reintento_push(v_envio.id, 'sin respuesta de la función');
        end if;
        continue;
      end if;

      if v_resp.timed_out or v_resp.status_code is distinct from 200 then
        perform public.programar_reintento_push(v_envio.id, format('la función respondió %s%s',
          coalesce(v_resp.status_code::text, 'sin estado'),
          case when v_resp.timed_out then ' (tiempo agotado)' when v_resp.error_msg is not null then ' (' || left(v_resp.error_msg, 120) || ')' else '' end));
        continue;
      end if;

      begin
        v_resultados := v_resp.content::jsonb -> 'resultados';
      exception when others then
        v_resultados := null;
      end;
      if v_resultados is null or jsonb_typeof(v_resultados) <> 'array' then
        perform public.programar_reintento_push(v_envio.id, 'respuesta ilegible de la función');
        continue;
      end if;

      v_exito := false;
      v_reintentar := '{}';
      v_permanente := null;
      for v_item in select value from jsonb_array_elements(v_resultados) loop
        v_id := (v_item ->> 'id')::uuid;
        v_estado := coalesce((v_item ->> 'estado')::integer, 0);
        if v_estado between 200 and 299 then
          v_exito := true;
          update public.push_suscripcion set ultimo_uso_at = now() where id = v_id;
        elsif v_estado in (404, 410) then
          delete from public.push_suscripcion where id = v_id;
        elsif v_estado = 0 or v_estado = 429 or v_estado >= 500 then
          v_reintentar := v_reintentar || v_id;
        else
          v_permanente := format('el servicio push rechazó una suscripción (%s)', v_estado);
        end if;
      end loop;

      if cardinality(v_reintentar) > 0 then
        perform public.programar_reintento_push(v_envio.id,
          format('%s suscripción(es) con error transitorio', cardinality(v_reintentar)), v_reintentar);
      elsif v_exito then
        update public.push_envio
        set estado = 'enviado', request_id = null, ultimo_error = v_permanente,
            suscripciones_pendientes = null, proximo_intento_at = null, actualizado_at = now()
        where id = v_envio.id;
      elsif v_permanente is null then
        -- Todas estaban vencidas y se borraron.
        update public.push_envio
        set estado = 'sin_suscripcion', request_id = null, suscripciones_pendientes = null,
            proximo_intento_at = null, actualizado_at = now()
        where id = v_envio.id;
      else
        update public.push_envio
        set estado = 'fallido', request_id = null, ultimo_error = v_permanente,
            proximo_intento_at = null, actualizado_at = now()
        where id = v_envio.id;
      end if;
    exception when others then
      raise warning 'push envío %: error al recoger la respuesta: %', v_envio.id, sqlerrm;
    end;
  end loop;

  for v_envio in
    select id from public.push_envio
    where estado = 'pendiente' and request_id is null and proximo_intento_at <= now()
    order by id
    for update skip locked
  loop
    begin
      perform public.despachar_push_envio(v_envio.id);
    exception when others then
      raise warning 'push envío %: no se pudo reintentar: %', v_envio.id, sqlerrm;
      perform public.programar_reintento_push(v_envio.id, sqlerrm, null, true);
    end;
  end loop;
end;
$$;

-- Retención: el historial de lo entregado (o sin destino) se borra a los 30 días.
-- Los fallidos se conservan para diagnóstico.
create function public.limpiar_push_envio()
returns void language sql security definer set search_path = '' as $$
  delete from public.push_envio
  where estado in ('enviado', 'sin_suscripcion') and actualizado_at < now() - interval '30 days';
$$;

comment on function public.recoger_respuestas_push() is
  'Fase 2 de las notificaciones push: lee net._http_response, marca enviado/fallido, borra suscripciones vencidas y reintenta con espera creciente (5 intentos). Corre vía pg_cron cada minuto.';

revoke all on function public.registrar_suscripcion_push(text, text, text, text),
  public.eliminar_suscripcion_push(text),
  public.programar_reintento_push(bigint, text, uuid[], boolean),
  public.despachar_push_envio(bigint),
  public.trigger_push_mencion(),
  public.recoger_respuestas_push(),
  public.limpiar_push_envio()
  from public, anon, authenticated;

grant execute on function public.registrar_suscripcion_push(text, text, text, text),
  public.eliminar_suscripcion_push(text)
  to authenticated;

select cron.schedule('push-recoger', '* * * * *', $$select public.recoger_respuestas_push();$$);
select cron.schedule('push-retencion', '20 4 * * *', $$select public.limpiar_push_envio();$$);

notify pgrst, 'reload schema';
commit;
