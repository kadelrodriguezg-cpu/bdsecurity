-- =============================================================================
-- Sprint 7.5.1 (2/4) — Clima histórico por predio: sincronización.
--
-- Diseño en dos fases, forzado por el hallazgo de la migración anterior
-- (net.http_collect_response bloqueante está deprecada y no es confiable):
--
--   1) DESPACHO — sincronizar_clima_predio(): valida el predio, llama
--      net.http_get() (retorna en sub-segundo) y anota el request_id en
--      predio_clima_sync_pendiente. Se llama desde el trigger de
--      geolocalización y desde el refresco mensual. Nunca espera la red,
--      por lo tanto nunca puede bloquear ni hacer fallar el guardado del
--      predio.
--   2) RECOLECCIÓN — recolectar_clima_pendiente(): corre periódicamente
--      (pg_cron, cada 5 minutos — sección 2.8 solo pide refresco "periódico
--      tipo mensual" para mantener al día datos ya sincronizados, pero la
--      recolección de una sincronización recién despachada necesita mucha
--      más frecuencia que eso para que "Sincronizando..." en la UI no quede
--      así por semanas; 5 minutos es un compromiso razonable para 2-10
--      predios, muy por debajo de cualquier límite de tasa de Open-Meteo).
--      Revisa net._http_response por cada pendiente; si ya llegó, agrega
--      diario→mensual y hace upsert en predio_clima_mensual. Si pasó más de
--      1 hora sin respuesta (worker caído, etc.), abandona esa fila con una
--      advertencia en el log en vez de crecer sin límite.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fase 1: despacho. SECURITY DEFINER porque predio_clima_sync_pendiente no
-- tiene grants para authenticated (regla del proyecto: escritura solo vía
-- RPC). p_meses_atras controla el largo del rango pedido a Open-Meteo: 24
-- meses para el backfill inicial (2.8 sugiere "ej. últimos 24 meses" — se
-- adopta tal cual: suficiente para correlacionar con evaluaciones de más de
-- una temporada sin pedir décadas de dato que este proyecto no necesita),
-- 2 meses para el refresco periódico (solo hay que rellenar lo que pasó
-- desde el último refresco).
-- ---------------------------------------------------------------------------
create or replace function sincronizar_clima_predio(p_predio_id uuid, p_meses_atras integer default 24)
returns bigint
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_lat numeric;
  v_lon numeric;
  v_fecha_desde date;
  v_fecha_hasta date;
  v_request_id bigint;
begin
  select latitud, longitud into v_lat, v_lon
  from predio
  where id = p_predio_id;

  if not found then
    raise exception 'Predio % no existe.', p_predio_id
      using errcode = 'P0002';
  end if;

  if v_lat is null or v_lon is null then
    raise exception 'El predio no tiene coordenadas registradas todavía: no se puede sincronizar clima hasta geolocalizarlo.'
      using errcode = '22023';
  end if;

  -- Open-Meteo Historical Weather API solo tiene datos hasta ~5 días atrás
  -- (el archivo ERA5 tiene rezago de reanálisis); se pide hasta ayer para
  -- evitar rangos con cola vacía.
  v_fecha_hasta := (current_date - 1);
  v_fecha_desde := (date_trunc('month', current_date) - (p_meses_atras || ' months')::interval)::date;

  v_request_id := net.http_get(
    url := 'https://archive-api.open-meteo.com/v1/archive',
    params := jsonb_build_object(
      'latitude', v_lat,
      'longitude', v_lon,
      'start_date', v_fecha_desde::text,
      'end_date', v_fecha_hasta::text,
      'daily', 'temperature_2m_max,temperature_2m_min,sunshine_duration,precipitation_sum',
      'timezone', 'auto'
    ),
    timeout_milliseconds := 30000
  );

  insert into predio_clima_sync_pendiente (request_id, predio_id, fecha_desde, fecha_hasta)
  values (v_request_id, p_predio_id, v_fecha_desde, v_fecha_hasta);

  return v_request_id;
end;
$$;

comment on function sincronizar_clima_predio(uuid, integer) is
  'Fase 1 (despacho) de 2.8: valida coordenadas, dispara net.http_get a Open-Meteo y registra el request_id como pendiente. No espera respuesta — retorna en sub-segundo, seguro de llamar desde un trigger de guardado de predio.';

revoke all on function sincronizar_clima_predio(uuid, integer) from public;
grant execute on function sincronizar_clima_predio(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Agregación diario→mensual de un cuerpo de respuesta de Open-Meteo. Función
-- separada (no inline en recolectar_clima_pendiente) para poder probarla
-- directo con un JSON de muestra sin depender de una llamada de red real.
-- ---------------------------------------------------------------------------
create or replace function procesar_respuesta_clima_predio(p_predio_id uuid, p_body jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into predio_clima_mensual (
    predio_id, anio, mes, temp_max_promedio, temp_min_promedio,
    horas_sol_acumuladas, precipitacion_mm, dias_helada, sincronizado_at
  )
  select
    p_predio_id,
    extract(year from dia)::integer,
    extract(month from dia)::integer,
    round(avg(temp_max)::numeric, 1),
    round(avg(temp_min)::numeric, 1),
    round((sum(sol_seg) / 3600.0)::numeric, 1),
    round(sum(precip_mm)::numeric, 1),
    count(*) filter (where temp_min <= 0),
    now()
  from (
    select
      (t.value #>> '{}')::date as dia,
      (tmax.value #>> '{}')::numeric as temp_max,
      (tmin.value #>> '{}')::numeric as temp_min,
      (sol.value #>> '{}')::numeric as sol_seg,
      (precip.value #>> '{}')::numeric as precip_mm
    from jsonb_array_elements(p_body #> '{daily,time}') with ordinality as t(value, idx)
    join jsonb_array_elements(p_body #> '{daily,temperature_2m_max}') with ordinality as tmax(value, idx) using (idx)
    join jsonb_array_elements(p_body #> '{daily,temperature_2m_min}') with ordinality as tmin(value, idx) using (idx)
    join jsonb_array_elements(p_body #> '{daily,sunshine_duration}') with ordinality as sol(value, idx) using (idx)
    join jsonb_array_elements(p_body #> '{daily,precipitation_sum}') with ordinality as precip(value, idx) using (idx)
  ) dias
  group by extract(year from dia), extract(month from dia)
  on conflict (predio_id, anio, mes) do update set
    temp_max_promedio = excluded.temp_max_promedio,
    temp_min_promedio = excluded.temp_min_promedio,
    horas_sol_acumuladas = excluded.horas_sol_acumuladas,
    precipitacion_mm = excluded.precipitacion_mm,
    dias_helada = excluded.dias_helada,
    sincronizado_at = excluded.sincronizado_at;
end;
$$;

comment on function procesar_respuesta_clima_predio(uuid, jsonb) is
  'Agrega la serie diaria de Open-Meteo (daily.time/temperature_2m_max/temperature_2m_min/sunshine_duration/precipitation_sum, arreglos paralelos) a filas mensuales y hace upsert en predio_clima_mensual. sunshine_duration llega en segundos, se convierte a horas. Un mes se cuenta "con helada" si algún día tuvo temp_min <= 0.';

revoke all on function procesar_respuesta_clima_predio(uuid, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Fase 2: recolección. Pensada para correr sola vía pg_cron, sin
-- argumentos, procesando todo lo pendiente en cada corrida.
-- ---------------------------------------------------------------------------
create or replace function recolectar_clima_pendiente()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_pend record;
  v_resp record;
begin
  for v_pend in select * from predio_clima_sync_pendiente loop
    select status_code, content, timed_out, error_msg
    into v_resp
    from net._http_response
    where id = v_pend.request_id;

    if not found then
      -- Todavía no llega respuesta. Si lleva más de 1 hora pendiente, algo
      -- se perdió (worker caído, etc.) — se abandona con advertencia en vez
      -- de acumular filas para siempre.
      if v_pend.created_at < now() - interval '1 hour' then
        raise warning 'clima predio %: request_id % sin respuesta tras 1 hora, se abandona', v_pend.predio_id, v_pend.request_id;
        delete from predio_clima_sync_pendiente where request_id = v_pend.request_id;
      end if;
      continue;
    end if;

    if v_resp.timed_out or v_resp.status_code is distinct from 200 then
      raise warning 'clima predio %: fallo en Open-Meteo (status=%, timed_out=%, error=%)',
        v_pend.predio_id, v_resp.status_code, v_resp.timed_out, v_resp.error_msg;
      delete from predio_clima_sync_pendiente where request_id = v_pend.request_id;
      continue;
    end if;

    begin
      perform procesar_respuesta_clima_predio(v_pend.predio_id, v_resp.content::jsonb);
    exception when others then
      raise warning 'clima predio %: error procesando respuesta (request_id %): %',
        v_pend.predio_id, v_pend.request_id, sqlerrm;
    end;

    delete from predio_clima_sync_pendiente where request_id = v_pend.request_id;
  end loop;
end;
$$;

comment on function recolectar_clima_pendiente() is
  'Fase 2 (recolección) de 2.8: revisa net._http_response por cada fila de predio_clima_sync_pendiente; si llegó, agrega y guarda; si falló, deja advertencia en el log y descarta (no bloquea nada, no reintenta indefinidamente). Corre vía pg_cron cada 5 minutos.';

revoke all on function recolectar_clima_pendiente() from public;

-- ---------------------------------------------------------------------------
-- Trigger: primera geolocalización de un predio dispara el backfill de 24
-- meses. BEGIN/EXCEPTION propio además del diseño async: aunque el despacho
-- ya es rápido y no debería fallar, un error de red a nivel de socket al
-- llamar net.http_get no debe poder tumbar el guardado del predio bajo
-- ninguna circunstancia (requisito explícito de 2.8).
-- ---------------------------------------------------------------------------
create or replace function trigger_sincronizar_clima_predio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.latitud is not null and new.longitud is not null
     and (tg_op = 'INSERT' or old.latitud is null or old.longitud is null) then
    begin
      perform sincronizar_clima_predio(new.id, 24);
    exception when others then
      raise warning 'clima predio %: no se pudo despachar sincronización inicial: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sincronizar_clima_predio on predio;
create trigger trg_sincronizar_clima_predio
  after insert or update of latitud, longitud on predio
  for each row
  execute function trigger_sincronizar_clima_predio();

comment on trigger trg_sincronizar_clima_predio on predio is
  'Al geolocalizar un predio por primera vez, despacha (no espera) el backfill de 24 meses de clima histórico (2.8). Envuelto en su propio manejo de excepción: un fallo acá nunca revierte el guardado del predio.';

-- ---------------------------------------------------------------------------
-- Refresco mensual: para todo predio ya geolocalizado, despacha una
-- sincronización corta (2 meses) que sirve tanto para completar datos
-- recientes (el archivo ERA5 tiene unos días de rezago) como para
-- autosanar cualquier predio cuyo backfill inicial haya fallado en su
-- momento (el upsert de procesar_respuesta_clima_predio es idempotente).
-- ---------------------------------------------------------------------------
create or replace function refrescar_clima_predios()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_predio record;
begin
  for v_predio in
    select id from predio where latitud is not null and longitud is not null
  loop
    begin
      perform sincronizar_clima_predio(v_predio.id, 2);
    exception when others then
      raise warning 'clima predio %: no se pudo despachar refresco mensual: %', v_predio.id, sqlerrm;
    end;
  end loop;
end;
$$;

comment on function refrescar_clima_predios() is
  'Refresco periódico de 2.8: despacha una sincronización de 2 meses para cada predio geolocalizado. También autosana backfills iniciales fallidos (upsert idempotente). Corre vía pg_cron una vez al mes.';

revoke all on function refrescar_clima_predios() from public;

-- ---------------------------------------------------------------------------
-- pg_cron: única forma de tarea programada disponible en este proyecto (sin
-- precedente previo de uso — confirmado por grep en todas las migraciones
-- existentes). Se habilita acá por primera vez.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'clima-recolectar',
  '*/5 * * * *',
  $$select recolectar_clima_pendiente();$$
);

select cron.schedule(
  'clima-refresco-mensual',
  '0 6 1 * *',
  $$select refrescar_clima_predios();$$
);
